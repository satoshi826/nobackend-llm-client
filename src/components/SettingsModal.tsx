// Settings: core tabs, tabs registered by features, then privacy & data
import type { ComponentType } from 'preact';
import { modal, settingsTab, type SettingsTab } from '../state/ui';
import { settingsSections, settingsTabs, textOf, type Text } from './extensions';
import { Modal, SideTabs, TabStrip } from './ui';
import { AppearanceTab } from './settings/AppearanceTab';
import { ChatTab } from './settings/ChatTab';
import { ConnectionsTab } from './settings/ConnectionsTab';
import { FeaturesTab } from './settings/FeaturesTab';
import { PrivacyTab } from './settings/PrivacyTab';
import { t } from './messages';

type TabDef = { id: SettingsTab; label: Text; Component: ComponentType };
// Labels are functions: they are translated when the tabs render
const CORE_FIRST: TabDef[] = [
  { id: 'connections', label: () => t('settings.tabConnections'), Component: ConnectionsTab },
  { id: 'chat', label: () => t('settings.tabChat'), Component: ChatTab },
  { id: 'appearance', label: () => t('settings.tabAppearance'), Component: AppearanceTab }
];
const FEATURES: TabDef = { id: 'features', label: () => t('settings.tabFeatures'), Component: FeaturesTab };
const CORE_LAST: TabDef[] = [{ id: 'privacy', label: () => t('settings.tabPrivacy'), Component: PrivacyTab }];

export function SettingsModal() {
  // "機能" holds the sections features put there (images, files); hidden when there are none
  const hasFeatures = settingsSections.some((x) => x.tab === 'features');
  const tabs: TabDef[] = [...CORE_FIRST, ...(hasFeatures ? [FEATURES] : []), ...settingsTabs, ...CORE_LAST];
  const tab = tabs.some((x) => x.id === settingsTab.value) ? settingsTab.value : 'connections';
  const Active = tabs.find((x) => x.id === tab)!.Component;
  const list = tabs.map((x) => ({ id: x.id, label: textOf(x.label) }));
  return (
    // Fixed size: switching tabs never resizes the dialog. Tabs in a column on wide screens, a row on phones
    <Modal title={t('settings.title')} onClose={() => (modal.value = null)} wide fixed bare fullOnPhone>
      <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav class="hidden w-48 shrink-0 overflow-y-auto border-r border-line p-2 sm:block">
          <SideTabs label={t('settings.title')} tabs={list} value={tab} onChange={(id) => (settingsTab.value = id)} />
        </nav>
        <TabStrip class="shrink-0 px-3 sm:hidden" label={t('settings.title')} tabs={list} value={tab} onChange={(id) => (settingsTab.value = id)} />
        <div role="tabpanel" key={tab} class="fade-in scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
          <Active />
        </div>
      </div>
    </Modal>
  );
}
