// Settings > Usage: tokens and cost recorded on this device, aggregated by day, provider, and model
import { useEffect, useMemo, useState } from 'preact/hooks';
import { BALANCE_ALERT_USD, balances, fetchBalances } from '../../../state/balance';
import { clearUsage, listUsage } from '../state';
import { summarizeUsage, type UsageRecord, type UsageTotals } from '../../../lib/usage';
import { modelOf, providerById } from '../../../state/models';
import { PRESETS } from '../../../lib/providers/registry';
import { showToast } from '../../../state/ui';
import { askConfirm } from '../../../components/ConfirmDialog';
import { Button, Chip, EmptyState, Icon, IconButton, Segmented, cx } from '../../../components/ui';
import { formatDate, formatList, formatNumber, formatDateTime } from '../../../lib/i18n';
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

const usd = (n: number, digits: number) => `$${formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
const fmtUsd = (n: number) => (n >= 1 ? usd(n, 2) : n > 0 ? usd(n, 4) : '$0');
const fmtTok = (n: number) =>
  n >= 1_000_000 ? `${formatNumber(n / 1_000_000, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}M` : n >= 10_000 ? `${formatNumber(Math.round(n / 1000))}k` : formatNumber(n);
/** "2026-11-25" (local day key) → the date in the UI language */
const dayLabel = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return y && m && d ? formatDate(new Date(y, m - 1, d)) : day;
};
/** Cost as plain text (for the chart's hover line) */
const costText = (v: UsageTotals) =>
  v.requests > 0 && v.unknownCost === v.requests ? '—' : `${v.estimated ? t('cost.approx', { cost: fmtUsd(v.costUsd) }) : fmtUsd(v.costUsd)}${v.unknownCost > 0 ? '+?' : ''}`;

/** Cost display ("approx." if it includes estimates; a note if some records have unknown cost) */
function Cost({ v }: { v: UsageTotals }) {
  if (v.requests > 0 && v.unknownCost === v.requests) return <span class="text-faint">—</span>;
  return (
    <span data-tip={v.estimated ? t('cost.estimatedTitle') : undefined}>
      {v.estimated ? t('cost.approx', { cost: fmtUsd(v.costUsd) }) : fmtUsd(v.costUsd)}
      {v.unknownCost > 0 && <span class="text-faint">+?</span>}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="rounded-lg border border-line px-3 py-2">
      <div class="text-[11px] text-muted">{label}</div>
      <div class="text-lg font-semibold tabular-nums">{children}</div>
    </div>
  );
}

/** Daily bar chart (single series; hover a bar to see its value) */
function DailyBars({ days, metric }: { days: { day: string; totals: UsageTotals }[]; metric: 'cost' | 'tokens' }) {
  const [hover, setHover] = useState<number | null>(null);
  const val = (v: UsageTotals) => (metric === 'cost' ? v.costUsd : v.inputTokens + v.outputTokens);
  const max = Math.max(...days.map((d) => val(d.totals)), 0);
  const h = hover !== null ? days[hover] : null;
  return (
    <div>
      <div class="mb-1 h-5 text-xs text-muted tabular-nums" aria-live="polite">
        {h ? (
          t(h.totals.requests === 1 ? 'chart.hoverOne' : 'chart.hoverMany', {
            day: dayLabel(h.day),
            value: metric === 'cost' ? costText(h.totals) : t('tokens', { n: fmtTok(val(h.totals)) }),
            n: formatNumber(h.totals.requests)
          })
        ) : (
          <span class="text-faint">{t('chart.hint')}</span>
        )}
      </div>
      <div class="flex h-32 items-end gap-[2px] border-b border-line" role="img" aria-label={metric === 'cost' ? t('chart.labelCost') : t('chart.labelTokens')}>
        {days.map((d, i) => {
          const v = val(d.totals);
          const pct = max > 0 ? (v / max) * 100 : 0;
          return (
            <div
              key={d.day}
              class="flex h-full min-w-0 flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              data-tip={t('chart.barTitle', { day: dayLabel(d.day), value: metric === 'cost' ? fmtUsd(d.totals.costUsd) : fmtTok(v) })}
            >
              <div
                class={cx('w-full max-w-8 rounded-t-[4px] bg-accent transition-opacity', hover !== null && hover !== i && 'opacity-50')}
                style={{ height: v > 0 ? `max(2px, ${pct}%)` : '0' }}
              />
            </div>
          );
        })}
      </div>
      {days.length > 1 && (
        <div class="mt-1 flex justify-between text-[11px] text-faint tabular-nums">
          <span>{dayLabel(days[0].day)}</span>
          <span>{dayLabel(days[days.length - 1].day)}</span>
        </div>
      )}
    </div>
  );
}

function Table({ rows }: { rows: { key: string; label: string; sub?: string; t: UsageTotals }[] }) {
  return (
    <table class="w-full text-left text-xs">
      <thead class="text-muted">
        <tr>
          <th class="w-2/5 py-1 font-normal"></th>
          <th class="py-1 text-right font-normal">{t('table.requests')}</th>
          <th class="py-1 text-right font-normal">{t('table.input')}</th>
          <th class="py-1 text-right font-normal">{t('table.output')}</th>
          <th class="py-1 text-right font-normal">{t('table.cost')}</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-line tabular-nums">
        {rows.map((r) => (
          <tr key={r.key}>
            <td class="max-w-0 truncate py-1.5 pr-2" data-tip={r.sub ? t('table.withSub', { label: r.label, sub: r.sub }) : r.label}>
              {r.label}
              {r.sub && <span class="ml-1 text-faint">{r.sub}</span>}
            </td>
            <td class="py-1.5 text-right">{formatNumber(r.t.requests)}</td>
            <td class="py-1.5 text-right" data-tip={r.t.cachedInputTokens ? t('table.cached', { n: formatNumber(r.t.cachedInputTokens) }) : undefined}>
              {fmtTok(r.t.inputTokens)}
            </td>
            <td class="py-1.5 text-right">{fmtTok(r.t.outputTokens)}</td>
            <td class="py-1.5 text-right">
              <Cost v={r.t} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Latest balance of providers that report one (asked again when shown), and what the alert means */
function BalanceSection() {
  useEffect(() => void fetchBalances(), []);
  const list = Object.entries(balances.value).filter(([, b]) => b.last);
  const usd = (n: number) => `$${formatNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <section class="space-y-2">
      <h3 class="text-sm font-semibold">{t('balance.title')}</h3>
      {list.length === 0 ? (
        <p class="text-xs text-muted">{t('balance.none', { providers: formatList(Object.values(PRESETS).flatMap((p) => (p.balanceApi ? [p.defaults.name] : [])).sort((a, b) => a.localeCompare(b))) })}</p>
      ) : (
        <ul class="divide-y divide-line rounded-lg border border-line text-sm">
          {list.map(([pid, b]) => (
            <li key={pid} class="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <span class="font-medium">{providerById(pid)?.name ?? pid}</span>
              <span class="tabular-nums">{usd(b.last!.usd)}</span>
              {PRESETS[providerById(pid)?.preset ?? '']?.balanceApi?.scope === 'key' && <span class="text-xs text-muted">{t('balance.keyLimit')}</span>}
              <span class="text-xs text-muted">{t('balance.row', { time: formatDateTime(b.last!.at) })}</span>
              {b.unexplainedUsd > 0 && <span class="text-xs text-warn">{t('balance.unexplained', { amount: usd(b.unexplainedUsd) })}</span>}
            </li>
          ))}
        </ul>
      )}
      <p class="text-xs text-muted">{t('balance.alertNote', { amount: usd(BALANCE_ALERT_USD) })}</p>
    </section>
  );
}

