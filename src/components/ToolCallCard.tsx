// Tool call display (running, result, error, denied), and the approval card while awaiting approval.
import { useState } from 'preact/hooks';
import type { Part } from '../lib/providers/types';
import { currentImageModel, paramsFromBar, pendingApprovals, resolveApproval } from '../state/app';
import { estimateImageCost } from '../lib/images/venice';
import { Button, Icon, Shimmer, Spinner, cx } from './ui';
import { SkillApproval } from './SkillApproval';
import { ToolImages } from './ImageView';
import { toolViewFor } from './extensions';

type ToolPart = Extract<Part, { type: 'tool' }>;

const LABEL: Record<string, string> = { web_search: 'Web 検索', fetch_url: 'ページ本文の取得', load_skill: 'スキル', save_skill: 'スキルの保存', generate_image: '画像の生成' };
const FIELD: Record<string, string> = { web_search: 'query', fetch_url: 'url', load_skill: 'name', save_skill: 'name', generate_image: 'prompt' };
const ICON = { web_search: 'search', fetch_url: 'globe', load_skill: 'book', save_skill: 'book', generate_image: 'image' } as const;

function summary(p: ToolPart): string {
  const custom = toolViewFor(p.name)?.summary?.(p);
  if (custom !== undefined) return custom;
  const i = (p.input ?? {}) as Record<string, unknown>;
  const v = i[FIELD[p.name] ?? ''];
  return typeof v === 'string' ? v : p.argsText;
}

/** What the image tool will use: model, whether it is relayed, and the estimated price */
function imageToolNote(): string {
  const m = currentImageModel.value;
  if (!m) return 'プロンプトは Venice に送られます。';
  const cost = estimateImageCost({ ...paramsFromBar(''), variants: 1, enhancePrompt: false }, m);
  return `プロンプトは Venice の「${m.name}」（${m.privacy === 'private' ? 'private' : m.privacy === 'anonymized' ? '外部中継' : '保持方針は提供元による'}）に送られます。${cost !== undefined ? `費用は約 $${cost.toFixed(3)}。` : '費用は不明です。'}`;
}

function ApprovalCard({ p }: { p: ToolPart }) {
  const pending = pendingApprovals.value[p.toolCallId];
  const field = FIELD[p.name];
  const [value, setValue] = useState(summary(p));
  const [reason, setReason] = useState('');
  if (!pending) return null;
  const edited = field && value !== summary(p) ? { ...((p.input ?? {}) as object), [field]: value } : undefined;
  const where =
    p.name === 'web_search'
      ? '検索語は Tavily に送られます。'
      : p.name === 'fetch_url'
        ? 'この URL は Jina Reader に送られ、Jina がページを取得します。'
        : p.name === 'generate_image'
          ? imageToolNote()
          : '';
  return (
    <div role="group" aria-label="ツールの実行の確認" class="my-2 rounded-lg border border-sky-300 bg-sky-50/60 p-3 text-sm dark:border-sky-800 dark:bg-sky-950/40">
      <div class="mb-2 flex items-center gap-1.5 font-medium">
        <Icon name={ICON[p.name as keyof typeof ICON] ?? 'wrench'} class="size-4" />
        {LABEL[p.name] ?? p.name} を実行してよいですか？
      </div>
      {field ? (
        <input
          class="block w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 font-mono text-[13px] dark:border-zinc-700 dark:bg-zinc-950"
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          aria-label={field === 'query' ? '検索語（編集できます）' : 'URL（編集できます）'}
        />
      ) : (
        <pre class="overflow-x-auto rounded bg-white p-2 text-xs dark:bg-zinc-950">{p.argsText}</pre>
      )}
      <p class="mt-1.5 text-xs text-zinc-500">{where} 内容は編集してから実行できます。</p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => resolveApproval(p.toolCallId, { approved: true, input: edited })}>
          実行
        </Button>
        <Button variant="outline" onClick={() => resolveApproval(p.toolCallId, { approved: true, always: true, input: edited })} title={`今後は「${LABEL[p.name] ?? p.name}」を確認なしで実行します（設定で戻せます）`}>
          常に許可
        </Button>
        <Button variant="outline" onClick={() => resolveApproval(p.toolCallId, { approved: false, reason: reason || undefined })}>
          拒否
        </Button>
        <input
          class="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
          placeholder="拒否の理由（任意・モデルに伝わります）"
          value={reason}
          onInput={(e) => setReason((e.target as HTMLInputElement).value)}
        />
      </div>
    </div>
  );
}

