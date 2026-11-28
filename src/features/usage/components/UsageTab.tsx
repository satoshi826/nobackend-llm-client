// Settings > Usage: what was spent in a period at a glance (the cost, against the period before), how it went over
// time by provider, and what it went to (models, providers, uses, conversations)
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BALANCE_ALERT_USD, balances, fetchBalances } from '../../../state/balance';
import { clearUsage, listUsage } from '../state';
import { summarizeUsage, type UsageBucket, type UsageRecord, type UsageSummary, type UsageTotals } from '../../../lib/usage';
import { enabledProviders, modelOf, providerById } from '../../../state/models';
import { conversations, openConversation } from '../../../state/conversations';
import { PRESETS } from '../../../lib/providers/registry';
import { modal, showToast } from '../../../state/ui';
import { askConfirm } from '../../../components/ConfirmDialog';
import { Button, Chip, Collapse, EmptyState, Icon, IconButton, Segmented, cx } from '../../../components/ui';
import { formatDate, formatList, formatNumber, formatDateTime, formatTime, formatUsd } from '../../../lib/i18n';
import { t } from '../messages';

type Range = 'today' | '7' | '30' | 'all';
const RANGES: Range[] = ['today', '7', '30', 'all'];
const rangeLabel = (r: Range) => (r === 'today' ? t('range.today') : r === 'all' ? t('range.all') : t('range.days', { n: Number(r) }));

function sinceOf(r: Range): number | null {
  if (r === 'all') return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (r !== 'today') d.setDate(d.getDate() - (Number(r) - 1));
  return d.getTime();
}

type Metric = 'cost' | 'tokens';
const valueOf = (v: UsageTotals, metric: Metric) => (metric === 'cost' ? v.costUsd : v.inputTokens + v.outputTokens);

