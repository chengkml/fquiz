from __future__ import annotations

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from ...core.database import get_db
from ...core.dependencies import CurrentUser, get_current_user
from ...services.legacy_authz_service import get_user_authorization, is_user_enabled
from ...services.stomp_protocol import (
    STOMP_SUBPROTOCOLS,
    build_stomp_frame,
    destination_to_topic,
    parse_stomp_frames,
    select_stomp_version,
)
from ...services.topic_registry import get_auto_topics, validate_topic_subscription
from ...services.user_service import get_user_by_id
from ...services.ws_manager import ws_connection_manager
from ...services.ws_ticket_service import ws_ticket_service
from ...schemas.ws import WsTicketResponse

router = APIRouter(prefix="/ws", tags=["ws"])


@router.post("/ticket", response_model=WsTicketResponse)
def create_ws_ticket(
    current_user: CurrentUser = Depends(get_current_user),
) -> WsTicketResponse:
    ticket, expires_in = ws_ticket_service.issue(current_user.user.id)
    return WsTicketResponse(ticket=ticket, expires_in=expires_in)


async def _authenticate_websocket(
    websocket: WebSocket,
    db: Session,
) -> tuple[str, set[str], set[str]] | None:
    ticket = websocket.query_params.get("ticket")
    user_id = ws_ticket_service.consume(ticket)
    if not user_id:
        await websocket.close(code=4401, reason="invalid_ws_ticket")
        return None

    user = get_user_by_id(db, user_id)
    if not user or not is_user_enabled(user.status):
        await websocket.close(code=4403, reason="user_not_allowed")
        return None

    authz = get_user_authorization(db, user.id)
    return user.id, authz.role_codes, authz.permission_codes


