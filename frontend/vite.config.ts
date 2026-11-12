import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
// API_PROXY_PORT permite rodar um segundo par API + tela (ex.: 3334/5174) ao lado do padrão 3333/5173.
const api = `http://127.0.0.1:${process.env.API_PROXY_PORT || "3333"}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(root, "src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": api,
      "/health": api,
      "/docs": api,
    },
  },
});
