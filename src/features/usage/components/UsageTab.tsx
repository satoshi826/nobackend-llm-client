// Settings > Usage: what was spent in a period at a glance (the cost, against the period before), how it went over
// time by provider, and what it went to (models, providers, uses, conversations)
import { useEffect, useMemo, useState } from 'preact/hooks';
import { balances, fetchBalances } from '../../../state/balance';
import { clearUsage, listUsage } from '../state';
import { summarizeUsage, USAGE_SPLITS, type UsageBucket, type UsageRecord, type UsageSplit, type UsageSummary, type UsageTotals } from '../../../lib/usage';
import { enabledProviders, modelOf, providerById } from '../../../state/models';
import { conversations, openConversation } from '../../../state/conversations';
import { PRESETS } from '../../../lib/providers/registry';
import { ENDPOINTS } from '../../../lib/providers/endpoints';
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

/** Uses in a fixed order: each keeps its colour */
const KINDS: UsageRecord['kind'][] = ['chat', 'summary', 'suggest', 'image', 'video'];
/** Coloured entries of a split that has no fixed order (models, conversations): the period's top ones; the rest are "others" */
const COLOURED = 7;
const OTHER = '\u0000other';
const OTHER_COLOUR = 'var(--series-other)';
const series = (i: number) => `var(--series-${i + 1})`;

const providerName = (pid: string) => providerById(pid)?.name ?? (pid || t('unknownProvider'));

/** One entry of the chosen split, as the legend, the chart and the breakdown show it */
interface Entry {
  key: string;
  label: string;
  sub?: string;
  color: string;
  totals: UsageTotals;
  open?(): void;
}

/**
 * The period by the chosen split, each entry with its colour. Providers are coloured by their place among the
 * connections and uses by a fixed order, so they keep their colour whatever the period; models and conversations by
 * their rank in the period (the top seven), the rest grey
 */
function useEntries(s: UsageSummary, split: UsageSplit): Entry[] {
  const orderKey = enabledProviders.value.map((p) => p.id).join();
  const convs = conversations.value;
  return useMemo(() => {
    const order = orderKey.split(',');
    const titles = new Map(convs.map((c) => [c.id, c.title]));
    return s.by[split].map(({ key, totals }, rank) => {
      if (split === 'provider') {
        const i = order.indexOf(key);
        return { key, totals, label: providerName(key), color: i >= 0 && i < 8 ? series(i) : OTHER_COLOUR };
      }
      if (split === 'kind') return { key, totals, label: t(`kind.${key as UsageRecord['kind']}`), color: series(KINDS.indexOf(key as UsageRecord['kind'])) };
      const color = rank < COLOURED ? series(rank) : OTHER_COLOUR;
      if (split === 'model') {
        const [pid, model] = key.split('\u0000');
        return { key, totals, color, label: modelOf(pid, model)?.name ?? model, sub: providerName(pid) };
      }
      const title = key ? titles.get(key) : undefined;
      return {
        key,
        totals,
        color,
        label: !key ? t('breakdown.outside') : (title ?? t('breakdown.deleted')),
        open: title === undefined ? undefined : () => {
          modal.value = null;
          void openConversation(key);
        }
      };
    });
  }, [s, split, orderKey, convs]);
}

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

/** A step's value for each segment: the coloured entries, and the grey ones together as "others" */
function segments(by: Record<string, UsageTotals>, entries: Entry[], metric: Metric): { key: string; color: string; value: number; totals: UsageTotals }[] {
  const out: { key: string; color: string; value: number; totals: UsageTotals }[] = [];
  let others: UsageTotals | null = null;
  for (const e of entries) {
    const v = by[e.key];
    if (!v) continue;
    if (e.color !== OTHER_COLOUR) out.push({ key: e.key, color: e.color, value: valueOf(v, metric), totals: v });
    else others = others ? sumTotals(others, v) : v;
  }
  if (others) out.push({ key: OTHER, color: OTHER_COLOUR, value: valueOf(others, metric), totals: others });
  return out;
}

const sumTotals = (a: UsageTotals, b: UsageTotals): UsageTotals => ({
  requests: a.requests + b.requests,
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  costUsd: a.costUsd + b.costUsd,
  estimated: a.estimated || b.estimated,
  unknownCost: a.unknownCost + b.unknownCost
});

/** The chosen split: the switch, and the legend that the chart and the breakdown both follow */
function SplitBar({ split, onChange, entries }: { split: UsageSplit; onChange(v: UsageSplit): void; entries: Entry[] }) {
  const shown = entries.filter((e) => e.color !== OTHER_COLOUR);
  const others = entries.length > shown.length;
  return (
    <div class="space-y-2.5">
      <Segmented label={t('split.label')} items={USAGE_SPLITS.map((v) => ({ id: v, label: t(`breakdown.${v}`) }))} value={split} onChange={onChange} stretch />
      <ul class="flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-muted" aria-label={t(`breakdown.${split}`)}>
        {shown.map((e) => (
          <li key={e.key} class="inline-flex min-w-0 items-center gap-1.5">
            <Swatch color={e.color} />
            <span class="truncate">{e.label}</span>
          </li>
        ))}
        {others && (
          <li class="inline-flex items-center gap-1.5">
            <Swatch color={OTHER_COLOUR} />
            {t('otherEntries')}
          </li>
        )}
      </ul>
    </div>
  );
}

