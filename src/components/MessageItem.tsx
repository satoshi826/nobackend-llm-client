import { useState } from 'preact/hooks';
import type { MessageRecord } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import { childrenOf } from '../lib/chat/tree';
import { messages } from '../state/conversations';
import { editUserMessage, regenerate, switchSibling } from '../state/generation';
import { isStreaming } from '../state/runs';
import { suggestingFor } from '../state/suggestions';
import { modelOf } from '../state/models';
import { settings } from '../state/settings';
import { composerFocus, composerText, openModelPicker, showToast } from '../state/ui';
import { Markdown } from './Markdown';
import { ToolCallCard } from './ToolCallCard';
import { assistantExtras, userMessageExtras } from './extensions';
import { Button, Collapse, Dots, Icon, Shimmer, Spinner, cx } from './ui';
import { t } from './messages';
import { formatNumber } from '../lib/i18n';

function textOf(m: MessageRecord): string {
  return m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
}

function SiblingNav({ m }: { m: MessageRecord }) {
  const sibs = childrenOf(messages.value, m.parentId).filter((s) => s.role === m.role);
  if (sibs.length < 2) return null;
  const i = sibs.findIndex((s) => s.id === m.id);
  return (
    <div class="flex items-center text-xs text-muted">
      <Button aria-label={t('msg.prevVersion')} disabled={i <= 0 || isStreaming.value} onClick={() => switchSibling(m.id, -1)}>
        <Icon name="chevron-left" class="size-3.5" />
      </Button>
      <span class="tabular-nums">
        {i + 1}/{sibs.length}
      </span>
      <Button aria-label={t('msg.nextVersion')} disabled={i >= sibs.length - 1 || isStreaming.value} onClick={() => switchSibling(m.id, 1)}>
        <Icon name="chevron-right" class="size-3.5" />
      </Button>
    </div>
  );
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(t('msg.copied'));
  } catch {
    showToast(t('msg.copyFailed'), 'error');
  }
}

