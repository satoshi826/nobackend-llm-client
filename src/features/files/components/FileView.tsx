// A file in the main area: read, edit, go through versions, download, print (to PDF), use in a chat
import { useEffect, useRef, useState } from 'preact/hooks';
import { currentVersion, extOf } from '../../../lib/db/files';
import type { FileRecord } from '../../../lib/db/schema';
import { conversations, openConversation, showChat } from '../../../state/conversations';
import { showToast, sidebarOpen } from '../../../state/ui';
import { askConfirm } from '../../../components/ConfirmDialog';
import { Markdown } from '../../../components/Markdown';
import { Badge, Button, Icon, IconButton, Select, Spinner, TextField } from '../../../components/ui';
import { MenuItem, MenuSeparator, Popover } from '../../../components/menu';
import { parseDelimited } from '../csv';
import { attachExisting, closeFileView, fileReturnsToChat, openFiler, deleteFiles, downloadFile, filesVersion, getFile, renameFile, restoreVersion, saveUserVersion } from '../state';
import { FileIcon, formatChars, typeLabel } from './common';
import { formatDateTime, formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const BY_KEYS: Record<string, 'by.model' | 'by.user' | 'by.upload'> = { model: 'by.model', user: 'by.user', upload: 'by.upload' };
const byLabel = (by: string) => (BY_KEYS[by] ? t(BY_KEYS[by]) : by);

export function FileView({ id = '' }: { id?: string }) {
  const [f, setF] = useState<FileRecord | null | undefined>(undefined);
  const [viewV, setViewV] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void getFile(id).then((x) => setF(x ?? null));
  }, [id, filesVersion.value]);
  useEffect(() => {
    setViewV(null);
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
            {t('file.back')}
          </Button>
        </div>
      </main>
    );

  const latest = currentVersion(f);
  const shown = (viewV !== null && f.versions.find((v) => v.v === viewV)) || latest;
  const isOld = shown.v !== latest.v;
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
      <header class="glass mx-2 mt-2 flex flex-wrap items-center gap-1 rounded-2xl px-2 py-1.5 sm:mx-3 md:ml-0 md:mr-3 md:mt-0">
        <IconButton class="md:hidden" label={t('menu')} onClick={() => (sidebarOpen.value = true)}>
          <Icon name="menu" />
        </IconButton>
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
            <span class="truncate text-sm font-medium text-ink-strong">{f.name}</span>
          </button>
        )}
        <Badge>{typeLabel(f)}</Badge>
        <span class="hidden text-xs text-muted tabular-nums sm:inline">{formatChars(shown.text.length)}</span>
        <div class="ml-auto flex flex-wrap items-center gap-0.5">
          {f.versions.length > 1 && (
            <label class="flex items-center gap-1 text-xs text-muted">
              <Icon name="history" class="size-3.5" />
              <Select compact
                value={String(shown.v)}
                aria-label={t('file.versionLabel')}
                onChange={(e) => setViewV(Number((e.target as HTMLSelectElement).value))}
              >
                {[...f.versions].reverse().map((v) => (
                  <option key={v.v} value={v.v}>
                    {v.v === latest.v ? t('file.versionLatest', { v: v.v }) : t('version', { v: v.v })} · {formatDateTime(v.at, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {byLabel(v.by)}
                    {v.note ? ` · ${v.note}` : ''}
                  </option>
                ))}
              </Select>
            </label>
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
            onCopy={() => void navigator.clipboard.writeText(shown.text).then(() => showToast(t('file.copied')))}
            onDownload={() => downloadFile(f, shown)}
            onPrint={print}
            source={conv ? { title: conv.title, open: () => void openConversation(conv.id) } : null}
            onDelete={async () => {
              if (await askConfirm({ title: t('file.deleteTitle'), message: t('file.deleteMessage', { name: f.name }), confirmLabel: t('delete'), danger: true })) await deleteFiles([f.id]);
            }}
          />
        </div>
      </header>
      {isOld && !editing && (
        <div class="flex flex-wrap items-center gap-2 mx-2 mt-2 rounded-2xl border border-warn/40 bg-warn-soft px-4 py-2 sm:mx-3 md:ml-0 md:mr-3 text-sm text-warn">
          {t('file.oldVersion', { v: shown.v, latest: latest.v })}
          <Button
            variant="outline"
            class="py-1! text-xs"
            onClick={async () => {
              await restoreVersion(f.id, shown.v);
              setViewV(null);
              showToast(t('file.restored', { v: shown.v }));
            }}
          >
            {t('file.restore')}
          </Button>
          <Button class="text-xs" onClick={() => setViewV(null)}>
            {t('file.showLatest')}
          </Button>
        </div>
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
              disabled={draft === latest.text}
              onClick={async () => {
                await saveUserVersion(f.id, draft);
                setEditing(false);
                setViewV(null);
                showToast(t('file.savedNew'));
              }}
            >
              {t('save')}
            </Button>
          </div>
        </div>
      ) : (
        <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 sm:px-3 md:pl-0 md:pr-3">
          <div ref={body} class="glass rise mx-auto my-3 w-full max-w-3xl rounded-[22px] px-5 py-6 sm:my-4 sm:px-8">
            <FileBody text={shown.text} ext={ext} />
          </div>
        </div>
      )}
    </main>
  );
}

function FileBody({ text, ext }: { text: string; ext: string }) {
  if (ext === 'md' || ext === 'markdown') return <Markdown text={text} />;
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
