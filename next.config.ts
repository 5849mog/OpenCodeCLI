import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for GitHub Pages / any static hosting.
  // Outputs a fully static site to `out/` directory.
  output: "export",

  // GitHub Pages serves at username.github.io/repo-name/,
  // so we need basePath + assetPrefix. Set REPO_NAME env var
  // when building for a sub-path deployment.
  // For username.github.io (root), leave REPO_NAME empty.
  ...(process.env.REPO_NAME
    ? {
        basePath: `/${process.env.REPO_NAME}`,
        assetPrefix: `/${process.env.REPO_NAME}/`,
      }
    : {}),

  // Static export doesn't support Next.js image optimization.
  images: {
    unoptimized: true,
  },

  // Trailing slash so GitHub Pages serves index.html for all routes.
  trailingSlash: true,

  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
