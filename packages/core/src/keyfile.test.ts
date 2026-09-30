import { describe, expect, it } from 'vitest';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { slh_dsa_sha2_128s } from '@noble/post-quantum/slh-dsa.js';
import { bytesToHex, hexToBytes, type Hex } from 'viem';
import { decryptKeyfile, encryptKeyfile, KEYFILE_MAX_BYTES, parseKeyfile } from './keyfile.js';

describe('encrypted PQ keyfile', () => {
  it('restores the same key and signs after export; each export has fresh salt and IV', async () => {
    const pair = slh_dsa_sha2_128s.keygen();
    const publicKey = bytesToHex(pair.publicKey);
    const password = 'a long recovery passphrase';
    const first = await encryptKeyfile(pair.secretKey, publicKey, password);
    const second = await encryptKeyfile(pair.secretKey, publicKey, password);
    const a = parseKeyfile(first);
    const b = parseKeyfile(second);
    expect(a.kdf.salt).not.toBe(b.kdf.salt);
    expect(a.cipher.iv).not.toBe(b.cipher.iv);
    expect(first).not.toContain(bytesToHex(pair.secretKey));
    const restored = await decryptKeyfile(first, password);
    expect(restored.publicKey).toBe(publicKey);
    expect(restored.secretKey).toEqual(pair.secretKey);
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const signature = slh_dsa_sha2_128s.sign(challenge, restored.secretKey);
    expect(slh_dsa_sha2_128s.verify(signature, challenge, pair.publicKey)).toBe(true);
    restored.secretKey.fill(0);
    pair.secretKey.fill(0);
  }, 30_000);

  it('rejects wrong password, damaged AAD and tag, oversized input, unsupported profile and wrong public key', async () => {
    const pair = slh_dsa_sha2_128s.keygen();
    const publicKey = bytesToHex(pair.publicKey);
    const file = await encryptKeyfile(pair.secretKey, publicKey, 'correct password');
    await expect(decryptKeyfile(file, 'wrong password')).rejects.toThrow('Wrong password or damaged keyfile');
    const parsed = parseKeyfile(file);
    const mutate = (change: (value: typeof parsed) => void) => {
      const copy = structuredClone(parsed);
      change(copy);
      return JSON.stringify(copy);
    };
    await expect(decryptKeyfile(mutate((v) => { v.publicKey = `0x${'01'.repeat(32)}`; }), 'correct password'))
      .rejects.toThrow('Wrong password or damaged keyfile');
    await expect(decryptKeyfile(mutate((v) => { v.ciphertext = `${v.ciphertext.slice(0, -1)}${v.ciphertext.endsWith('0') ? '1' : '0'}` as Hex; }), 'correct password'))
      .rejects.toThrow('Wrong password or damaged keyfile');
    expect(() => parseKeyfile(' '.repeat(KEYFILE_MAX_BYTES + 1))).toThrow('16 KiB');
    expect(() => parseKeyfile(mutate((v) => { (v.kdf as { N: number }).N = 2 ** 20; }))).toThrow('Invalid or unsupported');
    expect(() => parseKeyfile(mutate((v) => { v.version = 2 as 1; }))).toThrow('Invalid or unsupported');
    expect(() => parseKeyfile('{')).toThrow('Invalid keyfile JSON');
    await expect(encryptKeyfile(pair.secretKey, `0x${'02'.repeat(32)}`, 'correct password'))
      .rejects.toThrow('Secret and public key mismatch');

    // Build a valid GCM envelope with a false public key to exercise the post-decrypt match check.
    const wrongPublic = structuredClone(parsed);
    wrongPublic.publicKey = `0x${'03'.repeat(32)}`;
    const material = await scryptAsync(new TextEncoder().encode('correct password'), hexToBytes(parsed.kdf.salt), {
      N: 131072, r: 8, p: 1, dkLen: 32, maxmem: 129 * 1024 * 1024,
    });
    const key = await crypto.subtle.importKey('raw', material as BufferSource, 'AES-GCM', false, ['encrypt']);
    material.fill(0);
    const metadata = new TextEncoder().encode(JSON.stringify([
      wrongPublic.format, wrongPublic.version, wrongPublic.algorithm, wrongPublic.publicKey,
      wrongPublic.kdf.name, wrongPublic.kdf.N, wrongPublic.kdf.r, wrongPublic.kdf.p,
      wrongPublic.kdf.dkLen, wrongPublic.kdf.salt, wrongPublic.cipher.name, wrongPublic.cipher.iv,
    ]));
    wrongPublic.ciphertext = bytesToHex(new Uint8Array(await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: hexToBytes(wrongPublic.cipher.iv) as BufferSource, additionalData: metadata as BufferSource, tagLength: 128 },
      key, pair.secretKey as BufferSource,
    )));
    await expect(decryptKeyfile(JSON.stringify(wrongPublic), 'correct password'))
      .rejects.toThrow('Keyfile public key mismatch');
    pair.secretKey.fill(0);
  }, 30_000);
});
