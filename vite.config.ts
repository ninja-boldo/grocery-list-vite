
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,           // Allows access from any host (0.0.0.0)
    port: 0,             // Let Vite choose any available port
    strictPort: false,   // Allow port changes if needed
    cors: true,          // Enable CORS for cross-origin requests
    allowedHosts: true, // Allow all hosts including tunnel domains
  },
});