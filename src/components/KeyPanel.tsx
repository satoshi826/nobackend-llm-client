// キーの登録・解錠・削除の画面。中身はキー金庫のページ（iframe）で、入力したキーは本体アプリに渡らない。
// - KeyPanel: 1 つの接続先のキー（金庫がロック中なら解錠）
// - VaultSecurityPanel: 金庫全体のパスフレーズと、すべてのキーの削除
import { useEffect, useRef, useState } from 'preact/hooks';
import { VAULT_ORIGIN, vaultViewUrl } from '../lib/vault/client';
import { accountById } from '../lib/keys/accounts';
import { connectKeys, modal } from '../state/app';
import { Icon } from './ui';

function VaultFrame({ params, title }: { params: Record<string, string>; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(280);
  const dark = document.documentElement.classList.contains('dark');

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== VAULT_ORIGIN || e.source !== ref.current?.contentWindow) return;
      if (e.data?.type === 'vault-resize' && typeof e.data.height === 'number') setHeight(Math.min(1200, Math.max(100, e.data.height + 4)));
      // フレーム内で Esc が押されたら、開いている設定画面を閉じる
      if (e.data?.type === 'vault-escape') modal.value = null;
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      void connectKeys();
    };
  }, []);

  return (
    <iframe
      ref={ref}
      src={vaultViewUrl({ ...params, theme: dark ? 'dark' : 'light' })}
      title={title}
      referrerpolicy="no-referrer"
      class="block w-full rounded-lg border-0"
      style={{ height: `${height}px` }}
    />
  );
}

/**
 * キーの設定フォーム + 安全に使うための案内。
 * compact: 設定画面の中など、保管場所の説明が別にある場所で使う
 */
export function KeyPanel({ accountId, showGuide = true, compact }: { accountId: string; showGuide?: boolean; compact?: boolean }) {
  const guide = accountById(accountId)?.keyGuide;
  return (
    <div class="space-y-3">
      <VaultFrame params={{ view: 'keys', provider: accountId, ...(compact ? { compact: '1' } : {}) }} title="キーの設定" />
      {showGuide && guide && (
        <div class="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
          <div class="mb-1 flex items-center gap-1 font-semibold">
            <Icon name="shield" class="size-3.5" />
            安全に使うために
          </div>
          {guide}
        </div>
      )}
    </div>
  );
}

/** パスフレーズ（設定・解錠・ロック・変更・解除）と、すべてのキーの削除 */
export function VaultSecurityPanel() {
  return <VaultFrame params={{ view: 'security' }} title="キーの保護" />;
}
