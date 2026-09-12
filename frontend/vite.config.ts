import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

declare const process: { env: Record<string, string | undefined> };

export default defineConfig({
  base: process.env.VITE_ANDROID === 'true' ? './' : '/',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    sourcemap: true,
  },
});