const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${formatNumber(n / 1_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M` : n >= 10_000 ? `${formatNumber(Math.round(n / 1000))}k` : formatNumber(n);
const pct = (part: number, whole: number) => formatNumber(whole > 0 ? part / whole : 0, { style: 'percent', maximumFractionDigits: 0 });

/** Cost as text: "~" when it includes estimates, "+?" when some requests had no price, "—" when none had one */
function costText(v: UsageTotals): string {
  if (v.requests > 0 && v.unknownCost === v.requests) return '—';
  return `${v.estimated ? t('cost.approx', { cost: formatUsd(v.costUsd) }) : formatUsd(v.costUsd)}${v.unknownCost > 0 ? '+?' : ''}`;
}

const metricText = (v: UsageTotals, metric: Metric) => (metric === 'cost' ? costText(v) : t('tokens', { n: fmtTok(valueOf(v, metric)) }));

/** A step of the series, as its label (the hour, the day, the week it starts, the month) */
function stepLabel(at: number, bucket: UsageBucket): string {
  if (bucket === 'hour') return formatTime(at);
  if (bucket === 'week') return t('step.weekOf', { date: formatDate(at, { month: 'short', day: 'numeric' }) });
  if (bucket === 'month') return formatDate(at, { year: 'numeric', month: 'short' });
  return formatDate(at, { month: 'short', day: 'numeric' });
}

/**
 * Each provider's colour in charts: its place among the connections (stable whatever the period shows), so a provider
 * keeps its colour; past the palette, and for providers no longer connected, the neutral one
 */
function useProviderColors() {
  const order = enabledProviders.value.map((p) => p.id);
  return (providerId: string) => {
    const i = order.indexOf(providerId);
    return i >= 0 && i < 8 ? `var(--series-${i + 1})` : 'var(--series-other)';
  };
}

const providerName = (pid: string) => providerById(pid)?.name ?? (pid || t('unknownProvider'));

function Swatch({ color }: { color: string }) {
  return <span class="inline-block size-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden="true" />;
}

/** The headline: the period's cost, how it compares with the period of the same length before, and the counts */
function Headline({ total, prev }: { total: UsageTotals; prev: UsageTotals | null }) {
  const compare = () => {
    if (!prev) return null;
    if (prev.requests === 0) return t('hero.noPrev');
    if (prev.costUsd === total.costUsd) return t('hero.same');
    const change = prev.costUsd > 0 ? Math.abs(total.costUsd - prev.costUsd) / prev.costUsd : 1;
    return t(total.costUsd > prev.costUsd ? 'hero.up' : 'hero.down', { pct: pct(change, 1), prev: costText(prev) });
  };
  const note = compare();
  const stats = [
    { label: t('stat.requests'), value: formatNumber(total.requests) },
    { label: t('stat.input'), value: fmtTok(total.inputTokens) },
    { label: t('stat.output'), value: fmtTok(total.outputTokens) },
    { label: t('stat.cached'), value: pct(total.cachedInputTokens, total.inputTokens) }
  ];
  return (
    <section class="rounded-2xl border border-line bg-glass p-4">
      <h3 class="text-xs text-muted">{t('hero.cost')}</h3>
      <p class="mt-1 text-3xl font-semibold tracking-tight text-ink-strong tabular-nums" data-tip={total.estimated ? t('cost.estimatedTitle') : undefined}>
        {costText(total)}
      </p>
      {note && <p class="mt-1 text-xs text-muted">{note}</p>}
      <dl class="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <dt class="text-[11px] text-muted">{s.label}</dt>
            <dd class="text-base font-semibold text-ink tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The period over time: one bar per step, stacked by provider; touching a bar shows its breakdown */
function Chart({ s, color }: { s: UsageSummary; color(pid: string): string }) {
  const [metric, setMetric] = useState<Metric>('cost');
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  // Providers in the period, in their colour order (bars stack the same way in every step)
  const providers = useMemo(() => {
    const order = enabledProviders.value.map((p) => p.id);
    const rank = (pid: string) => (order.includes(pid) ? order.indexOf(pid) : order.length);
    return s.byProvider.map((p) => p.providerId).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  }, [s]);
  const max = Math.max(...s.series.map((x) => valueOf(x.totals, metric)), 0);
  const step = active !== null ? s.series[active] : null;
  const stepName = t(`step.${s.bucket}`);
  const metricName = metric === 'cost' ? t('chart.cost') : t('chart.tokens');
  // One handler for the whole plot: the step under the pointer (wide hit areas, no listener per bar)
  const pick = (e: PointerEvent) => {
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left) / box.width) * s.series.length);
    setActive(Math.min(s.series.length - 1, Math.max(0, i)));
  };
  return (
    <section class="space-y-3 rounded-2xl border border-line bg-glass p-4">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-semibold">{t('chart.title')}</h3>
        <div class="ml-auto flex items-center gap-2">
          <Segmented
            label={t('chart.metric')}
            size="sm"
            items={[
              { id: 'cost', label: t('chart.cost') },
              { id: 'tokens', label: t('chart.tokens') }
            ]}
            value={metric}
            onChange={setMetric}
          />
          <Chip on={asTable} aria-pressed={asTable} onClick={() => setAsTable(!asTable)}>
            <Icon name="list" class="size-3.5" />
            {t('chart.table')}
          </Chip>
        </div>
      </div>
      {asTable ? (
        <ul class="divide-y divide-line text-sm">
          {[...s.series].reverse().filter((x) => x.totals.requests > 0).map((x) => (
            <li key={x.at} class="flex items-baseline gap-3 py-1.5">
              <span class="min-w-0 flex-1 truncate">{stepLabel(x.at, s.bucket)}</span>
              <span class="text-xs text-muted tabular-nums">{t('chart.requests', { n: formatNumber(x.totals.requests) })}</span>
              <span class="w-24 text-right tabular-nums">{metricText(x.totals, metric)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <>
          {/* What the touched step holds; the hint while none is */}
          <div class="min-h-12 text-xs" aria-live="polite">
            {step ? (
              <>
                <p class="text-ink tabular-nums">
                  <span class="font-semibold">{stepLabel(step.at, s.bucket)}</span> ・ {metricText(step.totals, metric)} ・ {t('chart.requests', { n: formatNumber(step.totals.requests) })}
                </p>
                <p class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted tabular-nums">
                  {providers
                    .filter((pid) => step.byProvider[pid]?.requests)
                    .map((pid) => (
                      <span key={pid} class="inline-flex items-center gap-1.5">
                        <Swatch color={color(pid)} />
                        {providerName(pid)} {metricText(step.byProvider[pid], metric)}
                      </span>
                    ))}
                </p>
              </>
            ) : (
              <p class="text-faint">{t('chart.hint')}</p>
            )}
          </div>
          <div class="relative">
            {/* The scale: the top line is the largest step */}
            <div class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
            <span class="pointer-events-none absolute top-1 left-0 text-[10px] text-faint tabular-nums">{metric === 'cost' ? formatUsd(max) : fmtTok(max)}</span>
            <div
              class="flex h-40 touch-none items-end gap-[2px] border-b border-line pt-5"
              role="img"
              aria-label={t('chart.label', { step: stepName, metric: metricName })}
              onPointerMove={pick}
              onPointerDown={pick}
              onPointerLeave={(e) => e.pointerType === 'mouse' && setActive(null)}
            >
              {s.series.map((x, i) => {
                const v = valueOf(x.totals, metric);
                return (
                  <div key={x.at} class="flex h-full min-w-0 flex-1 flex-col-reverse items-stretch">
                    <div
                      // Segments are kept apart by a gap, except in a bar too short to hold one (it would split into lines)
                      class={cx('flex flex-col-reverse overflow-hidden rounded-t-[4px] transition-opacity', max > 0 && v / max >= 0.08 && 'gap-[2px]', active !== null && active !== i && 'opacity-40')}
                      style={{ height: max > 0 && v > 0 ? `max(2px, ${(v / max) * 100}%)` : '0' }}
                    >
                      {providers.map((pid) => {
                        const pv = x.byProvider[pid] ? valueOf(x.byProvider[pid], metric) : 0;
                        return pv > 0 ? <div key={pid} style={{ flexGrow: pv, flexBasis: 0, background: color(pid) }} /> : null;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div class="mt-1 flex justify-between text-[11px] text-faint tabular-nums">
              <span>{stepLabel(s.series[0].at, s.bucket)}</span>
              {s.series.length > 2 && <span>{stepLabel(s.series[Math.floor(s.series.length / 2)].at, s.bucket)}</span>}
              <span>{stepLabel(s.series[s.series.length - 1].at, s.bucket)}</span>
            </div>
          </div>
          {providers.length > 1 && (
            <ul class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={t('chart.legend')}>
              {providers.map((pid) => (
                <li key={pid} class="inline-flex items-center gap-1.5">
                  <Swatch color={color(pid)} />
                  {providerName(pid)}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

type By = 'model' | 'provider' | 'kind' | 'conversation';
type Row = { key: string; label: string; sub?: string; color?: string; totals: UsageTotals; open?(): void };
/** Rows shown before "show all" */
const TOP = 8;

/** What the period's cost went to, by model, provider, use or conversation: each row with its share */
function Breakdown({ s, color }: { s: UsageSummary; color(pid: string): string }) {
  const [by, setBy] = useState<By>('model');
  const [all, setAll] = useState(false);
  const convs = conversations.value;
  const titles = useMemo(() => new Map(convs.map((c) => [c.id, c.title])), [convs]);
  const rows: Row[] =
    by === 'model'
      ? s.byModel.map((m) => ({ key: `${m.providerId}|${m.model}`, label: modelOf(m.providerId, m.model)?.name ?? m.model, sub: providerName(m.providerId), color: color(m.providerId), totals: m.totals }))
      : by === 'provider'
        ? s.byProvider.map((p) => ({ key: p.providerId, label: providerName(p.providerId), color: color(p.providerId), totals: p.totals }))
        : by === 'kind'
          ? s.byKind.map((k) => ({ key: k.kind, label: t(`kind.${k.kind}`), totals: k.totals }))
          : s.byConversation.map((c) => {
              const title = titles.get(c.conversationId);
              return {
                key: c.conversationId,
                label: title ?? t('breakdown.deleted'),
                totals: c.totals,
                open: title === undefined ? undefined : () => {
                  modal.value = null;
                  void openConversation(c.conversationId);
                }
              };
            });
  // Shares of the cost; of the requests when no price is known at all
  const byCost = s.total.costUsd > 0;
  const whole = byCost ? s.total.costUsd : s.total.requests;
  const shown = all ? rows : rows.slice(0, TOP);
  const items: { id: By; label: string }[] = [
    { id: 'model', label: t('breakdown.model') },
    { id: 'provider', label: t('breakdown.provider') },
    { id: 'kind', label: t('breakdown.kind') },
    ...(s.byConversation.length ? [{ id: 'conversation' as const, label: t('breakdown.conversation') }] : [])
  ];
  return (
    <section class="space-y-3 rounded-2xl border border-line bg-glass p-4">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-semibold">{t('breakdown.title')}</h3>
        <Segmented
          class="ml-auto"
          label={t('breakdown.label')}
          size="sm"
          items={items}
          value={by}
          onChange={(v) => {
            setBy(v);
            setAll(false);
          }}
        />
      </div>
      <ul class="divide-y divide-line">
        {shown.map((r) => {
          const part = byCost ? r.totals.costUsd : r.totals.requests;
          const body = (
            <>
              <span class="flex items-baseline gap-2">
                {r.color && <Swatch color={r.color} />}
                <span class="min-w-0 truncate text-sm text-ink">{r.label}</span>
                {r.sub && <span class="shrink-0 text-xs text-faint">{r.sub}</span>}
                <span class="ml-auto shrink-0 text-sm font-medium tabular-nums">{costText(r.totals)}</span>
              </span>
              <span class="mt-1.5 flex items-center gap-3">
                <span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span class="block h-full rounded-full" style={{ width: `${whole > 0 ? (part / whole) * 100 : 0}%`, background: r.color ?? 'var(--accent)' }} />
                </span>
                <span class="shrink-0 text-[11px] text-muted tabular-nums">{t('breakdown.share', { pct: pct(part, whole), n: formatNumber(r.totals.requests) })}</span>
              </span>
            </>
          );
          return (
            <li key={r.key}>
              {r.open ? (
                <button type="button" class="-mx-2 block w-[calc(100%+1rem)] rounded-lg px-2 py-2.5 text-left hover:bg-glass-strong" aria-label={t('breakdown.open', { title: r.label })} onClick={r.open}>
                  {body}
                </button>
              ) : (
                <div class="py-2.5">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > TOP && (
        <Button class="text-xs" onClick={() => setAll(!all)}>
          {all ? t('breakdown.less') : t('breakdown.more', { n: formatNumber(rows.length) })}
        </Button>
      )}
    </section>
  );
}

/** Latest balance of providers that report one (asked again when shown), and what the alert means */
function BalanceSection() {
  useEffect(() => void fetchBalances(), []);
  const list = Object.entries(balances.value).filter(([, b]) => b.last);
  return (
    <section class="space-y-2">
      <h3 class="text-sm font-semibold">{t('balance.title')}</h3>
      {list.length === 0 ? (
        <p class="text-xs text-muted">{t('balance.none', { providers: formatList(Object.values(PRESETS).flatMap((p) => (p.balanceApi ? [p.defaults.name] : [])).sort((a, b) => a.localeCompare(b))) })}</p>
      ) : (
        <ul class="grid gap-2 sm:grid-cols-2">
          {list.map(([pid, b]) => (
            <li key={pid} class="rounded-xl border border-line bg-glass px-3 py-2.5">
              <p class="text-xs text-muted">{providerById(pid)?.name ?? pid}</p>
              <p class="text-lg font-semibold tabular-nums">{formatUsd(b.last!.usd)}</p>
              <p class="text-[11px] text-faint">
                {PRESETS[providerById(pid)?.preset ?? '']?.balanceApi?.scope === 'key' && `${t('balance.keyLimit')} ・ `}
                {t('balance.row', { time: formatDateTime(b.last!.at) })}
              </p>
              {b.unexplainedUsd > 0 && <p class="mt-1 text-xs text-warn">{t('balance.unexplained', { amount: formatUsd(b.unexplainedUsd) })}</p>}
            </li>
          ))}
        </ul>
      )}
      <p class="text-xs text-muted">{t('balance.alertNote', { amount: formatUsd(BALANCE_ALERT_USD) })}</p>
    </section>
  );
}

export function UsageTab() {
  const [range, setRange] = useState<Range>('30');
  const [records, setRecords] = useState<{ list: UsageRecord[]; since: number | null; now: number } | null>(null);
  const [about, setAbout] = useState(false);
  const color = useProviderColors();

  // The period and the one of the same length before it, read at once
  const load = () => {
    const since = sinceOf(range);
    const now = Date.now();
    void listUsage(since === null ? null : since - (now - since)).then((list) => setRecords({ list, since, now }));
  };
  useEffect(load, [range]);
  const s = useMemo(() => (records ? summarizeUsage(records.list, records.since, records.now) : null), [records]);
  const prev = useMemo(() => {
    if (!records || records.since === null) return null;
    const { list, since, now } = records;
    return summarizeUsage(
      list.filter((r) => r.at < since),
      since - (now - since),
      since - 1
    ).total;
  }, [records]);

  return (
    <div class="space-y-4">
      <div class="flex flex-wrap items-center gap-2">
        <Segmented label={t('range.label')} items={RANGES.map((r) => ({ id: r, label: rangeLabel(r) }))} value={range} onChange={setRange} />
        <div class="ml-auto flex items-center">
          <IconButton onClick={() => setAbout(!about)} label={t('about')} aria-expanded={about} class={cx(about && 'text-ink-strong')}>
            <Icon name="info" class="size-4" />
          </IconButton>
          <IconButton onClick={load} label={t('reload')}>
            <Icon name="refresh" class="size-3.5" />
          </IconButton>
        </div>
      </div>
      <Collapse open={about}>
        <p class="text-xs leading-5 text-muted">{t('intro')}</p>
      </Collapse>
      {!s ? (
        <p class="text-sm text-muted">{t('loading')}</p>
      ) : s.total.requests === 0 ? (
        <EmptyState icon="history">{t('empty')}</EmptyState>
      ) : (
        <>
          <Headline total={s.total} prev={prev} />
          <Chart s={s} color={color} />
          <Breakdown s={s} color={color} />
        </>
      )}
      <BalanceSection />
      <div class="border-t border-line pt-4">
        <Button
          variant="danger"
          onClick={() =>
            void askConfirm({ title: t('clear.title'), message: t('clear.message'), confirmLabel: t('clear.confirm'), danger: true }).then(async (ok) => {
              if (!ok) return;
              await clearUsage();
              load();
              showToast(t('clear.done'));
            })
          }
        >
          <Icon name="trash" />
          {t('clear.button')}
        </Button>
      </div>
    </div>
  );
}
