import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import localization from './scripts/localization.mjs';
export default defineConfig({
  plugins: [localization(), react()],
  build: { target: 'es2022' },
  server: {
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: true,
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**'],
    },
    proxy: {
      '/api': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
      '/pixel.js': process.env.API_PROXY_TARGET || 'http://127.0.0.1:3001',
    },
  },
});
