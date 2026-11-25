// The input box. Everything beyond typing and sending (attachments, skills, web search, image mode, ...)
// comes from composer add-ons that features register (components/extensions.ts).
// Layout: inside the box = 'inside' add-ons (attach) on the left, the model and send on the right;
// below the box = a row of chips for the other add-ons.
import { useEffect, useRef, useState } from 'preact/hooks';
import { currentConv } from '../../state/conversations';
import { modelOf, providerById } from '../../state/models';
import { openModelPicker } from '../../state/ui';
import { getPreset } from '../../lib/providers/registry';
import { cancelSuggestions } from '../../state/suggestions';
import { isStreaming, stopGeneration } from '../../state/runs';
import { sendMessage } from '../../state/generation';
import { composerFocus, composerText } from '../../state/ui';
import { activeComposerMode, collectComposerExtras, modelSlots, visibleComposerAddons, type ComposerApi } from '../extensions';
import { Button, Icon, cx } from '../ui';
import { t } from './messages';

/** The chat model, bottom right of the input box. Only "private" is marked (lock); the rest is in the tooltip */
function ModelButton() {
  const conv = currentConv.value;
  const model = modelOf(conv.providerId, conv.modelId);
  const cfg = providerById(conv.providerId);
  const copy = cfg ? (getPreset(cfg.preset).copy ?? {}) : {};
  const note =
    model?.privacy === 'private'
      ? (copy.private ?? t('header.privateTitle'))
      : model?.privacy === 'anonymized'
        ? (copy.relayed ?? t('header.relayedTitle'))
        : model?.privacy === 'unknown'
          ? t('header.byProviderTitle')
          : '';
  return (
    <button
      type="button"
      class="group flex min-w-0 items-center gap-1 rounded-full px-2.5 py-1.5 text-xs text-muted transition duration-200 hover:bg-glass-strong hover:text-ink active:scale-[.97]"
      onClick={() => openModelPicker()}
      title={note ? `${t('header.chooseModel')}
${note}` : t('header.chooseModel')}
      aria-label={`${t('header.chooseModel')}: ${model?.name ?? conv.modelId}`}
    >
      {model?.privacy === 'private' && <Icon name="lock" class="size-3 shrink-0 text-ok" />}
      <span class="max-w-[9rem] truncate sm:max-w-[14rem]">{model?.name ?? (conv.modelId || t('header.noModel'))}</span>
      <Icon name="chevron-down" class="size-3 shrink-0 text-faint transition-transform duration-200 group-hover:translate-y-px" />
    </button>
  );
}

export function Composer() {
  const conv = currentConv.value;
  const text = composerText.value;
  const setText = (v: string) => (composerText.value = v);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dragging, setDragging] = useState(false);
  const streaming = isStreaming.value;
  // On touch devices Enter inserts a newline (send via the button)
  const touch = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

  useEffect(() => {
    if (composerFocus.value) ref.current?.focus();
  }, [composerFocus.value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [text]);
  useEffect(() => {
    ref.current?.focus();
  }, [conv.id]);

  const active = activeComposerMode(conv);
  const addons = visibleComposerAddons(conv);
  const api: ComposerApi = { text, setText, focus: () => ref.current?.focus() };
  const canSend = !!text.trim() || (!active && addons.some((a) => a.hasContent?.()));

  const submit = async () => {
    if (!canSend || streaming) return;
    const sent = text;
    setText('');
    if (active) return void active.mode.send(sent, conv);
    void sendMessage(sent, await collectComposerExtras(conv));
  };
  const takeFiles = (files: File[]) => {
    const target = !active && addons.find((a) => a.onFiles);
    if (!files.length || !target) return false;
    target.onFiles!(files, conv);
    return true;
  };
  const placeholder = active ? (touch ? active.mode.touchPlaceholder : active.mode.placeholder) : t('composer.placeholder');
  const inside = addons.filter((a) => a.Button && a.placement === 'inside');
  const below = addons.filter((a) => a.Button && a.placement !== 'inside');
  const Slot = modelSlots.find((s) => s.when(conv))?.Component;

  return (
    <div class="mx-auto w-full max-w-3xl px-3 pb-3 sm:px-4">
      <div
        class={cx(
          'glass-float relative rounded-[22px] transition-colors duration-200 focus-within:border-line-strong',
          dragging && 'border-accent! ring-2 ring-accent/40'
        )}
        onDragOver={(e) => {
          if (active || !e.dataTransfer?.types.includes('Files')) return;
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          setDragging(false);
          if (active || !e.dataTransfer?.files.length) return;
          e.preventDefault();
          takeFiles([...e.dataTransfer.files]);
        }}
      >
        {addons.map((a) => a.Above && <a.Above key={a.id} conv={conv} api={api} />)}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={t('composer.label')}
          class="block max-h-60 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[15px] text-ink-strong outline-none placeholder:text-faint"
          onPaste={(e) => {
            const files = [...(e.clipboardData?.files ?? [])];
            if (files.length && takeFiles(files)) e.preventDefault();
          }}
          onInput={(e) => {
            const v = (e.target as HTMLTextAreaElement).value;
            // Once the user starts typing, in-progress reply suggestions are no longer needed
            if (v && !text) cancelSuggestions();
            setText(v);
          }}
          onKeyDown={(e) => {
            for (const a of addons) if (a.onKeyDown?.(e, api)) return;
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touch) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div class="flex items-center gap-1 px-2 pb-2">
          {inside.map((a) => a.Button && <a.Button key={a.id} conv={conv} />)}
          <div class="ml-auto flex min-w-0 items-center gap-1">
            {Slot ? <Slot conv={conv} /> : <ModelButton />}
            {streaming ? (
              <Button variant="primary" aria-label={t('composer.stop')} onClick={() => stopGeneration()} class="rounded-full! p-2!">
                <Icon name="stop" class="size-4" />
              </Button>
            ) : (
              <Button variant="primary" aria-label={t('composer.send')} disabled={!canSend} onClick={() => void submit()} class="rounded-full! p-2!">
                <Icon name="send" class="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
      {below.length > 0 && (
        <div class="mt-2 flex flex-wrap items-center gap-1.5 px-1">{below.map((a) => a.Button && <a.Button key={a.id} conv={conv} />)}</div>
      )}
    </div>
  );
}
