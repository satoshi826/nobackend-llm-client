// Input box pieces: the attach button (device / saved files) and the list of attached files
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Conversation, FileRecord } from '../../../lib/db/schema';
import { Button, Icon, Modal, SearchField, Spinner, cx } from '../../../components/ui';
import { MenuItem, Popover } from '../../../components/menu';
import { ATTACH_INLINE_CHARS, attachExisting, detach, fileList, pendingAttachments, refreshFiles, uploadFiles } from '../state';
import { formatChars, formatDate, FileIcon, typeLabel } from './common';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

const ACCEPT = '.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.xml,.html,.htm,.yaml,.yml,.toml,.log,.pdf,.js,.ts,.tsx,.jsx,.py,.go,.rs,.java,.c,.cpp,.cs,.php,.rb,.sh,.sql,.css,.srt,.vtt,text/*,application/pdf,application/json';

export function AttachButton({ conv }: { conv: Conversation }) {
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const n = pendingAttachments.value.length;
  return (
    <div class="relative" ref={wrap}>
      <Button
        aria-haspopup="menu"
        aria-expanded={menu}
        aria-label={n ? t('attach.buttonCount', { n }) : t('attach.button')}
        title={t('attach.title')}
        class={cx('relative rounded-full! p-2! text-muted hover:text-ink', n > 0 && 'text-ink-strong')}
        onClick={() => setMenu(!menu)}
      >
        <Icon name="paperclip" class="size-4" />
        {n > 0 && (
          <span class="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-accent text-[10px] font-semibold text-accent-ink tabular-nums">{n}</span>
        )}
      </Button>
      {menu && (
        <Popover anchor={wrap.current} onClose={() => setMenu(false)} label={t('attach.title')} class="w-56">
          <MenuItem
            icon={<Icon name="upload" class="mt-0.5 size-4 shrink-0" />}
            onSelect={() => {
              setMenu(false);
              input.current?.click();
            }}
          >
            {t('attach.fromDevice')}
          </MenuItem>
          <MenuItem
            icon={<Icon name="files" class="mt-0.5 size-4 shrink-0" />}
            onSelect={() => {
              setMenu(false);
              setPicker(true);
            }}
          >
            {t('attach.fromSaved')}
          </MenuItem>
        </Popover>
      )}
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        class="hidden"
        onChange={(e) => {
          const el = e.target as HTMLInputElement;
          const files = [...(el.files ?? [])];
          el.value = '';
          if (files.length) void uploadFiles(files, conv);
        }}
      />
      {picker && <FilePicker onClose={() => setPicker(false)} />}
    </div>
  );
}

/** Choose files already in the Files tab */
function FilePicker({ onClose }: { onClose(): void }) {
  const [q, setQ] = useState('');
  useEffect(() => {
    void refreshFiles();
  }, []);
  const list = fileList.value;
  const ql = q.trim().toLowerCase();
  const shown = (list ?? []).filter((f) => !ql || f.name.toLowerCase().includes(ql));
  const picked = new Set(pendingAttachments.value.map((a) => a.fileId));
  return (
    <Modal fixed title={t('picker.title')} onClose={onClose}>
      <SearchField class="mb-3" placeholder={t('picker.filter')} label={t('picker.filter')} value={q} onInput={setQ} />
      {!list ? (
        <p class="flex items-center gap-2 text-sm text-muted">
          <Spinner class="size-4" />
          {t('loading')}
        </p>
      ) : shown.length === 0 ? (
        <p class="text-sm text-muted">{list.length ? t('picker.noMatch') : t('picker.empty')}</p>
      ) : (
        <ul class="space-y-1">
          {shown.map((f: FileRecord) => (
            <li key={f.id}>
              <button
                type="button"
                disabled={picked.has(f.id)}
                class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-glass disabled:opacity-50"
                onClick={() => {
                  void attachExisting(f.id);
                  onClose();
                }}
              >
                <FileIcon f={f} class="size-4 shrink-0 text-muted" />
                <span class="min-w-0 flex-1 truncate">{f.name}</span>
                <span class="shrink-0 text-xs text-muted tabular-nums">
                  {typeLabel(f)} · {formatChars(f.size)} · {formatDate(f.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Attached files shown above the text area */
export function AttachmentChips() {
  const list = pendingAttachments.value;
  if (!list.length) return null;
  return (
    <div class="flex flex-wrap gap-1 px-3 pt-2.5">
      {list.map((a) => (
        <span
          key={a.fileId}
          class="inline-flex max-w-full items-center gap-1 rounded-full border border-line bg-glass-strong py-0.5 pr-1 pl-2 text-xs text-ink"
          title={a.chars && a.chars > ATTACH_INLINE_CHARS ? t('attach.long', { n: formatNumber(ATTACH_INLINE_CHARS) }) : undefined}
        >
          {a.reading ? <Spinner class="size-3" /> : <Icon name="paperclip" class="size-3" />}
          <span class="truncate">{a.name}</span>
          {a.chars !== undefined && <span class="text-muted tabular-nums">{formatChars(a.chars)}</span>}
          <button type="button" aria-label={t('attach.remove', { name: a.name })} title={t('attach.remove', { name: a.name })} class="rounded-full p-0.5 hover:bg-glass-strong" onClick={() => detach(a.fileId)}>
            <Icon name="x" class="size-3" />
          </button>
        </span>
      ))}
    </div>
  );
}
