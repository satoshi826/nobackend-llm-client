// キー金庫の画面（キーの登録・解錠）を iframe で埋め込む。キーの入力は金庫のオリジン内で行われ、本体には渡らない。
import { useEffect, useRef, useState } from 'preact/hooks';
import { VAULT_ORIGIN, vaultViewUrl } from '../lib/vault/client';
import { refreshKeyInfos } from '../state/app';

export function VaultKeyFrame({ providerId }: { providerId: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(320);
  const dark = document.documentElement.classList.contains('dark');

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== VAULT_ORIGIN || e.source !== ref.current?.contentWindow) return;
      if (e.data?.type === 'vault-resize' && typeof e.data.height === 'number') setHeight(Math.min(1200, Math.max(120, e.data.height + 4)));
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      void refreshKeyInfos();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      src={vaultViewUrl({ view: 'keys', provider: providerId, theme: dark ? 'dark' : 'light' })}
      title="キー金庫"
      referrerpolicy="no-referrer"
      class="block w-full rounded-lg border-0"
      style={{ height: `${height}px` }}
    />
  );
}
