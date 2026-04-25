import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  webpack(config) {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@spz-loader/core": path.resolve(process.cwd(), "src/lib/spz-loader-core-shim.ts"),
    };
    return config;
  },
};

export default nextConfig;
