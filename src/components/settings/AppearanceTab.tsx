// Settings → 表示: language (the theme choice is hidden while the app is dark only; see DARK_ONLY in state/settings.ts)
import { saveSettings, settings } from '../../state/settings';
import { LANGS, LANG_NAMES, type Lang } from '../../lib/i18n';
import { Section, selectCls } from '../settings-ui';
import { t } from './messages';

export function AppearanceTab() {
  const s = settings.value;
  return (
    <div class="space-y-6">
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
