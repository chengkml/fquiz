"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert, Empty, Spin, Typography } from "antd";

function toBase64Url(content: string): string {
  const utf8Bytes = new TextEncoder().encode(content);
  let binary = "";
  for (const byte of utf8Bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

type MermaidViewerProps = {
  code: string;
  className?: string;
};

export function MermaidViewer({ code, className }: MermaidViewerProps) {
  const [error, setError] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const normalized = code.trim();

  const imageUrl = useMemo(() => {
    if (!normalized) {
      return "";
    }
    return `https://mermaid.ink/svg/${toBase64Url(normalized)}`;
  }, [normalized]);

  useEffect(() => {
    setError(null);
    setImageLoading(Boolean(imageUrl));
  }, [imageUrl]);

  if (!normalized) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <Typography.Text type="secondary">暂无 Mermaid 代码，请先输入提示词或套用模板。</Typography.Text>
        }
      />
    );
  }

  return (
    <div className={className}>
      {error ? (
        <Alert
          type="error"
          showIcon
          message="Mermaid 渲染失败"
          description={error}
          style={{ marginBottom: 12 }}
        />
      ) : null}

      <div className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-white p-4">
        <Spin spinning={imageLoading} tip="正在渲染预览...">
          <img
            src={imageUrl}
            alt="Mermaid Preview"
            className="w-full"
            onLoad={() => setImageLoading(false)}
            onError={() => {
              setImageLoading(false);
              setError("请检查 Mermaid 语法是否正确后重试");
            }}
          />
        </Spin>
      </div>
    </div>
  );
}
