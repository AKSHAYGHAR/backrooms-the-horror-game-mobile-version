import type { NextConfig } from "next";

// CG_EXPORT=1 produces the CrazyGames build: a fully static, self-contained
// bundle with relative asset paths so it runs from their CDN subfolder.
// The normal (Vercel) build is untouched.
const cgExport = process.env.CG_EXPORT === "1";

const nextConfig: NextConfig = {
  // Allow mobile devices on the local network to connect to the dev server
  allowedDevOrigins: ["192.168.43.43", "192.168.56.1"],
  ...(cgExport && {
    output: "export" as const,
    assetPrefix: "./",
    images: { unoptimized: true },
  }),
};

export default nextConfig;
