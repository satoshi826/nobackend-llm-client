// ビルド成果物を _headers（Cloudflare Pages 形式）のヘッダ付きで配信する検証用サーバー。
// CSP・Trusted Types が本番相当で効いた状態で動作確認するために使う。
// Cloudflare と同じく、一致したルールのヘッダを順に適用し、「! 名前」でそれまでのヘッダを外せる。
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

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

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
          // 同じヘッダが複数のルールにあれば、Cloudflare と同じくカンマで連結する
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
