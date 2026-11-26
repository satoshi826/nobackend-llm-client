// Sandbox feature: the run_javascript tool for chat models. Importing this module registers it with the core.
// (Showing HTML / SVG and running code blocks are in the core: components/SandboxFrame, components/CodeRun.)
import { registerSettingsTab, registerToolView } from '../../components/extensions';
import { settings } from '../../state/settings';
import { SandboxSettings } from './Settings';
import { registerToolProvider } from '../../state/tool-registry';
import { RunOutput } from './RunOutput';
import { conversationFile } from '../files';
import { makeRunJavaScriptTool, RUN_JAVASCRIPT } from './tool';
import { t } from './messages';

// Turned off in settings ("使わない"), the tool is not offered at all
registerToolProvider({
  id: 'sandbox',
  tools: ({ conv, model, history }) =>
    model?.capabilities.tools && settings.value.toolPermissions[RUN_JAVASCRIPT] !== 'deny' ? [makeRunJavaScriptTool((id) => conversationFile(conv, history, id))] : []
});
// Its own tab: the sandbox serves both chat (code blocks, the tool) and files (HTML / SVG previews)
registerSettingsTab({ id: 'sandbox', label: () => t('tabLabel'), icon: 'code', Component: SandboxSettings });

registerToolView({
  names: [RUN_JAVASCRIPT],
  label: () => t('tool.label'),
  icon: 'code',
  editableField: { key: 'code', label: () => t('tool.codeField') },
  approvalNote: () => t('tool.approvalNote'),
  doneStatus: (p) => ((p.uiDetails as { failed?: boolean } | undefined)?.failed ? t('tool.failed') : undefined),
  Detail: RunOutput
});
