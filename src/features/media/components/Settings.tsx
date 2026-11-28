// Settings → 画像: the default image model, the format images are saved in, and the generate_image tool
import { useEffect } from 'preact/hooks';
import { SearchChoice, Select } from '../../../components/ui';
import { Group, PermissionRow, Row, ToggleRow } from '../../../components/settings-ui';
import { formatList, formatUsd } from '../../../lib/i18n';
import { defaultImageModel, estimateCost, generationModels, imageReady, imageSettings, loadImageModels, modelRef, privacyLabelOf, setDefaultImageModel, toolParams } from '../image/state';
import { imageProviderList, imageProviderOf } from '../image/providers/types';
import { tagModelLabel } from '../image/presets';
import { t } from '../image/messages';

/** Every image provider, A to Z (for texts that name them) */
const imageProviderNames = () => formatList(imageProviderList().map((p) => p.label).sort((a, b) => a.localeCompare(b)));

/** The default image model (tool and image mode) */
function DefaultModelRow() {
  // Loaded again when image providers become usable, or stop being usable
  const ready = imageReady.value;
  useEffect(() => {
    void loadImageModels();
  }, [ready]);
  const list = generationModels.value;
  const m = defaultImageModel.value;
  if (!list.length) return <Row label={t('settings.model')} below={<p class="text-xs leading-5 text-muted">{t('settings.noModels', { providers: imageProviderNames() })}</p>} />;
  const cost = m ? estimateCost({ ...toolParams(undefined, {}), providerId: m.providerId, model: m.id }) : undefined;
  return (
    <Row
      label={t('settings.model')}
      hint={t('settings.modelDesc')}
      below={
        <>
          <SearchChoice
            label={t('settings.model')}
            value={m ? modelRef(m) : ''}
            choices={list.map((x) => {
              const kind = tagModelLabel(x);
              return {
                value: modelRef(x),
                label: x.privacy === 'anonymized' ? t('bar.relayed', { name: x.name }) : x.name,
                sub: imageProviderOf(x.providerId)?.label ?? x.providerId,
                badge: kind ? { label: kind, title: t('model.tagsTitle') } : undefined
              };
            })}
            onChange={(v) => {
              const x = list.find((y) => modelRef(y) === v);
              if (x) void setDefaultImageModel(x);
            }}
          />
          {m && (
            <p class="mt-1.5 text-xs leading-5 text-muted">
              {[privacyLabelOf(m).title, cost !== undefined ? t('tool.costEach', { cost: formatUsd(cost) }) : t('settings.priceUnknown')].filter(Boolean).join(' ')}
            </p>
          )}
        </>
      }
    />
  );
}

export function ImageSettings() {
  const s = imageSettings.value.value;
  const saveImage = imageSettings.save;
  return (
    <div class="space-y-8">
      <Group note={t('settings.desc')}>
        <DefaultModelRow />
        <Row
          label={t('settings.format')}
          control={
            <Select aria-label={t('settings.format')} value={s.imageFormat} onChange={(e) => void saveImage({ imageFormat: (e.target as HTMLSelectElement).value as 'webp' | 'png' | 'jpeg' })}>
              <option value="webp">{t('settings.webp')}</option>
              <option value="png">{t('settings.png')}</option>
              <option value="jpeg">JPEG</option>
            </Select>
          }
        />
      </Group>
      <Group>
        <ToggleRow checked={s.imageTool} onChange={(v) => void saveImage({ imageTool: v })} label={t('settings.tool')} hint={t('settings.toolDesc')}>
          <PermissionRow label={t('settings.permission')} tools={['generate_image']} />
        </ToggleRow>
      </Group>
    </div>
  );
}
