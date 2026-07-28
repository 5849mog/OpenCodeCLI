import type { Metadata } from "next";
import { Inter, Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable} antialiased bg-[#FAF9F7] text-[#2D2B27]`}
      >
        {children}
        <Toaster
          position="bottom-right"
          theme="light"
          toastOptions={{
            style: {
              background: "#FFFFFF",
              border: "1px solid #E5E2D9",
              color: "#2D2B27",
              borderRadius: "8px",
            },
          }}
        />
      </body>
    </html>
  );
}
