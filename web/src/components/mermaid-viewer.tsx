"use client";
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from "react";

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
  const normalized = code.trim();

  const imageUrl = useMemo(() => {
    if (!normalized) {
      return "";
    }
    return `https://mermaid.ink/svg/${toBase64Url(normalized)}`;
  }, [normalized]);

  useEffect(() => {
    setError(null);
  }, [imageUrl]);

  return (
    <div className={className}>
      {error ? (
        <div className="rounded-lg border border-[var(--red-6)] bg-[var(--red-2)] p-3 text-sm text-[var(--red-11)]">
          {error}
        </div>
      ) : null}
      {!normalized ? (
        <div className="rounded-lg border border-dashed border-[var(--gray-6)] p-4 text-sm text-[var(--gray-11)]">
          暂无 Mermaid 代码
        </div>
      ) : null}
      {normalized ? (
        <div className="overflow-auto rounded-lg border border-[var(--gray-6)] bg-white p-4">
          <img
            src={imageUrl}
            alt="Mermaid Preview"
            className="min-w-full"
            onError={() => setError("Mermaid 渲染失败，请检查代码语法")}
          />
        </div>
      ) : null}
    </div>
  );
}
