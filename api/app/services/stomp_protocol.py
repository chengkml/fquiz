from __future__ import annotations

from dataclasses import dataclass

SUPPORTED_STOMP_VERSIONS = ("1.2", "1.1", "1.0")
STOMP_SUBPROTOCOLS = ("v12.stomp", "v11.stomp", "v10.stomp")
TOPIC_DESTINATION_PREFIX = "/topic/"


@dataclass(frozen=True)
class StompFrame:
    command: str
    headers: dict[str, str]
    body: str = ""


def select_stomp_version(accept_version_header: str | None) -> str | None:
    if not accept_version_header:
        return "1.0"
    requested = {version.strip() for version in accept_version_header.split(",") if version.strip()}
    for version in SUPPORTED_STOMP_VERSIONS:
        if version in requested:
            return version
    return None


def topic_to_destination(topic: str) -> str:
    return f"{TOPIC_DESTINATION_PREFIX}{topic}"


def destination_to_topic(destination: str) -> str | None:
    if destination.startswith(TOPIC_DESTINATION_PREFIX):
        topic = destination[len(TOPIC_DESTINATION_PREFIX):].strip()
        return topic if topic else None
    return None


def build_stomp_frame(command: str, *, headers: dict[str, str] | None = None, body: str = "") -> str:
    lines = [command]
    for key, value in (headers or {}).items():
        lines.append(f"{_escape_header(key)}:{_escape_header(value)}")
    lines.append("")
    return "\n".join(lines) + body + "\x00"


def parse_stomp_frames(payload: str) -> list[StompFrame]:
    frames: list[StompFrame] = []
    cursor = 0
    data = payload.replace("\r\n", "\n")

    while cursor < len(data):
        while cursor < len(data) and data[cursor] == "\n":
            cursor += 1
        if cursor >= len(data):
            break

        terminator = data.find("\x00", cursor)
        if terminator < 0:
            raise ValueError("frame_terminator_missing")

        raw_frame = data[cursor:terminator]
        cursor = terminator + 1
        if not raw_frame:
            continue

        frames.append(_parse_single_frame(raw_frame))

    return frames


def _parse_single_frame(raw_frame: str) -> StompFrame:
    header_blob, has_body, body = raw_frame.partition("\n\n")
    header_lines = [line.rstrip("\r") for line in header_blob.split("\n")]
    if not header_lines:
        raise ValueError("missing_command")

    command = header_lines[0].strip().upper()
    if not command:
        raise ValueError("missing_command")

    headers: dict[str, str] = {}
    for line in header_lines[1:]:
        if not line:
            continue
        if ":" not in line:
            raise ValueError("malformed_header")
        key, value = line.split(":", 1)
        headers[_unescape_header(key)] = _unescape_header(value)

    if not has_body:
        body = ""
    if "content-length" in headers:
        try:
            size = int(headers["content-length"])
        except ValueError as exc:
            raise ValueError("invalid_content_length") from exc
        if size < 0:
            raise ValueError("invalid_content_length")
        body = body[:size]

    return StompFrame(command=command, headers=headers, body=body)


def _escape_header(value: str) -> str:
    return (
        value.replace("\\", "\\\\")
        .replace("\r", "\\r")
        .replace("\n", "\\n")
        .replace(":", "\\c")
    )


def _unescape_header(value: str) -> str:
    result = ""
    cursor = 0
    while cursor < len(value):
        char = value[cursor]
        if char != "\\":
            result += char
            cursor += 1
            continue
        cursor += 1
        if cursor >= len(value):
            result += "\\"
            break
        escaped = value[cursor]
        cursor += 1
        if escaped == "r":
            result += "\r"
        elif escaped == "n":
            result += "\n"
        elif escaped == "c":
            result += ":"
        else:
            result += escaped
    return result
