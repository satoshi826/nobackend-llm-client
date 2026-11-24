// 設定 > 使用量: この端末で記録したトークン数と費用を、日・接続先・モデルごとに集計する
import { useEffect, useMemo, useState } from 'preact/hooks';
import * as repo from '../lib/db/repo';
import { summarizeUsage, type UsageRecord, type UsageTotals } from '../lib/usage';
import { modelOf, providerById, showToast } from '../state/app';
import { askConfirm } from './ConfirmDialog';
import { Button, Icon, cx } from './ui';

type Range = 'today' | '7' | '30' | 'all';
const RANGES: { id: Range; label: string }[] = [
  { id: 'today', label: '今日' },
  { id: '7', label: '7 日' },
  { id: '30', label: '30 日' },
  { id: 'all', label: 'すべて' }
];

function sinceOf(r: Range): number | null {
  if (r === 'all') return null;
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (r !== 'today') d.setDate(d.getDate() - (Number(r) - 1));
  return d.getTime();
}

const fmtUsd = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '$0');
const fmtTok = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n.toLocaleString());

/** 費用の表示（推定を含むなら「約」、分からない記録があれば注記） */
function Cost({ t }: { t: UsageTotals }) {
  if (t.requests > 0 && t.unknownCost === t.requests) return <span class="text-zinc-400">—</span>;
  return (
    <span title={t.estimated ? 'モデルの単価からの推定を含みます' : undefined}>
      {t.estimated ? '約 ' : ''}
      {fmtUsd(t.costUsd)}
      {t.unknownCost > 0 && <span class="text-zinc-400">+?</span>}
    </span>
  );
}

function Stat({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <div class="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <div class="text-[11px] text-zinc-500">{label}</div>
      <div class="text-lg font-semibold tabular-nums">{children}</div>
    </div>
  );
}

/** 日ごとの棒グラフ（1 系列。棒にマウスを乗せると値） */
function DailyBars({ days, metric }: { days: { day: string; totals: UsageTotals }[]; metric: 'cost' | 'tokens' }) {
  const [hover, setHover] = useState<number | null>(null);
  const val = (t: UsageTotals) => (metric === 'cost' ? t.costUsd : t.inputTokens + t.outputTokens);
  const max = Math.max(...days.map((d) => val(d.totals)), 0);
  const h = hover !== null ? days[hover] : null;
  return (
    <div>
      <div class="mb-1 h-5 text-xs text-zinc-600 tabular-nums dark:text-zinc-300" aria-live="polite">
        {h ? (
          <>
            {h.day}: {metric === 'cost' ? <Cost t={h.totals} /> : `${fmtTok(val(h.totals))} トークン`} ・ {h.totals.requests} 回
          </>
        ) : (
          <span class="text-zinc-400">棒にマウスを乗せると、その日の値を表示します</span>
        )}
      </div>
      <div class="flex h-32 items-end gap-[2px] border-b border-zinc-200 dark:border-zinc-800" role="img" aria-label={`日ごとの${metric === 'cost' ? '費用' : 'トークン数'}`}>
        {days.map((d, i) => {
          const v = val(d.totals);
          const pct = max > 0 ? (v / max) * 100 : 0;
          return (
            <div
              key={d.day}
              class="flex h-full min-w-0 flex-1 items-end justify-center"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              title={`${d.day}: ${metric === 'cost' ? fmtUsd(d.totals.costUsd) : fmtTok(v)}`}
            >
              <div
                class={cx('w-full max-w-8 rounded-t-[4px] bg-sky-500 transition-opacity dark:bg-sky-400', hover !== null && hover !== i && 'opacity-50')}
                style={{ height: v > 0 ? `max(2px, ${pct}%)` : '0' }}
              />
            </div>
          );
        })}
      </div>
      {days.length > 1 && (
        <div class="mt-1 flex justify-between text-[11px] text-zinc-400 tabular-nums">
          <span>{days[0].day}</span>
          <span>{days[days.length - 1].day}</span>
        </div>
      )}
    </div>
  );
}

