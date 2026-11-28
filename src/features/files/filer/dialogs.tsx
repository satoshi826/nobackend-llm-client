// The file manager's dialogs: a name to give, and where to move entries
import { useState } from 'preact/hooks';
import { cleanFolderName } from '../../../lib/paths';
import { Button, Icon, Modal, TextField } from '../../../components/ui';
import { formatNumber } from '../../../lib/i18n';
import { t } from '../messages';

/** A name to give: a folder's new path, a file's or image's new name, or a new folder's name */
export function RenameDialog({ title, label, note, initial, onClose, onSave }: { title: string; label: string; note?: string; initial: string; onClose(): void; onSave(value: string): Promise<boolean> }) {
  const [value, setValue] = useState(initial);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        class="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await onSave(value)) onClose();
        }}
      >
        <label class="block space-y-1 text-xs text-muted">
          <span>{label}</span>
          <TextField class="w-full" value={value} onInput={(e) => setValue(e.currentTarget.value)} autoFocus />
        </label>
        {note && <p class="text-xs text-muted">{note}</p>}
        <div class="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={!value.trim() || value.trim() === initial}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Where to move the chosen entries: a folder that exists, the top, or a new one */
export function MoveDialog({ folders, count, onClose, onMove }: { folders: string[]; count: number; onClose(): void; onMove(folder: string): Promise<void> }) {
  const [fresh, setFresh] = useState('');
  const row = 'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-glass';
  return (
    <Modal fixed title={t('filer.moveTo', { n: formatNumber(count) })} onClose={onClose}>
      <ul class="max-h-[50vh] space-y-0.5 overflow-y-auto">
        <li>
          <button type="button" class={row} onClick={() => void onMove('')}>
            <Icon name="files" class="size-4 shrink-0 text-muted" />
            {t('folder.top')}
          </button>
        </li>
        {folders.map((f) => (
          <li key={f}>
            <button type="button" class={row} onClick={() => void onMove(f)}>
              <Icon name="folder" class="size-4 shrink-0 text-muted" />
              <span class="truncate">{f.slice(0, -1)}</span>
            </button>
          </li>
        ))}
      </ul>
      <form
        class="mt-3 flex items-end gap-2 border-t border-line pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          const f = cleanFolderName(fresh);
          if (f) void onMove(f);
        }}
      >
        <label class="min-w-0 flex-1 space-y-1 text-xs text-muted">
          <span>{t('filer.moveNew')}</span>
          <TextField class="w-full" value={fresh} onInput={(e) => setFresh(e.currentTarget.value)} placeholder="my-folder" />
        </label>
        <Button variant="primary" type="submit" disabled={!cleanFolderName(fresh)}>
          {t('filer.move')}
        </Button>
      </form>
    </Modal>
  );
}
