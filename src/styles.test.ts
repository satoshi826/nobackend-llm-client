// The CSS minifier treats backdrop-filter and -webkit-backdrop-filter as one property and keeps only the last
// declaration. If the -webkit- one comes last, production CSS has no standard backdrop-filter and Chrome shows no blur.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('styles.css', () => {
  it('declares the standard backdrop-filter after the -webkit- one', () => {
    for (const file of ['src/styles.css', 'vault/style.css']) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (/^\s*-webkit-backdrop-filter:/.test(line)) expect(lines[i + 1], `${file}:${i + 2}`).toMatch(/^\s*backdrop-filter:/);
        if (/^\s*backdrop-filter:/.test(line)) expect(lines[i + 1] ?? '', `${file}:${i + 2}`).not.toMatch(/^\s*-webkit-backdrop-filter:/);
      });
    }
  });
});
