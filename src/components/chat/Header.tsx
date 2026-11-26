// Chat header: conversation title, temporary chat, context meter, instructions
// (the model is chosen in the input box: see Composer)
import { currentConv, isDraft, startNewChat } from '../../state/conversations';
import { compactConversation, compactingConv, compactionPreview, contextUsage, lastCompaction } from '../../state/compaction';
import { settings } from '../../state/settings';
import { inputBudget } from '../../lib/chat/context';
import { isStreaming } from '../../state/runs';
import { modal, openSettings, sidebarOpen } from '../../state/ui';
import { conversationCosts, loadConversationCost } from '../../state/costs';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Badge, Button, Chip, Icon, Spinner, cx, IconButton } from '../ui';
import { Popover } from '../menu';
import { sentences } from '../messages';
import { t } from './messages';
import { formatNumber } from '../../lib/i18n';

/** Where the context goes, in the order shown; the shades tell the parts of the bar apart (no colors of their own) */
const PARTS = [
  ['instructions', 'bg-accent'],
  ['notes', 'bg-accent/75'],
  ['summary', 'bg-accent/55'],
  ['messages', 'bg-accent/40'],
  ['attachments', 'bg-accent/28'],
  ['tools', 'bg-accent/18']
] as const;

/** The context meter: its percentage in the header; pressing it opens where the context goes and the compaction */
function ContextMeter() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const u = contextUsage.value;
  const pct = u.ratio != null ? Math.round(u.ratio * 100) : null;
  const busy = compactingConv.value === currentConv.value.id;
  const tone = pct == null ? '' : pct >= 80 ? 'text-danger' : pct >= 60 ? 'text-warn' : '';
  return (
    <>
      <Button
        ref={ref}
        aria-label={pct != null ? t('context.labelPct', { pct: formatNumber(pct) }) : t('context.label')}
        title={t('context.label')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-busy={busy}
        onClick={() => setOpen(!open)}
        class={cx('text-xs', tone, open && 'bg-glass-strong')}
      >
        {busy ? <Spinner class="size-4" /> : <Icon name="compress" class="size-4" />}
        <span class="tabular-nums">{pct != null ? `${pct}%` : `${formatNumber(Math.round(u.total / 1000))}K`}</span>
      </Button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement="bottom-end" role="dialog" label={t('context.label')} class="w-80 max-w-[calc(100vw-1rem)] p-4!">
          <ContextDetails pct={pct} tone={tone} busy={busy} onSettings={() => setOpen(false)} />
        </Popover>
      )}
    </>
  );
}

function ContextDetails({ pct, tone, busy, onSettings }: { pct: number | null; tone: string; busy: boolean; onSettings(): void }) {
  const u = contextUsage.value;
  const plan = compactionPreview.value;
  const last = lastCompaction.value;
  const s = settings.value;
  const scale = u.limit ?? u.total;
  const budget = inputBudget(u.limit ?? undefined);
  const label = (k: (typeof PARTS)[number][0]) => (k === 'messages' ? t('context.messages', { n: formatNumber(u.count) }) : t(`context.${k}`));
  return (
    <div class="space-y-4">
      <div class="space-y-2">
        <div class="flex items-baseline justify-between gap-3">
          <h2 class="font-medium text-ink-strong">{t('context.label')}</h2>
          {pct != null && <span class={cx('text-sm tabular-nums', tone || 'text-muted')}>{pct}%</span>}
        </div>
        <div class="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
          {scale > 0 && PARTS.map(([k, shade]) => u[k] > 0 && <span key={k} class={shade} style={{ width: `${Math.min(100, (u[k] / scale) * 100)}%` }} />)}
        </div>
        <p class="text-xs text-muted tabular-nums">
          {u.limit ? t('context.used', { tokens: formatNumber(u.total), limit: formatNumber(u.limit) }) : t('context.usedNoLimit', { tokens: formatNumber(u.total) })}
        </p>
      </div>

      <ul class="space-y-1 text-xs">
        {PARTS.map(
          ([k, shade]) =>
            u[k] > 0 && (
              <li key={k} class="flex items-center gap-2">
                <span class={cx('size-2 shrink-0 rounded-sm', shade)} aria-hidden="true" />
                <span class="min-w-0 flex-1 text-ink">{label(k)}</span>
                <span class="tabular-nums text-muted">{formatNumber(u[k])}</span>
              </li>
            )
        )}
      </ul>

      <p class="text-xs text-muted">
        {sentences(t('context.estimate'), !u.limit && t('context.noLimit'), budget != null && u.total > budget && t('context.overBudget'))}
      </p>

      <div class="space-y-3 border-t border-line pt-4">
        <div class="flex items-center gap-2 text-xs text-muted">
          <span class="min-w-0 flex-1">{s.autoCompact ? t('context.autoOn', { n: formatNumber(Math.round(s.compactThreshold * 100)) }) : t('context.autoOff')}</span>
          <Button
            class="shrink-0 text-xs"
            onClick={() => {
              onSettings();
              openSettings('chat');
            }}
          >
            <Icon name="settings" class="size-3.5" />
            {t('context.settings')}
          </Button>
        </div>
        {last && (
          <p class="flex gap-1.5 text-xs text-muted">
            <Icon name="check" class="mt-0.5 size-3.5 shrink-0" />
            {t('context.compacted', { n: formatNumber(last.count) })}
          </p>
        )}
        <p class="text-xs text-ink">
          {plan
            ? sentences(
                t('context.plan', { kept: formatNumber(plan.kept), n: formatNumber(plan.count), model: plan.model }),
                plan.inputUsd != null ? t('context.planSendCost', { tokens: formatNumber(plan.tokens), cost: usd(plan.inputUsd) }) : t('context.planSend', { tokens: formatNumber(plan.tokens) })
              )
            : t('context.tooShort')}
        </p>
        <Button variant="primary" class="w-full" disabled={!plan || busy || isStreaming.value} aria-busy={busy} onClick={() => void compactConversation()}>
          {busy ? <Spinner class="size-4" /> : <Icon name="compress" />}
          {t('context.compact')}
        </Button>
      </div>
    </div>
  );
}

