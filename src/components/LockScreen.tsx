// Screen shown until unlocked while conversations are encrypted (hides the sidebar, search, and all conversations)
import { dataLock, wipeEverything } from '../state/app';
import { VaultUnlockPanel } from './KeyPanel';
import { askConfirm } from './ConfirmDialog';
import { Button, Icon } from './ui';

export function LockScreen() {
  const lost = dataLock.value === 'lost';
  const forget = () =>
    void askConfirm({
      title: lost ? '暗号化された会話を削除' : 'パスフレーズを忘れた',
      message:
        '暗号化された会話・保存済みのプロンプト・スキルは、パスフレーズがないと元に戻せません。このブラウザ内のアプリのデータと API キーをすべて削除して、最初からやり直します。',
      confirmLabel: 'すべて削除してやり直す',
      danger: true,
      requireText: '削除'
    }).then((ok) => {
      if (ok) void wipeEverything();
    });
  return (
    <div class="grid h-full place-items-center overflow-y-auto px-5 py-10">
      <div class="w-full max-w-sm">
        <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
          <Icon name="lock" class="size-6 text-zinc-500" />
        </div>
        <h1 class="text-2xl font-semibold">{lost ? '会話を開けません' : 'ロックされています'}</h1>
        <p class="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {lost
            ? 'パスフレーズが削除されたため、暗号化された会話を開けなくなりました。'
            : '会話と API キーはパスフレーズで暗号化されています。パスフレーズを入れると開きます。'}
        </p>
        {!lost && (
          <div class="mt-5">
            <VaultUnlockPanel />
          </div>
        )}
        <Button variant="outline" class="mt-6 text-xs" onClick={forget}>
          {lost ? '暗号化された会話を削除する' : 'パスフレーズを忘れた場合'}
        </Button>
      </div>
    </div>
  );
}