/** The period over time: one bar per step, stacked by the chosen split; touching a bar shows its breakdown */
function Chart({ s, split, entries }: { s: UsageSummary; split: UsageSplit; entries: Entry[] }) {
  const [metric, setMetric] = useState<Metric>('cost');
  const [active, setActive] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const names = new Map(entries.map((e) => [e.key, e.label]));
  const nameOf = (key: string) => (key === OTHER ? t('otherEntries') : (names.get(key) ?? key));
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
                  {segments(step.by[split], entries, metric).map((g) => (
                    <span key={g.key} class="inline-flex items-center gap-1.5">
                      <Swatch color={g.color} />
                      {nameOf(g.key)} {metricText(g.totals, metric)}
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
                      {segments(x.by[split], entries, metric).map((g) => (g.value > 0 ? <div key={g.key} style={{ flexGrow: g.value, flexBasis: 0, background: g.color }} /> : null))}
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
        </>
      )}
    </section>
  );
}

/** Rows shown before "show all" */
const TOP = 8;

/** What the period's cost went to, by the chosen split: each entry with its colour and share */
function Breakdown({ s, split, entries }: { s: UsageSummary; split: UsageSplit; entries: Entry[] }) {
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [split]);
  // Shares of the cost; of the requests when no price is known at all
  const byCost = s.total.costUsd > 0;
  const whole = byCost ? s.total.costUsd : s.total.requests;
  const shown = all ? entries : entries.slice(0, TOP);
  return (
    <section class="space-y-3 rounded-2xl border border-line bg-glass p-4">
      <h3 class="text-sm font-semibold">{t('breakdown.title')}</h3>
      <ul class="divide-y divide-line">
        {shown.map((r) => {
          const part = byCost ? r.totals.costUsd : r.totals.requests;
          const body = (
            <>
              <span class="flex items-baseline gap-2">
                <Swatch color={r.color} />
                <span class="min-w-0 truncate text-sm text-ink">{r.label}</span>
                {r.sub && <span class="shrink-0 text-xs text-faint">{r.sub}</span>}
                <span class="ml-auto shrink-0 text-sm font-medium tabular-nums">{costText(r.totals)}</span>
              </span>
              <span class="mt-1.5 flex items-center gap-3">
                <span class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span class="block h-full rounded-full" style={{ width: `${whole > 0 ? (part / whole) * 100 : 0}%`, background: r.color }} />
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
      {entries.length > TOP && (
        <Button class="text-xs" onClick={() => setAll(!all)}>
          {all ? t('breakdown.less') : t('breakdown.more', { n: formatNumber(entries.length) })}
        </Button>
      )}
    </section>
  );
}

/** The split shared by the legend, the chart and the breakdown */
function Split({ s, split, onChange }: { s: UsageSummary; split: UsageSplit; onChange(v: UsageSplit): void }) {
  const entries = useEntries(s, split);
  return (
    <>
      <SplitBar split={split} onChange={onChange} entries={entries} />
      <Chart s={s} split={split} entries={entries} />
      <Breakdown s={s} split={split} entries={entries} />
    </>
  );
}

/** Latest balance of providers that report one (asked again when shown) */
function BalanceSection() {
  useEffect(() => void fetchBalances(), []);
  const list = Object.entries(balances.value);
  return (
    <section class="space-y-2">
      <h3 class="text-sm font-semibold">{t('balance.title')}</h3>
      {list.length === 0 ? (
        <p class="text-xs text-muted">{t('balance.none', { providers: formatList(Object.values(PRESETS).flatMap((p) => (p.balanceApi ? [ENDPOINTS[p.id].name] : [])).sort((a, b) => a.localeCompare(b))) })}</p>
      ) : (
        <ul class="grid gap-2 sm:grid-cols-2">
          {list.map(([pid, b]) => (
            <li key={pid} class="rounded-xl border border-line bg-glass px-3 py-2.5">
              <p class="text-xs text-muted">{providerById(pid)?.name ?? pid}</p>
              <p class="text-lg font-semibold tabular-nums">{formatUsd(b.usd)}</p>
              <p class="text-[11px] text-muted">
                {PRESETS[providerById(pid)?.preset ?? '']?.balanceApi?.scope === 'key' && `${t('balance.keyLimit')} ・ `}
                {t('balance.row', { time: formatDateTime(b.at) })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function UsageTab() {
  const [range, setRange] = useState<Range>('30');
  const [records, setRecords] = useState<{ list: UsageRecord[]; since: number | null; now: number } | null>(null);
  const [about, setAbout] = useState(false);
  const [split, setSplit] = useState<UsageSplit>('provider');

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
          <Split s={s} split={split} onChange={setSplit} />
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