const usd = (n: number) => (n > 0 && n < 0.001 ? '<$0.001' : '$' + formatNumber(n, { minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 }));

/** Estimated total cost of this conversation (replies, summaries, reply suggestions, images); opens the usage tab */
function ConversationCost() {
  const conv = currentConv.value;
  useEffect(() => {
    if (!isDraft.value && !conv.temporary) void loadConversationCost(conv.id);
  }, [conv.id]);
  const c = conversationCosts.value[conv.id];
  if (!c || (c.usd === 0 && c.unknown === 0)) return null;
  const title = [t('header.costTitle'), c.unknown ? t('header.costUnknown', { n: formatNumber(c.unknown) }) : '', c.estimated ? t('header.costEstimated') : ''].filter(Boolean).join('\n');
  return (
    <Button aria-label={`${t('header.cost')}: ${usd(c.usd)}`} title={title} class="text-xs tabular-nums text-muted" onClick={() => openSettings('usage')}>
      <span aria-hidden="true">≈</span>
      {usd(c.usd)}
      {c.unknown > 0 && <span aria-hidden="true">+</span>}
    </Button>
  );
}

export function Header() {
  const conv = currentConv.value;
  const draft = isDraft.value;
  return (
    <header class="glass mx-2 mt-2 flex items-center gap-1 rounded-2xl px-2 py-1.5 sm:mx-3 md:ml-0 md:mr-3 md:mt-0">
      <IconButton class="md:hidden" label={t('header.menu')} onClick={() => (sidebarOpen.value = true)}>
        <Icon name="menu" class="size-5" />
      </IconButton>
      <h1 class="min-w-0 truncate px-1.5 text-sm font-medium text-ink-strong">{draft ? t('header.newChat') : conv.title}</h1>
      {draft ? (
        // Before the first message, the new chat can be switched to/from a temporary (unsaved) chat here
        <Chip
          aria-pressed={!!conv.temporary}
          on={!!conv.temporary}
          title={conv.temporary ? t('header.tempOnTitle') : t('header.tempOffTitle')}
          class="h-7! px-2.5!"
          onClick={() => startNewChat(!conv.temporary)}
        >
          <Icon name="ghost" class="size-3.5" />
          <span class="hidden whitespace-nowrap sm:inline">{conv.temporary ? t('header.tempOn') : t('header.temp')}</span>
        </Chip>
      ) : (
        conv.temporary && (
          <Badge title={t('header.tempBadgeTitle')}>
            <Icon name="ghost" class="size-3" />
            <span class="hidden whitespace-nowrap sm:inline">{t('header.temp')}</span>
          </Badge>
        )
      )}
      <div class="ml-auto flex shrink-0 items-center gap-0.5">
        {!draft && <ConversationCost />}
        {!draft && <ContextMeter />}
        <Button aria-label={t('header.systemPrompt')} title={t('header.systemPromptTitle')} onClick={() => (modal.value = 'system')} class={cx('text-xs', conv.systemPrompt && 'text-ink-strong')}>
          <Icon name="sliders" class="size-4" />
          <span class="hidden sm:inline">{t('header.instructions')}</span>
          {conv.systemPrompt && <span class="size-1.5 rounded-full bg-accent" aria-hidden="true" />}
        </Button>
      </div>
    </header>
  );
}
