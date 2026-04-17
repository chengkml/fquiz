import type { Metadata } from "next";
import { Theme } from "@radix-ui/themes";

import { AppQueryProvider } from "@/components/app-query-provider";
import { AuthProvider } from "@/components/auth-provider";
import { WSProvider } from "@/components/ws-provider";

import "@radix-ui/themes/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "fquiz",
  description: "fquiz admin workspace",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <Theme accentColor="indigo" grayColor="slate" radius="medium" scaling="100%">
          <div className="app-theme-root flex min-h-full flex-col">
            <AppQueryProvider>
              <AuthProvider>
                <WSProvider>{children}</WSProvider>
              </AuthProvider>
            </AppQueryProvider>
          </div>
        </Theme>
      </body>
    </html>
  );
}
