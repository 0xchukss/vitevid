import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@remotion/bundler", "@remotion/renderer", "esbuild"],
  outputFileTracingIncludes: {
    "/api/clip": ["node_modules/ffmpeg-static/ffmpeg*"],
    "/api/render-block": ["node_modules/ffmpeg-static/ffmpeg*"],
    "/api/render-video": ["node_modules/ffmpeg-static/ffmpeg*"],
    "/api/render-remotion": [
      "node_modules/@remotion/**",
      "node_modules/remotion/**",
      "node_modules/ffmpeg-static/ffmpeg*",
    ],
  },
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
