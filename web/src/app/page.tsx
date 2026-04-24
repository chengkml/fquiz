"use client";

import { IdcardOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Input, Space, Typography } from "antd";

import { useAuth } from "@/components/auth-provider";
import { Card } from "@/components/ui-antd";

type Mode = "login" | "register";

export default function Home() {
  const router = useRouter();
  const { user, initializing, login, register } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!initializing && user) {
      router.replace("/dashboard");
    }
  }, [initializing, router, user]);

  const formTitle = mode === "login" ? "登录你的工作台" : "创建你的工作台";
  const submitLabel = mode === "login" ? "登录" : "创建账号";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      if (mode === "login") {
        await login(userId.trim(), password);
      } else {
        await register(`${username.trim() || userId.trim()}@example.local`, username.trim(), password);
      }
      setPassword("");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "未知错误";
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  if (initializing) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20">
        <Typography.Text type="secondary">正在初始化会话...</Typography.Text>
      </main>
    );
  }

  if (user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl items-center justify-center px-6 py-20">
        <Typography.Text type="secondary">正在跳转到控制台...</Typography.Text>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#eef2f8] px-4 py-6 sm:px-8 sm:py-10">
      <section className="mx-auto flex w-full max-w-[760px] items-center justify-center rounded-[24px] bg-[#f3f4f6] p-4 shadow-[0_20px_48px_rgba(15,23,42,0.12)] sm:p-8">
        <Card className="w-full border-0 shadow-none" styles={{ body: { padding: "24px 16px" } }}>
          <Space direction="vertical" size={22} className="w-full">
            <div className="flex items-center justify-center gap-4">
              <div className="grid h-[60px] w-[60px] place-items-center rounded-[16px] bg-[linear-gradient(160deg,#0ccbf0_0%,#3571ff_54%,#7156f8_100%)] text-[32px] font-bold text-white shadow-[0_10px_20px_rgba(53,113,255,0.32)]">
                D
              </div>
              <div>
                <Typography.Title level={2} className="!mb-0 !text-[#0f1b36]">
                  开发智能平台
                </Typography.Title>
                <Typography.Text type="secondary">Development Intelligence Platform</Typography.Text>
              </div>
            </div>

            <Typography.Title level={2} className="!mb-0 !text-center !text-[#0f1b36]">
              {formTitle}
            </Typography.Title>

            <form className="space-y-4" onSubmit={handleSubmit}>
              <div>
                <Typography.Text strong className="mb-2 block tracking-wide text-[#1e293b]">
                  用户 ID
                </Typography.Text>
                <Input
                  size="large"
                  value={userId}
                  prefix={<IdcardOutlined className="text-slate-400" />}
                  placeholder="请输入用户ID"
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setUserId(event.currentTarget.value)}
                  className="h-[48px] rounded-[10px]"
                  autoComplete="username"
                  required
                />
              </div>

              {mode === "register" && (
                <div>
                  <Typography.Text strong className="mb-2 block tracking-wide text-[#1e293b]">
                    用户名
                  </Typography.Text>
                  <Input
                    size="large"
                    value={username}
                    prefix={<UserOutlined className="text-slate-400" />}
                    placeholder="请输入用户名"
                    onChange={(event: ChangeEvent<HTMLInputElement>) => setUsername(event.currentTarget.value)}
                    className="h-[48px] rounded-[10px]"
                    minLength={3}
                    maxLength={64}
                    required
                  />
                </div>
              )}

              <div>
                <Typography.Text strong className="mb-2 block tracking-wide text-[#1e293b]">
                  密码
                </Typography.Text>
                <Input.Password
                  size="large"
                  value={password}
                  prefix={<LockOutlined className="text-slate-400" />}
                  placeholder={mode === "login" ? "请输入密码" : "请输入密码（至少 8 位）"}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => setPassword(event.currentTarget.value)}
                  className="h-[48px] rounded-[10px]"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={mode === "login" ? 1 : 8}
                  maxLength={128}
                  required
                />
              </div>

              <Button block size="large" type="primary" htmlType="submit" loading={busy}>
                {submitLabel}
              </Button>

              {mode === "login" && (
                <div className="flex justify-end">
                  <Button type="link" onClick={() => setError("请联系管理员重置密码。")}>
                    忘记密码？
                  </Button>
                </div>
              )}

              <Button
                block
                type="link"
                onClick={() => {
                  setError("");
                  setMode((current) => (current === "login" ? "register" : "login"));
                }}
              >
                {mode === "login" ? "创建新项目？" : "返回登录"}
              </Button>
            </form>

            {error && <Alert showIcon type="error" message={error} />}
          </Space>
        </Card>
      </section>
    </main>
  );
}
