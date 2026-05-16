import { NextRequest, NextResponse } from "next/server";

import { normalizeAppRoutePath } from "./lib/app-route-path";

function normalizeBasePath(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "/") {
    return "";
  }

  return `/${trimmed.replace(/^\/+|\/+$/g, "")}`;
}

const APP_BASE_PATH = normalizeBasePath(process.env.NEXT_PUBLIC_APP_BASE_PATH);

const RESERVED_PREFIXES = [
  "/api",
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

const PUBLIC_FILE = /\.[^/]+$/;

function stripBasePath(pathname: string): string {
  if (!APP_BASE_PATH) {
    return pathname;
  }

  if (pathname === APP_BASE_PATH) {
    return "/";
  }

  if (pathname.startsWith(`${APP_BASE_PATH}/`)) {
    return pathname.slice(APP_BASE_PATH.length) || "/";
  }

  return pathname;
}

function isBypassedPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "/login" || pathname === "/login/") {
    return true;
  }
  if (PUBLIC_FILE.test(pathname)) {
    return true;
  }
  return RESERVED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest) {
  const pathname = stripBasePath(request.nextUrl.pathname);

  if (isBypassedPath(pathname)) {
    return NextResponse.next();
  }

  const canonicalPath = normalizeAppRoutePath(pathname) ?? pathname;

  // Keep backward compatibility for existing /admin links and legacy menu aliases.
  if (pathname.startsWith("/admin/")) {
    const url = request.nextUrl.clone();
    url.pathname = canonicalPath;
    return NextResponse.redirect(url);
  }
  if (canonicalPath !== pathname) {
    const url = request.nextUrl.clone();
    url.pathname = canonicalPath;
    return NextResponse.redirect(url);
  }

  // New public URLs without /admin are internally rewritten to existing routes.
  const url = request.nextUrl.clone();
  url.pathname = `/admin${canonicalPath}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/:path*",
};
