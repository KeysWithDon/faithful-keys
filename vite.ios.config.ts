import { defineConfig, mergeConfig } from 'vite';
import desktop from './vite.desktop.config';

export default mergeConfig(desktop, defineConfig({
  define: { 'import.meta.env.VITE_IOS': JSON.stringify('true') },
  plugins: [{
    name: 'iphone-layout',
    enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/src/main.tsx')) return `${source}\nimport '../ios/iphone.css';`;
    },
  }],
  build: { outDir: 'ios-dist', emptyOutDir: true },
}));
