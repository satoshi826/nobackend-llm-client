// Settings → 表示: theme and language
import { saveSettings, settings, type Settings } from '../../state/settings';
import { LANGS, LANG_NAMES, type Lang } from '../../lib/i18n';
import { Segmented, cx } from '../ui';
import { Section, selectCls } from '../settings-ui';
import { t } from './messages';

const THEMES: Settings['theme'][] = ['dark', 'light', 'system'];

export function AppearanceTab() {
  const s = settings.value;
  const label = (v: Settings['theme']) => (v === 'dark' ? t('chat.themeDark') : v === 'light' ? t('chat.themeLight') : t('chat.themeSystem'));
  return (
    <div class="space-y-6">
      <Section title={t('chat.theme')}>
        <Segmented label={t('chat.theme')} index={THEMES.indexOf(s.theme)} count={THEMES.length} class="max-w-md">
          {THEMES.map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={s.theme === v}
              class={cx('relative z-10 flex-1 rounded-[9px] px-3 py-1.5 text-sm', s.theme === v ? 'font-medium text-ink-strong' : 'text-muted hover:text-ink')}
              onClick={() => void saveSettings({ theme: v })}
            >
              {label(v)}
            </button>
          ))}
        </Segmented>
      </Section>
      <Section title="言語 / Language">
        <label class="flex items-center justify-between gap-3 text-sm">
          {t('appearance.language')}
          <select class={selectCls} value={s.language} onChange={(e) => saveSettings({ language: (e.target as HTMLSelectElement).value as 'auto' | Lang })}>
            <option value="auto">{t('chat.langAuto')}</option>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
      </Section>
    </div>
  );
}
