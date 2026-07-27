/**
 * Browser-facing Agent gateway.
 *
 * UI features consume this entry point instead of knowing transport URLs, SSE reduction,
 * or the concrete client implementation.
 */
export { agentClient } from './client';
export { requestJson } from './request';
export * from './protocol';
