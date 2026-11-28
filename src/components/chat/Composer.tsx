// The input box. Everything beyond typing and sending (attachments, skills, web search, image mode, ...)
// comes from composer add-ons that features register (components/extensions.ts).
// Layout: inside the box, one line by default = 'inside' add-ons (attach) | text | send;
// below the box = a row of chips for the other add-ons, and the model on the right.
// A mode (image, video) puts its own parts in the box before and after the text, and its model in place of the chat's.
import { useEffect, useRef, useState } from 'preact/hooks';
import { currentConv } from '../../state/conversations';
import { modelOf, providerById } from '../../state/models';
import { openModelPicker } from '../../state/ui';
import { getPreset } from '../../lib/providers/registry';
import { cancelSuggestions } from '../../state/suggestions';
import { isStreaming, stopGeneration } from '../../state/runs';
import { sendMessage } from '../../state/generation';
import { needsSetup } from '../../state/setup';
import { composerFocus, composerText } from '../../state/ui';
import { activeComposerMode, collectComposerExtras, visibleComposerAddons, type ComposerApi } from '../extensions';
import { Icon, IconButton, cx } from '../ui';
import { touchDevice } from '../device';
import { t } from './messages';

/** The chat model, bottom right of the input box. Only "private" is marked (lock); the rest is in the tooltip */
function ModelButton() {
  const conv = currentConv.value;
  const model = modelOf(conv.providerId, conv.modelId);
  const cfg = providerById(conv.providerId);
  const copy = cfg ? (getPreset(cfg.id).copy ?? {}) : {};
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
      data-tip={note ? `${t('header.chooseModel')}
${note}` : t('header.chooseModel')}
      aria-label={`${t('header.chooseModel')}: ${model?.name ?? conv.modelId}`}
    >
      <span class="max-w-[14rem] truncate">{model?.name ?? (conv.modelId || t('header.noModel'))}</span>
      <Icon name="chevron-down" class="size-3 shrink-0 text-faint transition-transform duration-200 group-hover:translate-y-px" />
    </button>
  );
}

export function Composer() {
  const conv = currentConv.value;
  const text = composerText.value;
  const setText = (v: string) => (composerText.value = v);
  const ref = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const streaming = isStreaming.value;

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
    if (!touchDevice) ref.current?.focus(); // on touch devices it would bring up the keyboard over the conversation
  }, [conv.id]);

  const active = activeComposerMode(conv);
  const addons = visibleComposerAddons(conv);
  const api: ComposerApi = { text, setText, focus: () => ref.current?.focus(), box: boxRef.current };
  // A mode sends only when it can (e.g. its model is ready); a chat message needs a chosen model
  const canSend = active ? !!text.trim() && active.mode.ready : !!conv.modelId && (!!text.trim() || addons.some((a) => a.hasContent?.()));

  const submit = async () => {
    if (!canSend || streaming) return;
    // No provider or key yet (e.g. a conversation from a backup): what is missing shows, and the text stays for then
    if (!active && needsSetup()) return;
    const sent = text;
    setText('');
    if (active) return void active.mode.send(sent, conv);
    // Not sent (e.g. it could not be saved): what was typed comes back, unless something new was typed meanwhile
    if (!(await sendMessage(sent, await collectComposerExtras(conv)))) composerText.value ||= sent;
  };
  const takeFiles = (files: File[]) => {
    const target = !active && addons.find((a) => a.onFiles);
    if (!files.length || !target) return false;
    target.onFiles!(files, conv);
    return true;
  };
  const placeholder = active ? (touchDevice ? active.mode.touchPlaceholder : active.mode.placeholder) : t('composer.placeholder');
  const inside = addons.filter((a) => a.Button && a.placement === 'inside');
  const below = addons.filter((a) => a.Button && a.placement !== 'inside');
  const Mode = active?.mode;

  // 16px wider than the message column on each side (max-w-3xl + 2rem), so text scrolling under it never shows past its rounded corners
  return (
    <div class="mx-auto w-full max-w-[calc(48rem+2rem)] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-0 md:pb-0">
      <div
        ref={boxRef}
        data-composer-box
        class={cx(
          'glass-deep relative rounded-[22px] transition-colors duration-200 focus-within:border-line-strong',
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
        {/* One line by default: attach | text | send; the text grows upward and the buttons stay at the bottom */}
        <div class="flex items-end gap-0.5 p-1.5">
          {inside.map((a) => a.Button && <a.Button key={a.id} conv={conv} />)}
          {Mode?.Start && <Mode.Start api={api} />}
          <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          aria-label={t('composer.label')}
          class={cx('block max-h-60 min-w-0 flex-1 resize-none bg-transparent py-1 text-[15px] leading-6 text-ink-strong outline-none placeholder:text-faint', inside.length || Mode?.Start ? 'pr-1 pl-0' : 'px-2.5')}
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
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !touchDevice) {
              e.preventDefault();
              void submit();
            }
          }}
        />
          {Mode?.End && <Mode.End api={api} />}
          {streaming ? (
            <IconButton variant="primary" label={t('composer.stop')} onClick={() => stopGeneration()} class="shrink-0 rounded-full! p-2!">
              <Icon name="stop" class="size-4" />
            </IconButton>
          ) : (
            <IconButton variant="primary" label={t('composer.send')} disabled={!canSend} onClick={() => void submit()} class="shrink-0 rounded-full! p-2!">
              <Icon name="send" class="size-4" />
            </IconButton>
          )}
        </div>
      </div>
      {/* Below the box: the features' chips, and the model on the right, on one line. When it is narrow the chips keep
          only their icons (their labels: @max-[22rem]:hidden), and the model's name gives way last (ellipsis) */}
      <div class="@container mt-2 flex items-center gap-1.5 px-1">
        {below.map((a) => a.Button && <a.Button key={a.id} conv={conv} />)}
        <div class="flex min-w-0 flex-1 items-center justify-end">{Mode?.Model ? <Mode.Model /> : <ModelButton />}</div>
      </div>
    </div>
  );
}
