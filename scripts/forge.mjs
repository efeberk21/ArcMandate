import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const local = process.platform === 'win32' ? '.tools/foundry/forge.exe' : '.tools/foundry/forge';
const executable = existsSync(local) ? local : 'forge';
const toolchain = JSON.parse((await import('node:fs')).readFileSync('toolchain.json', 'utf8')).release;
const version = spawnSync(executable, ['--version'], { encoding: 'utf8', shell: false });
if (version.error || version.status !== 0 || !version.stdout.includes(toolchain.forgeVersion) || !version.stdout.includes(toolchain.forgeCommit)) {
  console.error(`Forge identity differs from release ${toolchain.forgeVersion} / ${toolchain.forgeCommit}`);
  if (process.env.ARC_ALLOW_TOOLCHAIN_MISMATCH !== '1') process.exit(1);
  console.error('Development override enabled; this run is not release evidence');
}
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit', shell: false });
if (result.error) {
  console.error(`Foundry forge unavailable: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
