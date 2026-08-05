/** Public Canvas boundary. App composition imports panels only from this file. */
export { ConversationPanel } from './panels/conversation-panel';
export { ConversationRail } from './panels/conversation-rail';
export { TopBar } from './panels/top-bar';
export { WorkspacePanel } from './panels/workspace-panel';

// Keep route-level panels behind real dynamic-import boundaries. Re-exporting the
// components here would make this already-loaded barrel pull them into the shell.
export const loadModelPanel = () => import('./panels/model-panel');
export const loadSessionPanel = () => import('./panels/session-panel');
export const loadSkillPanel = () => import('./panels/skill-panel');
export { preloadConfigView } from './panels/config-preload';
