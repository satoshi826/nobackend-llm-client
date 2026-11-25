// Settings → チャット: generation, reply suggestions, sections registered by features, compaction
import { keyStatus } from '../../state/keys';
import { providerById, visibleModels } from '../../state/models';
import { saveSettings, settings } from '../../state/settings';
import { formatNumber } from '../../lib/i18n';
import { settingsSections } from '../extensions';
import { Icon, cx } from '../ui';
import { Section, Toggle, selectCls } from '../settings-ui';
import { t } from './messages';
import { around } from '../messages';

export function ChatTab() {
  const s = settings.value;
  const choices = visibleModels.value.filter((m) => keyStatus(m.providerId).present);
  const modelOption = (m: (typeof choices)[number]) => {
    const provider = providerById(m.providerId)?.name ?? m.providerId;
    const price = m.pricing?.inputPerMTok;
    return price != null ? t('chat.modelOptionPriced', { provider, model: m.name, price: price.toFixed(2) }) : `${provider} / ${m.name}`;
  };
  const [lengthBefore, lengthAfter] = around(t('chat.lengthText'), 'icon');
  return (
    <div class="space-y-6">
      <Section title={t('chat.display')}>
        <label class="flex items-center justify-between gap-3 text-sm">
          <span>
            {t('chat.temperature')}
            <span class="block text-xs text-muted">{t('chat.temperatureHint')}</span>
          </span>
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            class={cx(selectCls, 'w-24')}
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
            <select disabled={!s.replySuggestions} class={selectCls} value={String(s.suggestionCount)} onChange={(e) => saveSettings({ suggestionCount: Number((e.target as HTMLSelectElement).value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {t('chat.suggestionCountOption', { n })}
                </option>
              ))}
            </select>
          </label>
          <label class="flex items-center justify-between gap-3 text-sm">
            {t('chat.suggestionTurns')}
            <select disabled={!s.replySuggestions} class={selectCls} value={String(s.suggestionTurns)} onChange={(e) => saveSettings({ suggestionTurns: Number((e.target as HTMLSelectElement).value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {t('chat.suggestionTurnsOption', { n })}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label class={cx('block text-sm', !s.replySuggestions && 'opacity-50')}>
          {t('chat.suggestionModel')}
          <select disabled={!s.replySuggestions} class={cx(selectCls, 'mt-1 block w-full py-1.5')} value={s.suggestionModel} onChange={(e) => saveSettings({ suggestionModel: (e.target as HTMLSelectElement).value })}>
            <option value="">{t('chat.sameModel')}</option>
            {choices.map((m) => (
              <option key={m.providerId + m.id} value={`${m.providerId}|${m.id}`}>
                {modelOption(m)}
              </option>
            ))}
          </select>
        </label>
      </Section>
      {settingsSections
        .filter((x) => x.tab === 'chat')
        .map((x) => (
          <x.Component key={x.id} />
        ))}
      <Section title={t('chat.length')}>
        <p class="text-xs text-muted">
          {lengthBefore}
          <Icon name="compress" class="inline size-3.5" />
          {lengthAfter}
        </p>
        <Toggle checked={s.autoCompact} onChange={(v) => saveSettings({ autoCompact: v })} title={t('chat.autoCompact')} desc={t('chat.autoCompactDesc')} />
        <label class={cx('flex items-center justify-between gap-3 text-sm', !s.autoCompact && 'opacity-50')}>
          {t('chat.compactThreshold')}
          <select disabled={!s.autoCompact} class={selectCls} value={String(Math.round(s.compactThreshold * 100))} onChange={(e) => saveSettings({ compactThreshold: Number((e.target as HTMLSelectElement).value) / 100 })}>
            {[50, 60, 70, 80, 90].map((v) => (
              <option key={v} value={v}>
                {t('chat.compactThresholdOption', { n: formatNumber(v) })}
              </option>
            ))}
          </select>
        </label>
        <label class="block text-sm">
          {t('chat.compactModel')}
          <select class={cx(selectCls, 'mt-1 block w-full py-1.5')} value={s.compactModel} onChange={(e) => saveSettings({ compactModel: (e.target as HTMLSelectElement).value })}>
            <option value="">{t('chat.sameModel')}</option>
            {choices.map((m) => (
              <option key={m.providerId + m.id} value={`${m.providerId}|${m.id}`}>
                {modelOption(m)}
              </option>
            ))}
          </select>
        </label>
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

