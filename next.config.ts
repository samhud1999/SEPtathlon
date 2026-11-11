import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/WASM-backed drivers out of the bundler; they resolve at runtime.
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  outputFileTracingIncludes: {
    "/*": ["./drizzle/**/*", "./fixtures/**/*"],
  },
};

export default nextConfig;
