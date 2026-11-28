// A skill's files in its edit view: listed by path with their sizes, renamed or moved by path, deleted, a text one
// opened and edited, new ones added by the picker or by dropping files and folders. Nothing is saved until the skill is
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { createPortal, memo } from 'preact/compat';
import { askConfirm } from '../../../components/ConfirmDialog';
import { Button, Icon, IconButton, Modal, TextArea, TextField, cx, useInPlace } from '../../../components/ui';
import { showToast } from '../../../state/ui';
import { cleanSkillPath, freeSkillPath, isTextMime, MAX_SKILL_FILE_BYTES, skillFileMime, skillFilesProblem } from '../../../lib/skills/files';
import type { ImportSource } from '../../../lib/skills/package';
import { pathKey } from '../../../lib/paths';
import { formatBytes } from '../../../lib/i18n';
import { droppedSources, pickedSources } from '../sources';
import { readSkillFileData } from '../../../lib/db/skills';
import { t } from '../messages';

/** A file in the edit view: one the skill has (id, unless its bytes changed), or new bytes (data) */
export interface DraftFile {
  path: string;
  mime: string;
  bytes: number;
  id?: string;
  data?: Blob;
}

/** A draft file's bytes: its new ones, else the stored ones */
const bytesOf = async (f: DraftFile): Promise<Blob> => f.data ?? (await readSkillFileData(f.id!)) ?? new Blob([]);

/** The text of a file, in a dialog: changed text replaces the file's bytes in the draft */
function TextFileDialog({ file, onApply, onClose }: { file: DraftFile; onApply(text: string): void; onClose(): void }) {
  const [text, setText] = useState<{ was: string; now: string } | null>(null);
  useEffect(() => {
    let alive = true;
    void bytesOf(file).then(async (b) => {
      const s = await b.text();
      if (alive) setText({ was: s, now: s });
    });
    return () => {
      alive = false;
    };
  }, [file]);
  // At the page root: the settings dialog's glass (backdrop-filter) would otherwise hold a fixed layer inside it
  return createPortal(
    <Modal title={file.path} onClose={onClose} wide>
      {text && (
        <div class="space-y-3">
          <TextArea
            compact
            class="block w-full font-mono leading-5"
            rows={18}
            aria-label={t('files.text')}
            value={text.now}
            onInput={(e) => setText({ ...text, now: (e.target as HTMLTextAreaElement).value })}
          />
          <p class="text-xs text-muted">{t('files.textHelp')}</p>
          <div class="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('cancel')}
            </Button>
            <Button variant="primary" disabled={text.now === text.was} onClick={() => onApply(text.now)}>
              <Icon name="check" />
              {t('files.apply')}
            </Button>
          </div>
        </div>
      )}
    </Modal>,
    document.body
  );
}

