import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, WrongPassphraseError } from './passphrase';

describe('パスフレーズ暗号化', () => {
  it('暗号化して同じパスフレーズで復号できる', async () => {
    const blob = await encryptSecret('sk-test-123', 'correct horse', 1000);
    expect(blob.ct).not.toContain('sk-test');
    expect(await decryptSecret(blob, 'correct horse')).toBe('sk-test-123');
  });
  it('違うパスフレーズでは WrongPassphraseError', async () => {
    const blob = await encryptSecret('sk-test-123', 'correct horse', 1000);
    await expect(decryptSecret(blob, 'wrong pass')).rejects.toBeInstanceOf(WrongPassphraseError);
  });
  it('短すぎるパスフレーズは拒否', async () => {
    await expect(encryptSecret('x', 'short', 1000)).rejects.toThrow();
  });
  it('毎回ソルトと IV が変わる', async () => {
    const a = await encryptSecret('k', 'passphrase1', 1000);
    const b = await encryptSecret('k', 'passphrase1', 1000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.iv).not.toBe(b.iv);
  });
});
