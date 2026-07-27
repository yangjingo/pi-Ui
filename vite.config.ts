import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { piAgentPlugin } from './src/core/pi/vite-plugin';

// UI/UX layer (Vite + React) + Core layer (Pi agent, mounted as dev middleware).
// `npm run dev` serves the React app AND the live Pi agent from one process.
export default defineConfig({
  plugins: [react(), piAgentPlugin()],
  server: {
    port: 5173,
    open: false,
    // Playwright writes trace HTML while Vite is running. Watching it can reload the page
    // under test and leave a transient blank document.
    watch: { ignored: ['**/output/**'] },
  },
});
