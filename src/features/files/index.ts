// Files feature: documents the model writes, files the user attaches, and the Files tab.
// Importing this module registers everything with the core through extension points;
// the core never imports anything from here.
import { registerComposerAddon, registerMainView, registerSettingsSection, registerSidebarTab, registerToolView, registerUserMessageExtra } from '../../components/extensions';
import { FilesSettings } from './components/Settings';
import { AttachButton, AttachmentChips } from './components/Composer';
import { FilesPanel } from './components/FilesPanel';
import { FileView } from './components/FileView';
import { Filer } from './components/Filer';
import { FileToolDetail, UserAttachments } from './components/Message';
import { openFiler, pendingAttachments, takeAttachments, uploadFiles } from './state';
import { FILE_TOOL_NAMES } from './tools';

export { openFile, openFiler } from './state';

registerSidebarTab({ id: 'files', label: 'ファイル', icon: 'files', Panel: FilesPanel, onSelect: () => openFiler() });
registerMainView({ kind: 'files', Component: Filer });
registerMainView({ kind: 'file', Component: FileView });
registerComposerAddon({
  id: 'files',
  Button: AttachButton,
  Above: AttachmentChips,
  hasContent: () => pendingAttachments.value.some((a) => !a.reading),
  collect: async () => ({ attachments: await takeAttachments() }),
  onFiles: (files, conv) => void uploadFiles(files, conv)
});
const FILE_TOOL_LABELS: Record<string, string> = { create_file: 'ファイルの作成', append_file: 'ファイルへの追記', edit_file: 'ファイルの編集', read_file: 'ファイルの読み込み' };
registerToolView({
  names: FILE_TOOL_NAMES,
  label: (name) => FILE_TOOL_LABELS[name],
  icon: 'file',
  summary: (p) => {
    const d = p.uiDetails as { name?: string } | undefined;
    const i = (p.input ?? {}) as { name?: string; file_id?: string; note?: string };
    return d?.name ?? i.name ?? i.file_id ?? '';
  },
  doneStatus: (p) => {
    const d = p.uiDetails as { version?: number } | undefined;
    return p.name === 'read_file' ? '読みました' : d?.version ? `版 ${d.version}` : undefined;
  },
  Detail: FileToolDetail
});
registerUserMessageExtra(UserAttachments);
registerSettingsSection({ id: 'files', tab: 'chat', Component: FilesSettings });
