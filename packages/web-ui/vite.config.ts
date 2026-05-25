import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Predictable filenames make it easier for the Node server to serve
        // them and for diffs to stay reviewable.
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith('.css')) return 'assets/app.css';
          return 'assets/[name][extname]';
        },
      },
    },
  },
  server: {
    port: 5174,
    proxy: {
      // Target the live orckit web server while developing the frontend.
      // Override with ORCKIT_WEB_TARGET=http://127.0.0.1:<port> when the
      // default 7677 is taken (e.g. another `orc start` already running).
      '/api': process.env.ORCKIT_WEB_TARGET ?? 'http://127.0.0.1:7677',
      '/events': {
        target: process.env.ORCKIT_WEB_TARGET ?? 'http://127.0.0.1:7677',
        changeOrigin: true,
        ws: false,
      },
    },
  },
});
