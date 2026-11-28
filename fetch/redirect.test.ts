import { describe, expect, it } from 'vitest';
import { redirectStep } from './redirect';

const from = new URL('https://allowed.example/go?to=x');

describe('redirectStep', () => {
  it('follows a redirect that stays on the same site, relative or not', () => {
    expect(redirectStep(from, '/docs/', [])).toEqual({ follow: new URL('https://allowed.example/docs/') });
    expect(redirectStep(from, 'https://allowed.example/a', [])).toEqual({ follow: new URL('https://allowed.example/a') });
  });
  it('asks about a redirect to another site, even from a remembered one (an open redirect)', () => {
    expect(redirectStep(from, 'https://evil.example/?data=secret', ['allowed.example'])).toEqual({ ask: new URL('https://evil.example/?data=secret') });
    // Another port, or a subdomain, is another site
    expect(redirectStep(from, 'https://allowed.example:8443/', ['allowed.example'])).toEqual({ ask: new URL('https://allowed.example:8443/') });
    expect(redirectStep(from, 'https://www.allowed.example/', ['allowed.example'])).toEqual({ ask: new URL('https://www.allowed.example/') });
  });
  it('follows a redirect to a site remembered for the mode', () => {
    expect(redirectStep(from, 'https://cdn.example/f.png', ['cdn.example'])).toEqual({ follow: new URL('https://cdn.example/f.png') });
  });
  it('asks without an address when the browser hides where it leads', () => {
    expect(redirectStep(from, null, ['allowed.example'])).toEqual({ ask: null });
  });
  it('refuses a redirect to anything but https, or with credentials', () => {
    for (const to of ['http://allowed.example/', 'data:text/plain,x', 'javascript:alert(1)', 'https://u:p@allowed.example/', 'https://[bad']) expect(redirectStep(from, to, ['allowed.example'])).toEqual({ refuse: true });
  });
});
