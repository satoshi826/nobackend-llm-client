// ビルド成果物を public/_headers（Cloudflare 形式）のヘッダ付きで配信する検証用サーバー。
// CSP・Trusted Types が本番相当で効いた状態で動作確認するために使う。
// 追加で connect-src に許可したいオリジンを第 3 引数に渡せる（例: モックサーバー）。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? 'dist');
const port = Number(process.argv[3] ?? 4173);
const extraConnect = process.argv[4] ?? '';

function parseHeaders(file) {
  const rules = [];
  if (!fs.existsSync(file)) return rules;
  let cur = null;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      cur = { pattern: line.trim(), headers: {} };
      rules.push(cur);
    } else if (cur) {
      const i = line.indexOf(':');
      cur.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
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
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, 'index.html');
    for (const r of parseHeaders(path.join(root, '_headers'))) {
      const re = new RegExp('^' + r.pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (re.test(u.pathname)) {
        for (const [k, v] of Object.entries(r.headers)) {
          res.setHeader(k, k.toLowerCase() === 'content-security-policy' && extraConnect ? v.replace('connect-src ', `connect-src ${extraConnect} `) : v);
        }
      }
    }
    res.setHeader('Content-Type', types[path.extname(p)] ?? 'application/octet-stream');
    fs.createReadStream(p).pipe(res);
  })
  .listen(port, () => console.log(`serving ${root} with _headers on http://localhost:${port}`));
