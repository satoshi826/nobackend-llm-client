import { memo } from 'preact/compat';
import { useState } from 'preact/hooks';
import { computed, useComputed } from '@preact/signals';
import type { MessageRecord } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import { messages, messagesById } from '../state/conversations';
import { editUserMessage, regenerate, switchSibling } from '../state/generation';
import { requestHandlerFor } from '../state/tool-registry';
import { isStreaming } from '../state/runs';
import { suggestingFor } from '../state/suggestions';
import { modelOf } from '../state/models';
import { settings } from '../state/settings';
import { sentRequestsOf } from '../state/sent-requests';
import { RequestView } from './RequestView';
import { copyText } from './clipboard';
import { composerFocus, composerText, openModelPicker } from '../state/ui';
import { Markdown } from './Markdown';
import { ToolCallCard } from './ToolCallCard';
import { assistantExtras, toolViewFor, userMessageExtras } from './extensions';
import { Button, Chevron, Collapse, Dots, Icon, IconButton, Shimmer, Spinner, TextArea, cx } from './ui';
import { t } from './messages';
import { formatNumber } from '../lib/i18n';
import { estimateCost } from '../lib/usage';

function textOf(m: MessageRecord): string {
  return m.parts.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('');
}

/** Each message's place among its versions (the messages with the same parent and role), as "index count"; only for messages with versions */
const versions = computed(() => {
  const groups = new Map<string, MessageRecord[]>();
  for (const x of messages.value) {
    const k = `${x.parentId}|${x.role}`;
    const g = groups.get(k);
    if (g) g.push(x);
    else groups.set(k, [x]);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => a.createdAt - b.createdAt);
    g.forEach((x, i) => out.set(x.id, `${i} ${g.length}`));
  }
  return out;
});

function SiblingNav({ m }: { m: MessageRecord }) {
  // A string, so this re-renders only when the place changes (not on every streamed token)
  const pos = useComputed(() => versions.value.get(m.id)).value;
  if (!pos) return null;
  const [i, n] = pos.split(' ').map(Number);
  return (
    <div class="flex items-center text-xs text-muted">
      <IconButton label={t('msg.prevVersion')} disabled={i <= 0 || isStreaming.value} onClick={() => switchSibling(m.id, -1)}>
        <Icon name="chevron-left" class="size-3.5" />
      </IconButton>
      <span class="tabular-nums">
        {i + 1}/{n}
      </span>
      <IconButton label={t('msg.nextVersion')} disabled={i >= n - 1 || isStreaming.value} onClick={() => switchSibling(m.id, 1)}>
        <Icon name="chevron-right" class="size-3.5" />
      </IconButton>
    </div>
  );
}

