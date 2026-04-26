import { NextRequest, NextResponse } from "next/server";

const RESERVED_PREFIXES = [
  "/api",
  "/_next",
  "/favicon.ico",
  "/robots.txt",
  "/sitemap.xml",
];

const PUBLIC_FILE = /\.[^/]+$/;

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
  const { pathname } = request.nextUrl;

  if (isBypassedPath(pathname)) {
    return NextResponse.next();
  }

  // Keep backward compatibility for existing /admin links.
  if (pathname === "/admin" || pathname === "/admin/") {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/admin/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice("/admin".length) || "/dashboard";
    return NextResponse.redirect(url);
  }

  // New public URLs without /admin are internally rewritten to existing routes.
  const url = request.nextUrl.clone();
  url.pathname = pathname === "/dashboard" ? "/admin" : `/admin${pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: "/:path*",
};

