import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/",
  define: { "import.meta.env.VITE_DESKTOP": JSON.stringify("true") },
  plugins: [
    {
      name: "desktop-local-fonts",
      enforce: "pre",
      transform(source, id) {
        if (id.endsWith("/app/globals.css")) {
          return source.replace(/@import url\('https:\/\/fonts\.googleapis\.com[^\n]+\n/, "");
        }
        if (id.endsWith("/src/main.tsx")) return `import '../desktop/fonts.css';\n${source}`;
      },
    },
    react(),
  ],
  build: { outDir: "desktop-dist", emptyOutDir: true },
});