function Reasoning({ part, streaming }: { part: Extract<Part, { type: 'reasoning' }>; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  const active = streaming && part.state === 'streaming';
  return (
    <div class="mb-3 rounded-lg border border-line">
      <button type="button" class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted hover:text-ink" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="brain" class={cx('size-3.5', active && 'text-accent-text motion-safe:animate-pulse')} />
        {active ? <Shimmer>{t('msg.thinking')}</Shimmer> : <span>{t('msg.reasoning')}</span>}
        <span class="text-faint">{t('msg.chars', { n: formatNumber(part.text.length) })}</span>
        <Chevron open={open} class="ml-auto" />
      </button>
      <Collapse open={open} class="border-t border-line px-3 py-2 text-[13px] whitespace-pre-wrap text-muted">
        {part.text}
      </Collapse>
    </div>
  );
}

/** A tool the provider ran on its own servers (e.g. its web search): one line, nothing to approve */
function ServerToolLine({ p }: { p: Extract<Part, { type: 'server-tool' }> }) {
  const view = toolViewFor(p.name);
  const label = view?.label?.(p.name) ?? p.name;
  return (
    <div class="my-1.5 flex min-w-0 items-center gap-2 text-xs text-muted">
      {p.state === 'running' ? <Spinner class="size-3.5 shrink-0" /> : <Icon name={view?.icon ?? 'globe'} class={cx('size-3.5 shrink-0', p.state === 'error' && 'text-danger')} />}
      <span class="shrink-0 font-medium text-ink">{label}</span>
      {p.query && <span class="min-w-0 truncate">{p.query}</span>}
      {p.state === 'running' ? (
        <Shimmer>{t('msg.searching')}</Shimmer>
      ) : p.state === 'error' ? (
        <span class="text-danger">{t('msg.serverToolFailed', { error: p.error ?? '' })}</span>
      ) : (
        p.resultCount != null && <span class="shrink-0 tabular-nums">{t('msg.results', { n: formatNumber(p.resultCount) })}</span>
      )}
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
  // A request a feature answers (images, videos) can be edited only when its text means something and it can run now
  const handler = requestHandlerFor(m);
  const editable = !handler || (handler.ready(m) && !!handler.edit?.(m, textOf(m)));
  if (editing) {
    return (
      <div class="ml-auto w-full max-w-[85%]">
        <TextArea
          class="w-full"
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
            <Icon name="send" />
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
      {textOf(m) && <UserText text={textOf(m)} />}
      <div class="mt-1 flex items-center gap-0.5 opacity-60 transition group-hover:opacity-100 focus-within:opacity-100">
        <SiblingNav m={m} />
        {textOf(m) && (
          <IconButton label={t('msg.copy')} onClick={() => copyText(textOf(m))}>
            <Icon name="copy" class="size-3.5" />
          </IconButton>
        )}
        {editable && (
          <IconButton
            label={t('msg.edit')}
            disabled={isStreaming.value}
            onClick={() => {
              setDraft(textOf(m));
              setEditing(true);
            }}
          >
            <Icon name="edit" class="size-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

/** Over this a user message is folded (e.g. a pasted JSON or log) */
const LONG_CHARS = 1500;
const LONG_LINES = 20;

/** The user's text: long lines wrap anywhere (no horizontal overflow); very long text is folded with a toggle */
function UserText({ text }: { text: string }) {
  const lines = text.split('\n').length;
  const long = text.length > LONG_CHARS || lines > LONG_LINES;
  const [open, setOpen] = useState(false);
  return (
    <div class="max-w-[85%] min-w-0 rounded-2xl bg-glass-strong px-4 py-2.5 text-[15px] leading-7">
      <div
        class={cx('whitespace-pre-wrap [overflow-wrap:anywhere]', long && !open && 'max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,#000_65%,transparent)]')}
      >
        {text}
      </div>
      {long && (
        <button
          type="button"
          class="mt-1 flex items-center gap-1 text-xs text-muted hover:text-ink"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? t('msg.collapse') : t('msg.expand', { lines: formatNumber(lines), chars: formatNumber(text.length) })}
          <Chevron open={open} />
        </button>
      )}
    </div>
  );
}

function AssistantMessage({ m }: { m: MessageRecord }) {
  const streaming = m.status === 'streaming';
  const model = modelOf(m.meta?.providerId, m.meta?.model);
  const sources = m.parts.filter((p) => p.type === 'source') as Extract<Part, { type: 'source' }>[];
  const hasText = m.parts.some((p) => p.type === 'text' && p.text);
  const usage = m.meta?.usage;
  const estimated = m.meta?.costUsd == null && usage ? estimateCost(usage, model?.pricing) : undefined;
  // A feature answers this message itself (e.g. images): no waiting text, no "another model"
  const owned = assistantExtras.some((x) => x.owns?.(m));
  // Its request runs again only when the feature can run it now (e.g. its provider still has a key)
  // (computed: the message list changes on every streaming frame, the answer is the same)
  const rerunnable = useComputed(() => {
    const request = m.parentId ? messagesById.value.get(m.parentId) : undefined;
    const handler = requestHandlerFor(request);
    return !handler || handler.ready(request!);
  }).value;
  // The developer button: shows the requests recorded for this reply in this session
  const [reqOpen, setReqOpen] = useState(false);
  const showReq = settings.value.developerMode && sentRequestsOf(m.id).length > 0;
  return (
    <div class="group">
      {m.parts.map((p, i) => {
        if (p.type === 'reasoning') return <Reasoning key={i} part={p} streaming={streaming} />;
        if (p.type === 'text') return <Markdown key={i} text={p.text} streaming={streaming && p.state === 'streaming'} citations={sources.map((s) => s.url)} />;
        if (p.type === 'tool') return <ToolCallCard key={i} p={p} live={streaming} owner={{ conversationId: m.conversationId, messageId: m.id }} />;
        if (p.type === 'server-tool') return <ServerToolLine key={i} p={p} />;
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
          {textOf(m) && (
            <IconButton label={t('msg.copy')} onClick={() => copyText(textOf(m))}>
              <Icon name="copy" class="size-3.5" />
            </IconButton>
          )}
          {/* One regenerate control: the arrow reruns with the same model, the chevron picks another model */}
          {rerunnable && <span class="inline-flex items-center rounded-[10px] transition hover:bg-glass">
            <IconButton label={t('msg.regenerate')} disabled={isStreaming.value} onClick={() => regenerate(m.id)} class="group/re">
              <Icon name="refresh" class="size-3.5 transition-transform duration-500 group-hover/re:rotate-180" />
            </IconButton>
            {!owned && (
              <IconButton
                label={t('msg.regenerateOther')}
                disabled={isStreaming.value}
                class="-ml-1 px-1!"
                onClick={() => openModelPicker({ kind: 'regenerate', assistantId: m.id })}
              >
                <Icon name="chevron-down" class="size-3" />
              </IconButton>
            )}
          </span>}
          {showReq && (
            <IconButton label={t('msg.request')} aria-pressed={reqOpen} class={cx(reqOpen && 'bg-glass-strong')} onClick={() => setReqOpen(!reqOpen)}>
              <Icon name="code" class="size-3.5" />
            </IconButton>
          )}
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
          {!!usage?.webSearches && (
            <span class="ml-2 tabular-nums" title={t('msg.webSearchesTitle')}>
              {t('msg.webSearches', { n: formatNumber(usage.webSearches) })}
            </span>
          )}
          {m.meta?.costUsd != null ? (
            <span class="ml-2 tabular-nums" title={t('msg.costTitle')}>
              ${m.meta.costUsd.toFixed(4)}
            </span>
          ) : (
            estimated != null && (
              // No cost reported (e.g. OpenAI, Anthropic): estimated from the model's list price, and marked so
              <span class="ml-2 tabular-nums" title={t('msg.costEstimatedTitle')}>
                ≈${estimated.toFixed(4)}
              </span>
            )
          )}
        </div>
      )}
      {showReq && reqOpen && <RequestView replyId={m.id} />}
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
          <Chevron open={open} />
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

/** One message. Memoized: while a reply streams, only that reply's object changes, so the others are skipped */
export const MessageItem = memo(function MessageItem({ m, isLast }: { m: MessageRecord; isLast?: boolean }) {
  if (m.compaction) return <CompactionDivider m={m} />;
  return (
    <div class={cx('py-3', Date.now() - m.createdAt < 4000 && 'rise')}>
      {m.role === 'user' ? <UserMessage m={m} /> : <AssistantMessage m={m} />}
      {isLast && m.role === 'assistant' && m.status !== 'streaming' && <Suggestions m={m} />}
    </div>
  );
});
