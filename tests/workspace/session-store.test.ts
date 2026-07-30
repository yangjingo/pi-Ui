import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserAgentClient } from '../../src/core/agent/client';
import type { AgentEvent } from '../../src/core/agent/contracts';

function snapshot(sessionId: string, title: string): AgentEvent {
  return {
    type: 'session_snapshot',
    sessionId,
    session: {
      id: sessionId,
      title,
      group: '今天',
      time: '刚刚',
      live: false,
      status: 'idle',
    },
    messages: [],
    steers: [],
    goal: null,
    thinking: false,
    cwd: `C:/workspace/${sessionId}`,
    files: [],
    reason: 'session',
  };
}

test('Workspace Session store reduces events only into their addressed record', () => {
  const subject = new BrowserAgentClient() as any;
  subject.reduce(snapshot('session-a', 'A'));
  subject.reduce(snapshot('session-b', 'B'));
  subject.reduce({
    type: 'text_delta',
    sessionId: 'session-a',
    delta: 'only A',
  });

  const state = subject.getSnapshot();
  assert.equal(state.sessions['session-a'].streaming.text, 'only A');
  assert.equal(state.sessions['session-b'].streaming, null);
  assert.equal(state.sessions['session-b'].summary.title, 'B');
});

test('Workspace reconnect restores every known Session by ID without a global snapshot', async () => {
  const originalWindow = globalThis.window;
  const originalEventSource = globalThis.EventSource;
  const instances: FakeEventSource[] = [];

  class FakeEventSource {
    static readonly CLOSED = 2;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((event: MessageEvent<string>) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(public readonly url: string) { instances.push(this); }
    close() {}
  }

  try {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        addEventListener() {},
        setTimeout,
        clearTimeout,
      },
    });
    Object.defineProperty(globalThis, 'EventSource', {
      configurable: true,
      value: FakeEventSource,
    });

    const subject = new BrowserAgentClient() as any;
    subject.reduce(snapshot('session-a', 'A'));
    subject.reduce(snapshot('session-b', 'B'));
    subject.state = { ...subject.state, connectionStatus: 'reconnecting' };
    const restored: string[] = [];
    subject.getSession = async (id: string) => {
      restored.push(id);
      return { ok: true };
    };

    instances[0]?.onopen?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.deepEqual(restored.sort(), ['session-a', 'session-b']);
    assert.equal(subject.getSnapshot().connectionStatus, 'connected');
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: originalEventSource });
  }
});
