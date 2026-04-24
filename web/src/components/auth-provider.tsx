"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getApiBaseUrl, readApiError } from "@/lib/api";
import type { AuthTokenResponse, UserPublic } from "@/types/auth";

type AuthContextValue = {
  user: UserPublic | null;
  accessToken: string | null;
  initializing: boolean;
  login: (userId: string, password: string) => Promise<void>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
  fetchWithAuth: (
    path: string,
    init?: RequestInit,
    retryOnUnauthorized?: boolean,
  ) => Promise<Response>;
  hasRole: (roleCode: string) => boolean;
  hasPermission: (permissionCode: string) => boolean;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function withApiPath(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }
  return `${getApiBaseUrl()}${path}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);
  const accessTokenRef = useRef<string | null>(null);

  const applyToken = useCallback((token: string | null) => {
    accessTokenRef.current = token;
    setAccessToken(token);
  }, []);

  const clearAuth = useCallback(() => {
    setUser(null);
    applyToken(null);
  }, [applyToken]);

  const applyAuthPayload = useCallback(
    (payload: AuthTokenResponse) => {
      setUser(payload.user);
      applyToken(payload.access_token);
    },
    [applyToken],
  );

  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    const response = await fetch(withApiPath("/api/v1/auth/refresh"), {
      method: "POST",
      credentials: "include",
    });
    if (!response.ok) {
      clearAuth();
      return false;
    }

    const payload = (await response.json()) as AuthTokenResponse;
    applyAuthPayload(payload);
    return true;
  }, [applyAuthPayload, clearAuth]);

  const fetchWithAuth = useCallback(
    async (
      path: string,
      init: RequestInit = {},
      retryOnUnauthorized = true,
    ): Promise<Response> => {
      const headers = new Headers(init.headers);
      const token = accessTokenRef.current;
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }

      const response = await fetch(withApiPath(path), {
        ...init,
        headers,
        credentials: "include",
      });

      if (response.status !== 401 || !retryOnUnauthorized) {
        return response;
      }

      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        return response;
      }

      const retryHeaders = new Headers(init.headers);
      const nextToken = accessTokenRef.current;
      if (nextToken) {
        retryHeaders.set("Authorization", `Bearer ${nextToken}`);
      }

      return fetch(withApiPath(path), {
        ...init,
        headers: retryHeaders,
        credentials: "include",
      });
    },
    [refreshAccessToken],
  );

  const login = useCallback(
    async (userId: string, password: string) => {
      const response = await fetch(withApiPath("/api/v1/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ user_id: userId, password }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as AuthTokenResponse;
      applyAuthPayload(payload);
    },
    [applyAuthPayload],
  );

  const register = useCallback(
    async (email: string, username: string, password: string) => {
      const response = await fetch(withApiPath("/api/v1/auth/register"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, username, password }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }

      const payload = (await response.json()) as AuthTokenResponse;
      applyAuthPayload(payload);
    },
    [applyAuthPayload],
  );

  const logout = useCallback(async () => {
    try {
      await fetch(withApiPath("/api/v1/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    } finally {
      clearAuth();
      if (typeof window !== "undefined") {
        window.location.replace("/");
      }
    }
  }, [clearAuth]);

  useEffect(() => {
    const bootstrap = async () => {
      try {
        await refreshAccessToken();
      } finally {
        setInitializing(false);
      }
    };
    void bootstrap();
  }, [refreshAccessToken]);

  const hasRole = useCallback(
    (roleCode: string) => (user ? user.role_codes.includes(roleCode) : false),
    [user],
  );
  const hasPermission = useCallback(
    (permissionCode: string) =>
      user
        ? user.role_codes.includes("admin") || user.permission_codes.includes(permissionCode)
        : false,
    [user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      accessToken,
      initializing,
      login,
      register,
      logout,
      refreshAccessToken,
      fetchWithAuth,
      hasRole,
      hasPermission,
    }),
    [
      user,
      accessToken,
      initializing,
      login,
      register,
      logout,
      refreshAccessToken,
      fetchWithAuth,
      hasRole,
      hasPermission,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
