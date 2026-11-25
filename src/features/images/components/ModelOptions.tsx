// <option>s for choosing an image model, grouped by provider (image bar and settings)
import type { ImageModelInfo } from '../providers/common';
import { imageProviderOf } from '../providers/types';
import { modelRef } from '../state';
import { t } from '../messages';

export function ModelOptions({ list, defaultRef }: { list: ImageModelInfo[]; defaultRef?: string }) {
  const groups = new Map<string, ImageModelInfo[]>();
  for (const m of list) groups.set(m.providerId, [...(groups.get(m.providerId) ?? []), m]);
  return (
    <>
      {[...groups].map(([pid, models]) => (
        <optgroup key={pid} label={imageProviderOf(pid)?.label ?? pid}>
          {models.map((x) => {
            const name = x.privacy === 'anonymized' ? t('bar.relayed', { name: x.name }) : x.name;
            return (
              <option key={modelRef(x)} value={modelRef(x)}>
                {defaultRef === modelRef(x) ? t('bar.default', { name }) : name}
              </option>
            );
          })}
        </optgroup>
      ))}
    </>
  );
}
