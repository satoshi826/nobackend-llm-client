// Settings → チャット: generation, reply suggestions, compaction
import { saveSettings, settings } from '../../state/settings';
import { formatNumber } from '../../lib/i18n';
import { Icon, Select, TextField, cx } from '../ui';
import { ModelSelect, Section, Toggle } from '../settings-ui';
import { t } from './messages';
import { around } from '../messages';

export function ChatTab() {
  const s = settings.value;
  const [lengthBefore, lengthAfter] = around(t('chat.lengthText'), 'icon');
  return (
    <div class="space-y-6">
      <Section title={t('chat.display')}>
        <label class="flex items-center justify-between gap-3 text-sm">
          <span>
            {t('chat.temperature')}
            <span class="block text-xs text-muted">{t('chat.temperatureHint')}</span>
          </span>
          <TextField
            type="number"
            min={0}
            max={2}
            step={0.1}
            class="w-24"
            value={s.temperature ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              void saveSettings({ temperature: v === '' ? null : Math.max(0, Math.min(2, Number(v))) });
            }}
          />
        </label>
        <p class="text-xs text-muted">{t('chat.providerSettingsNote')}</p>
      </Section>
      <Section title={t('chat.suggestions')}>
        <Toggle
          checked={s.replySuggestions}
          onChange={(v) => saveSettings({ replySuggestions: v })}
          title={t('chat.suggestionsToggle')}
          desc={t('chat.suggestionsDesc')}
        />
        <div class={cx('grid gap-3 sm:grid-cols-2', !s.replySuggestions && 'opacity-50')}>
          <label class="flex items-center justify-between gap-3 text-sm">
            {t('chat.suggestionCount')}
            <Select disabled={!s.replySuggestions} value={String(s.suggestionCount)} onChange={(e) => saveSettings({ suggestionCount: Number((e.target as HTMLSelectElement).value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {t('chat.suggestionCountOption', { n })}
                </option>
              ))}
            </Select>
          </label>
          <label class="flex items-center justify-between gap-3 text-sm">
            {t('chat.suggestionTurns')}
            <Select disabled={!s.replySuggestions} value={String(s.suggestionTurns)} onChange={(e) => saveSettings({ suggestionTurns: Number((e.target as HTMLSelectElement).value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {t('chat.suggestionTurnsOption', { n })}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <ModelSelect label={t('chat.suggestionModel')} disabled={!s.replySuggestions} value={s.suggestionModel} onChange={(v) => saveSettings({ suggestionModel: v })} />
      </Section>
      <Section title={t('chat.length')}>
        <p class="text-xs text-muted">
          {lengthBefore}
          <Icon name="compress" class="inline size-3.5" />
          {lengthAfter}
        </p>
        <Toggle checked={s.autoCompact} onChange={(v) => saveSettings({ autoCompact: v })} title={t('chat.autoCompact')} desc={t('chat.autoCompactDesc')} />
        <label class={cx('flex items-center justify-between gap-3 text-sm', !s.autoCompact && 'opacity-50')}>
          {t('chat.compactThreshold')}
          <Select disabled={!s.autoCompact} value={String(Math.round(s.compactThreshold * 100))} onChange={(e) => saveSettings({ compactThreshold: Number((e.target as HTMLSelectElement).value) / 100 })}>
            {[50, 60, 70, 80, 90].map((v) => (
              <option key={v} value={v}>
                {t('chat.compactThresholdOption', { n: formatNumber(v) })}
              </option>
            ))}
          </Select>
        </label>
        <ModelSelect label={t('chat.compactModel')} value={s.compactModel} onChange={(v) => saveSettings({ compactModel: v })} />
        <Toggle
          checked={s.resendReasoning}
          onChange={(v) => saveSettings({ resendReasoning: v })}
          title={t('chat.resendReasoning')}
          desc={t('chat.resendReasoningDesc')}
        />
        <p class="text-xs text-muted">{t('chat.cacheNote')}</p>
      </Section>
    </div>
  );
}

