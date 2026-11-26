// Sandbox feature: the run_javascript tool for chat models. Importing this module registers it with the core.
// (Showing HTML / SVG and running code blocks are in the core: components/SandboxFrame, components/CodeRun.)
import { registerToolView } from '../../components/extensions';
import { registerToolProvider } from '../../state/tool-registry';
import { RunOutput } from './RunOutput';
import { RUN_JAVASCRIPT, runJavaScriptTool } from './tool';
import { t } from './messages';

registerToolProvider({ id: 'sandbox', tools: ({ model }) => (model?.capabilities.tools ? [runJavaScriptTool] : []) });

registerToolView({
  names: [RUN_JAVASCRIPT],
  label: () => t('tool.label'),
  icon: 'code',
  editableField: { key: 'code', label: () => t('tool.codeField') },
  approvalNote: () => t('tool.approvalNote'),
  doneStatus: (p) => ((p.uiDetails as { failed?: boolean } | undefined)?.failed ? t('tool.failed') : undefined),
  Detail: RunOutput
});
