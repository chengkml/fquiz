"use client";

import { useMemo, useState } from "react";

type PingResponse = {
  message: string;
  service: string;
};

const FALLBACK_API_BASE_URL = "http://127.0.0.1:8000";

export default function Home() {
  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_BASE_URL ?? FALLBACK_API_BASE_URL,
    [],
  );
  const [pingResult, setPingResult] = useState<PingResponse | null>(null);
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handlePing = async () => {
    setLoading(true);
    setError("");
    setPingResult(null);

    try {
      const response = await fetch(`${apiBaseUrl}/api/v1/ping`, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as PingResponse;
      setPingResult(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(
        `Failed to connect API at ${apiBaseUrl}/api/v1/ping (${message})`,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-20 sm:px-10">
      <h1 className="text-3xl font-semibold tracking-tight">fquiz</h1>
      <p className="text-base text-zinc-600 dark:text-zinc-300">
        Next.js + FastAPI full-stack starter is ready.
      </p>

      <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-black">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">API Base URL</p>
        <p className="mt-1 font-mono text-sm">{apiBaseUrl}</p>
      </div>

      <div className="flex items-center gap-3">
        <button
          className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          onClick={handlePing}
          disabled={loading}
          type="button"
        >
          {loading ? "Pinging..." : "Ping Backend"}
        </button>
      </div>

      {pingResult && (
        <pre className="overflow-auto rounded-xl border border-emerald-500/30 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-300">
          {JSON.stringify(pingResult, null, 2)}
        </pre>
      )}

      {error && (
        <pre className="overflow-auto rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </pre>
      )}
    </div>
  );
}
