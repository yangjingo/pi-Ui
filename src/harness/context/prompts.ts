/** Prompt constants for the Context harness. These are the only user-visible strings injected
 *  into Pi's system prompt. They must never contain a session id, timestamp, model name, or
 *  mutable workspace content. */

/** The stabilized CWD line injected into Pi's system prompt.
 *  The physical path contains a per-session id and must not leak into the context prefix. */
export const CONTEXT_WORKSPACE_LINE =
  'Current working directory: . (the active session workspace; resolve relative tool paths here)';

/** Static, deliberately short guidance appended to Pi's base system prompt. */
export const CONTEXT_SYSTEM_PROMPT = `<context_harness>
Treat context as finite working memory:
- Keep the declared tool set stable for the whole session; select a tool by calling it, not by asking to add or remove definitions.
- Retrieve files and Skill supporting material just in time with relative paths instead of loading broad directories up front.
- Keep tool failures in the conversation so later attempts can adapt; do not repeat large tool results unless they are needed.
- Persist durable plans and intermediate results in workspace files when the task outlives the current context window.
</context_harness>`;
