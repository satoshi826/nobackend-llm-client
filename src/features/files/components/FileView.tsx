// A file in the main area: read, edit, undo the last change, download, print (to PDF), use in a chat
import { createPortal } from 'preact/compat';
import { useEffect, useRef, useState } from 'preact/hooks';
import { extOf } from '../../../lib/db/files';
import type { FileRecord } from '../../../lib/db/schema';
import { conversations, openConversation, showChat } from '../../../state/conversations';
import { showToast } from '../../../state/ui';
import { askConfirm } from '../../../components/ConfirmDialog';
import { filesVersion } from '../../../state/stored';
import { copyText } from '../../../components/clipboard';
import { Markdown } from '../../../components/Markdown';
import { useDialog } from '../../../components/dialog';
import { PageHeader } from '../../../components/PageHeader';
import { Badge, Button, Icon, IconButton, Modal, Segmented, Spinner, TextField, cx } from '../../../components/ui';
import { SandboxFrame, svgPage } from '../../../components/SandboxFrame';
import { isProblem, type PageLog, type SandboxPage } from '../../../lib/sandbox/client';
import { settings } from '../../../state/settings';
import { MenuItem, MenuSeparator, Popover } from '../../../components/menu';
import { parseDelimited } from '../csv';
import { attachExisting, closeFileView, fileReturnsToChat, openFiler, deleteFiles, downloadFile, fileList, getFile, imageList, pageOf, refreshFiles, refreshImages, renameFile, saveUserText, siteSignature, undoLastChange } from '../state';
import { FileIcon, formatChars, PathName, typeLabel } from './common';
import { formatDateTime, formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const BY_KEYS: Record<string, 'by.model' | 'by.user' | 'by.upload'> = { model: 'by.model', user: 'by.user', upload: 'by.upload' };
const byLabel = (by: string) => (BY_KEYS[by] ? t(BY_KEYS[by]) : by);

export function FileView({ id = '' }: { id?: string }) {
  const [f, setF] = useState<FileRecord | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void getFile(id).then((x) => setF(x ?? null));
  }, [id, filesVersion.value]);
  useEffect(() => {
    setEditing(false);
    setRenaming(false);
  }, [id]);

  if (f === undefined)
    return (
      <main class="grid flex-1 place-items-center text-sm text-muted">
        <Spinner class="size-5" />
      </main>
    );
  if (f === null)
    return (
      <main class="grid flex-1 place-items-center text-sm text-muted">
        <div class="text-center">
          <p>{t('file.notFound')}</p>
          <Button class="mt-3" variant="outline" onClick={closeFileView}>
            <Icon name="chevron-left" />
            {t('file.back')}
          </Button>
        </div>
      </main>
    );

  const shown = f.current;
  const conv = f.conversationId ? conversations.value.find((c) => c.id === f.conversationId) : undefined;
  const ext = extOf(f.name);

  const print = () => {
    const src = body.current;
    if (!src) return;
    // Print a copy of the document alone (the app's own layout clips scrolling content)
    const root = document.createElement('div');
    root.id = 'print-root';
    const h = document.createElement('h1');
    h.textContent = f.name;
    root.append(h, src.cloneNode(true));
    document.body.append(root);
    const done = () => {
      root.remove();
      removeEventListener('afterprint', done);
    };
    addEventListener('afterprint', done);
    window.print();
  };

  return (
    <main class="flex min-w-0 flex-1 flex-col">
      <PageHeader wrap>
        {fileReturnsToChat() ? (
          <IconButton label={t('file.backToChat')} onClick={closeFileView}>
            <Icon name="chevron-left" />
          </IconButton>
        ) : (
          <>
            <button type="button" class="rounded-lg px-2 py-1 text-sm text-muted hover:bg-glass-strong hover:text-ink-strong" onClick={() => openFiler()}>
              {t('files')}
            </button>
            <Icon name="chevron-right" class="size-3.5 shrink-0 text-faint" />
          </>
        )}
        {renaming ? (
          <form
            class="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              setRenaming(false);
              if (name.trim() && name.trim() !== f.name) void renameFile(f.id, name.trim());
            }}
          >
            <TextField compact
              class="w-full"
              value={name}
              autoFocus
              aria-label={t('file.name')}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
            />
          </form>
        ) : (
          <button
            type="button"
            class="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-glass-strong"
            title={t('file.rename')}
            onClick={() => {
              setName(f.name);
              setRenaming(true);
            }}
          >
            <FileIcon f={f} class="size-4 shrink-0 text-muted" />
            <span class="truncate text-sm font-medium text-ink-strong">
              <PathName name={f.name} />
            </span>
          </button>
        )}
        <Badge>{typeLabel(f)}</Badge>
        <span class="hidden text-xs text-muted tabular-nums sm:inline">{formatChars(shown.text.length)}</span>
        <div class="ml-auto flex flex-wrap items-center gap-0.5">
          {f.previous && !editing && (
            <Button
              class="text-sm"
              title={t('file.undoTitle', { by: byLabel(f.previous.by), at: formatDateTime(f.previous.at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}
              onClick={async () => {
                await undoLastChange(f.id);
                showToast(t('file.undone'));
              }}
            >
              <Icon name="history" />
              <span class="hidden sm:inline">{t('file.undo')}</span>
            </Button>
          )}
          <Button
            class="text-sm"
            title={t('useInChatTitle')}
            onClick={() => {
              void attachExisting(f.id);
              showChat();
            }}
          >
            <Icon name="paperclip" />
            <span class="hidden sm:inline">{t('useInChat')}</span>
          </Button>
          {!editing && (
            <Button
              class="text-sm"
              title={t('file.editTitle')}
              onClick={() => {
                setDraft(shown.text);
                setEditing(true);
              }}
            >
              <Icon name="edit" />
              <span class="hidden sm:inline">{t('file.edit')}</span>
            </Button>
          )}
          <MoreMenu
            onCopy={() => void copyText(shown.text, t('file.copied'))}
            onDownload={() => downloadFile(f, shown)}
            onPrint={print}
            source={conv ? { title: conv.title, open: () => void openConversation(conv.id) } : null}
            onDelete={async () => {
              if (await askConfirm({ title: t('file.deleteTitle'), message: t('file.deleteMessage', { name: f.name }), confirmLabel: t('delete'), danger: true })) await deleteFiles([f.id]);
            }}
          />
        </div>
      </PageHeader>
      {f.url && (
        <p class="mx-3 mt-2 flex min-w-0 items-center gap-1.5 text-xs text-muted md:ml-1">
          <Icon name="link" class="size-3.5 shrink-0" />
          {t('fetch.source')}:
          <a href={f.url} target="_blank" rel="noopener noreferrer nofollow" class="truncate underline hover:text-ink">
            {f.url}
          </a>
        </p>
      )}
      {f.source?.startsWith('PDF') && <p class="border-b border-line px-4 py-1.5 text-xs text-muted">{t('file.pdfNote')}</p>}
      {editing ? (
        <div class="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <textarea
            class="glass min-h-0 w-full flex-1 resize-none rounded-[18px] p-4 font-mono text-sm text-ink-strong outline-none focus:border-line-strong"
            value={draft}
            aria-label={t('file.content')}
            onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
          />
          <div class="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>
              {t('cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={draft === shown.text}
              onClick={async () => {
                await saveUserText(f.id, draft);
                setEditing(false);
                showToast(t('file.savedNew'));
              }}
            >
              <Icon name="check" />
              {t('save')}
            </Button>
          </div>
        </div>
      ) : (
        <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 sm:px-3 md:pl-0 md:pr-3">
          <div ref={body} class="glass rise mx-auto my-3 w-full max-w-3xl rounded-[22px] px-5 py-6 sm:my-4 sm:px-8">
            <FileBody file={f} text={shown.text} ext={ext} />
          </div>
        </div>
      )}
    </main>
  );
}

function FileBody({ file, text, ext }: { file: FileRecord; text: string; ext: string }) {
  if (ext === 'md' || ext === 'markdown') return <Markdown text={text} />;
  if (ext === 'html' || ext === 'htm' || ext === 'svg') return <PageBody file={file} text={text} svg={ext === 'svg'} />;
  if (ext === 'csv' || ext === 'tsv') {
    const { rows, truncated } = parseDelimited(text, ext === 'tsv' ? '\t' : ',');
    if (rows.length > 0 && rows.length <= 1000) {
      const [head, ...rest] = rows;
      return (
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-sm">
            <thead>
              <tr>
                {head.map((c, i) => (
                  <th key={i} class="border border-line bg-glass px-2 py-1 text-left font-semibold">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rest.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} class="border border-line px-2 py-1 align-top">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {truncated && <p class="mt-2 text-xs text-muted">{t('file.csvTruncated', { n: formatNumber(1000) })}</p>}
        </div>
      );
    }
  }
  return <pre class="font-mono text-sm break-words whitespace-pre-wrap">{text}</pre>;
}

/**
 * An HTML or SVG file: shown as a page in the sandbox (its scripts run there, without network), or as its code. The
 * page can start again (reload) and open over the whole window (its own run of the page)
 */
/** How each kind of log line is labelled */
const LOG_LABELS: Record<PageLog['level'], () => string> = {
  log: () => 'log',
  info: () => 'info',
  debug: () => 'debug',
  warn: () => 'warn',
  error: () => 'error',
  exception: () => t('file.logException'),
  resource: () => t('file.logResource'),
  csp: () => t('file.logBlocked')
};

function PageBody({ file, text, svg }: { file: FileRecord; text: string; svg: boolean }) {
  const [view, setView] = useState<'preview' | 'code'>(settings.value.htmlFilePreview ? 'preview' : 'code');
  const [run, setRun] = useState(0);
  const [full, setFull] = useState(false);
  const page = svg ? svgPage(text) : text;
  // The files of its site, for references by relative path, and its localStorage. Loaded again when the site's files
  // or images change, but not when the page itself saved its localStorage (it already has that)
  const [files, setFiles] = useState<SandboxPage | undefined>(undefined);
  useEffect(() => {
    void refreshFiles();
    void refreshImages();
  }, []);
  // Waits for both lists, so the page is not shown once before they arrive and again after
  const ready = !!fileList.value && !!imageList.value;
  const signature = siteSignature(file);
  useEffect(() => {
    if (svg || !ready) return;
    let alive = true;
    void pageOf(file).then((x) => alive && setFiles(x));
    return () => {
      alive = false;
    };
  }, [file.id, file.name, signature, svg, ready]);
  // What the shown page logged and what went wrong on it, for its current render
  const [log, setLog] = useState<{ render: string; entries: PageLog[] }>({ render: '', entries: [] });
  const onLog = (entries: PageLog[], render: string) =>
    setLog((prev) => (prev.render === render ? { render, entries: [...prev.entries, ...entries].slice(-500) } : { render, entries }));
  const [logOpen, setLogOpen] = useState(false);
  const problems = log.entries.filter(isProblem).length;
  return (
    <div class="space-y-2">
      <div class="flex flex-wrap items-center gap-2">
        <Segmented
          label={t('file.viewAs')}
          items={[
            { id: 'preview', label: t('file.preview'), icon: 'eye' },
            { id: 'code', label: t('file.code'), icon: 'code' }
          ]}
          value={view}
          onChange={setView}
        />
        {view === 'preview' && <span class="min-w-0 flex-1 text-xs text-muted">{t('file.sandboxNote')}</span>}
        {view === 'preview' && (
          <div class="ml-auto flex items-center gap-0.5">
            {log.entries.length > 0 && (
              <button
                type="button"
                class={cx('flex items-center gap-1 rounded-full px-2 py-1 text-xs tabular-nums hover:bg-glass-strong', problems ? 'text-danger' : 'text-muted hover:text-ink')}
                title={t('file.logTitle')}
                onClick={() => setLogOpen(true)}
              >
                <Icon name={problems ? 'info' : 'code'} class="size-3.5" />
                {problems ? t('file.problems', { n: formatNumber(problems) }) : t('file.logs', { n: formatNumber(log.entries.length) })}
              </button>
            )}
            <IconButton label={t('file.reload')} onClick={() => setRun(run + 1)}>
              <Icon name="refresh" />
            </IconButton>
            <IconButton label={t('file.fillWindow')} onClick={() => setFull(true)}>
              <Icon name="expand" />
            </IconButton>
          </div>
        )}
      </div>
      {view === 'preview' ? (
        svg || files ? (
          <SandboxFrame key={run} html={page} page={files} title={t('file.preview')} class="h-[70vh]" onLog={onLog} />
        ) : (
          // Shown once its files are here, so it does not render twice
          <div class="grid h-[70vh] place-items-center rounded-xl border border-line">
            <Spinner class="size-5 text-faint" />
          </div>
        )
      ) : (
        <pre class="font-mono text-sm break-words whitespace-pre-wrap">{text}</pre>
      )}
      {full && <FullPage html={page} page={files} onClose={() => setFull(false)} />}
      {logOpen && (
        <Modal title={t('file.logTitle')} onClose={() => setLogOpen(false)} wide>
          <ul class="max-h-[60vh] space-y-1 overflow-y-auto font-mono text-xs">
            {log.entries.map((l, i) => (
              <li key={i} class={cx('flex gap-2 rounded-md px-2 py-1 break-all whitespace-pre-wrap', isProblem(l) ? 'bg-danger-soft text-danger' : l.level === 'warn' ? 'bg-warn-soft text-warn' : 'text-ink')}>
                <span class="shrink-0 opacity-70">{LOG_LABELS[l.level]()}</span>
                <span class="min-w-0">{l.text}</span>
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

/**
 * The page filling the whole window, its buttons floating over its top right corner. Rendered at the page root: the
 * file panel's glass (backdrop-filter) would otherwise hold a fixed layer inside it
 */
function FullPage({ html, page, onClose }: { html: string; page?: SandboxPage; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [run, setRun] = useState(0);
  useDialog(ref, { onClose, active: true });
  return createPortal(
    <div ref={ref} class="fixed inset-0 z-[70] bg-white" role="dialog" aria-modal="true" aria-label={t('file.preview')}>
      {/* First in the layer, so focus starts on a button: keys pressed inside the page's frame never reach the app (Esc) */}
      <div class="absolute top-[max(0.5rem,env(safe-area-inset-top))] right-2 z-10 flex items-center gap-0.5 rounded-full bg-black/60 p-0.5 text-white backdrop-blur-sm">
        <IconButton class="text-white hover:bg-glass" label={t('file.reload')} onClick={() => setRun(run + 1)}>
          <Icon name="refresh" />
        </IconButton>
        <IconButton class="text-white hover:bg-glass" label={t('file.closeFill')} onClick={onClose} data-dialog-close data-autofocus>
          <Icon name="x" />
        </IconButton>
      </div>
      <SandboxFrame key={run} html={html} page={page} title={t('file.preview')} class="h-full rounded-none! border-0!" />
    </div>,
    document.body
  );
}

/** The less frequent actions of a file, with delete set apart at the end */
function MoreMenu({ onCopy, onDownload, onPrint, source, onDelete }: { onCopy(): void; onDownload(): void; onPrint(): void; source: { title: string; open(): void } | null; onDelete(): void }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const item = (icon: Parameters<typeof Icon>[0]['name'], run: () => void) => ({ icon: <Icon name={icon} class="mt-0.5 size-4 shrink-0 text-muted" />, onSelect: () => (setOpen(false), run()) });
  return (
    <span ref={anchor}>
      <IconButton label={t('file.more')} aria-haspopup="menu" aria-expanded={open} class={open ? 'bg-glass-strong' : undefined} onClick={() => setOpen(!open)}>
        <Icon name="more" />
      </IconButton>
      {open && (
        <Popover anchor={anchor.current} onClose={() => setOpen(false)} placement="bottom-end" label={t('file.more')} class="w-60">
          <MenuItem {...item('copy', onCopy)}>{t('file.copyTitle')}</MenuItem>
          <MenuItem {...item('download', onDownload)}>{t('download')}</MenuItem>
          <MenuItem {...item('printer', onPrint)}>{t('file.print')}</MenuItem>
          {source && (
            <MenuItem {...item('chat', source.open)}>
              <span class="block truncate">{t('file.openSourceTitle', { title: source.title })}</span>
            </MenuItem>
          )}
          <MenuSeparator />
          <MenuItem icon={<Icon name="trash" class="mt-0.5 size-4 shrink-0" />} class="text-danger! hover:bg-danger-soft! focus-visible:bg-danger-soft!" onSelect={() => (setOpen(false), onDelete())}>
            {t('file.deleteTitle')}
          </MenuItem>
        </Popover>
      )}
    </span>
  );
}
