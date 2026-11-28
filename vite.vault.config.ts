// Build config for the key vault, assuming it is hosted on a separate site (separate origin) from the app (vite.page.ts).
import { separatePage } from './vite.page';
import { vaultHeadersFile, vaultPagePolicy } from './csp.config';

export default separatePage('vault', 5175, { policy: vaultPagePolicy, headersFile: vaultHeadersFile });
