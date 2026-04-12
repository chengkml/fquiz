const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function getApiBaseUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? "http://127.0.0.1:8000";

  if (typeof window === "undefined") {
    return trimTrailingSlash(configured);
  }

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    return trimTrailingSlash(configured);
  }

  const browserHost = window.location.hostname;
  const shouldRewriteLoopback =
    isLoopbackHost(parsed.hostname) && !isLoopbackHost(browserHost);
  if (!shouldRewriteLoopback) {
    return trimTrailingSlash(configured);
  }

  const port = parsed.port || "8000";
  const pathname = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${browserHost}:${port}${pathname}`;
}

export const API_BASE_URL = getApiBaseUrl();

export async function readApiError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { detail?: string };
    return data.detail ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}
