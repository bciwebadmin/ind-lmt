import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Which deploy a crash report came from (self-repair loop). GitHub Actions
  // sets GITHUB_SHA; local builds say "dev".
  define: {
    __BUILD__: JSON.stringify((process.env.GITHUB_SHA || 'dev').slice(0, 12))
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
