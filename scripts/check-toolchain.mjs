import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const { release } = JSON.parse(readFileSync('toolchain.json', 'utf8'));
const npm = spawnSync(process.execPath, [process.env.npm_execpath, '--version'], { encoding: 'utf8', shell: false });
if (process.versions.node !== release.node || npm.status !== 0 || npm.stdout.trim() !== release.npm) {
  throw new Error(`Release requires Node ${release.node} / npm ${release.npm}; found Node ${process.versions.node} / npm ${npm.stdout?.trim() || 'unavailable'}`);
}
console.log(`Release Node ${release.node} / npm ${release.npm} verified`);
