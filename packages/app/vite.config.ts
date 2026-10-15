import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const r = (p: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), p);

// Renderer build for Electron (file:// loading) → relative asset paths.
// @ve/engine aliases point at the engine SOURCE (no Electron/DOM deps there,
// contract §Module boundaries rule 1); switch to dist once the engine ships builds.
export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@ve/engine/types": r("../engine/src/types.ts"),
      "@ve/engine/time": r("../engine/src/time.ts"),
      "@ve/engine": r("../engine/src/api.ts"),
    },
  },
  build: {
    outDir: "dist/ui",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
