// Loaded by smoke.html only; excluded from the index.html production build.
import type { BrowserWallet } from './lib/wallet';

const config = await fetch('/__smoke/config').then((response) => response.json()) as { token: string; owner: string; relay: string };
let role: 'owner' | 'relay' = 'owner';
let chainId = '0x4cef52'; // 5042002
let rejectNext = false;
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
function emit(event: string, value: unknown) { listeners.get(event)?.forEach((listener) => listener(value)); }
async function bridge(path: string, payload?: unknown) {
  const response = await fetch(`/__smoke/${path}`, { method: payload ? 'POST' : 'GET', headers: { 'X-Smoke-Token': config.token, 'Content-Type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
const provider: BrowserWallet = {
  async request({ method, params }) {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [config[role]];
    if (method === 'eth_chainId') return chainId;
    if (method === 'eth_getTransactionCount') return (await bridge('nonce', { role })).nonce;
    if (method === 'wallet_switchEthereumChain') { chainId = (params?.[0] as { chainId: string }).chainId; emit('chainChanged', chainId); return null; }
    if (method === 'eth_sendTransaction') {
      if (rejectNext) { rejectNext = false; throw Object.assign(new Error('Synthetic user rejection'), { code: 4001 }); }
      return (await bridge('send', { role, transaction: params?.[0] })).hash;
    }
    throw new Error(`Unsupported smoke method ${method}`);
  },
  on(event, callback) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); },
  removeListener(event, callback) { listeners.get(event)?.delete(callback); },
};
window.ethereum = provider;

const bar = document.createElement('aside');
bar.style.cssText = 'padding:12px;background:#fff6df;font:13px system-ui;border-bottom:1px solid #e2c778';
bar.innerHTML = '<strong>Local smoke wallet · disposable Arc testnet accounts</strong><div id="smoke-buttons"></div><span id="smoke-message"></span>';
document.body.prepend(bar);
const message = (text: string) => { bar.querySelector('#smoke-message')!.textContent = text; };
function button(label: string, action: () => void | Promise<void>) {
  const element = document.createElement('button'); element.textContent = label;
  element.addEventListener('click', () => { Promise.resolve(action()).catch((error) => message(String(error))); });
  bar.querySelector('#smoke-buttons')!.append(element);
}
button('Use owner account', () => { role = 'owner'; emit('accountsChanged', [config.owner]); message('Owner selected'); });
button('Use relay account', () => { role = 'relay'; emit('accountsChanged', [config.relay]); message('Relay selected'); });
button('Wrong network', () => { chainId = '0x1'; emit('chainChanged', chainId); message('Synthetic wrong wallet network'); });
button('Reject next send', () => { rejectNext = true; message('Next eth_sendTransaction will be rejected'); });
button('Restore captured file selection', async () => {
  const result = await bridge('backup');
  if (!result.keyfile) throw new Error('Export a backup first');
  const transfer = new DataTransfer();
  transfer.items.add(new File([result.keyfile], 'arcmandate-keyfile.json', { type: 'application/json' }));
  const input = document.querySelector<HTMLInputElement>('input[type=file]');
  if (!input) throw new Error('Enter management mode first');
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  message('Selected the browser-exported encrypted file saved on disk by this test harness');
});
document.addEventListener('click', (event) => {
  const link = event.target;
  if (!(link instanceof HTMLAnchorElement) || !/^arcmandate-key-[0-9a-f]{8}\.json$/i.test(link.download)) return;
  void fetch(link.href).then((response) => response.text()).then((keyfile) => bridge('backup', { keyfile })).then(() => message('Browser-exported encrypted file saved to the ignored smoke directory')).catch((error) => message(String(error)));
});
await import('./main');
