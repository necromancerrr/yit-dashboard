import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a minimal, self-contained server build (used by the Dockerfile).
  output: "standalone",
};

export default nextConfig;
