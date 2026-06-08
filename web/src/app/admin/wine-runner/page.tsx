"use client";

import { PlayCircleOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card as AntdCard,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Tag,
  Typography,
  type CardProps,
} from "antd";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { useToastFeedback } from "@/hooks/use-toast-feedback";
import { readApiError } from "@/lib/api";

type WineStatusResponse = {
  wine_binary: string;
  resolved_binary: string | null;
  available: boolean;
  version: string | null;
  allowed_root: string;
  default_timeout_seconds: number;
  max_timeout_seconds: number;
  error: string | null;
};

type WineRunFormValues = {
  exe_path: string;
  arguments_text?: string;
  working_dir?: string;
  timeout_seconds?: number | null;
};

type ParsedSseMessage = {
  event: string;
  payload: Record<string, unknown>;
};

type WineLogEvent = {
  id: string;
  event: string;
  receivedAt: number;
  message?: string;
  command?: string[];
  cwd?: string;
  timeoutSeconds?: number;
  exitCode?: number;
  timedOut?: boolean;
};

const DEFAULT_FORM_VALUES: WineRunFormValues = {
  exe_path: "",
  arguments_text: "",
  working_dir: "",
  timeout_seconds: 300,
};

const Card = AntdCard as unknown as ComponentType<CardProps>;

