// Test server that serves the build output with the headers from _headers (Cloudflare Pages format).
// Used to check behaviour with CSP and Trusted Types enforced as in production.
// Like Cloudflare, applies headers of matching rules in order; "! Name" removes a header set earlier.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);

function parseHeaders(file) {
  const rules = [];
  if (!fs.existsSync(file)) return rules;
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), ops: [] };
      rules.push(cur);
    } else if (cur) {
      const t = line.trim();
      if (t.startsWith('!')) cur.ops.push({ detach: t.slice(1).trim().toLowerCase() });
      else {
        const i = t.indexOf(':');
        cur.ops.push({ name: t.slice(0, i).trim(), value: t.slice(i + 1).trim() });
      }
    }
  }
  return rules;
}

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

http
  .createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = path.join(root, decodeURIComponent(u.pathname));
    if (!p.startsWith(root)) return res.writeHead(403).end();
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) p = path.join(root, 'index.html');
    const headers = new Map();
    for (const r of parseHeaders(path.join(root, '_headers'))) {
      const re = new RegExp('^' + r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (!re.test(u.pathname)) continue;
      for (const op of r.ops) {
        if (op.detach) headers.delete(op.detach);
        else {
          // If several rules set the same header, join them with commas like Cloudflare does
          const k = op.name.toLowerCase();
          const prev = headers.get(k);
          headers.set(k, { name: op.name, value: prev ? `${prev.value}, ${op.value}` : op.value });
        }
      }
    }
    for (const { name, value } of headers.values()) res.setHeader(name, value);
    res.setHeader('Content-Type', types[path.extname(p)] ?? 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  })
  .listen(port, () => console.log(`serving ${root} with _headers on http://localhost:${port}`));
