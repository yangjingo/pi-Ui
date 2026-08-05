import type { Message, TrajStep } from '../agent/protocol';

export type ShellKind = 'bash' | 'powershell';
export type ShellOutputEncoding = 'utf-8' | 'normalized' | 'lossy';

const ANSI_ESCAPE = /[\u001b\u009b](?:\][^\u0007]*(?:\u0007|\u001b\\)|[[(][0-?]*[ -/]*[@-~])/g;
const POWERSHELL_INVOCATION = /(?:^|(?:&&|\|\||[;|])\s*)(?:&\s*)?(?:pwsh|powershell)(?:\.exe)?(?=\s|$)/i;
const CMD_POWERSHELL_INVOCATION = /^\s*cmd(?:\.exe)?\s+\/[cs]\s+(?:pwsh|powershell)(?:\.exe)?(?=\s|$)/i;

/** Classify the executable that a historical shell command actually invokes. Merely mentioning
 * PowerShell (for example `where powershell`) must remain a Bash command. */
export function classifyShellCommand(command: unknown, toolName = 'bash'): ShellKind {
  if (toolName.toLowerCase() === 'powershell') return 'powershell';
  const source = String(command || '').trim();
  return POWERSHELL_INVOCATION.test(source) || CMD_POWERSHELL_INVOCATION.test(source)
    ? 'powershell'
    : 'bash';
}

/** Make persisted terminal text safe for browser rendering without claiming to recover bytes that
 * were already replaced before persistence. */
export function normalizeShellText(value: unknown): {
  text: string;
  encoding: ShellOutputEncoding;
} {
  const source = String(value ?? '');
  const hadNulls = source.includes('\u0000');
  let normalized = source
    .replace(ANSI_ESCAPE, '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0001-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '');
  if (normalized.charCodeAt(0) === 0xfeff) normalized = normalized.slice(1);
  return {
    text: normalized,
    encoding: normalized.includes('\ufffd') ? 'lossy' : hadNulls ? 'normalized' : 'utf-8',
  };
}

function readableOutputScore(value: string): number {
  return [...value].reduce((score, character) => (
    character === '\ufffd' || character === '\u0000' ? score : score + 1
  ), 0);
}

function sourceSteps(messages: ReadonlyArray<Message>): Map<string, TrajStep> {
  const result = new Map<string, TrajStep>();
  for (const message of messages) {
    if (message.role !== 'agent') continue;
    for (const step of message.traj || []) {
      if (step.id) result.set(step.id, step);
    }
  }
  return result;
}

/** Upgrade old `.session.json` trajectory snapshots from the canonical Pi JSONL projection.
 * Older builds kept only the first output line and did not persist shell metadata. Matching by
 * toolCallId avoids replaying commands or guessing from display order. */
export function repairHistoricalShellTrajectories(
  messages: ReadonlyArray<Message>,
  projectedSource: ReadonlyArray<Message> = [],
): Message[] {
  const byId = sourceSteps(projectedSource);
  return messages.map(message => {
    if (message.role !== 'agent' || !message.traj?.length) return message;
    let changed = false;
    const traj = message.traj.map(step => {
      if (step.t !== 'code' && !step.shell) return step;
      const source = step.id ? byId.get(step.id) : undefined;
      const command = source?.in || step.in || step.det || '';
      const toolName = source?.shell === 'powershell' || step.title.toLowerCase() === 'powershell'
        ? 'powershell'
        : 'bash';
      const shell = source?.shell || classifyShellCommand(command, toolName);
      const input = normalizeShellText(command);
      const currentOutput = normalizeShellText(step.out || '');
      const sourceOutput = normalizeShellText(source?.out || '');
      const useSource = sourceOutput.text.length > 0
        && readableOutputScore(sourceOutput.text) > readableOutputScore(currentOutput.text);
      const output = useSource ? sourceOutput : currentOutput;
      const repaired: TrajStep = {
        ...step,
        shell,
        in: input.text,
        out: output.text,
        outputEncoding: output.encoding,
      };
      changed = changed
        || repaired.shell !== step.shell
        || repaired.in !== step.in
        || repaired.out !== step.out
        || repaired.outputEncoding !== step.outputEncoding;
      return repaired;
    });
    return changed ? { ...message, traj } : message;
  });
}
