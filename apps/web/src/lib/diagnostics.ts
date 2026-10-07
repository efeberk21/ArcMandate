// Local diagnostics contain event names/timings only, never payloads, accounts, signatures or keys.
export const DIAGNOSTIC_KEY = 'arcmandate.lifecycle.v1';
export function diagnostic(event: 'page-load' | 'page-hide' | 'asset-error' | 'wallet-account' | 'wallet-chain' | 'wallet-disconnect' | 'worker-start' | 'worker-stop' | 'vault-read-start' | 'vault-read-ok' | 'vault-read-error' | 'hmr') {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DIAGNOSTIC_KEY) ?? '[]');
    const rows = Array.isArray(saved) ? saved.filter(row => row && typeof row.event === 'string' && typeof row.at === 'string').slice(-99) : [];
    sessionStorage.setItem(DIAGNOSTIC_KEY, JSON.stringify([...rows, { event, at: new Date().toISOString() }]));
  } catch { /* Diagnostics never affect authorization. */ }
}
