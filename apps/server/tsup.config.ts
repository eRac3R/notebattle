import { defineConfig } from "tsup";

// Bundle the workspace packages (they ship TS source) but keep npm deps external.
export default defineConfig({
  entry: ["src/main.ts", "src/db/migrate.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  noExternal: [/^@notebattle\//],
});
