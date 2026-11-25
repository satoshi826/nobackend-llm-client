import { render } from 'preact';
import './styles.css';
import { App } from './App';
import { preloadLazyComponents } from './components/lazy';
import { init } from './state/app';
// Features register themselves with the core (extension points) when imported
import './features';

render(<App />, document.getElementById('app')!);
// Screens split into their own chunks are fetched in the background once the browser is idle
preloadLazyComponents();
init().catch((e) => {
  console.error('Initialization failed', e);
});

// PWA: register the Service Worker only in production builds (it caches only the app itself)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Under Trusted Types, register() needs a TrustedScriptURL. Use a dedicated policy that allows nothing but /sw.js.
    const tt = (window as any).trustedTypes;
    const swUrl = tt?.createPolicy
      ? tt.createPolicy('app-sw', {
          createScriptURL: (u: string) => {
            if (u !== '/sw.js') throw new TypeError('Service Worker URL not allowed');
            return u;
          }
        }).createScriptURL('/sw.js')
      : '/sw.js';
    navigator.serviceWorker.register(swUrl, { scope: '/' }).catch((e) => console.warn('Could not register the Service Worker', e));
  });
}
