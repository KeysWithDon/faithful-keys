import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/faithful-keys/",
  server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
  plugins: [react()],
});
