import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';

export const DEFAULT_WORKSPACE_WIDTH = 860;
export const MIN_WORKSPACE_WIDTH = 360;
const MAX_WORKSPACE_WIDTH = 1400;
const MIN_CONVERSATION_WIDTH = 420;

export function useWorkspaceWidth() {
  const [dragging, setDragging] = useState(false);
  const [workspaceWidth, setWorkspaceWidth] = useState(DEFAULT_WORKSPACE_WIDTH);
  const widthRef = useRef(DEFAULT_WORKSPACE_WIDTH);
  const desiredWidthRef = useRef(DEFAULT_WORKSPACE_WIDTH);
  const resizePointerRef = useRef<number | null>(null);

  const maxWorkspaceWidth = () => window.innerWidth > 1180
    ? Math.max(MIN_WORKSPACE_WIDTH, Math.min(MAX_WORKSPACE_WIDTH, window.innerWidth - MIN_CONVERSATION_WIDTH))
    : MAX_WORKSPACE_WIDTH;

  const applyWorkspaceWidth = (raw: number, persist = false, announce = false) => {
    const next = Math.round(Math.max(MIN_WORKSPACE_WIDTH, Math.min(maxWorkspaceWidth(), raw)));
    widthRef.current = next;
    (document.querySelector('.app') as HTMLElement | null)?.style.setProperty('--ws-w', `${next}px`);
    if (announce) setWorkspaceWidth(next);
    if (persist) {
      desiredWidthRef.current = next;
      window.localStorage.setItem('pi.workspace.width', String(next));
    }
    return next;
  };

  useEffect(() => {
    const saved = Number(window.localStorage.getItem('pi.workspace.width'));
    if (Number.isFinite(saved) && saved >= MIN_WORKSPACE_WIDTH && saved <= MAX_WORKSPACE_WIDTH) desiredWidthRef.current = saved;
    applyWorkspaceWidth(desiredWidthRef.current, false, true);
    const onWindowResize = () => applyWorkspaceWidth(desiredWidthRef.current, false, true);
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
    desiredWidthRef.current = widthRef.current;
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
    const next = event.key === 'Home' ? DEFAULT_WORKSPACE_WIDTH
      : event.key === 'End' ? maxWorkspaceWidth()
        : widthRef.current + (event.key === 'ArrowLeft' ? step : -step);
    applyWorkspaceWidth(next, true, true);
  };

  return {
    dragging, workspaceWidth, maxWorkspaceWidth, beginResize, moveResize, finishResize, resizeWithKeyboard,
    resetWorkspaceWidth: () => applyWorkspaceWidth(DEFAULT_WORKSPACE_WIDTH, true, true),
  };
}