const FileRow = memo(function FileRow({ f, onOpen, onRename, onDelete }: { f: DraftFile; onOpen(f: DraftFile): void; onRename(f: DraftFile, path: string): string | null; onDelete(f: DraftFile): void }) {
  const rename = useInPlace<HTMLButtonElement>();
  const [path, setPath] = useState(f.path);
  const [error, setError] = useState('');
  const commit = () => {
    const problem = onRename(f, path);
    if (problem) setError(problem);
    else rename.close(true);
  };
  return (
    <li class="px-3 py-2">
      <div class="flex items-center gap-2">
        <Icon name="file" class="size-4 shrink-0 text-faint" />
        {rename.open ? (
          <TextField
            compact
            autoFocus
            class="min-w-0 flex-1 font-mono"
            aria-label={t('files.pathLabel')}
            value={path}
            onInput={(e) => {
              setPath((e.target as HTMLInputElement).value);
              setError('');
            }}
            onKeyDown={(e) => e.key === 'Enter' && commit()}
            onBlur={() => rename.close()}
          />
        ) : (
          <span class="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
        )}
        <span class="shrink-0 text-xs text-muted tabular-nums">{formatBytes(f.bytes)}</span>
        <div class="flex shrink-0 items-center">
          {isTextMime(f.mime) && (
            <IconButton label={t('files.openAria', { path: f.path })} title={t('files.open')} onClick={() => onOpen(f)}>
              <Icon name="eye" class="size-4" />
            </IconButton>
          )}
          <IconButton
            ref={rename.control}
            label={t('files.renameAria', { path: f.path })}
            title={t('files.rename')}
            onClick={() => {
              setPath(f.path);
              setError('');
              rename.show();
            }}
          >
            <Icon name="edit" class="size-4" />
          </IconButton>
          <IconButton label={t('files.deleteAria', { path: f.path })} title={t('delete')} variant="remove" onClick={() => onDelete(f)}>
            <Icon name="trash" class="size-4" />
          </IconButton>
        </div>
      </div>
      {rename.open && error && (
        <p role="alert" class="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </li>
  );
});

export function SkillFiles({ files, onChange }: { files: DraftFile[]; onChange(files: DraftFile[]): void }) {
  const [folder, setFolder] = useState('');
  const [over, setOver] = useState(false);
  const [open, setOpen] = useState<DraftFile | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  // The latest list, for the handlers of rows that are not drawn again
  const latest = useRef(files);
  latest.current = files;
  const problem = useMemo(() => skillFilesProblem(files), [files]);

  const add = async (sources: ImportSource[]) => {
    let into = '';
    try {
      into = folder.trim() ? `${cleanSkillPath(folder)}/` : '';
    } catch (e) {
      showToast((e as Error).message, 'error');
      return;
    }
    const next = [...latest.current];
    const taken = new Set(next.map((f) => pathKey(f.path)));
    const errors: string[] = [];
    for (const s of sources) {
      try {
        if (s.file.size > MAX_SKILL_FILE_BYTES) throw new Error(t('files.tooBig', { max: formatBytes(MAX_SKILL_FILE_BYTES) }));
        const path = freeSkillPath(cleanSkillPath(into + s.path), taken);
        taken.add(pathKey(path));
        next.push({ path, mime: await skillFileMime(path, s.file), bytes: s.file.size, data: s.file });
      } catch (e) {
        errors.push(t('files.addError', { name: s.path, error: (e as Error).message }));
      }
    }
    onChange(next.sort((a, b) => a.path.localeCompare(b.path)));
    if (errors.length) showToast(errors.join(' / '), 'error');
  };

  const rename = (f: DraftFile, raw: string): string | null => {
    let path: string;
    try {
      path = cleanSkillPath(raw);
    } catch (e) {
      return (e as Error).message;
    }
    const next = latest.current.map((x) => (x === f ? { ...x, path } : x)).sort((a, b) => a.path.localeCompare(b.path));
    const problem = skillFilesProblem(next);
    if (problem) return problem;
    onChange(next);
    return null;
  };

  const remove = (f: DraftFile) =>
    void askConfirm({ title: t('files.deleteTitle'), message: t('files.deleteMessage', { path: f.path }), confirmLabel: t('delete'), danger: true }).then((ok) => {
      if (ok) onChange(latest.current.filter((x) => x !== f));
    });

  const apply = (f: DraftFile, text: string) => {
    const data = new Blob([text], { type: f.mime });
    onChange(latest.current.map((x) => (x === f ? { path: f.path, mime: f.mime, bytes: data.size, data } : x)));
    setOpen(null);
  };

  return (
    <section class="space-y-2" aria-label={t('files.title')}>
      <div>
        <div class="text-sm">{t('files.title')}</div>
        <p class="mt-0.5 text-xs text-muted">{t('files.help')}</p>
      </div>
      {files.length > 0 && (
        <ul class="divide-y divide-line rounded-xl border border-line bg-glass">
          {files.map((f) => (
            <FileRow key={f.id ?? f.path} f={f} onOpen={setOpen} onRename={rename} onDelete={remove} />
          ))}
        </ul>
      )}
      {problem && (
        <p role="alert" class="text-xs text-danger">
          {problem}
        </p>
      )}
      <div
        class={cx('flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3 transition', over ? 'border-line-strong bg-glass-strong' : 'border-line')}
        // Dropped here, files join this skill: the tab around takes a drop as skills to import
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          if (e.dataTransfer) void droppedSources(e.dataTransfer).then(add);
        }}
      >
        <TextField compact class="w-40 min-w-0 flex-1 font-mono sm:flex-none" aria-label={t('files.folderLabel')} placeholder={t('files.folderPlaceholder')} value={folder} onInput={(e) => setFolder((e.target as HTMLInputElement).value)} />
        <Button variant="outline" onClick={() => picker.current?.click()}>
          <Icon name="upload" class="size-4" />
          {t('files.add')}
        </Button>
        <span class="text-xs text-muted">{t('files.dropHint')}</span>
        <input
          ref={picker}
          type="file"
          multiple
          class="hidden"
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            if (input.files?.length) void add(pickedSources(input.files));
            input.value = '';
          }}
        />
      </div>
      {open && <TextFileDialog file={open} onApply={(text) => apply(open, text)} onClose={() => setOpen(null)} />}
    </section>
  );
}
