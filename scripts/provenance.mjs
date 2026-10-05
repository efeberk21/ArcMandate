import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function sourceProvenance() {
  const paths = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0').filter((path) => path && !path.startsWith('deployments/') && !path.startsWith('docs/') && !/^ArcMandate-.*\.md$/.test(path) && existsSync(path)).sort();
  const tree = createHash('sha256');
  for (const path of paths) { tree.update(path); tree.update('\0'); tree.update(sha256(readFileSync(path))); tree.update('\0'); }
  const artifact = 'contracts/out/ArcMandateVault.sol/ArcMandateVault.json';
  const compiled = JSON.parse(readFileSync(artifact, 'utf8'));
  const metadata = typeof compiled.metadata === 'string' ? JSON.parse(compiled.metadata) : compiled.metadata;
  return {
    gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    dirty: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
    sourceTreeSha256: tree.digest('hex'),
    sourceScope: 'Tracked and non-ignored public files, excluding deployment outputs and private documents; hashes include uncommitted source, never ignored credentials',
    trackedPatchSha256: sha256(execFileSync('git', ['diff', '--binary', 'HEAD', '--', '.', ':!docs/**', ':!ArcMandate-*.md', ':!deployments/**'])),
    lockfileSha256: sha256(readFileSync('package-lock.json')),
    artifactSha256: sha256(readFileSync(artifact)),
    foundrySettingsSha256: sha256(readFileSync('contracts/foundry.toml')),
    compiler: metadata.compiler, settings: metadata.settings,
  };
}
