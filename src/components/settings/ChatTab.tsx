// Settings → チャット: generation, reply suggestions, compaction
import { saveSettings, settings } from '../../state/settings';
import { formatNumber } from '../../lib/i18n';
import { Icon, Select, TextField } from '../ui';
import { Group, ModelChoice, Row, ToggleRow } from '../settings-ui';
import { t } from './messages';
import { around } from '../messages';

export function ChatTab() {
  const s = settings.value;
  const [lengthBefore, lengthAfter] = around(t('chat.lengthText'), 'icon');
  return (
    <div class="space-y-8">
      <Group title={t('chat.display')} footer={t('chat.providerSettingsNote')}>
        <Row
          label={t('chat.temperature')}
          hint={t('chat.temperatureHint')}
          control={
            <TextField
              type="number"
              min={0}
              max={2}
              step={0.1}
              class="w-24"
              aria-label={t('chat.temperature')}
              value={s.temperature ?? ''}
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value;
                void saveSettings({ temperature: v === '' ? null : Math.max(0, Math.min(2, Number(v))) });
              }}
            />
          }
        />
      </Group>

      <Group title={t('chat.suggestions')}>
        <ToggleRow checked={s.replySuggestions} onChange={(v) => saveSettings({ replySuggestions: v })} label={t('chat.suggestionsToggle')} hint={t('chat.suggestionsDesc')}>
          <Row
            label={t('chat.suggestionCount')}
            control={
              <Select aria-label={t('chat.suggestionCount')} value={String(s.suggestionCount)} onChange={(e) => saveSettings({ suggestionCount: Number((e.target as HTMLSelectElement).value) })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {t('chat.suggestionCountOption', { n })}
                  </option>
                ))}
              </Select>
            }
          />
          <Row
            label={t('chat.suggestionTurns')}
            control={
              <Select aria-label={t('chat.suggestionTurns')} value={String(s.suggestionTurns)} onChange={(e) => saveSettings({ suggestionTurns: Number((e.target as HTMLSelectElement).value) })}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {t('chat.suggestionTurnsOption', { n })}
                  </option>
                ))}
              </Select>
            }
          />
          <Row label={t('chat.suggestionModel')} below={<ModelChoice label={t('chat.suggestionModel')} value={s.suggestionModel} onChange={(v) => saveSettings({ suggestionModel: v })} />} />
        </ToggleRow>
      </Group>

      <Group
        title={t('chat.length')}
        note={
          <>
            {lengthBefore}
            <Icon name="compress" class="inline size-3.5" />
            {lengthAfter}
          </>
        }
        footer={t('chat.cacheNote')}
      >
        <ToggleRow checked={s.autoCompact} onChange={(v) => saveSettings({ autoCompact: v })} label={t('chat.autoCompact')} hint={t('chat.autoCompactDesc')}>
          <Row
            label={t('chat.compactThreshold')}
            control={
              <Select aria-label={t('chat.compactThreshold')} value={String(Math.round(s.compactThreshold * 100))} onChange={(e) => saveSettings({ compactThreshold: Number((e.target as HTMLSelectElement).value) / 100 })}>
                {[50, 60, 70, 80, 90].map((v) => (
                  <option key={v} value={v}>
                    {t('chat.compactThresholdOption', { n: formatNumber(v) })}
                  </option>
                ))}
              </Select>
            }
          />
        </ToggleRow>
        <Row label={t('chat.compactModel')} below={<ModelChoice label={t('chat.compactModel')} value={s.compactModel} onChange={(v) => saveSettings({ compactModel: v })} />} />
        <ToggleRow checked={s.resendReasoning} onChange={(v) => saveSettings({ resendReasoning: v })} label={t('chat.resendReasoning')} hint={t('chat.resendReasoningDesc')} />
      </Group>
    </div>
  );
}
