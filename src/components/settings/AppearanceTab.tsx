// Settings → 表示: background, scrolling and language (the theme choice is hidden while the app is dark only; see DARK_ONLY in state/settings.ts)
import { useRef } from 'preact/hooks';
import { saveSettings, settings } from '../../state/settings';
import { showToast } from '../../state/ui';
import { backgroundImage, backgroundOf, clearBackgroundImage, GLOW_ORDER, GLOW_PRESETS, loadBackgroundImage, MAX_SPEED, saveBackground, setBackgroundImage, type BackgroundSetting } from '../../state/background';
import { LANGS, LANG_NAMES, type Lang } from '../../lib/i18n';
import { Button, Segmented, Select, Slider, cx, Icon } from '../ui';
import { Group, Row, ToggleRow } from '../settings-ui';
import { t } from './messages';

const KINDS: BackgroundSetting['kind'][] = ['glow', 'solid', 'image'];
const SOLIDS = ['#0b0d17', '#111827', '#0f172a', '#1c1917', '#14231c', '#1e1b2e'];

function Background() {
  const bg = backgroundOf();
  const input = useRef<HTMLInputElement>(null);
  if (bg.kind === 'image') void loadBackgroundImage();
  return (
    <Group title={t('bg.title')} footer={bg.kind === 'image' ? t('bg.imageNote') : undefined}>
      <Row
        below={
          <Segmented
            label={t('bg.title')}
            items={KINDS.map((k) => ({ id: k, label: t(k === 'glow' ? 'bg.glow' : k === 'solid' ? 'bg.solid' : 'bg.image') }))}
            value={bg.kind}
            onChange={(k) => (k === 'image' && !backgroundImage.value ? input.current?.click() : void saveBackground({ kind: k }))}
            stretch
          />
        }
      />

      {bg.kind === 'glow' && (
        <>
          <Row
            below={
              <div class="grid grid-cols-3 gap-2 sm:grid-cols-5" role="radiogroup" aria-label={t('bg.preset')}>
                {GLOW_ORDER.map((id) => {
                  const p = GLOW_PRESETS[id];
                  return (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={bg.preset === id}
                      data-tip={t(`bg.preset.${id}`)}
                      class={cx('lift flex flex-col items-center gap-1.5 rounded-xl border p-1.5 text-xs', bg.preset === id ? 'border-accent text-ink-strong' : 'border-line text-muted hover:text-ink')}
                      onClick={() => void saveBackground({ preset: id })}
                    >
                      <span
                        class="block h-12 w-full rounded-lg bg-canvas"
                        style={{ backgroundImage: `radial-gradient(circle at 20% 20%, ${p.colors[0]}aa, transparent 60%), radial-gradient(circle at 80% 85%, ${p.colors[1]}aa, transparent 60%), radial-gradient(circle at 55% 50%, ${p.colors[2]}66, transparent 55%)` }}
                      />
                      {t(`bg.preset.${id}`)}
                    </button>
                  );
                })}
              </div>
            }
          />
          <Row
            below={
              <Slider
                label={t('bg.speed')}
                value={bg.speed}
                min={0}
                max={MAX_SPEED}
                step={0.25}
                format={(v) => (v === 0 ? t('bg.speedStill') : `×${v}`)}
                desc={t('bg.speedDesc')}
                onChange={(v) => void saveBackground({ speed: v })}
              />
            }
          />
        </>
      )}

      {bg.kind === 'solid' && (
        <Row
          below={
            <div class="flex flex-wrap items-center gap-2">
              {SOLIDS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={bg.color.toLowerCase() === c}
                  class={cx('lift size-9 rounded-full border', bg.color.toLowerCase() === c ? 'border-accent ring-2 ring-accent/40' : 'border-line')}
                  style={{ background: c }}
                  onClick={() => void saveBackground({ color: c })}
                />
              ))}
              <label class="flex items-center gap-2 text-sm text-muted">
                <input type="color" value={bg.color} class="size-9 cursor-pointer rounded-full border border-line bg-transparent" onInput={(e) => void saveBackground({ color: (e.target as HTMLInputElement).value })} />
                {t('bg.custom')}
              </label>
            </div>
          }
        />
      )}

      {bg.kind === 'image' && (
        <>
          <Row
            below={
              <div class="flex flex-wrap items-end gap-3">
                {backgroundImage.value && <img src={backgroundImage.value} alt="" class="h-28 w-48 rounded-xl border border-line object-cover" />}
                <div class="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => input.current?.click()}>
                    <Icon name="image" />
                    {t('bg.choose')}
                  </Button>
                  {backgroundImage.value && (
                    <Button onClick={() => void clearBackgroundImage()}>
                      <Icon name="x" />
                      {t('bg.remove')}
                    </Button>
                  )}
                </div>
              </div>
            }
          />
          <Row below={<Slider label={t('bg.dim')} value={Math.round(bg.dim * 100)} min={0} max={80} step={5} format={(v) => `${v}%`} onChange={(v) => void saveBackground({ dim: v / 100 })} />} />
        </>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        class="hidden"
        onChange={async (e) => {
          const el = e.target as HTMLInputElement;
          const file = el.files?.[0];
          el.value = '';
          if (!file) return;
          try {
            await setBackgroundImage(file);
          } catch {
            showToast(t('bg.imageFailed'), 'error');
          }
        }}
      />
    </Group>
  );
}

export function AppearanceTab() {
  const s = settings.value;
  return (
    <div class="space-y-8">
      <Background />
      <Group title={t('scroll.title')}>
        <ToggleRow checked={s.smoothScroll} onChange={(v) => void saveSettings({ smoothScroll: v })} label={t('scroll.smooth')} hint={t('scroll.smoothDesc')} />
      </Group>
      <Group title="言語 / Language">
        <Row
          label={t('appearance.language')}
          control={
            <Select aria-label={t('appearance.language')} value={s.language} onChange={(e) => saveSettings({ language: (e.target as HTMLSelectElement).value as 'auto' | Lang })}>
              <option value="auto">{t('chat.langAuto')}</option>
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {LANG_NAMES[l]}
                </option>
              ))}
            </Select>
          }
        />
      </Group>
    </div>
  );
}
