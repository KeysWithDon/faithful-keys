import { defineConfig, mergeConfig } from 'vite';
import desktop from './vite.desktop.config';
import publicConfig from './ios/public-config.json';

export default mergeConfig(desktop, defineConfig({
  define: {
    'import.meta.env.VITE_IOS': JSON.stringify('true'),
    ...Object.fromEntries(Object.entries(publicConfig).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(process.env[key] || value)])),
  },
  plugins: [{
    name: 'iphone-layout',
    enforce: 'pre',
    transform(source, id) {
      if (id.endsWith('/src/main.tsx')) return `${source}\nimport '../ios/iphone.css';`;
    },
  }],
  build: { outDir: 'ios-dist', emptyOutDir: true },
}));
