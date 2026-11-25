// Chat header: conversation title, temporary chat, context meter, instructions
// (the model is chosen in the input box: see Composer)
import { currentConv, isDraft, startNewChat } from '../../state/conversations';
import { compactConversation, compactingConv, contextUsage } from '../../state/compaction';
import { isStreaming } from '../../state/runs';
import { modal, sidebarOpen } from '../../state/ui';
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

export function Header() {
  const conv = currentConv.value;
  const draft = isDraft.value;
  return (
    <header class="glass mx-2 mt-2 flex items-center gap-1 rounded-2xl px-2 py-1.5 sm:mx-3 md:mx-0 md:mt-0">
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
