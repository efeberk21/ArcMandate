import type { Hex } from 'viem';
const bytes = (hex: string) => Uint8Array.from(hex.match(/.{2}/g) ?? [], x => parseInt(x, 16));
const hex = (value: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(value), x => x.toString(16).padStart(2, '0')).join('');
async function master(secret: string) {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error('Automation key protection is not configured.');
  return crypto.subtle.importKey('raw', bytes(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(key: Hex, secret: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, await master(secret), new TextEncoder().encode(key));
  return `v1:${hex(iv)}:${hex(encrypted)}`;
}
export async function unseal(value: string, secret: string, context: string): Promise<Hex> {
  const [version, iv, encrypted] = value.split(':');
  if (version !== 'v1' || !/^[a-f0-9]{24}$/.test(iv) || !/^[a-f0-9]+$/.test(encrypted)) throw new Error('Invalid protected agent key.');
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(iv), additionalData: new TextEncoder().encode(context) }, await master(secret), bytes(encrypted));
  const result = new TextDecoder().decode(decrypted);
  if (!/^0x[a-f0-9]{64}$/i.test(result)) throw new Error('Invalid agent key.');
  return result as Hex;
}
export async function digest(value: string): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))); }
