import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, MAX_ITERATIONS, MIN_ITERATIONS, UnsupportedBlobError, WrongPassphraseError } from './passphrase';

describe('passphrase encryption', () => {
  it('encrypts and decrypts with the same passphrase', async () => {
    const blob = await encryptSecret('sk-test-123', 'correct horse', MIN_ITERATIONS);
    expect(blob.ct).not.toContain('sk-test');
    expect(await decryptSecret(blob, 'correct horse')).toBe('sk-test-123');
  });
  it('throws WrongPassphraseError for a different passphrase', async () => {
    const blob = await encryptSecret('sk-test-123', 'correct horse', MIN_ITERATIONS);
    await expect(decryptSecret(blob, 'wrong pass')).rejects.toBeInstanceOf(WrongPassphraseError);
  });
  it('rejects a passphrase that is too short', async () => {
    await expect(encryptSecret('x', 'short', MIN_ITERATIONS)).rejects.toThrow();
  });
  it('uses a new salt and IV every time', async () => {
    const a = await encryptSecret('k', 'passphrase1', MIN_ITERATIONS);
    const b = await encryptSecret('k', 'passphrase1', MIN_ITERATIONS);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
  it('refuses an iteration count out of range before deriving anything', async () => {
    const blob = await encryptSecret('k', 'passphrase1', MIN_ITERATIONS);
    for (const iter of [MIN_ITERATIONS - 1, MAX_ITERATIONS + 1, 1e15, 1.5e5 + 0.5, Number.NaN]) {
      await expect(decryptSecret({ ...blob, iter }, 'passphrase1')).rejects.toBeInstanceOf(UnsupportedBlobError);
    }
    expect(await decryptSecret(blob, 'passphrase1')).toBe('k');
  });
});