function Table({ rows }: { rows: { key: string; label: string; sub?: string; t: UsageTotals }[] }) {
  return (
    <table class="w-full text-left text-xs">
      <thead class="text-zinc-500">
        <tr>
          <th class="w-2/5 py-1 font-normal"></th>
          <th class="py-1 text-right font-normal">回数</th>
          <th class="py-1 text-right font-normal">入力</th>
          <th class="py-1 text-right font-normal">出力</th>
          <th class="py-1 text-right font-normal">費用</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-zinc-200 tabular-nums dark:divide-zinc-800">
        {rows.map((r) => (
          <tr key={r.key}>
            <td class="max-w-0 truncate py-1.5 pr-2" title={r.sub ? `${r.label}（${r.sub}）` : r.label}>
              {r.label}
              {r.sub && <span class="ml-1 text-zinc-400">{r.sub}</span>}
            </td>
            <td class="py-1.5 text-right">{r.t.requests}</td>
            <td class="py-1.5 text-right" title={r.t.cachedInputTokens ? `うちキャッシュ ${r.t.cachedInputTokens.toLocaleString()}` : undefined}>
              {fmtTok(r.t.inputTokens)}
            </td>
            <td class="py-1.5 text-right">{fmtTok(r.t.outputTokens)}</td>
            <td class="py-1.5 text-right">
              <Cost t={r.t} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function UsageTab() {
  const [range, setRange] = useState<Range>('30');
  const [records, setRecords] = useState<UsageRecord[] | null>(null);
  const [metric, setMetric] = useState<'cost' | 'tokens'>('cost');
  const [showDays, setShowDays] = useState(false);

  const load = () => void repo.listUsage(sinceOf(range)).then(setRecords);
  useEffect(load, [range]);
  const s = useMemo(() => (records ? summarizeUsage(records, sinceOf(range)) : null), [records, range]);
  const name = (pid: string) => providerById(pid)?.name ?? (pid || '不明');

  return (
    <div class="space-y-5">
      <p class="text-xs leading-5 text-zinc-500">
        このブラウザで送った分のトークン数と費用です。記録はこの端末の中だけにあり、会話を消しても残ります（一時チャットは記録しません）。費用を返さない接続先は、モデルの単価から推定して「約」を付けます。単価も分からないものは「—」です。
      </p>
      <div class="flex flex-wrap items-center gap-2">
        <div class="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800" role="tablist" aria-label="期間">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              role="tab"
              aria-selected={range === r.id}
              onClick={() => setRange(r.id)}
              class={cx('rounded-md px-3 py-1 text-sm', range === r.id ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-500')}
            >
              {r.label}
            </button>
          ))}
        </div>
        <Button class="ml-auto text-xs" onClick={load} aria-label="再読み込み">
          <Icon name="refresh" class="size-3.5" />
        </Button>
      </div>
      {!s ? (
        <p class="text-sm text-zinc-500">読み込み中…</p>
      ) : s.total.requests === 0 ? (
        <p class="py-6 text-center text-sm text-zinc-500">この期間の記録はありません</p>
      ) : (
        <>
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="費用">
              <Cost t={s.total} />
            </Stat>
            <Stat label="回数">{s.total.requests.toLocaleString()}</Stat>
            <Stat label="入力トークン">{fmtTok(s.total.inputTokens)}</Stat>
            <Stat label="出力トークン">{fmtTok(s.total.outputTokens)}</Stat>
          </div>
          {s.total.cachedInputTokens > 0 && (
            <p class="text-xs text-zinc-500">入力のうち {fmtTok(s.total.cachedInputTokens)} トークンはプロンプトキャッシュに当たりました（通常より安く課金）。</p>
          )}
          {s.byDay.length > 1 && (
            <section class="space-y-2">
              <div class="flex items-center gap-2">
                <h3 class="text-sm font-semibold">日ごと</h3>
                <div class="ml-auto flex gap-1 text-xs" role="tablist" aria-label="グラフの値">
                  {(['cost', 'tokens'] as const).map((m) => (
                    <button key={m} type="button" role="tab" aria-selected={metric === m} onClick={() => setMetric(m)} class={cx('rounded-md px-2 py-0.5', metric === m ? 'bg-zinc-100 dark:bg-zinc-800' : 'text-zinc-500')}>
                      {m === 'cost' ? '費用' : 'トークン'}
                    </button>
                  ))}
                  <button type="button" aria-pressed={showDays} onClick={() => setShowDays(!showDays)} class={cx('rounded-md px-2 py-0.5', showDays ? 'bg-zinc-100 dark:bg-zinc-800' : 'text-zinc-500')}>
                    表
                  </button>
                </div>
              </div>
              {showDays ? (
                <Table rows={[...s.byDay].reverse().filter((d) => d.totals.requests > 0).map((d) => ({ key: d.day, label: d.day, t: d.totals }))} />
              ) : (
                <DailyBars days={s.byDay} metric={metric} />
              )}
            </section>
          )}
          <section class="space-y-2">
            <h3 class="text-sm font-semibold">接続先ごと</h3>
            <Table rows={s.byProvider.map((p) => ({ key: p.providerId, label: name(p.providerId), t: p.totals }))} />
          </section>
          <section class="space-y-2">
            <h3 class="text-sm font-semibold">モデルごと</h3>
            <Table rows={s.byModel.map((m) => ({ key: m.providerId + m.model, label: modelOf(m.providerId, m.model)?.name ?? m.model, sub: name(m.providerId), t: m.totals }))} />
          </section>
        </>
      )}
      <div class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <Button
          variant="outline"
          onClick={() =>
            void askConfirm({ title: '使用量の記録を消す', message: 'この端末に記録した使用量と費用をすべて消します。会話は消えません。', confirmLabel: '記録を消す', danger: true }).then(async (ok) => {
              if (!ok) return;
              await repo.clearUsage();
              load();
              showToast('使用量の記録を消しました');
            })
          }
        >
          <Icon name="trash" />
          使用量の記録を消す
        </Button>
      </div>
    </div>
  );
}
