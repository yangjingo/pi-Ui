import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { piAgentPlugin } from './core/pi/vite-plugin';

// UI/UX layer (Vite + React) + Core layer (Pi agent, mounted as dev middleware).
// `npm run dev` serves the React app AND the live Pi agent from one process.
export default defineConfig({
  plugins: [react(), piAgentPlugin()],
  server: { port: 5173, open: false },
});
