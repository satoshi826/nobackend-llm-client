import { useState } from 'preact/hooks';
import type { MessageRecord } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import { childrenOf } from '../lib/chat/tree';
import { composerFocus, composerText, editUserMessage, isStreaming, messages, modelOf, openModelPicker, regenerate, settings, showToast, suggestingFor, switchSibling } from '../state/app';
import { Markdown } from './Markdown';
import { ToolCallCard } from './ToolCallCard';
import { Badge, Button, Dots, Icon, Shimmer, Spinner, cx } from './ui';

function textOf(m: MessageRecord): string {
  return m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
}

function SiblingNav({ m }: { m: MessageRecord }) {
  const sibs = childrenOf(messages.value, m.parentId).filter((s) => s.role === m.role);
  if (sibs.length < 2) return null;
  const i = sibs.findIndex((s) => s.id === m.id);
  return (
    <div class="flex items-center text-xs text-zinc-500">
      <Button aria-label="前の版" disabled={i <= 0 || isStreaming.value} onClick={() => switchSibling(m.id, -1)}>
        <Icon name="chevron-left" class="size-3.5" />
      </Button>
      <span class="tabular-nums">
        {i + 1}/{sibs.length}
      </span>
      <Button aria-label="次の版" disabled={i >= sibs.length - 1 || isStreaming.value} onClick={() => switchSibling(m.id, 1)}>
        <Icon name="chevron-right" class="size-3.5" />
      </Button>
    </div>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('コピーしました');
  } catch {
    showToast('コピーできませんでした', 'error');
  }
}

