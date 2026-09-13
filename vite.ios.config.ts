import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Native bundle: relative assets work inside Capacitor's iPhone/iPad WebView. */
export default defineConfig({ base: "./", plugins: [react()] });
