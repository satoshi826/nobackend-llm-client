// Skills in the input box: the "スキル" menu, "/name" suggestions, attached skill chips; and chips on sent messages
import { useEffect, useRef, useState } from 'preact/hooks';
import type { MessageRecord, Skill } from '../../../lib/db/schema';
import { openSettings } from '../../../state/ui';
import type { ComposerApi } from '../../../components/extensions';
import { Chip, Icon, cx } from '../../../components/ui';
import { allSkills, attachedSkillIds, attachedSkills, toggleAttachedSkill } from '../state';
import { t } from '../messages';

/** Skills offered while typing "/name" at the start of the input */
export function slashSuggestions(text: string): Skill[] {
  const slash = /^\/([a-z0-9-]*)$/.exec(text);
  return slash ? allSkills.value.filter((s) => s.name.startsWith(slash[1]) && !attachedSkillIds.value.includes(s.id)).slice(0, 6) : [];
}

export function pickSkill(id: string, api: ComposerApi) {
  toggleAttachedSkill(id);
  api.setText('');
  api.focus();
}

/** Tab / Enter picks the first suggestion; Backspace in an empty input removes the last attached skill */
export function skillKeys(e: KeyboardEvent, api: ComposerApi): boolean {
  const list = slashSuggestions(api.text);
  if (list.length && (e.key === 'Tab' || (e.key === 'Enter' && !e.isComposing))) {
    e.preventDefault();
    pickSkill(list[0].id, api);
    return true;
  }
  const attached = attachedSkills.value;
  if (e.key === 'Backspace' && !api.text && attached.length) {
    toggleAttachedSkill(attached[attached.length - 1].id);
    return true;
  }
  return false;
}

function SkillMenu({ onClose }: { onClose(): void }) {
  const list = allSkills.value;
  const ids = attachedSkillIds.value;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <div ref={ref} role="menu" aria-label={t('composer.menu')} class="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-[calc(100vw-2rem)] panel rounded-2xl p-1.5">
      {list.length === 0 ? (
        <p class="p-2 text-xs text-muted">{t('none')}</p>
      ) : (
        <ul class="scroll-thin max-h-64 overflow-y-auto">
          {list.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={ids.includes(s.id)}
                class="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-glass"
                onClick={() => toggleAttachedSkill(s.id)}
              >
                <Icon name="check" class={cx('mt-0.5 size-4 shrink-0', ids.includes(s.id) ? 'text-accent-text' : 'invisible')} />
                <span class="min-w-0">
                  <span class="block font-mono text-sm">{s.name}</span>
                  <span class="line-clamp-2 block text-xs text-muted">{s.description}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        class="mt-1 w-full rounded-lg border-t border-line px-2 pt-2 pb-1 text-left text-xs text-muted hover:text-ink"
        onClick={() => {
          onClose();
          openSettings('skills');
        }}
      >
        {t('composer.manage')}
      </button>
    </div>
  );
}

export function SkillButton() {
  const [menu, setMenu] = useState(false);
  const attached = attachedSkills.value;
  return (
    <div class="relative">
      <Chip aria-haspopup="menu" aria-expanded={menu} on={attached.length > 0} title={t('composer.buttonTitle')} onClick={() => setMenu(!menu)}>
        <Icon name="book" class="size-3.5" />
        {attached.length ? t('composer.buttonCount', { n: attached.length }) : t('composer.button')}
      </Chip>
      {menu && <SkillMenu onClose={() => setMenu(false)} />}
    </div>
  );
}

/** "/name" suggestions and the attached skills, above the text area */
export function SkillsAbove({ api }: { api: ComposerApi }) {
  const suggestions = slashSuggestions(api.text);
  const attached = attachedSkills.value;
  return (
    <>
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label={t('composer.suggestions')} class="absolute bottom-full left-0 z-20 mb-2 w-80 max-w-full panel rounded-2xl p-1.5">
          {suggestions.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                role="option"
                aria-selected={i === 0}
                class={cx('flex w-full flex-col rounded-lg px-2 py-1.5 text-left hover:bg-glass', i === 0 && 'bg-glass')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pickSkill(s.id, api)}
              >
                <span class="font-mono text-sm">/{s.name}</span>
                <span class="truncate text-xs text-muted">{s.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {attached.length > 0 && (
        <div class="flex flex-wrap gap-1 px-3 pt-2.5">
          {attached.map((s) => (
            <span key={s.id} class="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pr-1 pl-2 font-mono text-xs text-accent-text">
              <Icon name="book" class="size-3" />
              {s.name}
              <button type="button" aria-label={t('remove', { name: s.name })} class="rounded-full p-0.5 hover:bg-accent-soft" onClick={() => toggleAttachedSkill(s.id)}>
                <Icon name="x" class="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** Skills picked for a sent message */
export function UserSkills({ m }: { m: MessageRecord }) {
  if (!m.skills?.length) return null;
  return (
    <div class="mb-1 flex max-w-[85%] flex-wrap justify-end gap-1">
      {m.skills.map((s) => (
        <span key={s.name} class="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 font-mono text-xs text-accent-text" title={t('composer.picked')}>
          <Icon name="book" class="size-3" />
          {s.name}
        </span>
      ))}
    </div>
  );
}
