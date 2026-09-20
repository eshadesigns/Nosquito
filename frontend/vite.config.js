import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // During `npm run dev`, anything the frontend calls at /api/* is
      // forwarded to the Flask backend running on port 5000.
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
});
