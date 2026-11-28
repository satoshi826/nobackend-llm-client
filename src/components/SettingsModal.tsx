// Settings: core tabs, tabs registered by features, then privacy & data and about
import { modal, settingsTab, type SettingsTab } from '../state/ui';
import { settingsTabs, textOf, type SettingsTabDef } from './extensions';
import { useRef } from 'preact/hooks';
import { Modal, ScrollArea, SideTabs, TabStrip } from './ui';
import { AppearanceTab } from './settings/AppearanceTab';
import { ChatTab } from './settings/ChatTab';
import { ConnectionsTab } from './settings/ConnectionsTab';
import { PrivacyTab } from './settings/PrivacyTab';
import { AboutTab } from './settings/AboutTab';
import { t } from './messages';

type TabDef = SettingsTabDef & { id: SettingsTab };
// Labels are functions: they are translated when the tabs render
const CORE_FIRST: TabDef[] = [
  { id: 'connections', label: () => t('settings.tabConnections'), icon: 'key', Component: ConnectionsTab },
  { id: 'chat', label: () => t('settings.tabChat'), icon: 'chat', Component: ChatTab },
  { id: 'appearance', label: () => t('settings.tabAppearance'), icon: 'palette', Component: AppearanceTab }
];
const CORE_LAST: TabDef[] = [
  { id: 'privacy', label: () => t('settings.tabPrivacy'), icon: 'shield', Component: PrivacyTab },
  { id: 'about', label: () => t('settings.tabAbout'), icon: 'info', Component: AboutTab }
];

export function SettingsModal() {
  const tabs: TabDef[] = [...CORE_FIRST, ...settingsTabs, ...CORE_LAST];
  const tab = tabs.some((x) => x.id === settingsTab.value) ? settingsTab.value : 'connections';
  const Active = tabs.find((x) => x.id === tab)!.Component;
  const list = tabs.map((x) => ({ id: x.id, label: textOf(x.label), icon: x.icon }));
  const panel = useRef<HTMLDivElement>(null);
  return (
    // Fixed size: switching tabs never resizes the dialog. Tabs in a column with icons on wide screens, a row of
    // labels on phones (icons would make the row scroll further)
    <Modal title={t('settings.title')} onClose={() => (modal.value = null)} wide fixed bare fullOnPhone>
      <div class="flex min-h-0 flex-1 flex-col sm:flex-row">
        <nav class="hidden w-56 shrink-0 overflow-y-auto border-r border-line p-2 sm:block">
          <SideTabs label={t('settings.title')} tabs={list} value={tab} onChange={(id) => (settingsTab.value = id)} />
        </nav>
        <TabStrip class="shrink-0 px-3 sm:hidden" label={t('settings.title')} tabs={list} value={tab} onChange={(id) => (settingsTab.value = id)} />
        <ScrollArea.Provider value={panel}>
          <div ref={panel} role="tabpanel" key={tab} class="fade-in scroll-thin min-h-0 flex-1 overflow-y-auto p-5">
            <Active />
          </div>
        </ScrollArea.Provider>
      </div>
    </Modal>
  );
}
