// The header's ツール・出力: for this chat only, before it starts or along the way, which tools the model is offered
// (all at once, by group, or one by one, each with about what it costs to send), how long an answer may be, how much
// the model thinks, and whether its earlier reasoning goes back to it. Nothing here is saved (state/chat-options.ts).
import { useRef, useState } from 'preact/hooks';
import { currentConv, currentPath } from '../../state/conversations';
import { chatOptionsOf, DEFAULT_CHAT_OPTIONS, setChatOptions, toolOn, type ChatOptions } from '../../state/chat-options';
import { modelOf, providerById } from '../../state/models';
import { getPreset } from '../../lib/providers/registry';
import { settings } from '../../state/settings';
import { toolGroups, type ToolGroup } from '../../state/tool-registry';
import { formatNumber } from '../../lib/i18n';
import { Popover } from '../menu';
import { Switch } from '../settings-ui';
import { Button, Chevron, Icon, Select, cx } from '../ui';
import { t } from './messages';

const MAX_TOKENS = [1000, 2000, 4000, 8000, 16000, 32000];
/** Levels from least to most: providers list theirs in any order, the menu shows them in this one */
const EFFORT_NAMES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
const effortRank = (e: string) => {
  const i = (EFFORT_NAMES as readonly string[]).indexOf(e);
  return i < 0 ? EFFORT_NAMES.length : i;
};
const effortLabel = (e: string) => ((EFFORT_NAMES as readonly string[]).includes(e) ? t(`opts.effort.${e as (typeof EFFORT_NAMES)[number]}`) : e);

const changed = (o: ChatOptions) => o.off.size > 0 || o.maxTokens !== null || o.reasoningEffort !== null || o.resendReasoning !== null;
const tokens = (n: number) => t('opts.tokens', { n: formatNumber(n) });

/** Everything in a group, or one tool, turned on or off (a group's own switch clears what was set one by one) */
function setTools(o: ChatOptions, groups: ToolGroup[], ids: string[], on: boolean): ReadonlySet<string> {
  const off = new Set(o.off);
  for (const id of ids) {
    const group = groups.find((g) => g.id === id);
    if (group) for (const tool of group.tools) off.delete(tool.name);
    if (on) off.delete(id);
    else off.add(id);
  }
  return off;
}

export function ChatOptionsButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const conv = currentConv.value;
  const o = chatOptionsOf(conv.id);
  return (
    <>
      <Button ref={ref} aria-label={t('opts.label')} aria-expanded={open} onClick={() => setOpen(!open)} class={cx('text-xs', changed(o) && 'text-ink-strong')}>
        <Icon name="wrench" class="size-4" />
        <span class="hidden sm:inline">{t('opts.button')}</span>
        {changed(o) && <span class="size-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </Button>
      {open && (
        <Popover anchor={ref.current} onClose={() => setOpen(false)} placement="bottom-end" role="dialog" label={t('opts.label')} class="w-80 p-3">
          <ChatOptionsPanel />
        </Popover>
      )}
    </>
  );
}

