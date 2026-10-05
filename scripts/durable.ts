import { randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function atomicJson(path: string, value: unknown, checkpoint?: (stage: 'flushed' | 'renamed') => void): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  const fd = openSync(temp, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(fd); }
  finally { closeSync(fd); }
  try { checkpoint?.('flushed'); renameSync(temp, path); } catch (error) { unlinkSync(temp); throw error; }
  checkpoint?.('renamed');
  if (process.platform !== 'win32') {
    const directory = openSync(dirname(path), 'r');
    try { fsyncSync(directory); } finally { closeSync(directory); }
  }
}

export async function withOsLock<T>(path: string, task: (assertHeld: () => void) => Promise<T>): Promise<T> {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const child = process.platform === 'win32'
    ? spawn(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', fileURLToPath(new URL('./os-lock.ps1', import.meta.url)), '-LockPath', resolve(path)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    : spawn('flock', ['-n', resolve(path), 'sh', '-c', 'printf "locked\\n"; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'ignore'] });
  await new Promise<void>((accept, reject) => {
    let output = '';
    child.stdout.on('data', (data: Buffer) => { output += data.toString(); if (output.includes('locked\n') || output.includes('locked\r\n')) accept(); });
    child.once('error', reject);
    child.once('exit', () => reject(new Error(`Journal is in use or OS lock unavailable: ${path}`)));
  });
  // Parent death closes the pipe; the helper releases the kernel lock at EOF.
  let lost = false;
  const exited = () => { lost = true; };
  child.once('exit', exited);
  const assertHeld = () => { if (lost || child.exitCode !== null || child.signalCode !== null) throw new Error('OS lock helper exited unexpectedly; reconcile the durable journal'); };
  try {
    assertHeld();
    const result = await task(assertHeld);
    assertHeld();
    return result;
  } finally {
    child.removeListener('exit', exited);
    await new Promise<void>((done) => { child.once('exit', () => done()); child.stdin.end(); if (child.exitCode !== null || child.signalCode !== null) done(); });
  }
}