@router.websocket("")
async def websocket_endpoint(websocket: WebSocket, db: Session = Depends(get_db)) -> None:
    auth_result = await _authenticate_websocket(websocket, db)
    if not auth_result:
        return
    user_id, role_codes, permission_codes = auth_result

    await websocket.accept()
    connection = await ws_connection_manager.register(
        websocket,
        user_id=user_id,
        role_codes=role_codes,
        permission_codes=permission_codes,
    )

    await websocket.send_json(
        {
            "type": "ready",
            "connection_id": connection.connection_id,
            "user_id": user_id,
            "auto_topics": sorted(get_auto_topics()),
        }
    )

    try:
        while True:
            message = await websocket.receive_json()
            message_type = message.get("type")

            if message_type == "ping":
                await websocket.send_json({"type": "pong"})
                continue

            if message_type == "subscribe":
                topics = [topic for topic in message.get("topics", []) if isinstance(topic, str)]
                accepted: list[str] = []
                rejected: list[dict[str, str]] = []
                for topic in topics:
                    is_allowed, reason = validate_topic_subscription(
                        topic,
                        role_codes=connection.role_codes,
                        permission_codes=connection.permission_codes,
                    )
                    if is_allowed:
                        accepted.append(topic)
                    else:
                        rejected.append({"topic": topic, "reason": reason or "forbidden"})
                accepted = await ws_connection_manager.subscribe(connection.connection_id, accepted)
                await websocket.send_json(
                    {
                        "type": "subscribed",
                        "topics": accepted,
                        "rejected": rejected,
                    }
                )
                continue

            if message_type == "unsubscribe":
                topics = [topic for topic in message.get("topics", []) if isinstance(topic, str)]
                removed = await ws_connection_manager.unsubscribe(connection.connection_id, topics)
                await websocket.send_json({"type": "unsubscribed", "topics": removed})
                continue

            await websocket.send_json(
                {
                    "type": "error",
                    "code": "unsupported_message_type",
                    "message": "Unsupported ws message type",
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        await ws_connection_manager.unregister(connection.connection_id)


async def _accept_stomp_socket(websocket: WebSocket) -> None:
    offered = websocket.headers.get("sec-websocket-protocol", "")
    offered_set = {item.strip() for item in offered.split(",") if item.strip()}
    for protocol in STOMP_SUBPROTOCOLS:
        if protocol in offered_set:
            await websocket.accept(subprotocol=protocol)
            return
    await websocket.accept()


async def _send_stomp_error(websocket: WebSocket, message: str, *, code: str | None = None) -> None:
    body = code if code else message
    await websocket.send_text(
        build_stomp_frame(
            "ERROR",
            headers={
                "message": message,
                "content-type": "text/plain",
            },
            body=body,
        )
    )


async def _send_stomp_receipt_if_requested(websocket: WebSocket, frame_headers: dict[str, str]) -> None:
    receipt_id = frame_headers.get("receipt")
    if not receipt_id:
        return
    await websocket.send_text(build_stomp_frame("RECEIPT", headers={"receipt-id": receipt_id}))


@router.websocket("/stomp")
async def websocket_stomp_endpoint(websocket: WebSocket, db: Session = Depends(get_db)) -> None:
    auth_result = await _authenticate_websocket(websocket, db)
    if not auth_result:
        return
    user_id, role_codes, permission_codes = auth_result

    await _accept_stomp_socket(websocket)

    connection = None
    connected = False

    try:
        while True:
            raw_payload = await websocket.receive_text()
            try:
                frames = parse_stomp_frames(raw_payload)
            except ValueError as exc:
                await _send_stomp_error(websocket, "Invalid STOMP frame", code=str(exc))
                continue

            for frame in frames:
                if not connected:
                    if frame.command not in {"CONNECT", "STOMP"}:
                        await _send_stomp_error(
                            websocket,
                            "First STOMP frame must be CONNECT",
                            code="connect_required",
                        )
                        await websocket.close(code=1002, reason="connect_required")
                        return

                    version = select_stomp_version(frame.headers.get("accept-version"))
                    if not version:
                        await _send_stomp_error(
                            websocket,
                            "Unsupported STOMP version",
                            code="unsupported_version",
                        )
                        await websocket.close(code=1002, reason="unsupported_version")
                        return

                    connection = await ws_connection_manager.register(
                        websocket,
                        user_id=user_id,
                        role_codes=role_codes,
                        permission_codes=permission_codes,
                        protocol="stomp",
                    )
                    connected = True
                    await websocket.send_text(
                        build_stomp_frame(
                            "CONNECTED",
                            headers={
                                "version": version,
                                "session": connection.connection_id,
                                "server": "fquiz-stomp/1.0",
                                "heart-beat": "0,0",
                            },
                        )
                    )
                    await _send_stomp_receipt_if_requested(websocket, frame.headers)
                    continue

                if frame.command == "SUBSCRIBE":
                    destination = frame.headers.get("destination", "")
                    subscription_id = frame.headers.get("id", "").strip()
                    topic = destination_to_topic(destination)
                    if not topic or not subscription_id:
                        await _send_stomp_error(
                            websocket,
                            "SUBSCRIBE requires destination and id",
                            code="invalid_subscribe",
                        )
                        continue

                    is_allowed, reason = validate_topic_subscription(
                        topic,
                        role_codes=connection.role_codes,
                        permission_codes=connection.permission_codes,
                    )
                    if not is_allowed:
                        await _send_stomp_error(
                            websocket,
                            f"Subscription forbidden: {topic}",
                            code=reason or "forbidden",
                        )
                        continue

                    await ws_connection_manager.subscribe(
                        connection.connection_id,
                        [topic],
                        subscription_ids={topic: subscription_id},
                    )
                    await _send_stomp_receipt_if_requested(websocket, frame.headers)
                    continue

                if frame.command == "UNSUBSCRIBE":
                    subscription_id = frame.headers.get("id", "").strip()
                    destination = frame.headers.get("destination", "")
                    if subscription_id:
                        await ws_connection_manager.unsubscribe_by_subscription_id(
                            connection.connection_id,
                            subscription_id,
                        )
                    else:
                        topic = destination_to_topic(destination)
                        if topic:
                            await ws_connection_manager.unsubscribe(connection.connection_id, [topic])
                    await _send_stomp_receipt_if_requested(websocket, frame.headers)
                    continue

                if frame.command == "DISCONNECT":
                    await _send_stomp_receipt_if_requested(websocket, frame.headers)
                    await websocket.close(code=1000, reason="client_disconnect")
                    return

                if frame.command == "SEND":
                    destination = frame.headers.get("destination", "")
                    if destination not in {"", "/app/ping"}:
                        await _send_stomp_error(
                            websocket,
                            f"SEND destination not supported: {destination}",
                            code="unsupported_destination",
                        )
                        continue
                    await _send_stomp_receipt_if_requested(websocket, frame.headers)
                    continue

                if frame.command in {"ACK", "NACK", "BEGIN", "COMMIT", "ABORT"}:
                    await _send_stomp_receipt_if_requested(websocket, frame.headers)
                    continue

                await _send_stomp_error(
                    websocket,
                    f"Unsupported STOMP command: {frame.command}",
                    code="unsupported_command",
                )

    except WebSocketDisconnect:
        pass
    finally:
        if connection:
            await ws_connection_manager.unregister(connection.connection_id)
