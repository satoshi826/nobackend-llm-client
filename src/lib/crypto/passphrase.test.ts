import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, WrongPassphraseError } from './passphrase';

describe('passphrase encryption', () => {
  it('encrypts and decrypts with the same passphrase', async () => {
    const blob = await encryptSecret('sk-test-123', 'correct horse', 1000);
    expect(blob.ct).not.toContain('sk-test');
    expect(await decryptSecret(blob, 'correct horse')).toBe('sk-test-123');
  });
  it('throws WrongPassphraseError for a different passphrase', async () => {
    const blob = await encryptSecret('sk-test-123', 'correct horse', 1000);
    await expect(decryptSecret(blob, 'wrong pass')).rejects.toBeInstanceOf(WrongPassphraseError);
  });
  it('rejects a passphrase that is too short', async () => {
    await expect(encryptSecret('x', 'short', 1000)).rejects.toThrow();
  });
  it('uses a new salt and IV every time', async () => {
    const a = await encryptSecret('k', 'passphrase1', 1000);
    const b = await encryptSecret('k', 'passphrase1', 1000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
});
