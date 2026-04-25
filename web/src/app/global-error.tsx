"use client";

import { useEffect } from "react";

import { isChunkLoadError, reloadOnceOnChunkError } from "@/lib/chunk-error";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    reloadOnceOnChunkError(error);
  }, [error]);

  const chunkError = isChunkLoadError(error);

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#f5f7fb",
          color: "#101828",
          fontFamily:
            "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <section
          style={{
            width: "100%",
            maxWidth: 560,
            borderRadius: 14,
            background: "#ffffff",
            border: "1px solid #e5e7eb",
            boxShadow: "0 10px 24px rgba(15, 23, 42, 0.08)",
            padding: 24,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>应用暂时不可用</h1>
          <p style={{ margin: "12px 0 0", lineHeight: 1.6, color: "#344054" }}>
            {chunkError
              ? "检测到静态资源版本不一致，正在尝试自动刷新页面。"
              : "应用遇到未处理错误，请重试或刷新后再试。"}
          </p>
          <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                border: "1px solid #d0d5dd",
                background: "#ffffff",
                color: "#101828",
                borderRadius: 8,
                padding: "8px 14px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                border: "1px solid #155eef",
                background: "#155eef",
                color: "#ffffff",
                borderRadius: 8,
                padding: "8px 14px",
                cursor: "pointer",
                fontWeight: 600,
              }}
            >
              刷新页面
            </button>
          </div>
        </section>
      </body>
    </html>
  );
}
