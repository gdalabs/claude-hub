import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5174,
    host: "0.0.0.0",
    proxy: {
      "/api": {
        target: "http://localhost:3456",
        changeOrigin: true,
      },
      "/auth": {
        target: "http://localhost:3456",
        changeOrigin: true,
      },
    },
  },
});
