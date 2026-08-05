import { constants } from 'node:fs';
import { access, mkdir, readFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loopbackHost } from './network-policy';
import { spawn } from 'node:child_process';

type Command = 'doctor' | 'help' | 'install' | 'start' | 'version';

export interface CliOptions {
  command: Command;
  cwd: string;
  host: string;
  json: boolean;
  noOpen: boolean;
  port: number;
}

interface DoctorReport {
  ok: boolean;
  version: string;
  node: {
    current: string;
    required: string;
    ok: boolean;
  };
  assets: {
    path: string;
    found: boolean;
  };
  workspace: {
    cwd: string;
    path: string;
    found: boolean;
    writable: boolean;
    modelConfigFound: boolean;
    authConfigFound: boolean;
  };
  server: {
    host: string;
    port: number;
    available: boolean;
  };
}

const HELP = `Pi UI — local-first Pi agent workspace

Usage:
  piUi install [options]   Initialize .workspace and start Pi UI
  piUi start [options]     Start an existing Pi UI workspace
  piUi doctor [options]    Check runtime, assets, workspace, and port
  piUi --version           Print the installed version

Options:
  --cwd <path>             Project directory (default: current directory)
  --host <host>            Loopback host only (default: 127.0.0.1)
  --port <port>            Listen port (default: 4173)
  --no-open                Do not open a browser
  --json                   JSON output for doctor
  -h, --help               Show help
  -v, --version            Show version

Examples:
  npx pi-ui install
  piUi install --port 4317
  piUi doctor --json
`;

