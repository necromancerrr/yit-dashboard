import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" produces the minimal self-contained server build the
  // Dockerfile copies into the runtime image — needed for self-hosting, but
  // it fights Vercel's own build tracing (missing next-server.js.nft.json)
  // since Vercel already does the equivalent optimization itself. Only set
  // it when we're not building on Vercel.
  output: process.env.VERCEL ? undefined : "standalone",

  // The Yit OS information architecture renamed several areas. These are
  // permanent moves, but the redirects are 307 (permanent: false) on purpose:
  // a 308 is cached by the browser forever, and this app is installed as a PWA
  // where a wrong permanent redirect would be very hard to clear.
  async redirects() {
    return [
      { source: "/interviews", destination: "/career", permanent: false },
      { source: "/gym", destination: "/health", permanent: false },
      { source: "/leetcode", destination: "/growth", permanent: false },
      { source: "/finance", destination: "/money", permanent: false },
      { source: "/crypto", destination: "/money", permanent: false },
    ];
  },
};

export default nextConfig;
