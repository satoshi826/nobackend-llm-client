// Danbooru tag suggestions while an image prompt is typed (for tag models, or as the image options say): a list above the input box, picked with Tab or Enter
// (arrow keys move, Esc closes) or a tap. Typing goes on in the input box, which keeps the focus.
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { ComposerApi } from '../../../components/extensions';
import { MenuItem, Popover } from '../../../components/menu';
import { cx } from '../../../components/ui';
import { touchDevice } from '../../../components/device';
import { composerText } from '../../../state/ui';
import { formatNumber } from '../../../lib/i18n';
import { tagSuggestionsOn as offered } from '../image/state';
import { completeTag, loadTags, searchTags, tagLabel, tagList, tagQuery, tagText, type TagMatch } from '../image/tags';
import { t } from '../image/messages';

/** The text the list was closed for (Esc or a press outside): it opens again once the text changes */
const closedFor = signal<string | null>(null);
/** The highlighted suggestion, for the text it was moved in */
const active = signal({ text: '', index: 0 });

let last: { text: string; list: TagMatch[] } = { text: '', list: [] };
/** Suggestions for the input box's text (the search runs once per text) */
function suggestionsFor(text: string): TagMatch[] {
  if (!offered.value || !tagList.value || closedFor.value === text) return [];
  if (last.text !== text) last = { text, list: searchTags(tagList.value, tagQuery(text)) };
  return last.list;
}

const activeIndex = (text: string, n: number) => (active.value.text === text ? Math.min(active.value.index, n - 1) : 0);

function pick(api: ComposerApi, m: TagMatch) {
  api.setText(completeTag(api.text, m.name));
  api.focus();
}

/** Keys in the input box while suggestions show; true when handled */
export function tagKeys(e: KeyboardEvent, api: ComposerApi): boolean {
  const list = suggestionsFor(api.text);
  const box = e.target as HTMLTextAreaElement;
  // Only for the tag at the end, where the caret is
  if (!list.length || e.isComposing || box.selectionStart !== api.text.length) return false;
  const i = activeIndex(api.text, list.length);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    active.value = { text: api.text, index: (i + (e.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length };
  } else if (e.key === 'Tab' && !e.shiftKey) {
    pick(api, list[i]);
  } else if (e.key === 'Enter' && !e.shiftKey && !touchDevice && tagText(list[i].name).toLowerCase() !== tagQuery(api.text).trim().toLowerCase()) {
    // Enter sends as usual once the tag is typed out in full
    pick(api, list[i]);
  } else return false;
  e.preventDefault();
  return true;
}

export function TagSuggestions({ api }: { api: ComposerApi }) {
  const typing = offered.value && !!tagQuery(api.text).trim();
  useEffect(() => {
    if (typing) loadTags();
  }, [typing]);
  const list = suggestionsFor(api.text);
  if (!list.length) return null;
  const i = activeIndex(api.text, list.length);
  return (
    <Popover anchor={api.box} role="listbox" label={t('tags.label')} onClose={() => (closedFor.value = composerText.peek())} class="w-80">
      {list.map((m, n) => {
        const count = formatNumber(m.count, { notation: 'compact' });
        return (
          <MenuItem key={m.name} role="option" selected={n === i} onMouseDown={(e) => e.preventDefault()} onSelect={() => pick(api, m)}>
            {/* Rows of 44 px on touch devices */}
            <span class={cx('flex items-baseline gap-2', touchDevice && 'py-1.5')}>
              <span class="min-w-0 flex-1 break-words">
                {m.alias && <span class="text-muted">{t('tags.alias', { alias: tagLabel(m.alias) })} </span>}
                {tagLabel(m.name)}
              </span>
              <span class="shrink-0 text-xs text-muted tabular-nums">{m.category === 'general' ? count : t('tags.info', { category: t(`tags.cat.${m.category}`), count })}</span>
            </span>
          </MenuItem>
        );
      })}
    </Popover>
  );
}
