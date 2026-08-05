import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';

export const DEFAULT_WORKSPACE_WIDTH = 860;
export const DEFAULT_WORKSPACE_WIDTH_RATIO = 0.5;
export const MIN_WORKSPACE_WIDTH = 360;
const MAX_WORKSPACE_WIDTH = 1400;
const MIN_CONVERSATION_WIDTH = 420;
const MAX_WORKSPACE_VIEWPORT_SHARE = 0.65;

export function useWorkspaceWidth() {
  const [dragging, setDragging] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState(DEFAULT_WORKSPACE_WIDTH);
  const widthRef = useRef(DEFAULT_WORKSPACE_WIDTH);
  const preferredWidthRef = useRef<number | null>(null);
  const resizePointerRef = useRef<number | null>(null);

  const minWorkspaceWidth = () => Math.min(
    MIN_WORKSPACE_WIDTH,
    Math.floor(window.innerWidth * MAX_WORKSPACE_VIEWPORT_SHARE),
  );
  const minConversationWidth = () => Math.min(
    MIN_CONVERSATION_WIDTH,
    Math.ceil(window.innerWidth * (1 - MAX_WORKSPACE_VIEWPORT_SHARE)),
  );
  const maxWorkspaceWidth = () => Math.max(
    minWorkspaceWidth(),
    Math.min(MAX_WORKSPACE_WIDTH, window.innerWidth - minConversationWidth()),
  );

  const applyWorkspaceWidth = (raw: number, persist = false, announce = false) => {
    const next = Math.round(Math.max(minWorkspaceWidth(), Math.min(maxWorkspaceWidth(), raw)));
    widthRef.current = next;
    (document.querySelector('.app') as HTMLElement | null)?.style.setProperty('--ws-w', `${next}px`);
    if (announce) setWorkspaceWidth(next);
    if (persist) {
      preferredWidthRef.current = next;
      window.localStorage.setItem('pi.workspace.width', String(next));
    }
    return next;
  };

  useEffect(() => {
    const saved = Number(window.localStorage.getItem('pi.workspace.width'));
    preferredWidthRef.current = Number.isFinite(saved) && saved >= MIN_WORKSPACE_WIDTH && saved <= MAX_WORKSPACE_WIDTH
      ? saved
      : null;
    const defaultWidth = () => Math.round(window.innerWidth * DEFAULT_WORKSPACE_WIDTH_RATIO);
    applyWorkspaceWidth(preferredWidthRef.current ?? defaultWidth(), false, true);
    const onWindowResize = () => applyWorkspaceWidth(preferredWidthRef.current ?? defaultWidth(), false, true);
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  useEffect(() => () => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const beginResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizePointerRef.current != null) return;
    event.preventDefault();
    resizePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizePointerRef.current === event.pointerId) applyWorkspaceWidth(window.innerWidth - event.clientX);
  };
  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (resizePointerRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    resizePointerRef.current = null;
    preferredWidthRef.current = widthRef.current;
    window.localStorage.setItem('pi.workspace.width', String(widthRef.current));
    setWorkspaceWidth(widthRef.current);
    setDragging(false);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  const resizeWithKeyboard = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 80 : 24;
    if (event.key === 'Home') {
      preferredWidthRef.current = null;
      window.localStorage.removeItem('pi.workspace.width');
      applyWorkspaceWidth(window.innerWidth * DEFAULT_WORKSPACE_WIDTH_RATIO, false, true);
      return;
    }
    const next = event.key === 'End' ? maxWorkspaceWidth()
      : widthRef.current + (event.key === 'ArrowLeft' ? step : -step);
    applyWorkspaceWidth(next, true, true);
  };

  const resetWorkspaceWidth = () => {
    preferredWidthRef.current = null;
    window.localStorage.removeItem('pi.workspace.width');
    return applyWorkspaceWidth(window.innerWidth * DEFAULT_WORKSPACE_WIDTH_RATIO, false, true);
  };

  return {
    dragging, workspaceWidth, minWorkspaceWidth, maxWorkspaceWidth, beginResize, moveResize, finishResize, resizeWithKeyboard,
    resetWorkspaceWidth,
  };
}