export function ToolCallCard({ p, live, owner }: { p: ToolPart; live: boolean; owner?: { conversationId: string; messageId: string } }) {
  const [open, setOpen] = useState(false);
  if (p.state === 'approval-requested' && live && pendingApprovals.value[p.toolCallId]) return p.name === 'save_skill' ? <SkillApproval p={p} /> : <ApprovalCard p={p} />;
  const d = (p.uiDetails ?? {}) as { results?: { title: string; url: string }[]; title?: string; chars?: number; truncated?: boolean; updated?: boolean; blobIds?: string[] };
  let status: string;
  let tone = 'text-zinc-500';
  switch (p.state) {
    case 'input-streaming':
      status = '準備中…';
      break;
    case 'input-available':
      status = live ? '実行中…' : '中断';
      break;
    case 'approval-requested':
      status = '確認待ちのまま中断';
      break;
    case 'output-available':
      status =
        p.name === 'web_search'
          ? `${d.results?.length ?? 0} 件`
          : p.name === 'fetch_url'
            ? `${(d.chars ?? 0).toLocaleString()} 文字${d.truncated ? '（一部）' : ''}`
            : p.name === 'generate_image'
              ? `${d.blobIds?.length ?? 0} 枚`
              : p.name === 'load_skill'
              ? '読み込みました'
              : p.name === 'save_skill'
                ? d.updated
                  ? '更新しました'
                  : '作成しました'
                : (toolViewFor(p.name)?.doneStatus?.(p) ?? '完了');
      break;
    case 'output-denied':
      status = p.approval?.auto ? '禁止（設定）' : '拒否しました';
      tone = 'text-amber-700 dark:text-amber-400';
      break;
    default:
      status = 'エラー';
      tone = 'text-rose-700 dark:text-rose-400';
  }
  const hasDetails = (d.results?.length ?? 0) > 0 || !!p.error || !!p.approval?.reason;
  const view = toolViewFor(p.name);
  const Detail = view?.Detail;
  return (
    <div class="my-1.5 rounded-lg border border-zinc-200 text-xs dark:border-zinc-800">
      <button
        type="button"
        class="flex w-full items-center gap-1.5 px-3 py-1.5 text-left"
        onClick={() => hasDetails && setOpen(!open)}
        aria-expanded={hasDetails ? open : undefined}
      >
        {live && (p.state === 'input-available' || p.state === 'input-streaming') ? (
          <Spinner class="size-3.5 text-sky-600 dark:text-sky-400" />
        ) : (
          <Icon name={ICON[p.name as keyof typeof ICON] ?? view?.icon ?? 'wrench'} class="size-3.5 shrink-0" />
        )}
        <span class="shrink-0 font-medium">{LABEL[p.name] ?? view?.label?.(p.name) ?? p.name}</span>
        <span class="min-w-0 truncate text-zinc-500">{summary(p)}</span>
        <span class={cx('ml-auto shrink-0', tone)}>{live && (p.state === 'input-available' || p.state === 'input-streaming') ? <Shimmer>{status}</Shimmer> : status}</span>
        {hasDetails && <Icon name="chevron-down" class={cx('size-3.5 shrink-0 transition', open && 'rotate-180')} />}
      </button>
      {Detail && p.state === 'output-available' && <Detail p={p} live={live} owner={owner} />}
      {p.name === 'generate_image' && (d as { deleted?: boolean }).deleted && !d.blobIds?.length && (
        <p class="border-t border-zinc-200 px-3 py-2 text-zinc-500 dark:border-zinc-800">（画像は削除されました）</p>
      )}
      {p.name === 'generate_image' && !!d.blobIds?.length && owner && (
        <div class="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <ToolImages blobIds={d.blobIds} conversationId={owner.conversationId} messageId={owner.messageId} />
        </div>
      )}
      {open && (
        <div class="border-t border-zinc-200 px-3 py-2 dark:border-zinc-800">
          {p.error && <p class="text-rose-700 dark:text-rose-400">{p.error}</p>}
          {p.approval?.reason && <p class="text-zinc-500">理由: {p.approval.reason}</p>}
          {d.results && (
            <ol class="list-decimal space-y-0.5 pl-5">
              {d.results.map((r) => (
                <li key={r.url}>
                  <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" class="text-sky-700 underline dark:text-sky-400">
                    {r.title}
                  </a>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
