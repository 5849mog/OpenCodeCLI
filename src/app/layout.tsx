import type { Metadata, Viewport } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "katex/dist/katex.min.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Open Code Web — Browser-based AI Coding Agent",
  description:
    "A near 1:1 browser replica of the Open Code CLI. Upload files to the 文件袋 virtual workspace, connect your own LLM API key, and let the agent build your project — all in the browser.",
  keywords: [
    "Open Code",
    "AI coding agent",
    "browser IDE",
    "Claude Code",
    "LLM",
  ],
  authors: [{ name: "Open Code Web" }],
  icons: { icon: "/logo.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "#161616",
              border: "1px solid #333333",
              color: "#e7e5e4",
              borderRadius: "8px",
            },
          }}
        />
      </body>
    </html>
  );
}
