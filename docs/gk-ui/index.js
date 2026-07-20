// uniEx Agent Console — Entry point
import { createServer } from "./pi/server.js";
import { initAgent } from "./pi/agent.js";

const PORT = process.env.PORT || 3456;

const app = createServer();

// Initialize pi-agent session (non-blocking — falls back gracefully)
initAgent().catch((e) => console.warn("[init] pi-agent not available, using fallback:", e.message));

app.listen(PORT, () => {
  console.log(`\n⬡ uniEx Agent Console`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Skills: PDF Parse | VLM Analyze | Build Dashboard`);
  console.log(`  pi-agent: auto-initializing...\n`);
});
