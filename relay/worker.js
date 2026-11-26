// Optional relay for the fetch page (fetch/): fetches one https address for sites that do not allow fetching from
// a browser (no CORS). Deploy it on your own Cloudflare account and build the app with VITE_FETCH_RELAY_URL set to
// its address (README). It keeps nothing, sends no cookies or headers of the caller, and answers only to the fetch
// page's origin(s) in ALLOWED_ORIGINS.
const MAX_BYTES = 20 * 1024 * 1024;

/** Hosts the relay never reaches: this machine, private networks, link-local and similar */
function isPrivateHost(host) {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  return h.includes(':') && (h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:'));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = String(env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (!allowed.includes(origin)) return new Response('Forbidden', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Disposition', Vary: 'Origin' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

    let target;
    try {
      target = new URL(new URL(request.url).searchParams.get('url') ?? '');
    } catch {
      return new Response('Bad address', { status: 400, headers: cors });
    }
    if (target.protocol !== 'https:' || target.username || target.password || isPrivateHost(target.hostname)) return new Response('Address not allowed', { status: 400, headers: cors });

    // A plain request: none of the caller's headers or cookies go on
    const res = await fetch(target.href, { redirect: 'follow', headers: { Accept: '*/*', 'User-Agent': 'nobackend-llm-client-fetch-relay' } });
    if (!res.ok || !res.body) return new Response(null, { status: res.ok ? 502 : res.status, headers: cors });
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return new Response('Too large', { status: 413, headers: cors });
    let total = 0;
    const capped = res.body.pipeThrough(
      new TransformStream({
        transform(chunk, out) {
          total += chunk.byteLength;
          if (total > MAX_BYTES) out.error(new Error('Too large'));
          else out.enqueue(chunk);
        }
      })
    );
    const headers = { ...cors, 'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const disposition = res.headers.get('content-disposition');
    if (disposition) headers['Content-Disposition'] = disposition;
    return new Response(capped, { headers });
  }
};
