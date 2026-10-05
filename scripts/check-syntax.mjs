import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
for (const file of readdirSync('scripts').filter((file) => file.endsWith('.mjs'))) {
  const result = spawnSync(process.execPath, ['--check', `scripts/${file}`], { stdio: 'inherit', shell: false });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('JavaScript script syntax verified');