function Reasoning({ part, streaming }: { part: Extract<Part, { type: 'reasoning' }>; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const active = streaming && part.state === 'streaming';
  return (
    <div class="mb-3 rounded-lg border border-line">
      <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="brain" class={cx('size-3.5', active && 'text-accent-text motion-safe:animate-pulse')} />
        {active ? <Shimmer>{t('msg.thinking')}</Shimmer> : <span>{t('msg.reasoning')}</span>}
        <span class="text-faint">{t('msg.chars', { n: formatNumber(part.text.length) })}</span>
        <Icon name="chevron-down" class={cx('ml-auto size-3.5 transition', open && 'rotate-180')} />
      </button>
      <Collapse open={open} class="border-t border-line px-3 py-2 text-[13px] whitespace-pre-wrap text-muted">
        {part.text}
      </Collapse>
    </div>
  );
}

function Sources({ parts }: { parts: Extract<Part, { type: 'source' }>[] }) {
  if (parts.length === 0) return null;
  return (
    <div class="mt-3">
      <div class="mb-1.5 flex items-center gap-1 text-xs text-muted">
        <Icon name="globe" class="size-3.5" />
        {t('msg.sources')}
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
                class="flex max-w-64 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs hover:bg-glass"
              >
                <span class="text-faint">{i + 1}</span>
                <span class="truncate">{s.title || host}</span>
                <span class="shrink-0 text-faint">{host}</span>
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
          class="w-full rounded-xl border border-line bg-glass p-3 text-[15px]"
          rows={Math.min(12, draft.split('\n').length + 1)}
          value={draft}
          onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
        />
        <div class="mt-2 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditing(false)}>
            {t('msg.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!draft.trim() || isStreaming.value}
            onClick={() => {
              setEditing(false);
              void editUserMessage(m.id, draft);
            }}
          >
            {t('msg.send')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div class="group flex flex-col items-end">
      {userMessageExtras.map((X, i) => (
        <X key={i} m={m} />
      ))}
      {textOf(m) && <div class="max-w-[85%] rounded-2xl bg-glass-strong px-4 py-2.5 text-[15px] leading-7 whitespace-pre-wrap">{textOf(m)}</div>}
      <div class="mt-1 flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100 focus-within:opacity-100">
        <SiblingNav m={m} />
        <Button aria-label={t('msg.copy')} onClick={() => copy(textOf(m))}>
          <Icon name="copy" class="size-3.5" />
        </Button>
        <Button
          aria-label={t('msg.edit')}
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
  // A feature answers this message itself (e.g. images): no waiting text, no "another model"
  const owned = assistantExtras.some((x) => x.owns?.(m));
  return (
    <div class="group">
      {m.parts.map((p, i) => {
        if (p.type === 'reasoning') return <Reasoning key={i} part={p} streaming={streaming} />;
        if (p.type === 'text') return <Markdown key={i} text={p.text} streaming={streaming && p.state === 'streaming'} citations={sources.map((s) => s.url)} />;
        if (p.type === 'tool') return <ToolCallCard key={i} p={p} live={streaming} owner={{ conversationId: m.conversationId, messageId: m.id }} />;
        return null;
      })}
      {assistantExtras.map((X) => (
        <X.Component key={X.id} m={m} />
      ))}
      {streaming && !owned && !hasText && !m.parts.some((p) => p.type === 'reasoning') && (
        <div class="flex items-center gap-2 text-sm text-faint" role="status">
          <Dots />
          <Shimmer>{t('msg.waiting')}</Shimmer>
        </div>
      )}
      {m.status === 'error' && m.error && (
        <div role="alert" class="mt-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">
          <div>{m.error.message}</div>
          {m.error.hint && <div class="mt-1 text-xs opacity-80">{m.error.hint}</div>}
        </div>
      )}
      {m.status === 'aborted' && <div class="mt-1 text-xs text-muted">{t('msg.stopped')}</div>}
      {!!m.meta?.truncated && (
        <div class="mt-1 text-xs text-warn">
          {t('msg.truncated', { n: formatNumber(m.meta.truncated) })}
        </div>
      )}
      {m.meta?.finishReason === 'length' && <div class="mt-1 text-xs text-warn">{t('msg.lengthLimit')}</div>}
      <Sources parts={sources} />
      {!streaming && (
        <div class="mt-1.5 flex flex-wrap items-center gap-0.5 text-xs text-muted opacity-70 transition group-hover:opacity-100 focus-within:opacity-100">
          <SiblingNav m={m} />
          <Button aria-label={t('msg.copy')} onClick={() => copy(textOf(m))}>
            <Icon name="copy" class="size-3.5" />
          </Button>
          {/* One regenerate control: the arrow reruns with the same model, the chevron picks another model */}
          <span class="inline-flex items-center rounded-[10px] transition hover:bg-glass">
            <Button aria-label={t('msg.regenerate')} title={t('msg.regenerate')} disabled={isStreaming.value} onClick={() => regenerate(m.id)} class="group/re">
              <Icon name="refresh" class="size-3.5 transition-transform duration-500 group-hover/re:rotate-180" />
            </Button>
            {!owned && (
              <Button
                aria-label={t('msg.regenerateOther')}
                title={t('msg.regenerateOther')}
                disabled={isStreaming.value}
                class="-ml-1 px-1!"
                onClick={() => openModelPicker({ kind: 'regenerate', assistantId: m.id })}
              >
                <Icon name="chevron-down" class="size-3" />
              </Button>
            )}
          </span>
          <span class="ml-1 truncate" title={m.meta?.model}>
            {model?.name ?? m.meta?.model}
          </span>
          {usage && (
            <span class="ml-2 tabular-nums" title={t('msg.tokensTitle')}>
              {t('msg.tokens', { input: usage.inputTokens != null ? formatNumber(usage.inputTokens) : '?', output: usage.outputTokens != null ? formatNumber(usage.outputTokens) : '?' })}
            </span>
          )}
          {!!usage?.cachedInputTokens && (
            <span class="ml-1 text-ok tabular-nums" title={t('msg.cachedTitle')}>
              {t('msg.cached', { n: formatNumber(usage.cachedInputTokens) })}
            </span>
          )}
          {m.meta?.costUsd != null && <span class="ml-2 tabular-nums">${m.meta.costUsd.toFixed(4)}</span>}
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
      <div class="flex items-center gap-2 text-xs text-muted">
        <span class="h-px flex-1 bg-glass-strong" />
        <button type="button" class="flex items-center gap-1 rounded-md px-2 py-1 hover:bg-glass-strong" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="compress" class="size-3.5" />
          {t(c.auto ? 'msg.compactedAuto' : 'msg.compacted', { n: formatNumber(c.count) })}
          <Icon name="chevron-down" class={cx('size-3.5 transition', open && 'rotate-180')} />
        </button>
        <span class="h-px flex-1 bg-glass-strong" />
      </div>
      <p class="mt-1 text-center text-[11px] text-faint">{t('msg.compactedNote')}</p>
      <Collapse open={open} class="pt-2">
        <div class="rounded-xl border border-line bg-glass p-3">
          <Markdown text={c.summary} />
          {c.model && <div class="mt-2 text-xs text-muted">{t('msg.compactModel', { name: modelOf(m.meta?.providerId, c.model)?.name ?? c.model })}</div>}
        </div>
      </Collapse>
    </div>
  );
}

/** Reply suggestions shown below the latest answer. Clicking one puts it in the input box (it can be edited before sending) */
function Suggestions({ m }: { m: MessageRecord }) {
  const loading = suggestingFor.value === m.id;
  if (!settings.value.replySuggestions || (!loading && !m.suggestions?.length)) return null;
  return (
    <div class="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={t('msg.suggestions')}>
      {loading && !m.suggestions?.length ? (
        <span class="flex items-center gap-1.5 text-xs text-faint" role="status">
          <Spinner class="size-3" />
          <Shimmer>{t('msg.suggesting')}</Shimmer>
        </span>
      ) : (
        m.suggestions!.map((s) => (
          <button
            key={s}
            type="button"
            class="max-w-full truncate rounded-full border border-line px-3 py-1 text-left text-[13px] text-ink hover:border-line-strong hover:bg-glass"
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
    <div class={cx('py-3', Date.now() - m.createdAt < 4000 && 'rise')}>
      {m.role === 'user' ? <UserMessage m={m} /> : <AssistantMessage m={m} />}
      {isLast && m.role === 'assistant' && m.status !== 'streaming' && <Suggestions m={m} />}
    </div>
  );
}
