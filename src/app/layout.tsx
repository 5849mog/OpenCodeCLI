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
  // 相对路径（不用 / 前缀）——部署 basePath 是 /OpenCodeCLI/，绝对路径会解析到
  // 站点根导致 404；相对路径在根部署与子路径部署下都正确。
  icons: {
    icon: ["./logo.svg", "./favicon-32x32.png"],
    apple: "./apple-touch-icon.png",
  },
  manifest: "./site.webmanifest",
  // PWA: full-screen when added to iOS home screen. statusBarStyle "black-translucent"
  // draws the status bar over the content; matches our dark gradient backdrop.
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Open Code Web",
  },
  applicationName: "Open Code Web",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  // iOS Safari: extend layout under the notch so env(safe-area-inset-*) works.
  viewportFit: "cover",
  // Chrome Android: resize visual viewport so content lifts above the keyboard.
  interactiveWidget: "resizes-content",
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
