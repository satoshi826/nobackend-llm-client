import { KeyForm } from './KeyForm';
import { currentProviderId, provider } from '../state/app';
import { Icon } from './ui';

export function Onboarding() {
  return (
    <div class="scroll-thin flex-1 overflow-y-auto">
      <div class="mx-auto max-w-lg px-5 py-10">
        <div class="mb-4 grid size-12 place-items-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
          <Icon name="shield" class="size-6 text-zinc-500" />
        </div>
        <h1 class="text-2xl font-semibold">はじめに</h1>
        <p class="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          このアプリはサーバーを持ちません。会話はこのブラウザにだけ保存され、あなたの API キーで {provider.value?.name ?? 'Venice'} に直接接続します。
        </p>
        <ul class="mt-3 space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <li>・アカウント登録・解析ツール・外部スクリプトなし</li>
          <li>・既定では Venice がホストする「private」モデルだけを表示</li>
          <li>・保存しない「一時チャット」も使えます</li>
        </ul>
        <div class="mt-6">
          <KeyForm providerId={currentProviderId.value} />
        </div>
      </div>
    </div>
  );
}
