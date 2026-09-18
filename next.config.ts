import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standard output (no "standalone" — that flag is only for container
  // deployments; it breaks plain `next start`).
  reactStrictMode: false,
};

export default nextConfig;
