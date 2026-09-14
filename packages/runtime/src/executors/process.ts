import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const exec = promisify(execFile);
export interface ProcessIdentity {
  pid: number;
  ppid: number;
  pgid: number;
  start: string;
  command: string;
  state: string;
}
export async function processTable(): Promise<ProcessIdentity[]> {
  const { stdout } = await exec(
    '/bin/ps',
    ['-axo', 'pid=,ppid=,pgid=,stat=,lstart=,comm='],
    { maxBuffer: 4 * 1024 * 1024, timeout: 3000 },
  );
  return stdout.split('\n').flatMap((line) => {
    const m = line
      .trim()
      .match(
        /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.+)$/,
      );
    return m
      ? [
          {
            pid: Number(m[1]),
            ppid: Number(m[2]),
            pgid: Number(m[3]),
            state: m[4]!,
            start: m[5]!,
            command: m[6]!,
          },
        ]
      : [];
  });
}
const same = (a: ProcessIdentity, b: ProcessIdentity) =>
  a.pid === b.pid && a.start === b.start;
const alive = (p: ProcessIdentity) => !p.state.startsWith('Z');
export interface ManagedResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  errorCode: string | null;
  stopped: boolean;
  identities: ProcessIdentity[];
}
export async function managedProcess(input: {
  executable: string;
  argv: string[];
  cwd: string;
  stdin: string;
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  timeoutMs: number;
  onData: (stream: 'stdout' | 'stderr', chunk: Buffer) => void;
  onIdentity: (root: ProcessIdentity, all: ProcessIdentity[]) => void;
}): Promise<ManagedResult> {
  let errorCode: string | null = null,
    exitCode: number | null = null,
    exitSignal: NodeJS.Signals | null = null,
    exited = false,
    ioClosed = false;
  const known = new Map<number, ProcessIdentity>();
  let root: ProcessIdentity | undefined;
  const child = spawn(input.executable, input.argv, {
    cwd: input.cwd,
    env: input.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  child.once('error', () => {
    errorCode = 'PROCESS_SPAWN_FAILED';
    exited = true;
  });
  child.once('close', () => {
    ioClosed = true;
  });
  child.once('exit', (code, signal) => {
    exitCode = code;
    exitSignal = signal;
    exited = true;
  });
  child.stdin.on('error', () => {});
  for (const stream of ['stdout', 'stderr'] as const)
    child[stream].on('data', (chunk: Buffer) => {
      try {
        input.onData(stream, chunk);
      } catch (e) {
        errorCode = e instanceof Error ? e.message : 'OUTPUT_INVALID';
      }
    });
  const started = Date.now();
  let lastIdentity = '';
  async function scan() {
    const table = await processTable();
    if (!root && child.pid) {
      root = table.find((p) => p.pid === child.pid);
      if (root) known.set(root.pid, root);
    }
    // Descendants can start their own sessions/groups. Parent lineage, not PGID,
    // attributes them to this dispatch. Persist identities before signalling.
    let added = true;
    while (added) {
      added = false;
      for (const p of table)
        if (!known.has(p.pid) && known.has(p.ppid)) {
          const parent = known.get(p.ppid)!;
          const current = table.find((x) => x.pid === parent.pid);
          if (!current || same(parent, current)) {
            known.set(p.pid, p);
            added = true;
          }
        }
    }
    const identity = JSON.stringify(
      [...known.values()].map((p) => ({
        pid: p.pid,
        start: p.start,
        command: p.command,
      })),
    );
    if (root && identity !== lastIdentity) {
      input.onIdentity(root, [...known.values()]);
      lastIdentity = identity;
    }
    return table.filter(
      (p) => alive(p) && known.has(p.pid) && same(known.get(p.pid)!, p),
    );
  }
  async function signalVerified(signal: NodeJS.Signals) {
    const current = await scan();
    for (const p of current) {
      try {
        process.kill(p.pid, signal);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
      }
    }
  }
  try {
    await scan();
    if (!root && !exited) {
      await delay(10);
      await scan();
    }
    if (!root && !exited) throw new Error('PROCESS_IDENTITY_UNAVAILABLE');
    if (input.signal.aborted) errorCode = 'CANCELLED';
    // Do not provide the task until the spawned process identity is persisted.
    if (!errorCode) child.stdin.end(input.stdin);
    else child.stdin.end();
    for (;;) {
      let live = await scan();
      if (exited) live = (await scan()).filter((p) => p.pid !== child.pid);
      if (input.signal.aborted) errorCode = 'CANCELLED';
      if (Date.now() - started > input.timeoutMs)
        errorCode = 'EXECUTION_TIMEOUT';
      if (errorCode || exited) {
        if (live.length) {
          if (!errorCode) errorCode = 'PROCESS_DESCENDANTS_REMAIN';
          // Freeze then rescan to catch children created immediately before stop.
          await signalVerified('SIGSTOP');
          await signalVerified('SIGSTOP');
          await signalVerified('SIGTERM');
          await signalVerified('SIGCONT');
          const deadline = Date.now() + 1500;
          while ((await scan()).length && Date.now() < deadline)
            await delay(25);
          if ((await scan()).length) await signalVerified('SIGKILL');
        }
        break;
      }
      await delay(40);
    }
    const deadline = Date.now() + 2000;
    while ((!exited || !ioClosed) && Date.now() < deadline) await delay(20);
    const stopped = exited && ioClosed && (await scan()).length === 0;
    if (!stopped) errorCode = 'PROCESS_STOP_UNCONFIRMED';
    return {
      exitCode,
      signal: exitSignal,
      errorCode,
      stopped,
      identities: [...known.values()],
    };
  } catch {
    // The ChildProcess handle is attributable, but unknown descendants are not.
    // Do not release the persistent workspace lease when inspection failed.
    child.kill('SIGTERM');
    return {
      exitCode,
      signal: exitSignal,
      errorCode: 'PROCESS_INSPECTION_FAILED',
      stopped: false,
      identities: [...known.values()],
    };
  }
}
