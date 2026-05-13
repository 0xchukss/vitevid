import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/api/clip": ["node_modules/ffmpeg-static/ffmpeg*"],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
