"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { getApiBaseUrl, readApiError } from "@/lib/api";
import { Button, Callout, Card, Checkbox, Flex, Heading, Text, TextField } from "@radix-ui/themes";

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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password);
        if (rememberPassword) {
          const credentials: RememberedCredentials = { email, password };
          window.localStorage.setItem(REMEMBER_CREDENTIALS_KEY, JSON.stringify(credentials));
        } else {
          window.localStorage.removeItem(REMEMBER_CREDENTIALS_KEY);
        }
      } else {
        await register(email, username, password);
      }
      setPassword("");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Unknown error";
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
        <Text size="2" color="gray">Initializing session...</Text>
      </main>
    );
  }

  if (user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-20 sm:px-10">
        <Heading size="8">Quiz</Heading>
        <Text size="3" color="gray">
          用户管理、角色管理、菜单管理、需求管理已接入统一后台（JWT + Refresh Session + RBAC + Menu + WS）。
        </Text>

        <Card size="3">
          <Flex direction="column" gap="2">
            <Text size="5" weight="medium">欢迎，{user.username}</Text>
            <Text size="2" color="gray">{user.email}</Text>
            <Text size="1" color="gray">Roles: {user.role_codes.join(", ") || "-"}</Text>
            <Text size="1" color="gray">Permissions: {user.permission_codes.join(", ") || "-"}</Text>
          </Flex>

          <Flex wrap="wrap" gap="2" mt="4">
            <Button onClick={handlePing} type="button">Ping Backend</Button>
            <Button asChild variant="soft"><Link href="/admin">进入后台</Link></Button>
            {hasPermission("user.manage") && (
              <Button asChild variant="soft"><Link href="/admin/users">管理用户</Link></Button>
            )}
            {hasPermission("requirement.read") && (
              <Button asChild variant="soft"><Link href="/admin/requirements">查看需求</Link></Button>
            )}
            <Button variant="soft" onClick={() => void logout()} type="button">退出登录</Button>
          </Flex>
        </Card>

        {pingResult && (
          <Callout.Root color="green">
            <Callout.Text>
              <pre>{JSON.stringify(pingResult, null, 2)}</pre>
            </Callout.Text>
          </Callout.Root>
        )}

        {error && (
          <Callout.Root color="red">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center px-6 py-14 sm:px-10 lg:py-20">
      <div className="grid w-full items-stretch gap-8 lg:grid-cols-[1.1fr_0.9fr]">
        <Card size="3">
          <Flex direction="column" justify="between" height="100%" gap="5">
            <div>
              <Text size="2" weight="bold" color="gray">WELCOME</Text>
              <Heading size="9" mt="2">Quiz</Heading>
              <Text size="3" color="gray" mt="4">
                统一后台入口，支持账号登录、权限访问控制、需求协作与密钥管理。保持现有鉴权链路不变，体验更清晰。
              </Text>
            </div>
            <Card variant="surface">
              <Text size="1" color="gray">已接入能力</Text>
              <Text size="2" mt="2">JWT + Refresh Session / RBAC / Menu / Requirement / WebSocket</Text>
            </Card>
          </Flex>
        </Card>

        <Card size="3">
          <Flex gap="2" mb="4">
            <Button
              type="button"
              variant={mode === "login" ? "solid" : "soft"}
              onClick={() => setMode("login")}
            >
              登录
            </Button>
            <Button
              type="button"
              variant={mode === "register" ? "solid" : "soft"}
              onClick={() => setMode("register")}
            >
              注册
            </Button>
          </Flex>

          <form className="space-y-3" onSubmit={handleSubmit}>
            <Heading size="4">{mode === "login" ? "登录到 Quiz" : "创建 Quiz 账号"}</Heading>

            <TextField.Root
              placeholder="Email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setEmail(event.currentTarget.value)}
              required
            />

            {mode === "register" && (
              <TextField.Root
                placeholder="Username"
                type="text"
                value={username}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.currentTarget.value)}
                minLength={3}
                maxLength={64}
                required
              />
            )}

            <TextField.Root
              placeholder="Password (>= 8 chars)"
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.currentTarget.value)}
              minLength={8}
              maxLength={128}
              required
            />

            {mode === "login" && (
              <label className="mt-1 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={rememberPassword}
                  onCheckedChange={(checked: boolean | "indeterminate") => setRememberPassword(checked === true)}
                />
                <Text size="2" color="gray">记住密码</Text>
              </label>
            )}

            <Button disabled={busy} type="submit" className="w-full">
              {busy ? "Submitting..." : mode === "login" ? "登录" : "注册并登录"}
            </Button>

            <Text size="1" color="gray" mt="2">
              {mode === "login" ? "使用已有账号登录系统。" : "注册后将自动登录并进入系统。"}
            </Text>
          </form>

          {error && (
            <Callout.Root color="red" mt="4">
              <Callout.Text>{error}</Callout.Text>
            </Callout.Root>
          )}
        </Card>
      </div>
    </main>
  );
}
