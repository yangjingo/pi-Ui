import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { normalizeShellText } from './shell-output';

const MAX_OUTPUT_CHARS = 256 * 1024;
const MAX_TIMEOUT_SECONDS = 2_147_483;

export interface PowerShellExecution {
  output: string;
  executable: string;
  exitCode: number;
  truncated: boolean;
}

export interface PowerShellRunOptions {
  signal?: AbortSignal;
  timeout?: number;
  onUpdate?(output: string): void;
}

function executableOnPath(name: string): string | null {
  try {
    const result = spawnSync('where.exe', [name], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] || null : null;
  } catch {
    return null;
  }
}

export function resolvePowerShellExecutable(): string {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';
  const candidates = [
    join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    executableOnPath('pwsh.exe'),
    join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    executableOnPath('powershell.exe'),
  ].filter((value): value is string => !!value);
  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) throw new Error('未找到 pwsh.exe 或 powershell.exe');
  return executable;
}

/** Execute native PowerShell directly. EncodedCommand keeps Chinese source text out of the
 * Bash/WSL boundary, while the prologue makes stdout/stderr UTF-8 before Core decodes it. */
export async function runPowerShell(
  command: string,
  cwd: string,
  options: PowerShellRunOptions = {},
): Promise<PowerShellExecution> {
  const timeout = options.timeout;
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT_SECONDS)) {
    throw new Error(`timeout 必须位于 0 到 ${MAX_TIMEOUT_SECONDS} 秒之间`);
  }
  if (options.signal?.aborted) throw new Error('PowerShell 命令已取消');

  const executable = resolvePowerShellExecutable();
  const script = [
    '$utf8 = [System.Text.UTF8Encoding]::new($false)',
    '[Console]::InputEncoding = $utf8',
    '[Console]::OutputEncoding = $utf8',
    '$OutputEncoding = $utf8',
    "$ProgressPreference = 'SilentlyContinue'",
    command,
  ].join('\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const child = spawn(executable, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-EncodedCommand',
    encoded,
  ], {
    cwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NO_COLOR: '1',
      POWERSHELL_TELEMETRY_OPTOUT: '1',
      TERM: 'dumb',
    },
  });

  const stdout = new StringDecoder('utf8');
  const stderr = new StringDecoder('utf8');
  let output = '';
  let truncated = false;
  const append = (value: string) => {
    if (!value) return;
    output += value;
    if (output.length > MAX_OUTPUT_CHARS) {
      output = output.slice(-MAX_OUTPUT_CHARS);
      truncated = true;
    }
    const current = normalizeShellText(output).text;
    options.onUpdate?.(truncated ? `[较早输出已截断]\n${current}` : current);
  };
  child.stdout?.on('data', data => append(stdout.write(data)));
  child.stderr?.on('data', data => append(stderr.write(data)));

  return await new Promise<PowerShellExecution>((resolve, reject) => {
    let timedOut = false;
    const stop = () => {
      try { child.kill(); } catch { /* process may already be gone */ }
    };
    const onAbort = () => stop();
    options.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = timeout === undefined ? null : setTimeout(() => {
      timedOut = true;
      stop();
    }, timeout * 1000);

    child.once('error', error => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.once('close', code => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      append(stdout.end());
      append(stderr.end());
      const normalized = normalizeShellText(output);
      const finalOutput = `${truncated ? '[较早输出已截断]\n' : ''}${normalized.text}`;
      if (options.signal?.aborted) {
        reject(new Error(`${finalOutput}\nPowerShell 命令已取消`.trim()));
        return;
      }
      if (timedOut) {
        reject(new Error(`${finalOutput}\nPowerShell 命令在 ${timeout} 秒后超时`.trim()));
        return;
      }
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(new Error(`${finalOutput}\nPowerShell 退出码：${exitCode}`.trim()));
        return;
      }
      resolve({ output: finalOutput, executable, exitCode, truncated });
    });
  });
}

const powerShellSchema = Type.Object({
  command: Type.String({ minLength: 1, description: 'PowerShell command or script to execute' }),
  timeout: Type.Optional(Type.Number({
    exclusiveMinimum: 0,
    maximum: MAX_TIMEOUT_SECONDS,
    description: 'Optional timeout in seconds',
  })),
});

export function createPowerShellToolDefinition(cwd: string) {
  return defineTool({
    name: 'powershell',
    label: 'PowerShell',
    description: 'Execute native PowerShell in the active Windows workspace with UTF-8 input and output. Returns merged stdout and stderr.',
    promptSnippet: 'Execute native Windows and PowerShell commands with UTF-8 output',
    parameters: powerShellSchema,
    async execute(_toolCallId, params, signal, onUpdate) {
      const result = await runPowerShell(params.command, cwd, {
        signal,
        timeout: params.timeout,
        onUpdate: output => onUpdate?.({
          content: [{ type: 'text', text: output }],
          details: { shell: 'powershell', encoding: 'utf-8' },
        }),
      });
      return {
        content: [{ type: 'text', text: result.output || '(no output)' }],
        details: {
          shell: 'powershell',
          encoding: 'utf-8',
          executable: result.executable,
          exitCode: result.exitCode,
          truncated: result.truncated,
        },
      };
    },
  });
}
