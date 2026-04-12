"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { API_BASE_URL, getApiBaseUrl, readApiError } from "@/lib/api";

type Mode = "login" | "register";
type PingResponse = { message: string };

type RememberedCredentials = {
  email: string;
  password: string;
};

const REMEMBER_CREDENTIALS_KEY = "fquiz.remembered_credentials";

export default function Home() {
  const { user, initializing, login, register, logout, hasPermission } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberPassword, setRememberPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [resolvedApiBaseUrl, setResolvedApiBaseUrl] = useState(API_BASE_URL);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(REMEMBER_CREDENTIALS_KEY);
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw) as Partial<RememberedCredentials>;
      if (typeof saved.email === "string") {
        setEmail(saved.email);
      }
      if (typeof saved.password === "string") {
        setPassword(saved.password);
        setRememberPassword(true);
      }
    } catch {
      window.localStorage.removeItem(REMEMBER_CREDENTIALS_KEY);
    }
  }, []);

  useEffect(() => {
    setResolvedApiBaseUrl(getApiBaseUrl());
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
        if (rememberPassword) {
          const credentials: RememberedCredentials = { email, password };
          window.localStorage.setItem(
            REMEMBER_CREDENTIALS_KEY,
            JSON.stringify(credentials),
          );
        } else {
          window.localStorage.removeItem(REMEMBER_CREDENTIALS_KEY);
        }
      } else {
        await register(email, username, password);
      }
      setPassword("");
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : "Unknown error";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const handlePing = async () => {
    setError("");
    const response = await fetch(`${getApiBaseUrl()}/api/v1/ping`, {
      method: "GET",
      credentials: "include",
    });
    if (!response.ok) {
      setError(await readApiError(response));
      return;
    }
    setPingResult((await response.json()) as PingResponse);
  };

  if (initializing) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20">
        <p className="text-sm text-muted">Initializing session...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-20 sm:px-10">
      <h1 className="text-3xl font-semibold tracking-tight">fquiz</h1>
      <p className="text-base text-muted">
        用户管理、角色管理、菜单管理、需求管理已接入统一后台（JWT + Refresh Session + RBAC + Menu + WS）。
      </p>

      <section className="surface-card">
        <p className="text-sm text-muted">API Base URL</p>
        <p className="mt-1 font-mono text-sm">{resolvedApiBaseUrl}</p>
      </section>

      {user ? (
        <section className="surface-card">
          <p className="text-lg font-medium">欢迎，{user.username}</p>
          <p className="mt-1 text-sm text-muted">{user.email}</p>
          <p className="mt-2 text-xs text-muted">
            Roles: {user.role_codes.join(", ") || "-"}
          </p>
          <p className="mt-1 text-xs text-muted">
            Permissions: {user.permission_codes.join(", ") || "-"}
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              className="btn-primary"
              onClick={handlePing}
              type="button"
            >
              Ping Backend
            </button>
            <Link
              href="/admin"
              className="btn-secondary"
            >
              进入后台
            </Link>
            {hasPermission("user.manage") && (
              <Link
                href="/admin/users"
                className="btn-secondary"
              >
                管理用户
              </Link>
            )}
            {hasPermission("requirement.read") && (
              <Link
                href="/admin/requirements"
                className="btn-secondary"
              >
                查看需求
              </Link>
            )}
            <button
              className="btn-secondary"
              onClick={() => void logout()}
              type="button"
            >
              退出登录
            </button>
          </div>
        </section>
      ) : (
        <section className="surface-card">
          <div className="mb-4 flex gap-2">
            <button
              className={`btn-small ${
                mode === "login"
                  ? "btn-primary"
                  : "btn-secondary"
              }`}
              onClick={() => setMode("login")}
              type="button"
            >
              登录
            </button>
            <button
              className={`btn-small ${
                mode === "register"
                  ? "btn-primary"
                  : "btn-secondary"
              }`}
              onClick={() => setMode("register")}
              type="button"
            >
              注册
            </button>
          </div>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <h2 className="text-base font-medium">
              {mode === "login" ? "登录" : "注册"}
            </h2>
            <input
              className="control w-full"
              placeholder="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            {mode === "register" && (
              <input
                className="control w-full"
                placeholder="Username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                minLength={3}
                maxLength={64}
                required
              />
            )}
            <input
              className="control w-full"
              placeholder="Password (>= 8 chars)"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
            {mode === "login" && (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input
                  type="checkbox"
                  checked={rememberPassword}
                  onChange={(event) => setRememberPassword(event.target.checked)}
                />
                记住密码
              </label>
            )}
            <button
              className="btn-primary"
              disabled={busy}
              type="submit"
            >
              {busy ? "Submitting..." : mode === "login" ? "登录" : "注册并登录"}
            </button>
          </form>
        </section>
      )}

      {pingResult && (
        <pre className="notice notice-success">
          {JSON.stringify(pingResult, null, 2)}
        </pre>
      )}

      {error && (
        <pre className="notice notice-error">
          {error}
        </pre>
      )}
    </main>
  );
}
