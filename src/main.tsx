import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { init } from './state/app';

render(<App />, document.getElementById('app')!);
init().catch((e) => {
  console.error('初期化に失敗しました', e);
});

// PWA: 本番ビルドのみ Service Worker を登録（アプリ本体だけをキャッシュする）
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Trusted Types 下では register() に TrustedScriptURL が必要。/sw.js 以外は通さない専用ポリシーを使う。
    const tt = (window as any).trustedTypes;
    const swUrl = tt?.createPolicy
      ? tt.createPolicy('app-sw', {
          createScriptURL: (u: string) => {
            if (u !== '/sw.js') throw new TypeError('許可されていない Service Worker URL');
            return u;
          }
        }).createScriptURL('/sw.js')
      : '/sw.js';
    navigator.serviceWorker.register(swUrl, { scope: '/' }).catch((e) => console.warn('Service Worker を登録できませんでした', e));
  });
}
