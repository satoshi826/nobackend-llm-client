import { describe, expect, it } from 'vitest';
import { b64url, openWithPrf, randomBytes, sealWithPrf, unb64url } from './passkey';

describe('passkey unlock crypto', () => {
  it('opens the passphrase with the same PRF output only', async () => {
    const prf = randomBytes(32);
    const sealed = await sealWithPrf(prf, 'correct horse battery');
    expect(await openWithPrf(prf, sealed)).toBe('correct horse battery');
    await expect(openWithPrf(randomBytes(32), sealed)).rejects.toThrow();
  });

  it('refuses short PRF outputs', async () => {
    await expect(sealWithPrf(randomBytes(16), 'x')).rejects.toThrow();
  });

  it('round-trips base64url credential ids', () => {
    const id = new Uint8Array([251, 255, 0, 62, 63, 1]);
    const s = b64url(id);
    expect(s).not.toMatch(/[+/=]/);
    expect([...unb64url(s)]).toEqual([...id]);
  });
});
