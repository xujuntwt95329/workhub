import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/mcp": "http://127.0.0.1:3001",
      "/oauth": "http://127.0.0.1:3001",
      "/.well-known": "http://127.0.0.1:3001",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("node_modules") &&
            /react-markdown|remark-|rehype-|micromark|mdast|hast|unified|vfile|markdown|unist|property-information/.test(
              id,
            )
          )
            return "markdown";
        },
      },
    },
  },
});
