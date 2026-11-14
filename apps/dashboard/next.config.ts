import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// All apps share one .env.local at the repo root (written by `npm run db:env`).
// forceReload: Next has already loaded (and cached) this app folder's env files before reading the config.
loadEnvConfig(path.resolve(process.cwd(), "../.."), process.env.NODE_ENV !== "production", console, true);

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  transpilePackages: ["@lotse/shared"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
