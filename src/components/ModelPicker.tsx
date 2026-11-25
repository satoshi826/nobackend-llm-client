import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import {
  currentConv,
  enabledProviders,
  keyInfos,
  modal,
  modelsStates,
  modelPickerTarget,
  regenerateWith,
  refreshAllModels,
  saveSettings,
  settings,
  chooseModel,
  visibleModels,
  isFavorite,
  toggleFavorite,
  providerById
} from '../state/app';
import type { ModelInfo } from '../lib/providers/types';
import { arrangeModels, FILTER_LABELS, FILTER_ORDER, matchesFilter, SORT_LABELS, type ModelFilter, type ModelSort } from '../lib/model-list';
import { PRESETS } from '../lib/providers/registry';
import { Badge, Button, Icon, Modal, Spinner, cx, formatCtx, formatPrice } from './ui';

function copyOf(providerId: string) {
  return PRESETS[providerId]?.copy ?? {};
}

function PrivacyBadge({ m }: { m: ModelInfo }) {
  if (m.privacy === 'private')
    return (
      <Badge tone="green" title={copyOf(m.providerId).private ?? '提供元がプロンプトを保存しないと明示しているモデル'}>
        <Icon name="lock" class="size-3" />
        private
      </Badge>
    );
  if (m.privacy === 'anonymized')
    return (
      <Badge tone="amber" title={copyOf(m.providerId).relayed ?? '外部の事業者に中継されるモデル。各社の保持ポリシーに従う'}>
        外部中継
      </Badge>
    );
  return <Badge title="保持方針は実際に処理する提供元によって異なります">提供元による</Badge>;
}

function ModelRow({ m, selected, onPick, showProvider }: { m: ModelInfo; selected: boolean; onPick(): void; showProvider?: boolean }) {
  const fav = isFavorite(m.providerId, m.id);
  return (
    <li class="relative">
      <button
        type="button"
        onClick={onPick}
        class={cx('w-full rounded-lg py-2.5 pr-10 pl-3 text-left', selected ? 'bg-zinc-100 dark:bg-zinc-800' : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/60')}
        aria-pressed={selected}
      >
        <div class="flex items-center gap-2">
          <span class="truncate text-sm font-medium">{m.name}</span>
          {showProvider && <span class="shrink-0 text-xs text-zinc-500">{providerById(m.providerId)?.name}</span>}
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
      <button
        type="button"
        class={cx('absolute top-2 right-2 rounded-md p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700', fav ? 'text-amber-500' : 'text-zinc-400')}
        aria-pressed={fav}
        aria-label={fav ? `${m.name} のブックマークを外す` : `${m.name} をブックマーク`}
        title={fav ? 'ブックマークを外す' : 'ブックマーク（上の「ブックマーク」タブにまとまります）'}
        onClick={() => void toggleFavorite(m.providerId, m.id)}
      >
        <Icon name="star" filled={fav} class="size-4" />
      </button>
    </li>
  );
}

const FILTER_TITLES: Partial<Record<ModelFilter, string>> = {
  private: '提供元がプロンプトを保存しないと明示しているモデルだけ',
  free: '無料モデルは提供元がデータを利用する場合があります'
};

function FilterChip({ label, count, on, title, onToggle }: { label: string; count: number; on: boolean; title?: string; onToggle(): void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onToggle}
      class={cx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
        on
          ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
          : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
      )}
    >
      {on && <Icon name="check" class="size-3" />}
      {label}
      <span class={cx('tabular-nums', on ? 'opacity-70' : 'text-zinc-400')}>{count}</span>
    </button>
  );
}

/** Provider sections the user collapsed (kept while the app is open) */
const collapsedSections = signal<Set<string>>(new Set());
const BOOKMARKS = '__bookmarks';

/** One collapsible section of the model list (bookmarks or a provider) */
function Section(props: {
  id: string;
  title: ComponentChildren;
  count: number;
  forceOpen: boolean;
  children: ComponentChildren;
}) {
  const open = props.forceOpen || !collapsedSections.value.has(props.id);
  const toggle = () => {
    const next = new Set(collapsedSections.value);
    if (next.has(props.id)) next.delete(props.id);
    else next.add(props.id);
    collapsedSections.value = next;
  };
  return (
    <section>
      <button
        type="button"
        class="sticky top-0 z-10 flex w-full items-center gap-2 bg-white px-1 py-2 text-left text-sm font-semibold dark:bg-zinc-900"
        aria-expanded={open}
        onClick={toggle}
        disabled={props.forceOpen}
      >
        <Icon name="chevron-down" class={cx('size-3.5 shrink-0 text-zinc-400 transition', !open && '-rotate-90')} />
        {props.title}
        <span class="ml-auto text-xs font-normal text-zinc-400 tabular-nums">{props.count}</span>
      </button>
      {open && <div class="pb-2">{props.children}</div>}
    </section>
  );
}

