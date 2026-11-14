import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "extension/dist",
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, "src/extension/main.tsx"),
      output: {
        format: "iife",
        name: "Sign2SpeakOverlay",
        entryFileNames: "overlay.js",
        inlineDynamicImports: true,
      },
    },
  },
});
