import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: true,
  env: {
    LUZIONE_BUILD_TIME: new Date().toISOString(),
  },
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverMinification: true,
  },
};

export default nextConfig;
