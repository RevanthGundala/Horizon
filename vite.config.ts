import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src')
    }
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  },
  server: {
    proxy: {
      // Proxy API requests to the AWS API Gateway during development
      '/config': {
        target: 'https://o97b3832ba.execute-api.us-west-2.amazonaws.com/stage',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/config/, '/config'),
      },
      '/auth': {
        target: 'https://o97b3832ba.execute-api.us-west-2.amazonaws.com/stage',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path,
      },
      '/user': {
        target: 'https://o97b3832ba.execute-api.us-west-2.amazonaws.com/stage',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path,
      },
      '/protected': {
        target: 'https://o97b3832ba.execute-api.us-west-2.amazonaws.com/stage',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path,
      },
    },
  },
});
