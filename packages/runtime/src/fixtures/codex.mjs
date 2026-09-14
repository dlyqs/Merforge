#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
let prompt = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (prompt += chunk));
const emit = (v) => process.stdout.write(JSON.stringify(v) + '\n');
process.stdin.on('end', () => {
  const pkg = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
  const mode = pkg.instructions;
  emit({
    type: 'thread.started',
    thread_id: '00000000-0000-4000-8000-000000000099',
  });
  emit({ type: 'turn.started' });
  if (mode === 'AUTH') {
    process.stderr.write('401 Unauthorized\n');
    process.exitCode = 1;
    return;
  }
  if (mode === 'NONZERO') {
    process.exitCode = 7;
    return;
  }
  if (mode === 'MALFORMED') {
    process.stdout.write('{bad}\n');
    return;
  }
  if (mode === 'TRUNCATED') {
    process.stdout.write('{"type":"turn.completed"}');
    return;
  }
  if (mode === 'UNKNOWN') {
    emit({ type: 'turn.future_end' });
    return;
  }
  if (mode === 'OUTPUT_LIMIT') {
    process.stdout.write('x'.repeat(8192));
    setInterval(() => {}, 1000);
    return;
  }
  if (mode === 'WAIT' || mode === 'WAIT_TREE') {
    if (mode === 'WAIT_TREE') {
      const child = spawn(
        process.execPath,
        [
          '-e',
          "require('fs').writeFileSync('child.json',JSON.stringify({pid:process.pid}));setInterval(()=>{},1000)",
        ],
        { detached: true, stdio: 'ignore' },
      );
      child.unref();
    }
    setInterval(() => {}, 1000);
    return;
  }
  if (
    (mode === 'RETRY_SUCCESS' || mode === 'CRASH_RETRY') &&
    readFileSync('sum.mjs', 'utf8').includes('()=>0')
  ) {
    writeFileSync('sum.mjs', 'export const sum=()=>1;\n');
    if (mode === 'CRASH_RETRY') {
      setInterval(() => {}, 1000);
      return;
    }
  } else writeFileSync('sum.mjs', 'export const sum=(a,b)=>a+b;\n');
  emit({ type: 'new.telemetry', secret: 'must not persist' });
  emit({
    type: 'item.completed',
    item: { type: 'error', message: 'deprecated setting' },
  });
  emit({
    type: 'turn.completed',
    usage: { input_tokens: 10, output_tokens: 4 },
  });
});
