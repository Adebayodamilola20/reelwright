import { defineConfig } from "vite";

// Renderer build for Electron (file:// loading) → relative asset paths.
export default defineConfig({
  base: "./",
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
