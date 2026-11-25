import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { init } from './state/app';

render(<App />, document.getElementById('app')!);
init().catch((e) => {
  console.error('初期化に失敗しました', e);
});

// PWA: register the Service Worker only in production builds (it caches only the app itself)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Under Trusted Types, register() needs a TrustedScriptURL. Use a dedicated policy that allows nothing but /sw.js.
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
