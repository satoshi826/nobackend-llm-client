// A collapsible row with an account's key status (used for LLM providers and services such as search)
import type { ComponentChildren } from 'preact';
import { keyStatus } from '../../state/keys';
import { accountById } from '../../lib/keys/accounts';
import { Badge, Chevron, Collapse } from '../ui';
import { t } from './messages';

function KeyBadge({ id }: { id: string }) {
  const k = keyStatus(id);
  if (k.present) return <Badge tone={k.locked ? 'amber' : 'green'}>{k.locked ? t('account.locked') : t('account.keySet')}</Badge>;
  return <Badge>{accountById(id)?.keyOptional ? t('account.noKeyNeeded') : t('account.noKey')}</Badge>;
}

/** Collapsible key settings row */
export function AccountRow(props: { id: string; title: string; host: string; open: boolean; onToggle(): void; right?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="rounded-lg border border-line">
      <div class="flex items-center gap-2 px-3 py-2">
        <button type="button" class="-mx-1.5 flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-0.5 text-left hover:bg-glass-strong" onClick={props.onToggle} aria-expanded={props.open}>
          <span class="font-medium">{props.title}</span>
          <span class="truncate text-xs text-muted">{props.host}</span>
          <KeyBadge id={props.id} />
          <Chevron open={props.open} class="ml-auto" />
        </button>
        {props.right}
      </div>
      <Collapse open={props.open} class="border-t border-line p-3">
        {props.children}
      </Collapse>
    </div>
  );
}

