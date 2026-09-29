import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const local = process.platform === 'win32' ? '.tools/foundry/forge.exe' : '.tools/foundry/forge';
const executable = existsSync(local) ? local : 'forge';
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit', shell: false });
if (result.error) {
  console.error(`Foundry forge unavailable: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
