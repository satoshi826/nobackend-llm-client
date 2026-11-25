// Settings → 機能: sections that features register with tab 'features' (image generation, files, ...)
import { settingsSections } from '../extensions';

export function FeaturesTab() {
  return (
    <div class="space-y-6">
      {settingsSections
        .filter((x) => x.tab === 'features')
        .map((x) => (
          <x.Component key={x.id} />
        ))}
    </div>
  );
}
