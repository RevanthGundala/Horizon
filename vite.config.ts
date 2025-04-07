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
      '/api': {
        target: 'https://vihy6489c7.execute-api.us-west-2.amazonaws.com/stage',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path,
        configure: (proxy) => {
          proxy.on('proxyReq', function(proxyReq, req, res, options) {
            // Log cookies being sent to the backend
            console.log('Cookies sent to backend:', req.headers.cookie);
          });
          proxy.on('proxyRes', function(proxyRes, req, res) {
            // Log cookies coming back from the backend
            console.log('Cookies from backend:', proxyRes.headers['set-cookie']);
          });
        }
      }
    }
  }
});
