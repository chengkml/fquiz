import { NextRequest, NextResponse } from "next/server";

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

function withBasePath(pathname: string): string {
  if (!APP_BASE_PATH) {
    return pathname;
  }

  if (pathname === "/") {
    return APP_BASE_PATH;
  }

  return `${APP_BASE_PATH}${pathname}`;
}

function isBypassedPath(pathname: string): boolean {
  if (pathname === "/") {
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

  // Keep backward compatibility for existing /admin links.
  if (pathname === "/admin" || pathname === "/admin/") {
    const url = request.nextUrl.clone();
    url.pathname = withBasePath("/users");
    return NextResponse.redirect(url);
  }
  if (pathname === "/dashboard" || pathname === "/dashboard/") {
    const url = request.nextUrl.clone();
    url.pathname = withBasePath("/users");
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/admin/")) {
    const url = request.nextUrl.clone();
    url.pathname = withBasePath(pathname.slice("/admin".length) || "/users");
    return NextResponse.redirect(url);
  }

  // New public URLs without /admin are internally rewritten to existing routes.
  const url = request.nextUrl.clone();
  url.pathname = withBasePath(`/admin${pathname}`);
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/:path*",
};
