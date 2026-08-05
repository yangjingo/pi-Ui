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
    intent: null,
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
  subject.reduce({
    type: 'intent_updated',
    sessionId: 'session-a',
    intent: {
      intentId: 'intent-a',
      sessionId: 'session-a',
      sourceTurnId: 'turn-a',
      status: 'awaitingConfirmation',
      clarificationRound: 0,
      objective: 'Only A contract',
      deliverables: ['A'],
      acceptanceCriteria: ['A verified'],
      constraints: [],
      nonGoals: [],
      verificationPlan: ['test A'],
      assumptions: [],
      openQuestions: [],
      revision: 1,
      contractHash: 'hash-a',
      createdAt: 1,
      updatedAt: 1,
    },
  });

  const state = subject.getSnapshot();
  assert.equal(state.sessions['session-a'].streaming.text, 'only A');
  assert.equal(state.sessions['session-b'].streaming, null);
  assert.equal(state.sessions['session-b'].summary.title, 'B');
  assert.equal(state.sessions['session-a'].intent?.intentId, 'intent-a');
  assert.equal(state.sessions['session-b'].intent, null);

  subject.reduce({
    type: 'session_deleted',
    sessionId: 'session-b',
    deletedSessionId: 'session-b',
  });
  assert.equal(subject.getSnapshot().sessions['session-b'], undefined);
  assert.equal(subject.getSnapshot().sessions['session-a'].summary.title, 'A');
});

test('Workspace Session store batches high-frequency stream events without hiding raw events', async () => {
  const subject = new BrowserAgentClient() as any;
  subject.reduce(snapshot('session-a', 'A'));
  let storeNotifications = 0;
  const rawEvents: AgentEvent[] = [];
  const stopStore = subject.storeSubscribe(() => { storeNotifications += 1; });
  const stopEvents = subject.subscribe((event: AgentEvent) => { rawEvents.push(event); });

  subject.receive({ type: 'text_delta', sessionId: 'session-a', delta: 'A' });
  subject.receive({ type: 'text_delta', sessionId: 'session-a', delta: 'B' });
  subject.receive({ type: 'text_delta', sessionId: 'session-a', delta: 'C' });
  subject.receive({ type: 'thinking_delta', sessionId: 'session-a', delta: 'x' });
  subject.receive({ type: 'thinking_delta', sessionId: 'session-a', delta: 'y' });

  assert.equal(rawEvents.length, 5);
  assert.equal(storeNotifications, 0);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(storeNotifications, 1);
  assert.equal(subject.getSnapshot().sessions['session-a'].streaming.text, 'ABC');
  assert.equal(subject.getSnapshot().sessions['session-a'].streaming.thinking, 'xy');

  stopEvents();
  stopStore();
});

test('a terminal tool event commits queued output and completion together', () => {
  const subject = new BrowserAgentClient() as any;
  subject.reduce(snapshot('session-a', 'A'));
  subject.reduce({
    type: 'tool_start',
    sessionId: 'session-a',
    step: { id: 'shell-1', t: 'code', title: 'PowerShell', status: 'running' },
  });
  let storeNotifications = 0;
  const stopStore = subject.storeSubscribe(() => { storeNotifications += 1; });

  subject.receive({
    type: 'tool_update',
    sessionId: 'session-a',
    step: { id: 'shell-1', t: 'code', title: 'PowerShell', status: 'running', out: 'partial' },
  });
  subject.receive({
    type: 'tool_end',
    sessionId: 'session-a',
    step: { id: 'shell-1', t: 'code', title: 'PowerShell', status: 'done', out: 'complete' },
  });

  assert.equal(storeNotifications, 1);
  assert.deepEqual(subject.getSnapshot().sessions['session-a'].streaming.steps[0], {
    id: 'shell-1',
    t: 'code',
    title: 'PowerShell',
    status: 'done',
    out: 'complete',
  });
  stopStore();
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