function validPort(value: string | undefined): number {
  const port = Number(value ?? '4173');
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port "${value}". Expected an integer from 1 to 65535.`);
  }
  return port;
}

function validHost(value: string | undefined): string {
  return loopbackHost(value);
}

export function parseCliArgs(argv: string[], baseCwd = process.cwd()): CliOptions {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      cwd: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      host: { type: 'string' },
      json: { type: 'boolean' },
      'no-open': { type: 'boolean' },
      port: { type: 'string' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (parsed.positionals.length > 1) {
    throw new Error(`Unexpected arguments: ${parsed.positionals.slice(1).join(' ')}`);
  }

  let command: Command;
  if (parsed.values.help) command = 'help';
  else if (parsed.values.version) command = 'version';
  else {
    const requested = parsed.positionals[0] || 'help';
    if (!['doctor', 'help', 'install', 'start', 'version'].includes(requested)) {
      throw new Error(`Unknown command "${requested}".`);
    }
    command = requested as Command;
  }

  return {
    command,
    cwd: resolve(baseCwd, parsed.values.cwd || '.'),
    host: validHost(parsed.values.host),
    json: parsed.values.json || false,
    noOpen: parsed.values['no-open'] || false,
    port: validPort(parsed.values.port),
  };
}

async function firstReadable(candidates: URL[]): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.R_OK);
      return fileURLToPath(candidate);
    } catch {
      // Source execution and bundled execution have different depths.
    }
  }
  return null;
}

async function packageVersion(): Promise<string> {
  const path = await firstReadable([
    new URL('../package.json', import.meta.url),
    new URL('../../../package.json', import.meta.url),
  ]);
  if (!path) return 'unknown';
  try {
    const metadata = JSON.parse(await readFile(path, 'utf8')) as { version?: unknown };
    return typeof metadata.version === 'string' ? metadata.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function uiDistPath(): Promise<string> {
  const index = await firstReadable([
    new URL('../dist/index.html', import.meta.url),
    new URL('../../../dist/index.html', import.meta.url),
  ]);
  if (!index) {
    return fileURLToPath(new URL('../dist', import.meta.url));
  }
  return dirname(index);
}

async function canAccess(path: string, mode: number): Promise<boolean> {
  try {
    await access(path, mode);
    return true;
  } catch {
    return false;
  }
}

async function portAvailable(host: string, port: number): Promise<boolean> {
  return new Promise(resolveAvailability => {
    const probe = createNetServer();
    probe.unref();
    probe.once('error', () => resolveAvailability(false));
    probe.listen(port, host, () => {
      probe.close(() => resolveAvailability(true));
    });
  });
}

export async function createDoctorReport(options: CliOptions): Promise<DoctorReport> {
  const version = await packageVersion();
  const distDir = await uiDistPath();
  const workspacePath = resolve(options.cwd, '.workspace');
  const workspaceFound = await canAccess(workspacePath, constants.R_OK);
  const writableTarget = workspaceFound ? workspacePath : options.cwd;
  const major = Number(process.versions.node.split('.')[0]);
  const [writable, available] = await Promise.all([
    canAccess(writableTarget, constants.W_OK),
    portAvailable(options.host, options.port),
  ]);
  const assetsFound = await canAccess(resolve(distDir, 'index.html'), constants.R_OK);

  const report: DoctorReport = {
    ok: major >= 20 && assetsFound && writable && available,
    version,
    node: {
      current: process.versions.node,
      required: '>=20',
      ok: major >= 20,
    },
    assets: {
      path: distDir,
      found: assetsFound,
    },
    workspace: {
      cwd: options.cwd,
      path: workspacePath,
      found: workspaceFound,
      writable,
      modelConfigFound: await canAccess(resolve(workspacePath, '.agentcore', 'models.json'), constants.R_OK),
      authConfigFound: await canAccess(resolve(workspacePath, '.agentcore', 'auth.json'), constants.R_OK),
    },
    server: {
      host: options.host,
      port: options.port,
      available,
    },
  };
  return report;
}

function printDoctor(report: DoctorReport): void {
  const mark = (ok: boolean) => ok ? '✓' : '✗';
  console.log(`Pi UI ${report.version}`);
  console.log(`${mark(report.node.ok)} Node ${report.node.current} (requires ${report.node.required})`);
  console.log(`${mark(report.assets.found)} UI assets ${report.assets.path}`);
  console.log(`${mark(report.workspace.writable)} Workspace ${report.workspace.path}${report.workspace.found ? '' : ' (will be created)'}`);
  console.log(`${mark(report.server.available)} Port ${report.server.host}:${report.server.port}`);
  console.log(`  models.json: ${report.workspace.modelConfigFound ? 'found' : 'not configured'}`);
  console.log(`  auth.json: ${report.workspace.authConfigFound ? 'found' : 'not configured'}`);
}

/**
 * Normalize proxy environment variables so undici's EnvHttpProxyAgent reads
 * consistent values. Undici checks lowercase keys first (http_proxy, https_proxy).
 * SSH sessions may inject loopback proxy variables that don't support long-lived
 * HTTPS streaming. When both a corporate proxy and a local proxy are present,
 * prefer the corporate one for HTTPS traffic so model API streams are stable.
 */
function sanitizeProxyEnv(): void {
  // Collect proxy values from all naming variants.
  const httpCandidates: string[] = [];
  const httpsCandidates: string[] = [];
  const isValidUrl = (raw: string) => {
    try { const u = new URL(raw); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
  };
  for (const [key, value] of Object.entries(process.env)) {
    if (!value) continue;
    const lower = key.toLowerCase();
    const trimmed = value.trim();
    if (!trimmed || !isValidUrl(trimmed)) continue;
    if (lower === 'http_proxy') httpCandidates.push(trimmed);
    else if (lower === 'https_proxy') httpsCandidates.push(trimmed);
  }
  // Prefer the first non-loopback proxy for each protocol.
  const pick = (list: string[]) => {
    const external = list.find(p => {
      try { const h = new URL(p).hostname; return h !== '127.0.0.1' && h !== 'localhost' && h !== '::1'; } catch { return false; }
    });
    return external || list[0];
  };
  const httpProxy = pick(httpCandidates);
  const httpsProxy = pick(httpsCandidates);
  if (httpsProxy) {
    // Ensure undici's first-lookup (lowercase) gets the stable corporate proxy
    // for HTTPS model API streaming.
    process.env.https_proxy = httpsProxy;
    process.env.HTTPS_PROXY = httpsProxy;
  }
  if (httpProxy) {
    process.env.http_proxy = httpProxy;
    process.env.HTTP_PROXY = httpProxy;
  }
}

function openBrowser(url: string): void {
  const launcher = process.platform === 'win32'
    ? { command: 'cmd', args: ['/c', 'start', '', url] }
    : process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : { command: 'xdg-open', args: [url] };
  try {
    const child = spawn(launcher.command, launcher.args, { detached: true, stdio: 'ignore' });
    child.once('error', () => console.warn(`Open this URL in your browser: ${url}`));
    child.unref();
  } catch {
    console.warn(`Open this URL in your browser: ${url}`);
  }
}

async function start(options: CliOptions, installing: boolean): Promise<void> {
  await mkdir(options.cwd, { recursive: true });
  process.chdir(options.cwd);
  const workspacePath = resolve(options.cwd, '.workspace');
  await mkdir(resolve(workspacePath, '.agentcore'), { recursive: true });
  process.env.PI_CWD = workspacePath;
  process.env.PORT = String(options.port);

  const distDir = await uiDistPath();
  if (!await canAccess(resolve(distDir, 'index.html'), constants.R_OK)) {
    throw new Error('Bundled UI assets are missing. Reinstall pi-ui.');
  }

  // Normalize proxy environment variables so undici resolves the right proxy for
  // HTTPS model API streaming. SSH sessions may inject loopback proxies that don't
  // support long-lived streaming; prefer the corporate proxy when both are present.
  sanitizeProxyEnv();

  // Prevent the process from crashing on unhandled exceptions during SSE streaming.
  // Log the error so it's visible but keep the server alive for client retries.
  process.on('uncaughtException', (error) => {
    console.error('[pi] uncaughtException:', error?.message || String(error));
    if (error?.stack) console.error(error.stack);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[pi] unhandledRejection:', (reason as any)?.message || String(reason));
  });

  const { startPiUiServer } = await import('./server');
  await startPiUiServer({
    distDir,
    host: options.host,
    port: options.port,
  });

  const visibleHost = options.host.includes(':') ? `[${options.host}]` : options.host;
  const url = `http://${visibleHost}:${options.port}`;
  if (installing) console.log(`Pi UI initialized at ${workspacePath}`);
  console.log(`Pi UI ${await packageVersion()} → ${url}`);
  console.log('Press Ctrl+C to stop.');
  if (!options.noOpen) openBrowser(url);
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  try {
    const options = parseCliArgs(argv);
    if (options.command === 'help') {
      console.log(HELP);
      return;
    }
    if (options.command === 'version') {
      console.log(await packageVersion());
      return;
    }
    if (options.command === 'doctor') {
      const report = await createDoctorReport(options);
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else printDoctor(report);
      if (!report.ok) process.exitCode = 1;
      return;
    }
    await start(options, options.command === 'install');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`piUi: ${message}`);
    console.error('Run "piUi --help" for usage.');
    process.exitCode = 1;
  }
}
