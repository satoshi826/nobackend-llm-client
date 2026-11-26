// Sandbox feature: the run_javascript tool for chat models. Importing this module registers it with the core.
// (Showing HTML / SVG and running code blocks are in the core: components/SandboxFrame, components/CodeRun.)
import { registerSettingsSection, registerToolView } from '../../components/extensions';
import { settings } from '../../state/settings';
import { SandboxSettings } from './Settings';
import { registerToolProvider } from '../../state/tool-registry';
import { RunOutput } from './RunOutput';
import { RUN_JAVASCRIPT, runJavaScriptTool } from './tool';
import { t } from './messages';

// Turned off in settings ("使わない"), the tool is not offered at all
registerToolProvider({ id: 'sandbox', tools: ({ model }) => (model?.capabilities.tools && settings.value.toolPermissions[RUN_JAVASCRIPT] !== 'deny' ? [runJavaScriptTool] : []) });
registerSettingsSection({ id: 'sandbox', tab: 'chat', Component: SandboxSettings });

registerToolView({
  names: [RUN_JAVASCRIPT],
  label: () => t('tool.label'),
  icon: 'code',
  editableField: { key: 'code', label: () => t('tool.codeField') },
  approvalNote: () => t('tool.approvalNote'),
  doneStatus: (p) => ((p.uiDetails as { failed?: boolean } | undefined)?.failed ? t('tool.failed') : undefined),
  Detail: RunOutput
});