export function ModelPicker() {
  const [q, setQ] = useState('');
  const conv = currentConv.value;
  const selProvider = conv.providerId;
  const selModel = conv.modelId;
  const { modelSort: sort, modelFilters: filters } = settings.value;
  const provs = enabledProviders.value;
  const favs = settings.value.favoriteModels;
  const all = visibleModels.value;

  // Show only filters that match some model (e.g. "private" only exists on some providers)
  const chips = FILTER_ORDER.map((f) => ({ f, count: all.filter((m) => matchesFilter(m, f)).length })).filter((c) => c.count > 0);
  const active = filters.filter((f) => chips.some((c) => c.f === f));
  const arranged = useMemo(() => arrangeModels(all, { query: q, filters: active, sort }), [all, q, active.join(), sort]);
  const favList = arranged.filter((m) => favs.includes(`${m.providerId}|${m.id}`));
  const searching = q.trim().length > 0;

  const anyLoading = Object.values(modelsStates.value).some((s) => s.loading);
  const toggleFilter = (f: ModelFilter) => saveSettings({ modelFilters: filters.includes(f) ? filters.filter((x) => x !== f) : [...filters, f] });

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
  const row = (m: ModelInfo, showProvider = false) => (
    <ModelRow key={m.providerId + m.id} m={m} showProvider={showProvider} selected={m.id === selModel && m.providerId === selProvider} onPick={() => pick(m)} />
  );

  return (
    <Modal title={target.kind === 'regenerate' ? '別のモデルで再生成' : 'モデルを選ぶ'} onClose={() => (modal.value = null)}>
      <div class="space-y-3">
        <div class="flex gap-2">
          <label class="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">
            <Icon name="search" class="size-4 shrink-0 text-zinc-400" />
            <input class="w-full bg-transparent outline-none" placeholder="モデル名で検索" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="モデル名で検索" />
          </label>
          <select
            aria-label="並び順"
            class="rounded-lg border border-zinc-300 bg-transparent px-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            value={sort}
            onChange={(e) => saveSettings({ modelSort: (e.target as HTMLSelectElement).value as ModelSort })}
          >
            {(Object.keys(SORT_LABELS) as ModelSort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        {chips.length > 0 && (
          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="絞り込み">
            {chips.map(({ f, count }) => (
              <FilterChip key={f} label={FILTER_LABELS[f]} count={count} on={active.includes(f)} title={FILTER_TITLES[f]} onToggle={() => toggleFilter(f)} />
            ))}
            {active.length > 0 && (
              <button type="button" class="px-1 text-xs text-zinc-500 underline-offset-2 hover:underline" onClick={() => saveSettings({ modelFilters: [] })}>
                解除
              </button>
            )}
          </div>
        )}
        <div class="flex items-center justify-between gap-2 text-xs text-zinc-500">
          <span>{arranged.length === all.length ? `${all.length} モデル` : `${arranged.length} / ${all.length} モデル`}</span>
          <Button class="text-xs" onClick={() => refreshAllModels()} disabled={anyLoading}>
            <Icon name="refresh" class={cx('size-3.5', anyLoading && 'motion-safe:animate-spin')} />
            {anyLoading ? '取得中…' : '一覧を更新'}
          </Button>
        </div>

        <div>
          {favList.length > 0 && (
            <Section
              id={BOOKMARKS}
              forceOpen={searching}
              count={favList.length}
              title={
                <>
                  <Icon name="star" filled class="size-3.5 text-amber-500" />
                  ブックマーク
                </>
              }
            >
              <ul class="space-y-0.5">{favList.map((m) => row(m, true))}</ul>
            </Section>
          )}
          {provs.map((p) => {
            const list = arranged.filter((m) => m.providerId === p.id);
            const st = modelsStates.value[p.id] ?? { loading: false, error: null, fetchedAt: null };
            const copy = copyOf(p.id);
            const noKey = !keyInfos.value[p.id]?.present && !PRESETS[p.preset]?.keyOptional;
            // While searching or filtering, hide providers with no matching models
            if ((searching || active.length) && list.length === 0) return null;
            return (
              <Section
                key={p.id}
                id={p.id}
                forceOpen={searching}
                count={list.length}
                title={
                  <>
                    {p.name}
                    {noKey && <span class="text-xs font-normal text-amber-600">キー未設定</span>}
                    {st.loading && <Spinner class="size-3 text-zinc-400" />}
                  </>
                }
              >
                <div class="space-y-2">
                  {list.some((m) => m.privacy === 'anonymized') && copy.relayedNote && (
                    <p class="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">{copy.relayedNote}</p>
                  )}
                  {copy.pickerNote && <p class="rounded-lg bg-zinc-50 p-2.5 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">{copy.pickerNote}</p>}
                  {st.error && (
                    <p role="alert" class="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                      モデル一覧を取得できませんでした: {st.error.message}
                      {st.error.hint && <span class="block opacity-80">{st.error.hint}</span>}
                    </p>
                  )}
                  {list.length > 0 ? (
                    <ul class="space-y-0.5">{list.map((m) => row(m))}</ul>
                  ) : (
                    !st.loading &&
                    !st.error && (
                      <p class="px-1 py-3 text-sm text-zinc-500">
                        {st.needsKey ? 'キーを設定するとモデル一覧を取得します（設定の「接続とキー」）' : 'モデルが見つかりません'}
                      </p>
                    )
                  )}
                </div>
              </Section>
            );
          })}
          {arranged.length === 0 && (searching || active.length > 0) && <p class="py-6 text-center text-sm text-zinc-500">条件に合うモデルがありません</p>}
        </div>
      </div>
    </Modal>
  );
}