function parseArguments(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseSseMessage(raw: string): ParsedSseMessage | null {
  const lines = raw.split("\n");
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  try {
    const payload = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    return { event, payload };
  } catch {
    return {
      event,
      payload: { message: dataLines.join("\n") },
    };
  }
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function toLogEvent(message: ParsedSseMessage): WineLogEvent {
  const payload = message.payload;
  const exitCode = typeof payload.exit_code === "number" ? payload.exit_code : undefined;
  const timeoutSeconds = typeof payload.timeout_seconds === "number" ? payload.timeout_seconds : undefined;
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    event: message.event,
    receivedAt: Date.now(),
    message: typeof payload.message === "string" ? payload.message : undefined,
    command: toStringArray(payload.command),
    cwd: typeof payload.cwd === "string" ? payload.cwd : undefined,
    timeoutSeconds,
    exitCode,
    timedOut: typeof payload.timed_out === "boolean" ? payload.timed_out : undefined,
  };
}

function formatLogEvent(item: WineLogEvent): string {
  const time = new Date(item.receivedAt).toLocaleTimeString();
  if (item.event === "start") {
    return `[${time}] START cwd=${item.cwd ?? "-"} timeout=${item.timeoutSeconds ?? "-"}s\n$ ${(item.command ?? []).join(" ")}`;
  }
  if (item.event === "exit") {
    return `[${time}] EXIT code=${item.exitCode ?? "-"} timed_out=${item.timedOut ? "true" : "false"}`;
  }
  if (item.event === "heartbeat") {
    return `[${time}] HEARTBEAT`;
  }
  if (item.event === "error") {
    return `[${time}] ERROR ${item.message ?? ""}`;
  }
  return `[${time}] ${item.message ?? ""}`;
}

export default function AdminWineRunnerPage() {
  const { user, initializing, fetchWithAuth, hasPermission } = useAuth();
  const [form] = Form.useForm<WineRunFormValues>();
  const controllerRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<WineStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<WineLogEvent[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const canRead = hasPermission("wine.read") || hasPermission("wine.manage");
  const canManage = hasPermission("wine.manage");

  useToastFeedback({
    errorMessage: error,
    successMessage: success,
    errorTitle: "执行失败",
    clearError: () => setError(""),
    clearSuccess: () => setSuccess(""),
  });

  const loadStatus = useCallback(async () => {
    if (!user || !canRead) {
      return;
    }
    setStatusLoading(true);
    setError("");
    try {
      const response = await fetchWithAuth("/api/v1/wine/status");
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      const payload = (await response.json()) as WineStatusResponse;
      setStatus(payload);
      form.setFieldsValue({
        timeout_seconds: payload.default_timeout_seconds,
      });
    } catch (candidate) {
      setError(candidate instanceof Error ? candidate.message : "Wine 状态检测失败");
    } finally {
      setStatusLoading(false);
    }
  }, [canRead, fetchWithAuth, form, user]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadStatus();
    });
  }, [loadStatus]);

  const appendLog = useCallback((item: WineLogEvent) => {
    setLogs((current) => [...current, item].slice(-1000));
    if (item.event === "exit") {
      if (item.exitCode === 0) {
        setSuccess("测试执行完成");
        setError("");
      } else {
        setSuccess("");
        setError(`进程退出码：${item.exitCode ?? "-"}`);
      }
    }
    if (item.event === "error") {
      setSuccess("");
      setError(item.message ?? "执行失败");
    }
  }, []);

  const logText = useMemo(() => {
    if (logs.length === 0) {
      return "等待执行...";
    }
    return logs.map(formatLogEvent).join("\n");
  }, [logs]);

  const handleRun = async (values: WineRunFormValues) => {
    if (!canManage) {
      setError("缺少 wine.manage 权限");
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setRunning(true);
    setLogs([]);
    setError("");
    setSuccess("");

    try {
      const response = await fetchWithAuth("/api/v1/wine/test/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          exe_path: values.exe_path.trim(),
          arguments: parseArguments(values.arguments_text),
          working_dir: values.working_dir?.trim() || null,
          timeout_seconds: values.timeout_seconds ?? null,
          environment: {},
        }),
      });
      if (!response.ok) {
        throw new Error(await readApiError(response));
      }
      if (!response.body) {
        throw new Error("后端未返回日志流");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, "\n");

        let separatorIndex = buffer.indexOf("\n\n");
        while (separatorIndex >= 0) {
          const rawMessage = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const parsed = parseSseMessage(rawMessage);
          if (parsed) {
            appendLog(toLogEvent(parsed));
          }
          separatorIndex = buffer.indexOf("\n\n");
        }
      }
    } catch (candidate) {
      if (candidate instanceof DOMException && candidate.name === "AbortError") {
        appendLog({
          id: `${Date.now()}-aborted`,
          event: "error",
          receivedAt: Date.now(),
          message: "执行已停止",
        });
        return;
      }
      setSuccess("");
      setError(candidate instanceof Error ? candidate.message : "执行失败");
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
      setRunning(false);
    }
  };

  const handleStop = () => {
    controllerRef.current?.abort();
  };

  if (initializing) {
    return <Card loading />;
  }

  if (!user) {
    return <Alert type="info" showIcon message="请先登录后访问 Wine 执行器。" />;
  }

  if (!canRead) {
    return <Alert type="warning" showIcon message="你没有访问该页面的权限（需要 wine.read）。" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card
            title="Wine 状态"
            extra={
              <Button icon={<ReloadOutlined />} loading={statusLoading} onClick={() => void loadStatus()}>
                检测
              </Button>
            }
          >
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <Space wrap>
                <Typography.Text strong>可用状态</Typography.Text>
                <Tag color={status?.available ? "success" : "error"}>{status?.available ? "可用" : "不可用"}</Tag>
              </Space>
              <Typography.Text copyable>{status?.resolved_binary ?? status?.wine_binary ?? "wine"}</Typography.Text>
              <Typography.Text type="secondary">{status?.version ?? status?.error ?? "尚未检测"}</Typography.Text>
              <Typography.Text type="secondary">允许目录：{status?.allowed_root ?? "-"}</Typography.Text>
              <Typography.Text type="secondary">
                超时范围：{status?.default_timeout_seconds ?? "-"} / {status?.max_timeout_seconds ?? "-"} 秒
              </Typography.Text>
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={16}>
          <Card title="测试执行">
            <Form<WineRunFormValues>
              form={form}
              layout="vertical"
              initialValues={DEFAULT_FORM_VALUES}
              onFinish={(values) => {
                void handleRun(values);
              }}
            >
              <Row gutter={12}>
                <Col xs={24} md={16}>
                  <Form.Item name="exe_path" label="EXE 路径" rules={[{ required: true, message: "请输入 EXE 路径" }]}>
                    <Input placeholder="demo/app.exe" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="timeout_seconds" label="超时秒数">
                    <InputNumber min={1} max={status?.max_timeout_seconds ?? 1800} style={{ width: "100%" }} />
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item name="working_dir" label="工作目录">
                <Input placeholder="留空时使用 EXE 所在目录" />
              </Form.Item>

              <Form.Item name="arguments_text" label="执行参数">
                <Input.TextArea rows={4} placeholder="每行一个参数" />
              </Form.Item>

              <Space wrap>
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<PlayCircleOutlined />}
                  disabled={!canManage || running}
                  loading={running}
                >
                  执行测试
                </Button>
                <Button icon={<StopOutlined />} disabled={!running} onClick={handleStop}>
                  停止
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>
      </Row>

      <Card title="实时日志">
        <pre className="h-[460px] overflow-auto rounded-md border border-[var(--ant-color-border)] bg-[var(--ant-color-bg-container)] p-4 text-xs leading-5 text-[var(--ant-color-text)]">
          {logText}
        </pre>
      </Card>
    </Space>
  );
}
