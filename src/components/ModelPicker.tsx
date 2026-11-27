import type { ComponentChildren } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { currentConv } from '../state/conversations';
import { regenerateWith, chooseModel } from '../state/generation';
import { keyInfos } from '../state/keys';
import { accountInUse, enabledProviders, modelsStates, refreshAllModels, visibleModels, isFavorite, toggleFavorite, providerById } from '../state/models';
import { saveSettings, settings } from '../state/settings';
import { modal, modelPickerTarget } from '../state/ui';
import type { ModelInfo } from '../lib/providers/types';
import { arrangeModels, FILTER_ORDER, matchesFilter, type ModelFilter, type ModelSort } from '../lib/model-list';
import { PRESETS } from '../lib/providers/registry';
import { Badge, Button, Chevron, Collapse, EmptyState, Icon, Modal, SearchField, Select, Spinner, cx, formatCtx, formatPrice } from './ui';
import { t } from './messages';

function copyOf(providerId: string) {
  return PRESETS[providerId]?.copy ?? {};
}

function PrivacyBadge({ m }: { m: ModelInfo }) {
  if (m.privacy === 'private')
    return (
      <Badge tone="green" title={copyOf(m.providerId).private ?? t('picker.privateTitle')}>
        <Icon name="eye-off" class="size-3" />
        private
      </Badge>
    );
  if (m.privacy === 'anonymized')
    return (
      <Badge tone="amber" title={copyOf(m.providerId).relayed ?? t('picker.relayedTitle')}>
        {t('picker.relayed')}
      </Badge>
    );
  return <Badge title={t('picker.byProviderTitle')}>{t('picker.byProvider')}</Badge>;
}

function ModelRow({ m, selected, onPick, showProvider }: { m: ModelInfo; selected: boolean; onPick(): void; showProvider?: boolean }) {
  const fav = isFavorite(m.providerId, m.id);
  return (
    <li class="relative">
      <button
        type="button"
        onClick={onPick}
        class={cx('w-full rounded-lg py-2.5 pr-10 pl-3 text-left', selected ? 'bg-glass-strong' : 'hover:bg-glass')}
        aria-pressed={selected}
      >
        <div class="flex items-center gap-2">
          <span class="truncate text-sm font-medium">{m.name}</span>
          {showProvider && <span class="shrink-0 text-xs text-muted">{providerById(m.providerId)?.name}</span>}
          {selected && <Icon name="check" class="size-4 shrink-0 text-ink-strong" />}
          <span
            class="ml-auto shrink-0 text-xs text-muted tabular-nums"
            data-tip={m.pricing?.listedAt ? `${t('picker.priceTitle')}
${t('picker.priceListed', { date: m.pricing.listedAt })}` : t('picker.priceTitle')}
          >
            {m.pricing?.listedAt && '≈ '}
            {formatPrice(m.pricing?.inputPerMTok)} / {formatPrice(m.pricing?.outputPerMTok)}
          </span>
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-1">
          <PrivacyBadge m={m} />
          {m.contextLength ? <Badge>{formatCtx(m.contextLength)}</Badge> : null}
          {m.capabilities.reasoning && (
            <Badge tone="sky">
              <Icon name="brain" class="size-3" />
              {t('picker.reasoning')}
            </Badge>
          )}
          {m.capabilities.vision && (
            <Badge>
              <Icon name="eye" class="size-3" />
              {t('picker.vision')}
            </Badge>
          )}
          {m.capabilities.imageOutput && (
            <Badge>
              <Icon name="image" class="size-3" />
              {t('picker.imageOutput')}
            </Badge>
          )}
          {m.capabilities.webSearch && (
            <Badge>
              <Icon name="globe" class="size-3" />
              {t('picker.search')}
            </Badge>
          )}
          {m.tags?.includes('most_uncensored') && <Badge>{t('picker.uncensored')}</Badge>}
          {m.tags?.includes('default') && <Badge>{t('picker.default')}</Badge>}
          {m.tags?.includes('free') && (
            <Badge title={t('picker.freeTitle')}>
              {t('picker.free')}
            </Badge>
          )}
          {m.deprecated && <Badge tone="amber">{t('picker.deprecated')}</Badge>}
        </div>
      </button>
      <button
        type="button"
        class={cx('absolute top-2 right-2 rounded-md p-1 hover:bg-glass-strong', fav ? 'text-ink-strong' : 'text-faint')}
        aria-pressed={fav}
        aria-label={fav ? t('picker.unbookmarkNamed', { name: m.name }) : t('picker.bookmarkNamed', { name: m.name })}
        data-tip={fav ? t('picker.unbookmark') : t('picker.bookmarkTitle')}
        onClick={() => void toggleFavorite(m.providerId, m.id)}
      >
        <Icon name="star" filled={fav} class="size-4" />
      </button>
    </li>
  );
}

const SORTS: ModelSort[] = ['recommended', 'name', 'price', 'context'];

function filterTitle(f: ModelFilter): string | undefined {
  if (f === 'private') return t('picker.filterPrivateTitle');
  if (f === 'free') return t('picker.filterFreeTitle');
  return undefined;
}