export function UsageTab() {
  const [range, setRange] = useState<Range>('30');
  const [records, setRecords] = useState<UsageRecord[] | null>(null);
  const [metric, setMetric] = useState<'cost' | 'tokens'>('cost');
  const [showDays, setShowDays] = useState(false);

  const load = () => void listUsage(sinceOf(range)).then(setRecords);
  useEffect(load, [range]);
  const s = useMemo(() => (records ? summarizeUsage(records, sinceOf(range)) : null), [records, range]);
  const name = (pid: string) => providerById(pid)?.name ?? (pid || t('unknownProvider'));

  return (
    <div class="space-y-5">
      <p class="text-xs leading-5 text-muted">{t('intro')}</p>
      <BalanceSection />
      <div class="flex flex-wrap items-center gap-2">
        <Segmented label={t('range.label')} items={RANGES.map((r) => ({ id: r, label: rangeLabel(r) }))} value={range} onChange={setRange} />
        <IconButton class="ml-auto text-xs" onClick={load} label={t('reload')}>
          <Icon name="refresh" class="size-3.5" />
        </IconButton>
      </div>
      {!s ? (
        <p class="text-sm text-muted">{t('loading')}</p>
      ) : s.total.requests === 0 ? (
        <EmptyState icon="history">{t('empty')}</EmptyState>
      ) : (
        <>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label={t('stat.cost')}>
              <Cost v={s.total} />
            </Stat>
            <Stat label={t('stat.requests')}>{formatNumber(s.total.requests)}</Stat>
            <Stat label={t('stat.input')}>{fmtTok(s.total.inputTokens)}</Stat>
            <Stat label={t('stat.output')}>{fmtTok(s.total.outputTokens)}</Stat>
          </div>
          {s.total.cachedInputTokens > 0 && (
            <p class="text-xs text-muted">{t('cachedNote', { n: fmtTok(s.total.cachedInputTokens) })}</p>
          )}
          {s.byDay.length > 1 && (
            <section class="space-y-2">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold">{t('byDay')}</h3>
                <div class="ml-auto flex items-center gap-2">
                  <Segmented
                    label={t('chart.metric')}
                    items={[
                      { id: 'cost', label: t('chart.cost') },
                      { id: 'tokens', label: t('chart.tokens') }
                    ]}
                    value={metric}
                    onChange={setMetric}
                    size="sm"
                  />
                  <Chip on={showDays} aria-pressed={showDays} onClick={() => setShowDays(!showDays)}>
                    <Icon name="list" class="size-3.5" />
                    {t('chart.table')}
                  </Chip>
                </div>
              </div>
              {showDays ? (
                <Table rows={[...s.byDay].reverse().filter((d) => d.totals.requests > 0).map((d) => ({ key: d.day, label: dayLabel(d.day), t: d.totals }))} />
              ) : (
                <DailyBars days={s.byDay} metric={metric} />
              )}
            </section>
          )}
          <section class="space-y-2">
            <h3 class="text-sm font-semibold">{t('byProvider')}</h3>
            <Table rows={s.byProvider.map((p) => ({ key: p.providerId, label: name(p.providerId), t: p.totals }))} />
          </section>
          <section class="space-y-2">
            <h3 class="text-sm font-semibold">{t('byModel')}</h3>
            <Table rows={s.byModel.map((m) => ({ key: m.providerId + m.model, label: modelOf(m.providerId, m.model)?.name ?? m.model, sub: name(m.providerId), t: m.totals }))} />
          </section>
        </>
      )}
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
