import { useMemo, useState } from 'preact/hooks';
import {
  currentConv,
  enabledProviders,
  keyInfos,
  modal,
  models,
  modelsStates,
  modelPickerTarget,
  regenerateWith,
  refreshAllModels,
  saveSettings,
  settings,
  chooseModel,
  visibleModels
} from '../state/app';
import type { ModelInfo } from '../lib/providers/types';
import { Badge, Button, Icon, Modal, cx, formatCtx, formatPrice } from './ui';

function PrivacyBadge({ m }: { m: ModelInfo }) {
  if (m.privacy === 'private')
    return (
      <Badge tone="green" title="Venice がホストし、プロンプトを保存しない">
        <Icon name="lock" class="size-3" />
        private
      </Badge>
    );
  if (m.privacy === 'anonymized')
    return (
      <Badge tone="amber" title="Claude・Gemini などの外部事業者に中継される。各社の保持ポリシーに従う">
        外部中継
      </Badge>
    );
  return <Badge title="保持方針は実際に処理する提供元によって異なります">提供元による</Badge>;
}

function ModelRow({ m, selected, onPick }: { m: ModelInfo; selected: boolean; onPick(): void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        class={cx('w-full rounded-lg px-3 py-2.5 text-left', selected ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60')}
        aria-pressed={selected}
      >
        <div class="flex items-center gap-2">
          <span class="truncate text-sm font-medium">{m.name}</span>
          {selected && <Icon name="check" class="size-4 shrink-0 text-emerald-600" />}
          <span class="ml-auto shrink-0 text-xs text-zinc-500 tabular-nums" title="100 万トークンあたり 入力 / 出力">
            {formatPrice(m.pricing?.inputPerMTok)} / {formatPrice(m.pricing?.outputPerMTok)}
          </span>
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-1">
          <PrivacyBadge m={m} />
          {m.contextLength ? <Badge>{formatCtx(m.contextLength)}</Badge> : null}
          {m.capabilities.reasoning && (
            <Badge tone="sky">
              <Icon name="brain" class="size-3" />
              思考
            </Badge>
          )}
          {m.capabilities.vision && (
            <Badge>
              <Icon name="eye" class="size-3" />
              画像
            </Badge>
          )}
          {m.capabilities.webSearch && (
            <Badge>
              <Icon name="globe" class="size-3" />
              検索
            </Badge>
          )}
          {m.tags?.includes('most_uncensored') && <Badge tone="rose">制限が最も少ない</Badge>}
          {m.tags?.includes('default') && <Badge>既定</Badge>}
          {m.tags?.includes('free') && (
            <Badge tone="amber" title="無料モデルは提供元がデータを利用する場合があり、データ収集を拒否する設定では使えないことがあります">
              無料
            </Badge>
          )}
          {m.deprecated && <Badge tone="amber">提供終了予定</Badge>}
        </div>
      </button>
    </li>
  );
}

export function ModelPicker() {
  const [q, setQ] = useState('');
  const conv = currentConv.value;
  const selProvider = conv.providerId;
  const selModel = conv.modelId;
  const showAnon = settings.value.showAnonymized;
  const provs = enabledProviders.value;
  const [tab, setTab] = useState<string>(provs.some((p) => p.id === selProvider) ? selProvider : provs[0]?.id ?? 'venice');

  const list = useMemo(() => {
    const ql = q.toLowerCase();
    return visibleModels.value.filter((m) => m.providerId === tab && (!ql || m.name.toLowerCase().includes(ql) || m.id.toLowerCase().includes(ql)));
  }, [q, tab, visibleModels.value]);
  const hiddenCount = models.value.filter((m) => m.providerId === tab && m.privacy === 'anonymized' && !m.offline).length;
  const st = modelsStates.value[tab] ?? { loading: false, error: null, fetchedAt: null };
  const anyLoading = Object.values(modelsStates.value).some((s) => s.loading);

  const target = modelPickerTarget.value;
  const pick = async (m: ModelInfo) => {
    if (target.kind === 'regenerate') {
      modal.value = null;
      await regenerateWith(target.assistantId, m.providerId, m.id);
      return;
    }
    await chooseModel(m.providerId, m.id);
    modal.value = null;
  };

  return (
    <Modal title={target.kind === 'regenerate' ? '別のモデルで再生成' : 'モデルを選ぶ'} onClose={() => (modal.value = null)}>
      <div class="space-y-3">
        {provs.length > 1 && (
          <div role="tablist" class="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
            {provs.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={tab === p.id}
                onClick={() => setTab(p.id)}
                class={cx('flex-1 rounded-md px-3 py-1.5 text-sm', tab === p.id ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-500')}
              >
                {p.name}
                {!keyInfos.value[p.id]?.present && <span class="ml-1 text-xs text-amber-600">（キー未設定）</span>}
              </button>
            ))}
          </div>
        )}
        <label class="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
          <Icon name="search" class="size-4 text-zinc-400" />
          <input class="w-full bg-transparent outline-none" placeholder="モデル名で検索" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="モデル名で検索" />
        </label>
        <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
          {hiddenCount > 0 || showAnon ? (
            <label class="flex items-center gap-1.5">
              <input type="checkbox" checked={showAnon} onChange={(e) => saveSettings({ showAnonymized: (e.target as HTMLInputElement).checked })} />
              外部中継のモデルも表示（{hiddenCount}）
            </label>
          ) : (
            <span>{list.length} モデル</span>
          )}
          <Button class="text-xs" onClick={() => refreshAllModels()} disabled={anyLoading}>
            <Icon name="refresh" class={cx('size-3.5', anyLoading && 'animate-spin')} />
            {anyLoading ? '取得中…' : '一覧を更新'}
          </Button>
        </div>
        {tab === 'venice' && showAnon && (
          <p class="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            「外部中継」のモデルは、Venice が匿名化したうえで Claude・Gemini などの外部事業者に送ります。プロンプトの保持や検閲は各社の方針に従います。
          </p>
        )}
        {tab === 'openrouter' && (
          <p class="rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
            OpenRouter は複数の提供元に中継します。このアプリは既定で「データを保存・学習に使う提供元」を経由しない設定（data_collection: deny）で送信します。
          </p>
        )}
        {st.error && (
          <p role="alert" class="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            モデル一覧を取得できませんでした: {st.error.message}
            {st.error.hint && <span class="block opacity-80">{st.error.hint}</span>}
          </p>
        )}
        <ul class="space-y-0.5">
          {list.map((m) => (
            <ModelRow key={m.providerId + m.id} m={m} selected={m.id === selModel && m.providerId === selProvider} onPick={() => pick(m)} />
          ))}
        </ul>
        {list.length === 0 && !st.loading && <p class="py-6 text-center text-sm text-zinc-500">モデルが見つかりません</p>}
      </div>
    </Modal>
  );
}
