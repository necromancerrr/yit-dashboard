import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" produces the minimal self-contained server build the
  // Dockerfile copies into the runtime image — needed for self-hosting, but
  // it fights Vercel's own build tracing (missing next-server.js.nft.json)
  // since Vercel already does the equivalent optimization itself. Only set
  // it when we're not building on Vercel.
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
