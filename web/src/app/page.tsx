"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { getApiBaseUrl, readApiError } from "@/lib/api";
import { Button, Callout, Card, Checkbox, Flex, Heading, Text, TextField } from "@/components/ui-antd";

type Mode = "login" | "register";
type PingResponse = { message: string };

type RememberedCredentials = {
  email: string;
  password: string;
};

const REMEMBER_CREDENTIALS_KEY = "fquiz.remembered_credentials";
const GAZE_MAX_X = 10;
const GAZE_MAX_Y = 7;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

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
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const monsterRef = useRef<HTMLDivElement | null>(null);

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
    if (passwordFocused) {
      setGaze({ x: -10, y: -3 });
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!monsterRef.current) {
        return;
      }
      const rect = monsterRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const relativeX = (event.clientX - centerX) / (rect.width / 2);
      const relativeY = (event.clientY - centerY) / (rect.height / 2);

      setGaze({
        x: clamp(relativeX * GAZE_MAX_X, -GAZE_MAX_X, GAZE_MAX_X),
        y: clamp(relativeY * GAZE_MAX_Y, -GAZE_MAX_Y, GAZE_MAX_Y),
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [passwordFocused]);

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

  const pupilStyle = {
    transform: `translate(${gaze.x}px, ${gaze.y}px)`,
  };

  return (
    <>
      <main className="relative isolate mx-auto flex min-h-screen w-full max-w-6xl items-center overflow-hidden px-6 py-14 sm:px-10 lg:py-16">
        <div className="pointer-events-none absolute inset-0">
          <div className="blob blob-one" />
          <div className="blob blob-two" />
          <div className="blob blob-three" />
        </div>

        <div className="relative grid w-full items-stretch gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <Card size="3" className="monster-intro-card">
            <Flex direction="column" justify="between" height="100%" gap="5">
              <div>
                <Text size="2" weight="bold" color="gray">MONSTER LOGIN</Text>
                <Heading size="9" mt="2">Quiz</Heading>
                <Text size="3" color="gray" mt="4">
                  小怪兽会盯着你的鼠标移动，输入密码时它会礼貌地把视线挪开。
                </Text>
              </div>

              <div className="monster-stage">
                <div ref={monsterRef} className="monster">
                  <div className={`monster-body ${passwordFocused ? "is-averted" : ""}`} aria-hidden="true">
                    <span className="monster-horn left" />
                    <span className="monster-horn right" />
                    <span className="monster-ear left" />
                    <span className="monster-ear right" />
                    <div className="monster-eye left">
                      <span className={`monster-lid ${passwordFocused ? "is-averted" : ""}`} />
                      <span className="monster-pupil" style={pupilStyle} />
                    </div>
                    <div className="monster-eye right">
                      <span className={`monster-lid ${passwordFocused ? "is-averted" : ""}`} />
                      <span className="monster-pupil" style={pupilStyle} />
                    </div>
                    <span className="monster-mouth" />
                    <span className="monster-arm left" />
                    <span className="monster-arm right" />
                  </div>
                </div>
                <div className="monster-shadow" />
              </div>

              <Card variant="surface" className="ability-card">
                <Text size="1" color="gray">已接入能力</Text>
                <Text size="2" mt="2">JWT + Refresh Session / RBAC / Menu / Requirement / WebSocket</Text>
              </Card>
            </Flex>
          </Card>

          <Card size="3" className="login-form-card">
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
                onFocus={() => setPasswordFocused(true)}
                onBlur={() => setPasswordFocused(false)}
                minLength={8}
                maxLength={128}
                required
              />

              <Text size="1" color="gray">输入密码时，小怪兽会自动挪开视线。</Text>

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

      <style jsx>{`
        .blob {
          position: absolute;
          border-radius: 9999px;
          filter: blur(4px);
          opacity: 0.45;
        }

        .blob-one {
          top: -140px;
          left: -120px;
          width: 340px;
          height: 340px;
          background: radial-gradient(circle at 35% 35%, #ffe3a8 0%, #f4be62 56%, #d6892b 100%);
          animation: drift-one 12s ease-in-out infinite;
        }

        .blob-two {
          right: -140px;
          bottom: -120px;
          width: 360px;
          height: 360px;
          background: radial-gradient(circle at 30% 35%, #9de6ff 0%, #5dbbd6 56%, #367f9b 100%);
          animation: drift-two 14s ease-in-out infinite;
        }

        .blob-three {
          top: 44%;
          left: 50%;
          width: 260px;
          height: 260px;
          background: radial-gradient(circle at 30% 30%, #dfffc8 0%, #8ec66f 60%, #4f7c3d 100%);
          transform: translate(-50%, -50%);
          animation: drift-three 10s ease-in-out infinite;
        }

        .monster-intro-card {
          background: linear-gradient(165deg, rgba(255, 248, 233, 0.9) 0%, rgba(255, 237, 196, 0.75) 100%);
          backdrop-filter: blur(2px);
          border: 1px solid rgba(205, 160, 81, 0.2);
        }

        .ability-card {
          border: 1px solid rgba(80, 110, 58, 0.18);
          background: rgba(255, 255, 255, 0.72);
        }

        .login-form-card {
          background: linear-gradient(180deg, rgba(255, 255, 255, 0.95) 0%, rgba(244, 250, 255, 0.95) 100%);
          border: 1px solid rgba(55, 95, 122, 0.2);
          box-shadow: 0 20px 50px rgba(29, 61, 84, 0.16);
          backdrop-filter: blur(6px);
        }

        .monster-stage {
          position: relative;
          width: 100%;
          min-height: 230px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .monster {
          position: relative;
          width: 220px;
          height: 190px;
          animation: monster-float 4s ease-in-out infinite;
        }

        .monster-body {
          position: absolute;
          inset: 0;
          border-radius: 110px 110px 76px 76px;
          background: linear-gradient(180deg, #80cf7f 0%, #4ca267 68%, #34784f 100%);
          box-shadow: inset 0 -16px 26px rgba(20, 68, 40, 0.25), 0 12px 28px rgba(23, 54, 34, 0.22);
          transition: transform 220ms ease;
        }

        .monster-body.is-averted {
          transform: rotate(-12deg) translateX(-7px);
        }

        .monster-horn {
          position: absolute;
          top: -24px;
          width: 34px;
          height: 40px;
          border-radius: 999px;
          background: linear-gradient(180deg, #f9d996 0%, #d89d4a 100%);
          box-shadow: inset 0 -6px 8px rgba(115, 75, 25, 0.22);
        }

        .monster-horn.left {
          left: 44px;
          transform: rotate(-24deg);
        }

        .monster-horn.right {
          right: 44px;
          transform: rotate(24deg);
        }

        .monster-ear {
          position: absolute;
          top: 38%;
          width: 20px;
          height: 44px;
          border-radius: 16px;
          background: rgba(35, 107, 64, 0.8);
        }

        .monster-ear.left {
          left: -10px;
          transform: rotate(-12deg);
        }

        .monster-ear.right {
          right: -10px;
          transform: rotate(12deg);
        }

        .monster-eye {
          position: absolute;
          top: 58px;
          width: 68px;
          height: 68px;
          border-radius: 999px;
          background: #fff;
          border: 4px solid rgba(22, 76, 48, 0.78);
          overflow: hidden;
        }

        .monster-eye.left {
          left: 34px;
        }

        .monster-eye.right {
          right: 34px;
        }

        .monster-lid {
          position: absolute;
          top: -26px;
          left: -6px;
          width: calc(100% + 12px);
          height: 34px;
          border-radius: 30px;
          background: #4ca267;
          transition: transform 220ms ease;
          z-index: 3;
        }

        .monster-lid.is-averted {
          transform: translateY(20px);
        }

        .monster-pupil {
          position: absolute;
          left: 26px;
          top: 27px;
          width: 16px;
          height: 16px;
          border-radius: 999px;
          background: #13251a;
          box-shadow: inset 0 -2px 4px rgba(0, 0, 0, 0.35);
          transition: transform 120ms ease-out;
        }

        .monster-mouth {
          position: absolute;
          left: 50%;
          bottom: 30px;
          width: 72px;
          height: 34px;
          transform: translateX(-50%);
          border-radius: 0 0 30px 30px;
          border: 4px solid rgba(22, 76, 48, 0.78);
          border-top: none;
          background: rgba(17, 48, 30, 0.15);
        }

        .monster-arm {
          position: absolute;
          top: 112px;
          width: 20px;
          height: 70px;
          border-radius: 14px;
          background: linear-gradient(180deg, #5cb376 0%, #2f6b4a 100%);
          transform-origin: top center;
          transition: transform 220ms ease;
        }

        .monster-arm.left {
          left: -8px;
          transform: rotate(18deg);
        }

        .monster-arm.right {
          right: -8px;
          transform: rotate(-18deg);
        }

        .monster-body.is-averted .monster-arm.left {
          transform: rotate(-4deg) translateY(8px);
        }

        .monster-body.is-averted .monster-arm.right {
          transform: rotate(-32deg) translateY(10px);
        }

        .monster-shadow {
          width: 170px;
          height: 26px;
          border-radius: 999px;
          background: rgba(21, 67, 42, 0.16);
          filter: blur(2px);
          transform: translateY(88px);
          animation: shadow-pulse 4s ease-in-out infinite;
        }

        @keyframes monster-float {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-12px);
          }
        }

        @keyframes shadow-pulse {
          0%,
          100% {
            transform: translateY(88px) scaleX(1);
            opacity: 0.24;
          }
          50% {
            transform: translateY(88px) scaleX(0.92);
            opacity: 0.12;
          }
        }

        @keyframes drift-one {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(38px, 28px, 0);
          }
        }

        @keyframes drift-two {
          0%,
          100% {
            transform: translate3d(0, 0, 0);
          }
          50% {
            transform: translate3d(-34px, -30px, 0);
          }
        }

        @keyframes drift-three {
          0%,
          100% {
            transform: translate(-50%, -50%) scale(1);
          }
          50% {
            transform: translate(-50%, -50%) scale(1.1);
          }
        }

        @media (max-width: 1024px) {
          .monster-intro-card {
            order: 2;
          }

          .login-form-card {
            order: 1;
          }

          .monster-stage {
            min-height: 210px;
          }
        }
      `}</style>
    </>
  );
}
