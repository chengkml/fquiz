import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { AppQueryProvider } from "@/components/app-query-provider";
import { AuthProvider } from "@/components/auth-provider";
import { WSProvider } from "@/components/ws-provider";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "fquiz",
  description: "Next.js + FastAPI full-stack starter",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AppQueryProvider>
          <AuthProvider>
            <WSProvider>{children}</WSProvider>
          </AuthProvider>
        </AppQueryProvider>
      </body>
    </html>
  );
}
