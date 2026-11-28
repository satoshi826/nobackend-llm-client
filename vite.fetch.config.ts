// Build config for the fetch page hosted on a separate origin (optional; vite.page.ts).
//   VITE_FETCH_RELAY_URL  : optional relay for sites that do not allow fetching from a browser (relay/worker.js)
//   VITE_JINA_BASE_URL    : Jina Reader's address; only for the mock (defaults to https://r.jina.ai)
// The app is then built with VITE_FETCH_URL pointing at it, and with the same VITE_FETCH_RELAY_URL (Settings → Web
// shows it).
import { separatePage } from './vite.page';
import { fetchHeadersFile, fetchPagePolicy } from './csp.config';

export default separatePage('fetch', 5176, { policy: fetchPagePolicy, headersFile: fetchHeadersFile });