function Reasoning({ part, streaming }: { part: Extract<Part, { type: 'reasoning' }>; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const active = streaming && part.state === 'streaming';
  return (
    <div class="mb-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-500" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="brain" class={cx('size-3.5', active && 'text-sky-600 motion-safe:animate-pulse dark:text-sky-400')} />
        {active ? <Shimmer>考えています</Shimmer> : <span>思考の過程</span>}
        <span class="text-zinc-400">{part.text.length.toLocaleString()} 文字</span>
        <Icon name="chevron-down" class={cx('ml-auto size-3.5 transition', open && 'rotate-180')} />
      </button>
      {open && (
        <div class="border-t border-zinc-200 px-3 py-2 text-[13px] whitespace-pre-wrap text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">{part.text}</div>
      )}
    </div>
  );
}

function Sources({ parts }: { parts: Extract<Part, { type: 'source' }>[] }) {
  if (parts.length === 0) return null;
  return (
    <div class="mt-3">
      <div class="mb-1.5 flex items-center gap-1 text-xs text-zinc-500">
        <Icon name="globe" class="size-3.5" />
        出典
      </div>
      <ol class="flex flex-wrap gap-2">
        {parts.map((s, i) => {
          let host = '';
          try {
            host = new URL(s.url).host;
          } catch {
            /* ignore */
          }
          return (
            <li key={s.url}>
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={s.snippet ?? s.url}
                class="flex max-w-64 items-center gap-1.5 rounded-md border border-zinc-200 px-2 py-1 text-xs hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
              >
                <span class="text-zinc-400">{i + 1}</span>
                <span class="truncate">{s.title || host}</span>
                <span class="shrink-0 text-zinc-400">{host}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function UserMessage({ m }: { m: MessageRecord }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(textOf(m));
  if (editing) {
    return (
      <div class="ml-auto w-full max-w-[85%]">
        <textarea
          class="w-full rounded-xl border border-zinc-300 bg-white p-3 text-[15px] dark:border-zinc-700 dark:bg-zinc-900"
          rows={Math.min(12, draft.split('\n').length + 1)}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        />
        <div class="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditing(false)}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            disabled={!draft.trim() || isStreaming.value}
            onClick={() => {
              setEditing(false);
              void editUserMessage(m.id, draft);
            }}
          >
            送信
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div class="group flex flex-col items-end">
      {m.skills?.length ? (
        <div class="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">
          {m.skills.map((s) => (
            <span key={s.name} class="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 font-mono text-xs text-violet-800 dark:bg-violet-950 dark:text-violet-200" title="指定したスキル">
              <Icon name="book" class="size-3" />
              {s.name}
            </span>
          ))}
        </div>
      ) : null}
      {textOf(m) && <div class="max-w-[85%] rounded-2xl bg-zinc-100 px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap dark:bg-zinc-800">{textOf(m)}</div>}
      <div class="mt-1 flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100 focus-within:opacity-100">
        <SiblingNav m={m} />
        <Button aria-label="コピー" onClick={() => copy(textOf(m))}>
          <Icon name="copy" class="size-3.5" />
        </Button>
        <Button
          aria-label="編集"
          disabled={isStreaming.value}
          onClick={() => {
            setDraft(textOf(m));
            setEditing(true);
          }}
        >
          <Icon name="edit" class="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

function AssistantMessage({ m }: { m: MessageRecord }) {
  const streaming = m.status === 'streaming';
  const model = modelOf(m.meta?.providerId, m.meta?.model);
  const sources = m.parts.filter((p) => p.type === 'source') as Extract<Part, { type: 'source' }>[];
  const hasText = m.parts.some((p) => p.type === 'text' && p.text);
  const usage = m.meta?.usage;
  return (
    <div class="group">
      {m.parts.map((p, i) => {
        if (p.type === 'reasoning') return <Reasoning key={i} part={p} streaming={streaming} />;
        if (p.type === 'text') return <Markdown key={i} text={p.text} streaming={streaming && p.state === 'streaming'} citations={sources.map((s) => s.url)} />;
        if (p.type === 'tool') return <ToolCallCard key={i} p={p} live={streaming} />;
        return null;
      })}
      {streaming && !hasText && !m.parts.some((p) => p.type === 'reasoning') && (
        <div class="flex items-center gap-2 text-sm text-zinc-400" role="status">
          <Dots />
          <Shimmer>応答を待っています</Shimmer>
        </div>
      )}
      {m.status === 'error' && m.error && (
        <div role="alert" class="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
          <div>{m.error.message}</div>
          {m.error.hint && <div class="mt-1 text-xs opacity-80">{m.error.hint}</div>}
        </div>
      )}
      {m.status === 'aborted' && <div class="mt-1 text-xs text-zinc-500">（停止しました）</div>}
      {!!m.meta?.truncated && (
        <div class="mt-1 text-xs text-amber-700 dark:text-amber-400">
          会話が長いため、古いメッセージ {m.meta.truncated} 件を省いて送信しました（モデルの文脈長の上限）。
        </div>
      )}
      {m.meta?.finishReason === 'length' &&<div class="mt-1 text-xs text-amber-700 dark:text-amber-400">出力トークンの上限で途中終了しました。</div>}
      <Sources parts={sources} />
      {!streaming && (
        <div class="mt-1.5 flex flex-wrap items-center gap-0.5 text-xs text-zinc-500 opacity-70 transition group-hover:opacity-100 focus-within:opacity-100">
          <SiblingNav m={m} />
          <Button aria-label="コピー" onClick={() => copy(textOf(m))}>
            <Icon name="copy" class="size-3.5" />
          </Button>
          <Button aria-label="再生成" title="再生成" disabled={isStreaming.value} onClick={() => regenerate(m.id)}>
            <Icon name="refresh" class="size-3.5" />
          </Button>
          <Button
            aria-label="別のモデルで再生成"
            title="別のモデルで再生成"
            disabled={isStreaming.value}
            onClick={() => openModelPicker({ kind: 'regenerate', assistantId: m.id })}
          >
            <Icon name="swap" class="size-3.5" />
          </Button>
          <span class="ml-1 truncate" title={m.meta?.model}>
            {model?.name ?? m.meta?.model}
          </span>
          {usage && (
            <span class="ml-2 tabular-nums" title="入力 / 出力トークン">
              {usage.inputTokens?.toLocaleString() ?? '?'} / {usage.outputTokens?.toLocaleString() ?? '?'} tok
            </span>
          )}
          {!!usage?.cachedInputTokens && (
            <span class="ml-1 text-emerald-700 tabular-nums dark:text-emerald-400" title="入力のうちプロンプトキャッシュに当たった分（通常より安く課金されます）">
              （キャッシュ {usage.cachedInputTokens.toLocaleString()}）
            </span>
          )}
          {m.meta?.costUsd != null && <span class="ml-2 tabular-nums">${m.meta.costUsd.toFixed(4)}</span>}
          {model?.privacy === 'anonymized' && (
            <Badge tone="amber" title="このモデルは外部事業者に中継されます">
              外部中継
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function CompactionDivider({ m }: { m: MessageRecord }) {
  const [open, setOpen] = useState(false);
  const c = m.compaction!;
  return (
    <div class="my-2">
      <div class="flex items-center gap-2 text-xs text-zinc-500">
        <span class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
        <button type="button" class="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="compress" class="size-3.5" />
          ここまでの {c.count} 件を要約しました{c.auto ? '（自動）' : ''}
          <Icon name="chevron-down" class={cx('size-3.5 transition', open && 'rotate-180')} />
        </button>
        <span class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
      </div>
      <p class="mt-1 text-center text-[11px] text-zinc-400">以降は「要約 + この後の会話」をモデルに送ります。上の履歴は表示用に残っています。</p>
      {open && (
        <div class="mt-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <Markdown text={c.summary} />
          {c.model && <div class="mt-2 text-xs text-zinc-500">要約に使ったモデル: {modelOf(m.meta?.providerId, c.model)?.name ?? c.model}</div>}
        </div>
      )}
    </div>
  );
}

/** Reply suggestions shown below the latest answer. Clicking one puts it in the input box (it can be edited before sending) */
function Suggestions({ m }: { m: MessageRecord }) {
  const loading = suggestingFor.value === m.id;
  if (!settings.value.replySuggestions || (!loading && !m.suggestions?.length)) return null;
  return (
    <div class="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="返信候補">
      {loading && !m.suggestions?.length ? (
        <span class="flex items-center gap-1.5 text-xs text-zinc-400" role="status">
          <Spinner class="size-3" />
          <Shimmer>返信候補を考えています</Shimmer>
        </span>
      ) : (
        m.suggestions!.map((s) => (
          <button
            key={s}
            type="button"
            class="max-w-full truncate rounded-full border border-zinc-300 px-3 py-1 text-left text-[13px] text-zinc-700 hover:border-zinc-400 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:bg-zinc-900"
            title={s}
            onClick={() => {
              composerText.value = s;
              composerFocus.value++;
            }}
          >
            {s}
          </button>
        ))
      )}
    </div>
  );
}

export function MessageItem({ m, isLast }: { m: MessageRecord; isLast?: boolean }) {
  if (m.compaction) return <CompactionDivider m={m} />;
  return (
    <div class={cx('py-3')}>
      {m.role === 'user' ? <UserMessage m={m} /> : <AssistantMessage m={m} />}
      {isLast && m.role === 'assistant' && m.status !== 'streaming' && <Suggestions m={m} />}
    </div>
  );
}
