import { describe, expect, it } from 'vitest';
import { decryptFile, decryptSecret, encryptFile, encryptSecret, MAX_ITERATIONS, MIN_ITERATIONS, readFileHeader, UnsupportedBlobError, WrongPassphraseError } from './passphrase';

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

describe('files encrypted a chunk at a time', () => {
  const MiB = 1 << 20;
  // Over two chunks of 4 MiB, with every byte value
  const plain = new Uint8Array(9 * MiB).map((_, i) => (i * 7) & 0xff);
  const open = async (file: Blob, pass = 'correct horse') => decryptFile(file, (await readFileHeader(file))!, pass);

  it('decrypts to the same bytes, with the format named on its first line', async () => {
    const file = await encryptFile(new Blob([plain]), 'correct horse', 'test/format', MIN_ITERATIONS);
    expect((await readFileHeader(file))?.header).toMatchObject({ format: 'test/format', version: 2, iter: MIN_ITERATIONS, chunk: 4 * MiB });
    expect(new Uint8Array(await (await open(file)).arrayBuffer())).toEqual(plain);
    expect(await (await open(await encryptFile(new Blob([]), 'correct horse', 'f', MIN_ITERATIONS))).text()).toBe('');
    expect(await readFileHeader(new Blob(['{"format":"x"}']))).toBeNull();
  });

  it('refuses a wrong passphrase, and a file cut off, reordered or out of range', async () => {
    const file = await encryptFile(new Blob([plain]), 'correct horse', 'f', MIN_ITERATIONS);
    await expect(open(file, 'wrong horse')).rejects.toBeInstanceOf(WrongPassphraseError);
    const { start, header } = (await readFileHeader(file))!;
    const sealed = header.chunk + 16;
    // Cut after the second chunk: what is left ends on a chunk that was not the last
    await expect(open(file.slice(0, start + 2 * sealed))).rejects.toBeInstanceOf(WrongPassphraseError);
    const swapped = new Blob([file.slice(0, start), file.slice(start + sealed, start + 2 * sealed), file.slice(start, start + sealed), file.slice(start + 2 * sealed)]);
    await expect(open(swapped)).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(decryptFile(file, { start, header: { ...header, iter: 1e12 } }, 'correct horse')).rejects.toBeInstanceOf(UnsupportedBlobError);
  });
});
