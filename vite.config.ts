import { defineConfig, loadEnv, type Plugin } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';

/**
 * public/_headers の CSP を環境に合わせて書き換える。
 * - VITE_VAULT_URL があれば frame-src にキー金庫のオリジンを追加（金庫だけ埋め込める）
 */
function headersPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'csp-headers',
    apply: 'build',
    generateBundle(_opts, bundle) {
      // public の _headers はバンドル外なので、ここで置き換え版を出力する
      void bundle;
    },
    async writeBundle(opts) {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const file = path.join(opts.dir ?? 'dist', '_headers');
      if (!fs.existsSync(file)) return;
      let text = fs.readFileSync(file, 'utf8');
      if (env.VITE_VAULT_URL) {
        const origin = new URL(env.VITE_VAULT_URL).origin;
        text = text.replace("object-src 'none'", `object-src 'none'; frame-src ${origin}`);
      }
      fs.writeFileSync(file, text);
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    plugins: [preact(), tailwindcss(), headersPlugin({ ...env, ...process.env } as Record<string, string>)],
    build: {
      target: 'es2022',
      emptyOutDir: true,
      sourcemap: false,
      modulePreload: { polyfill: false } // インラインスクリプトを出さない（CSP script-src 'self' のため）
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'vault/**/*.test.ts']
    }
  } as any;
});
