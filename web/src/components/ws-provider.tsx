"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/components/auth-provider";
import { getApiBaseUrl } from "@/lib/api";
import { buildStompFrame, parseStompFrames, topicToDestination } from "@/lib/stomp";
import type { WsEventEnvelope, WsTicketResponse } from "@/types/ws";

type TopicHandler = (event: WsEventEnvelope) => void;

type WSContextValue = {
  connected: boolean;
  subscribeTopic: (topic: string, handler: TopicHandler) => () => void;
  sendPing: () => void;
};

const WSContext = createContext<WSContextValue | undefined>(undefined);

function toWebSocketUrl(path: string): string {
  const base = getApiBaseUrl();
  const url = new URL(path, base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function WSProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const { user, fetchWithAuth, logout, refreshAccessToken } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const stompConnectedRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const desiredTopicsRef = useRef<Set<string>>(new Set());
  const handlersRef = useRef<Map<string, Set<TopicHandler>>>(new Map());
  const seenEventIdsRef = useRef<string[]>([]);
  const userIdRef = useRef<string | null>(null);
  const connectRef = useRef<(() => Promise<void>) | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    userIdRef.current = user?.id ?? null;
  }, [user]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const rememberEventId = (eventId: string) => {
    seenEventIdsRef.current.push(eventId);
    if (seenEventIdsRef.current.length > 200) {
      seenEventIdsRef.current.shift();
    }
  };

  const hasSeenEvent = (eventId: string) => seenEventIdsRef.current.includes(eventId);

  const subscriptionIdForTopic = (topic: string) => `topic:${topic}`;

  const sendSubscribeFrame = useCallback((topic: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !stompConnectedRef.current) {
      return;
    }
    socket.send(
      buildStompFrame({
        command: "SUBSCRIBE",
        headers: {
          id: subscriptionIdForTopic(topic),
          destination: topicToDestination(topic),
        },
      }),
    );
  }, []);

  const sendUnsubscribeFrame = useCallback((topic: string) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !stompConnectedRef.current) {
      return;
    }
    socket.send(
      buildStompFrame({
        command: "UNSUBSCRIBE",
        headers: { id: subscriptionIdForTopic(topic) },
      }),
    );
  }, []);

  const handleIncomingEvent = useCallback((event: WsEventEnvelope) => {
    if (!event || typeof event.id !== "string" || typeof event.topic !== "string") {
      return;
    }
    if (hasSeenEvent(event.id)) {
      return;
    }
    rememberEventId(event.id);

    if (event.topic === "auth") {
      if (event.name === "auth.permission_changed") {
        void refreshAccessToken();
      }
      if (event.name === "auth.profile_changed") {
        const status = typeof event.payload.status === "string" ? event.payload.status : null;
        if (status && status !== "active") {
          void logout();
          return;
        }
        void refreshAccessToken();
      }
    }

    if (event.meta?.requires_refetch) {
      for (const key of event.meta.requires_refetch) {
        void queryClient.invalidateQueries({
          predicate: (query) => {
            const first = query.queryKey[0];
            return typeof first === "string" && (first === key || first.startsWith(`${key}?`));
          },
        });
      }
    }

    const handlers = handlersRef.current.get(event.topic);
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(event);
    }
  }, [logout, queryClient, refreshAccessToken]);

  const connect = useCallback(async () => {
    if (!userIdRef.current) {
      return;
    }
    if (socketRef.current) {
      if (
        socketRef.current.readyState === WebSocket.OPEN
        || socketRef.current.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
    }

    const ticketRes = await fetchWithAuth("/api/v1/ws/ticket", { method: "POST" });
    if (!ticketRes.ok) {
      return;
    }
    const ticketPayload = (await ticketRes.json()) as WsTicketResponse;
    const socket = new WebSocket(
      `${toWebSocketUrl("/api/v1/ws/stomp")}?ticket=${encodeURIComponent(ticketPayload.ticket)}`,
      ["v12.stomp", "v11.stomp", "v10.stomp"],
    );
    socketRef.current = socket;
    stompConnectedRef.current = false;

    socket.onopen = () => {
      socket.send(
        buildStompFrame({
          command: "CONNECT",
          headers: {
            "accept-version": "1.2,1.1,1.0",
            "heart-beat": "10000,10000",
          },
        }),
      );
    };

    socket.onmessage = (message) => {
      if (typeof message.data !== "string") {
        return;
      }

      let frames;
      try {
        frames = parseStompFrames(message.data);
      } catch {
        return;
      }

      for (const frame of frames) {
        if (frame.command === "CONNECTED") {
          stompConnectedRef.current = true;
          setConnected(true);
          reconnectAttemptRef.current = 0;
          for (const topic of desiredTopicsRef.current) {
            sendSubscribeFrame(topic);
          }
          continue;
        }

        if (frame.command === "MESSAGE") {
          if (!frame.body) {
            continue;
          }
          try {
            const event = JSON.parse(frame.body) as WsEventEnvelope;
            handleIncomingEvent(event);
          } catch {
            continue;
          }
          continue;
        }

        if (frame.command === "ERROR") {
          if (frame.body?.includes("user_not_allowed")) {
            void logout();
          }
        }
      }
    };

    socket.onclose = async (event) => {
      setConnected(false);
      stompConnectedRef.current = false;
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      if (!userIdRef.current) {
        return;
      }
      if (event.code === 4403) {
        await logout();
        return;
      }
      const delays = [1000, 2000, 5000, 10000, 20000];
      const delay = delays[Math.min(reconnectAttemptRef.current, delays.length - 1)];
      reconnectAttemptRef.current += 1;
      clearReconnectTimer();
      reconnectTimerRef.current = window.setTimeout(() => {
        void connectRef.current?.();
      }, delay);
    };
  }, [clearReconnectTimer, fetchWithAuth, handleIncomingEvent, logout, sendSubscribeFrame]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    if (!user) {
      clearReconnectTimer();
      socketRef.current?.close();
      socketRef.current = null;
      stompConnectedRef.current = false;
      desiredTopicsRef.current.clear();
      handlersRef.current.clear();
      if (connected) {
        queueMicrotask(() => setConnected(false));
      }
      return;
    }
    void connect();
    return () => {
      clearReconnectTimer();
    };
  }, [clearReconnectTimer, connect, connected, user]);

  const subscribeTopic = useCallback((topic: string, handler: TopicHandler) => {
    let handlers = handlersRef.current.get(topic);
    if (!handlers) {
      handlers = new Set();
      handlersRef.current.set(topic, handlers);
    }
    handlers.add(handler);

    const isNewTopic = !desiredTopicsRef.current.has(topic);
    desiredTopicsRef.current.add(topic);
    if (isNewTopic) {
      sendSubscribeFrame(topic);
    }

    return () => {
      const currentHandlers = handlersRef.current.get(topic);
      if (!currentHandlers) {
        return;
      }
      currentHandlers.delete(handler);
      if (currentHandlers.size > 0) {
        return;
      }
      handlersRef.current.delete(topic);
      desiredTopicsRef.current.delete(topic);
      sendUnsubscribeFrame(topic);
    };
  }, [sendSubscribeFrame, sendUnsubscribeFrame]);

  const sendPing = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send("\n");
    }
  }, []);

  const value = useMemo<WSContextValue>(
    () => ({ connected, subscribeTopic, sendPing }),
    [connected, sendPing, subscribeTopic],
  );

  return <WSContext.Provider value={value}>{children}</WSContext.Provider>;
}

export function useWS(): WSContextValue {
  const context = useContext(WSContext);
  if (!context) {
    throw new Error("useWS must be used inside WSProvider");
  }
  return context;
}
