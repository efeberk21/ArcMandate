import { scryptAsync } from '@noble/hashes/scrypt.js';
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { bytesToHex, hexToBytes, type Hex } from 'viem';

export const KEYFILE_MAX_BYTES = 16 * 1024;
export const KEYFILE_FORMAT = 'arcmandate-keyfile';
export const KEYFILE_ALGORITHM = 'SLH-DSA-SHA2-128s';
const PROFILE = { N: 131072, r: 8, p: 1, dkLen: 32 } as const;
const encoder = new TextEncoder();

export type Keyfile = {
  format: typeof KEYFILE_FORMAT;
  version: 1;
  algorithm: typeof KEYFILE_ALGORITHM;
  publicKey: Hex;
  kdf: { name: 'scrypt'; N: 131072; r: 8; p: 1; dkLen: 32; salt: Hex };
  cipher: { name: 'AES-256-GCM'; iv: Hex };
  ciphertext: Hex;
};

function exactKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === keys.sort().join(',');
}

function isHex(value: unknown, byteLength: number): value is Hex {
  return typeof value === 'string' && new RegExp(`^0x[0-9a-f]{${byteLength * 2}}$`).test(value);
}

function aad(file: Keyfile): Uint8Array {
  return encoder.encode(JSON.stringify([
    file.format, file.version, file.algorithm, file.publicKey,
    file.kdf.name, file.kdf.N, file.kdf.r, file.kdf.p, file.kdf.dkLen, file.kdf.salt,
    file.cipher.name, file.cipher.iv,
  ]));
}

function validate(value: unknown): Keyfile {
  if (!exactKeys(value, ['format', 'version', 'algorithm', 'publicKey', 'kdf', 'cipher', 'ciphertext'])
    || value.format !== KEYFILE_FORMAT || value.version !== 1 || value.algorithm !== KEYFILE_ALGORITHM
    || !isHex(value.publicKey, 32)
    || !exactKeys(value.kdf, ['name', 'N', 'r', 'p', 'dkLen', 'salt'])
    || value.kdf.name !== 'scrypt' || value.kdf.N !== PROFILE.N || value.kdf.r !== PROFILE.r
    || value.kdf.p !== PROFILE.p || value.kdf.dkLen !== PROFILE.dkLen || !isHex(value.kdf.salt, 32)
    || !exactKeys(value.cipher, ['name', 'iv']) || value.cipher.name !== 'AES-256-GCM'
    || !isHex(value.cipher.iv, 12) || !isHex(value.ciphertext, 80)) {
    throw new Error('Invalid or unsupported keyfile');
  }
  return value as Keyfile;
}

export function parseKeyfile(json: string): Keyfile {
  if (encoder.encode(json).length > KEYFILE_MAX_BYTES) throw new Error('Keyfile exceeds 16 KiB');
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error('Invalid keyfile JSON'); }
  return validate(value);
}

async function deriveKey(password: string, salt: Hex): Promise<CryptoKey> {
  if (typeof password !== 'string' || password.length === 0) throw new Error('Password is required');
  const material = await scryptAsync(encoder.encode(password), hexToBytes(salt), {
    ...PROFILE, maxmem: 129 * 1024 * 1024,
  });
  try {
    return await crypto.subtle.importKey('raw', material as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
  } finally {
    material.fill(0);
  }
}

export async function encryptKeyfile(secretKey: Uint8Array, publicKey: Hex, password: string): Promise<string> {
  if (secretKey.length !== 64 || !isHex(publicKey, 32)
    || bytesToHex(slh_dsa_sha2_128s.getPublicKey(secretKey)) !== publicKey) {
    throw new Error('Secret and public key mismatch');
  }
  const file: Keyfile = {
    format: KEYFILE_FORMAT, version: 1, algorithm: KEYFILE_ALGORITHM, publicKey,
    kdf: { name: 'scrypt', ...PROFILE, salt: bytesToHex(crypto.getRandomValues(new Uint8Array(32))) },
    cipher: { name: 'AES-256-GCM', iv: bytesToHex(crypto.getRandomValues(new Uint8Array(12))) },
    ciphertext: '0x' as Hex,
  };
  const key = await deriveKey(password, file.kdf.salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: hexToBytes(file.cipher.iv) as BufferSource, additionalData: aad(file) as BufferSource, tagLength: 128 },
    key, secretKey as BufferSource,
  );
  file.ciphertext = bytesToHex(new Uint8Array(ciphertext));
  return `${JSON.stringify(file, null, 2)}\n`;
}

export async function decryptKeyfile(json: string, password: string): Promise<{ secretKey: Uint8Array; publicKey: Hex }> {
  const file = parseKeyfile(json);
  const key = await deriveKey(password, file.kdf.salt);
  let secretKey: Uint8Array;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: hexToBytes(file.cipher.iv) as BufferSource, additionalData: aad(file) as BufferSource, tagLength: 128 },
      key, hexToBytes(file.ciphertext) as BufferSource,
    );
    secretKey = new Uint8Array(plain);
  } catch {
    throw new Error('Wrong password or damaged keyfile');
  }
  if (secretKey.length !== 64 || bytesToHex(slh_dsa_sha2_128s.getPublicKey(secretKey)) !== file.publicKey) {
    secretKey.fill(0);
    throw new Error('Keyfile public key mismatch');
  }
  return { secretKey, publicKey: file.publicKey };
}
