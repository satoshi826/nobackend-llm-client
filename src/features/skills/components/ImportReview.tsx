// Reviewing a skill brought in before it is saved: its SKILL.md and every file with its size, each text one readable,
// and for a skill that replaces one of the same name, what changes (the instructions' lines, files added, changed or
// removed). Skills come from others: what they tell a model is read here first
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { Badge, Button, Chevron, Collapse, Icon, Modal, Spinner } from '../../../components/ui';
import { isTextMime, SKILL_MD } from '../../../lib/skills/files';
import type { SkillPackage } from '../../../lib/skills/package';
import { formatBytes } from '../../../lib/i18n';
import { reviewImport, type ImportReview as Review } from '../state';
import { Diff } from './Diff';
import { t } from '../messages';

type Status = 'added' | 'changed' | 'same' | 'removed';

const BADGE: Record<Status, 'green' | 'amber' | 'zinc' | 'rose'> = { added: 'green', changed: 'amber', same: 'zinc', removed: 'rose' };

/** A file of the skill: its path, size and what happens to it; a text one opens to show its content */
function FileRow({ path, bytes, status, text }: { path: string; bytes: number; status?: Status; text?: () => Promise<string> }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<string | null>(null);
  const toggle = () => {
    setOpen(!open);
    if (!content && text) void text().then(setContent);
  };
  const head = (
    <>
      <Icon name="file" class="size-4 shrink-0 text-faint" />
      <span class="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
      {status && <Badge tone={BADGE[status]}>{t(`review.${status}`)}</Badge>}
      <span class="shrink-0 text-xs text-muted tabular-nums">{formatBytes(bytes)}</span>
    </>
  );
  return (
    <li class="px-3 py-2">
      {text ? (
        <button type="button" class="flex w-full items-center gap-2 text-left" aria-expanded={open} data-tip={t('review.showFile', { path })} onClick={toggle}>
          {head}
          <Chevron open={open} />
        </button>
      ) : (
        <div class="flex items-center gap-2">
          {head}
          {/* Space of the chevron, so sizes line up */}
          <span class="w-4 shrink-0" />
        </div>
      )}
      {text && (
        <Collapse open={open} class="pt-2">
          <pre class="max-h-72 overflow-auto rounded-lg bg-sunken p-2 font-mono text-xs leading-5 whitespace-pre-wrap">{content ?? ''}</pre>
        </Collapse>
      )}
    </li>
  );
}

export function ImportReview({ pkg, left, onSave, onSkip }: { pkg: SkillPackage; left: number; onSave(): Promise<void>; onSkip(): void }) {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    setReview(null);
    setError('');
    void reviewImport(pkg).then((r) => alive && setReview(r));
    return () => {
      alive = false;
    };
  }, [pkg]);
  const existing = review?.existing;
  const total = pkg.files.reduce((n, f) => n + f.bytes, 0);
  const save = async () => {
    setBusy(true);
    try {
      await onSave();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  // At the page root: the settings dialog's glass (backdrop-filter) would otherwise hold a fixed layer inside it
  return createPortal(
    <Modal title={existing ? t('review.updateTitle', { name: pkg.draft.name }) : t('review.title', { name: pkg.draft.name })} onClose={onSkip} wide>
      {!review ? (
        <div class="grid place-items-center py-8">
          <Spinner class="size-5" />
        </div>
      ) : (
        <div class="space-y-4 text-sm">
          <p class="rounded-lg bg-warn-soft p-2.5 text-xs text-warn">{t('review.warning')}</p>
          <div>
            <div class="font-mono font-medium">{pkg.draft.name}</div>
            <p class="mt-0.5 text-xs text-muted">{pkg.draft.description}</p>
          </div>
          {existing && (
            <section class="space-y-2">
              <h3 class="text-xs font-semibold text-muted">{t('review.changes')}</h3>
              {existing.description !== pkg.draft.description && (
                <div class="text-xs">
                  <div class="text-muted">{t('description')}</div>
                  <div class="text-danger line-through">{existing.description}</div>
                  <div class="text-ok">{pkg.draft.description}</div>
                </div>
              )}
              <Diff before={existing.body} after={pkg.draft.body} />
            </section>
          )}
          <section class="space-y-2">
            <h3 class="text-xs font-semibold text-muted">{t('review.files', { n: String(pkg.files.length + 1), size: formatBytes(total + new Blob([pkg.skillMd]).size) })}</h3>
            <ul class="divide-y divide-line rounded-xl border border-line bg-glass">
              <FileRow path={SKILL_MD} bytes={new Blob([pkg.skillMd]).size} text={async () => pkg.skillMd} />
              {pkg.files.map((f) => (
                <FileRow key={f.path} path={f.path} bytes={f.bytes} status={existing ? review.status.get(f.path) : undefined} text={isTextMime(f.mime) ? () => f.data.text() : undefined} />
              ))}
              {review.removed.map((f) => (
                <FileRow key={`removed:${f.id}`} path={f.path} bytes={f.bytes} status="removed" />
              ))}
            </ul>
          </section>
          {error && (
            <p role="alert" class="text-xs text-danger">
              {error}
            </p>
          )}
          <div class="flex flex-wrap items-center justify-end gap-2">
            {left > 0 && <span class="mr-auto text-xs text-muted">{t('review.left', { n: String(left) })}</span>}
            <Button variant="outline" onClick={onSkip}>
              {left > 0 ? t('review.skip') : t('cancel')}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => void save()}>
              {busy ? <Spinner /> : <Icon name="check" />}
              {existing ? t('approval.update') : t('review.import')}
            </Button>
          </div>
        </div>
      )}
    </Modal>,
    document.body
  );
}