function FilterChip({ label, count, on, title, onToggle }: { label: string; count: number; on: boolean; title?: string; onToggle(): void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-tip={title}
      onClick={onToggle}
      class={cx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
        on
          ? 'border-line-strong bg-accent-soft text-ink-strong'
          : 'border-line text-muted hover:bg-glass'
      )}
    >
      {on && <Icon name="check" class="size-3" />}
      {label}
      <span class={cx('tabular-nums', on ? 'opacity-70' : 'text-faint')}>{count}</span>
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
        class="sticky top-0 z-10 flex w-full items-center gap-2 rounded-lg bg-glass px-2 py-2 text-left text-sm font-semibold hover:bg-glass-strong"
        aria-expanded={open}
        onClick={toggle}
        disabled={props.forceOpen}
      >
        {props.title}
        <span class="ml-auto text-xs font-normal text-faint tabular-nums">{props.count}</span>
        <Chevron open={open} />
      </button>
      <Collapse open={open} class="pb-2">
        {props.children}
      </Collapse>
    </section>
  );
}

export function ModelPicker() {
  const [q, setQ] = useState('');
  const conv = currentConv.value;
  const selProvider = conv.providerId;
  const selModel = conv.modelId;
  const { modelSort: sort, modelFilters: filters } = settings.value;
  const target = modelPickerTarget.value;
  // Regenerating runs at once, so it offers only connections that can be called now; choosing a model for the chat may
  // pick one of a locked connection (unlocked next)
  const regen = target.kind === 'regenerate';
  const provs = regen ? enabledProviders.value.filter((p) => accountInUse(p.id)) : enabledProviders.value;
  const favs = settings.value.favoriteModels;
  const all = regen ? visibleModels.value.filter((m) => provs.some((p) => p.id === m.providerId)) : visibleModels.value;

  // Show only filters that match some model (e.g. "private" only exists on some providers)
  const chips = FILTER_ORDER.map((f) => ({ f, count: all.filter((m) => matchesFilter(m, f)).length })).filter((c) => c.count > 0);
  const active = filters.filter((f) => chips.some((c) => c.f === f));
  const arranged = useMemo(() => arrangeModels(all, { query: q, filters: active, sort }), [all, q, active.join(), sort]);
  const favList = arranged.filter((m) => favs.includes(`${m.providerId}|${m.id}`));
  const searching = q.trim().length > 0;

  const anyLoading = Object.values(modelsStates.value).some((s) => s.loading);
  const toggleFilter = (f: ModelFilter) => saveSettings({ modelFilters: filters.includes(f) ? filters.filter((x) => x !== f) : [...filters, f] });

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
    <Modal fullOnPhone fixed title={target.kind === 'regenerate' ? t('picker.titleRegenerate') : t('picker.title')} onClose={() => (modal.value = null)}>
      <div class="space-y-3">
        <div class="flex flex-wrap gap-2">
          <SearchField class="min-w-40 flex-1" placeholder={t('picker.searchPlaceholder')} label={t('picker.searchPlaceholder')} value={q} onInput={setQ} />
          <Select
            aria-label={t('picker.sortLabel')}
            value={sort}
            onChange={(e) => saveSettings({ modelSort: (e.target as HTMLSelectElement).value as ModelSort })}
          >
            {SORTS.map((k) => (
              <option key={k} value={k}>
                {t(`picker.sort.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        {chips.length > 0 && (
          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('picker.filterLabel')}>
            {chips.map(({ f, count }) => (
              <FilterChip key={f} label={t(`picker.filter.${f}`)} count={count} on={active.includes(f)} title={filterTitle(f)} onToggle={() => toggleFilter(f)} />
            ))}
            {active.length > 0 && (
              <button type="button" class="px-1 text-xs text-muted underline-offset-2 hover:underline" onClick={() => saveSettings({ modelFilters: [] })}>
                {t('picker.clearFilters')}
              </button>
            )}
          </div>
        )}
        <div class="flex items-center justify-between gap-2 text-xs text-muted">
          <span>{arranged.length === all.length ? t('picker.count', { n: all.length }) : t('picker.countFiltered', { shown: arranged.length, total: all.length })}</span>
          <Button class="text-xs" onClick={() => refreshAllModels()} disabled={anyLoading} aria-busy={anyLoading}>
            <Icon name="refresh" class={cx('size-3.5', anyLoading && 'motion-safe:animate-spin')} />
            {t('picker.refresh')}
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
                  <Icon name="star" filled class="size-3.5 text-ink-strong" />
                  {t('picker.bookmarks')}
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
                    {noKey && <span class="text-xs font-normal text-warn">{t('picker.noKey')}</span>}
                    {st.loading && <Spinner class="size-3 text-faint" />}
                  </>
                }
              >
                <div class="space-y-2">
                  {list.some((m) => m.privacy === 'anonymized') && copy.relayedNote && (
                    <p class="rounded-lg bg-warn-soft p-2.5 text-xs text-warn">{copy.relayedNote}</p>
                  )}
                  {copy.pickerNote && <p class="rounded-lg bg-glass p-2.5 text-xs text-muted">{copy.pickerNote}</p>}
                  {st.error && (
                    <p role="alert" class="rounded-lg bg-danger-soft p-2.5 text-xs text-danger">
                      {t('picker.loadFailed', { message: st.error.message })}
                      {st.error.hint && <span class="block opacity-80">{st.error.hint}</span>}
                    </p>
                  )}
                  {list.length > 0 ? (
                    <ul class="space-y-0.5">{list.map((m) => row(m))}</ul>
                  ) : (
                    !st.loading &&
                    !st.error && (
                      <p class="px-1 py-3 text-sm text-muted">
                        {st.needsKey ? t('picker.needsKey') : t('picker.noModels')}
                      </p>
                    )
                  )}
                </div>
              </Section>
            );
          })}
          {arranged.length === 0 && (searching || active.length > 0) && <EmptyState icon="search">{t('picker.noMatch')}</EmptyState>}
        </div>
      </div>
    </Modal>
  );
}