function ChatOptionsPanel() {
  const conv = currentConv.value;
  const o = chatOptionsOf(conv.id);
  const model = modelOf(conv.providerId, conv.modelId);
  const groups = toolGroups({ conv, messageId: '', model, history: currentPath.value });
  const [shown, setShown] = useState<ReadonlySet<string>>(new Set());
  const set = (patch: Partial<ChatOptions>) => setChatOptions(conv.id, patch);
  const allTools = groups.flatMap((g) => g.tools.map((x) => ({ group: g.id, ...x })));
  const onTools = allTools.filter((x) => toolOn(o, x.group, x.name));
  const groupOn = (g: ToolGroup) => g.tools.some((x) => toolOn(o, g.id, x.name));
  const sum = (list: { tokens: number }[]) => list.reduce((n, x) => n + x.tokens, 0);
  const efforts = [...(model?.capabilities.reasoningEffort ?? [])].sort((a, b) => effortRank(a) - effortRank(b));
  // Some providers never take earlier reasoning back: there is nothing to choose
  const cfg = providerById(conv.providerId);
  const resends = !!model?.capabilities.reasoning && !!cfg && getPreset(cfg.preset).reasoningResend !== 'never';
  const maxes = MAX_TOKENS.filter((n) => !model?.maxOutputTokens || n <= model.maxOutputTokens);
  return (
    <div class="space-y-4 text-sm">
      <div>
        <h2 class="font-semibold text-ink-strong">{t('opts.label')}</h2>
        <p class="mt-0.5 text-xs text-muted">{t('opts.note')}</p>
      </div>

      <section class="space-y-1">
        <div class="flex items-center gap-2">
          <h3 class="flex-1 font-medium">{t('opts.tools')}</h3>
          {groups.length > 0 && <span class="text-xs text-muted tabular-nums">{tokens(sum(onTools))}</span>}
          {groups.length > 0 && <Switch label={t('opts.all')} checked={onTools.length > 0} onChange={(on) => set({ off: setTools(o, groups, groups.map((g) => g.id), on) })} />}
        </div>
        {groups.length === 0 && <p class="text-xs text-muted">{t('opts.noTools')}</p>}
        <ul class="space-y-0.5">
          {groups.map((g) => {
            const open = shown.has(g.id);
            return (
              <li key={g.id}>
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="-mx-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1 py-1 text-left hover:bg-glass-strong"
                    aria-expanded={open}
                    aria-label={t('opts.expand', { name: g.label })}
                    onClick={() => setShown(open ? new Set([...shown].filter((x) => x !== g.id)) : new Set([...shown, g.id]))}
                  >
                    <span class="min-w-0 flex-1 truncate">{g.label}</span>
                    <span class="shrink-0 text-xs text-muted tabular-nums">{tokens(sum(g.tools.filter((x) => toolOn(o, g.id, x.name))))}</span>
                    <Chevron open={open} />
                  </button>
                  <Switch label={g.label} checked={groupOn(g)} onChange={(on) => set({ off: setTools(o, groups, [g.id], on) })} />
                </div>
                {open && (
                  <ul class="mt-0.5 mb-1 space-y-0.5 border-l border-line pl-3">
                    {g.tools.map((x) => (
                      <li key={x.name} class="flex items-center gap-2 py-0.5 text-xs">
                        <span class="min-w-0 flex-1 truncate">{x.label}</span>
                        {x.tokens > 0 && <span class="shrink-0 text-muted tabular-nums">{tokens(x.tokens)}</span>}
                        <Switch
                          label={x.label}
                          checked={toolOn(o, g.id, x.name)}
                          onChange={(on) => {
                            const off = new Set(o.off);
                            // Turning one on inside a group that was off: the group is on again, with only this one
                            if (on && off.has(g.id)) {
                              off.delete(g.id);
                              for (const y of g.tools) if (y.name !== x.name) off.add(y.name);
                            }
                            if (on) off.delete(x.name);
                            else off.add(x.name);
                            set({ off });
                          }}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <label class="flex items-center justify-between gap-3">
        {t('opts.maxTokens')}
        <Select compact value={String(o.maxTokens ?? '')} onChange={(e) => set({ maxTokens: Number((e.target as HTMLSelectElement).value) || null })}>
          <option value="">{t('opts.maxDefault')}</option>
          {maxes.map((n) => (
            <option key={n} value={n}>
              {t('opts.maxN', { n: formatNumber(n) })}
            </option>
          ))}
        </Select>
      </label>

      {efforts.length > 0 && (
        <label class="flex items-center justify-between gap-3">
          {t('opts.effort')}
          <Select compact value={o.reasoningEffort ?? ''} onChange={(e) => set({ reasoningEffort: (e.target as HTMLSelectElement).value || null })}>
            <option value="">{t('opts.effortDefault')}</option>
            {efforts.map((x) => (
              <option key={x} value={x}>
                {effortLabel(x)}
              </option>
            ))}
          </Select>
        </label>
      )}

      {resends && (
        <label class="flex cursor-pointer items-start justify-between gap-4">
          <span>
            {t('opts.resend')}
            <span class="mt-0.5 block text-xs text-muted">{t('opts.resendDesc')}</span>
          </span>
          <Switch class="mt-0.5" checked={o.resendReasoning ?? settings.value.resendReasoning} onChange={(v) => set({ resendReasoning: v })} />
        </label>
      )}

      {changed(o) && (
        <Button variant="outline" class="w-full text-xs" onClick={() => set(DEFAULT_CHAT_OPTIONS)}>
          {t('opts.reset')}
        </Button>
      )}
    </div>
  );
}
