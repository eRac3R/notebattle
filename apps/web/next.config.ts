import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@notebattle/protocol"],
  poweredByHeader: false,
};

export default config;
