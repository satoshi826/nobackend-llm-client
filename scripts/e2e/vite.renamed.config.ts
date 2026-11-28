// The app's build with every file under assets/ given another name (E2E_RENAME goes before the extension), for the
// update flow of npm run e2e (run.ts): a release in which no file kept its name, so an older tab finds none of its
// files on the host
import type { ConfigEnv } from 'vite';
import app from '../../vite.config.ts';

export default (env: ConfigEnv) => {
  const config = (app as (env: ConfigEnv) => any)(env);
  const output = config.build.rollupOptions.output;
  const tag = process.env.E2E_RENAME;
  if (!tag) throw new Error('E2E_RENAME is not set');
  output.entryFileNames = `assets/[name]-[hash]-${tag}.js`;
  output.chunkFileNames = `assets/[name]-[hash]-${tag}.js`;
  const assetName = output.assetFileNames;
  // Before the extension, written out ('.js') or a placeholder ('[extname]')
  output.assetFileNames = (info: { names?: string[] }) => assetName(info).replace(/(\.\w+|\[extname\])$/, `-${tag}$1`);
  return config;
};
