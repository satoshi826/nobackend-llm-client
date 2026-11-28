// Files feature: documents the model writes, files the user attaches, and the Files tab.
// Importing this module registers everything with the core through extension points;
// the core never imports anything from here.
import { registerComposerAddon, registerMainView, registerSettingsTab, registerSidebarTab, registerToolView, registerUserMessageExtra } from '../../components/extensions';
import { lazyComponent } from '../../components/lazy';
import { AttachButton, AttachmentChips } from './components/Composer';
import { FilesPanel } from './components/FilesPanel';
import { FileToolDetail, UserAttachments } from './components/Message';
import { pendingAttachments, selectFilesTab, takeAttachments, uploadFiles } from './state';
import { FILE_TOOL_NAMES, fileToolLabel } from './tools';
import { t } from './messages';
import { registerMessageTransform } from '../../lib/chat/request';
import { attachmentsTransform } from './transform';

export { conversationFile, openFile, openFiler } from './state';
/** Text of a PDF (or other attachable file), for reading pages fetched from the web */
export { extractText } from './extract';

registerSidebarTab({ id: 'files', label: () => t('files'), icon: 'files', Panel: FilesPanel, onSelect: selectFilesTab });
// The file manager and the file screen load their code when first opened
registerMainView({ kind: 'files', Component: lazyComponent(() => import('./filer/Filer').then((m) => m.Filer)) });
registerMainView({ kind: 'file', Component: lazyComponent(() => import('./components/FileView').then((m) => m.FileView)) });
registerMainView({ kind: 'image', Component: lazyComponent(() => import('./components/ImagePage').then((m) => m.ImagePage)) });
registerComposerAddon({
  id: 'files',
  placement: 'inside',
  Button: AttachButton,
  Above: AttachmentChips,
  hasContent: () => pendingAttachments.value.some((a) => !a.reading),
  collect: async () => ({ attachments: await takeAttachments() }),
  onFiles: (files, conv) => void uploadFiles(files, conv)
});
registerToolView({
  names: FILE_TOOL_NAMES,
  label: fileToolLabel,
  icon: 'file',
  summary: (p) => {
    const d = p.uiDetails as { name?: string } | undefined;
    const i = (p.input ?? {}) as { name?: string; file_id?: string; pattern?: string };
    return d?.name ?? i.name ?? i.file_id ?? i.pattern ?? '';
  },
  doneStatus: (p) => (p.name === 'read_file' ? t('tool.readDone') : undefined),
  Detail: FileToolDetail
});
registerUserMessageExtra(UserAttachments);
registerSettingsTab({ id: 'files', label: () => t('files'), icon: 'files', Component: lazyComponent(() => import('./components/Settings').then((m) => m.FilesSettings)) });
registerMessageTransform(attachmentsTransform);
