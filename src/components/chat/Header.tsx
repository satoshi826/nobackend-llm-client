// Chat header: conversation title, temporary chat, context meter, instructions
// (the model is chosen in the input box: see Composer)
import { currentConv, isDraft, startNewChat } from '../../state/conversations';
import { compactConversation, compactingConv, contextUsage } from '../../state/compaction';
import { isStreaming } from '../../state/runs';
import { modal, openSettings, sidebarOpen } from '../../state/ui';
import { conversationCosts, loadConversationCost } from '../../state/costs';
import { useEffect } from 'preact/hooks';
import { Badge, Button, Chip, Icon, Spinner, cx } from '../ui';
import { t } from './messages';
import { formatNumber } from '../../lib/i18n';

/** Context usage and the manual compaction button */
function ContextMeter() {
  const u = contextUsage.value;
  const pct = u.ratio != null ? Math.round(u.ratio * 100) : null;
  const busy = compactingConv.value === currentConv.value.id;
  const tone = pct == null ? '' : pct >= 80 ? 'text-danger' : pct >= 60 ? 'text-warn' : '';
  return (
    <Button
      aria-label={t('header.compact')}
      title={`${t('header.compactTitle')}\n${u.limit ? t('header.estimateWithLimit', { tokens: formatNumber(u.tokens), limit: formatNumber(u.limit) }) : t('header.estimate', { tokens: formatNumber(u.tokens) })}`}
      disabled={busy || isStreaming.value}
      onClick={() => compactConversation()}
      class={cx('text-xs', tone)}
    >
      {busy ? <Spinner class="size-4" /> : <Icon name="compress" class="size-4" />}
      <span class="tabular-nums">{busy ? t('header.compacting') : pct != null ? `${pct}%` : `${Math.round(u.tokens / 1000)}K`}</span>
    </Button>
  );
}

const money = (n: number) => (n > 0 && n < 0.001 ? '<$0.001' : '$' + formatNumber(n, { minimumFractionDigits: n < 1 ? 3 : 2, maximumFractionDigits: n < 1 ? 3 : 2 }));

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
    <Button aria-label={`${t('header.cost')}: ${money(c.usd)}`} title={title} class="text-xs tabular-nums text-muted" onClick={() => openSettings('usage')}>
      <span aria-hidden="true">≈</span>
      {money(c.usd)}
      {c.unknown > 0 && <span aria-hidden="true">+</span>}
    </Button>
  );
}

export function Header() {
  const conv = currentConv.value;
  const draft = isDraft.value;
  return (
    <header class="glass mx-2 mt-2 flex items-center gap-1 rounded-2xl px-2 py-1.5 sm:mx-3 md:ml-0 md:mr-3 md:mt-0">
      <Button class="md:hidden" aria-label={t('header.menu')} onClick={() => (sidebarOpen.value = true)}>
        <Icon name="menu" class="size-5" />
      </Button>
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
