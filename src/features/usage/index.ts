// Usage and cost (recorded on this device). Recording happens in the core (every reply and image job);
// this feature is the settings tab that sums it up.
import { registerSettingsTab } from '../../components/extensions';
import { lazyComponent } from '../../components/lazy';
import { t } from './messages';

registerSettingsTab({
  id: 'usage',
  // A getter: the tab label follows the UI language
  label: () => t('tab'),
  Component: lazyComponent(() => import('./components/UsageTab').then((m) => m.UsageTab))
});
