import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'spa-fallback',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          // If the request is for a file that doesn't exist, serve index.html
          if (req.url?.startsWith('/auth/callback') || req.url?.startsWith('/login')) {
            req.url = '/';
          }
          next();
        });
      }
    }
  ],
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
      '/chat': {
        target: 'https://o97b3832ba.execute-api.us-west-2.amazonaws.com/stage',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path,
      },
    }
  }
});
