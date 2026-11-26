// Tool call display (running, result, error, denied), and the approval card while awaiting approval.
// What is shown for each tool (label, icon, summary, details, approval note) comes from the tool views features register.
import { useState } from 'preact/hooks';
import { pendingApprovals, resolveApproval } from '../state/approvals';
import { Button, Chevron, Collapse, Icon, Shimmer, Spinner, TextArea, TextField, cx } from './ui';
import { textOf, toolViewFor, type ToolPart } from './extensions';
import { sentences, t } from './messages';

const labelOf = (name: string) => toolViewFor(name)?.label?.(name) ?? name;

function summary(p: ToolPart): string {
  const view = toolViewFor(p.name);
  const custom = view?.summary?.(p);
  if (custom !== undefined) return custom;
  const key = view?.editableField?.key;
  const v = key ? (p.input as Record<string, unknown> | undefined)?.[key] : undefined;
  return typeof v === 'string' ? v : p.argsText;
}

function ApprovalCard({ p }: { p: ToolPart }) {
  const pending = pendingApprovals.value[p.toolCallId];
  const view = toolViewFor(p.name);
  const field = view?.editableField;
  const [value, setValue] = useState(summary(p));
  const [reason, setReason] = useState('');
  if (!pending) return null;
  const edited = field && value !== summary(p) ? { ...((p.input ?? {}) as object), [field.key]: value } : undefined;
  const note = view?.approvalNote?.(p) ?? '';
  return (
    <div role="group" aria-label={t('tool.approvalLabel')} class="my-2 rounded-lg border border-accent bg-accent-soft p-3 text-sm">
      <div class="mb-2 flex items-center gap-1.5 font-medium">
        <Icon name={view?.icon ?? 'wrench'} class="size-4" />
        {t('tool.askRun', { tool: labelOf(p.name) })}
      </div>
      {field ? (
        // Wrapped in full (a long address must not hide its end); one line of text, so Enter adds no line break
        <TextArea
          rows={1}
          class="block w-full resize-none font-mono break-all [field-sizing:content]"
          value={value}
          onInput={(e) => setValue((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          aria-label={t('tool.editableLabel', { label: textOf(field.label) })}
        />
      ) : (
        <pre class="overflow-x-auto rounded bg-glass p-2 text-xs">{p.argsText}</pre>
      )}
      <p class="mt-1.5 text-xs text-muted">
        {sentences(note, !!field && t('tool.editableNote'))}
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => resolveApproval(p.toolCallId, { approved: true, input: edited })}>
          <Icon name="check" />
          {t('tool.run')}
        </Button>
        {pending.canAlwaysAllow && (
          <Button variant="outline" onClick={() => resolveApproval(p.toolCallId, { approved: true, always: true, input: edited })} title={t('tool.alwaysAllowTitle', { tool: labelOf(p.name) })}>
            <Icon name="check" />
            {t('tool.alwaysAllow')}
          </Button>
        )}
        <Button variant="outline" onClick={() => resolveApproval(p.toolCallId, { approved: false, reason: reason || undefined })}>
          <Icon name="x" />
          {t('tool.deny')}
        </Button>
        <TextField compact
          class="min-w-0 flex-1"
          placeholder={t('tool.reasonPlaceholder')}
          value={reason}
          onInput={(e) => setReason((e.target as HTMLInputElement).value)}
        />
      </div>
    </div>
  );
}

export function ToolCallCard({ p, live, owner }: { p: ToolPart; live: boolean; owner?: { conversationId: string; messageId: string } }) {
  const [open, setOpen] = useState(false);
  const view = toolViewFor(p.name);
  if (p.state === 'approval-requested' && live && pendingApprovals.value[p.toolCallId]) {
    const Approval = view?.Approval ?? ApprovalCard;
    return <Approval p={p} />;
  }
  let status: string;
  let tone = 'text-muted';
  switch (p.state) {
    case 'input-streaming':
      status = t('tool.preparing');
      break;
    case 'input-available':
      status = live ? t('tool.running') : t('tool.interrupted');
      break;
    case 'approval-requested':
      status = t('tool.interruptedAwaiting');
      break;
    case 'output-available':
      status = view?.doneStatus?.(p) ?? t('tool.done');
      break;
    case 'output-denied':
      status = p.approval?.auto ? t('tool.forbidden') : t('tool.denied');
      tone = 'text-warn';
      break;
    default:
      status = t('tool.error');
      tone = 'text-danger';
  }
  const hasDetails = !!p.error || !!p.approval?.reason;
  const running = live && (p.state === 'input-available' || p.state === 'input-streaming');
  const Detail = view?.Detail;
  return (
    <div class="my-1.5 rounded-lg border border-line text-xs">
      {hasDetails ? (
        <button type="button" class="flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-left hover:bg-glass-strong" onClick={() => setOpen(!open)} aria-expanded={open}>
          {running ? <Spinner class="size-3.5 text-accent-text" /> : <Icon name={view?.icon ?? 'wrench'} class="size-3.5 shrink-0" />}
          <span class="shrink-0 font-medium">{labelOf(p.name)}</span>
          <span class="min-w-0 truncate text-muted">{summary(p)}</span>
          <span class={cx('ml-auto shrink-0', tone)}>{running ? <Shimmer>{status}</Shimmer> : status}</span>
          {hasDetails && <Chevron open={open} />}
        </button>
      ) : (
        <div class="flex w-full items-center gap-1.5 px-3 py-1.5">
          {running ? <Spinner class="size-3.5 text-accent-text" /> : <Icon name={view?.icon ?? 'wrench'} class="size-3.5 shrink-0" />}
          <span class="shrink-0 font-medium">{labelOf(p.name)}</span>
          <span class="min-w-0 truncate text-muted">{summary(p)}</span>
          <span class={cx('ml-auto shrink-0', tone)}>{running ? <Shimmer>{status}</Shimmer> : status}</span>
          {hasDetails && <Chevron open={open} />}
        </div>
      )}
      {Detail && <Detail p={p} live={live} owner={owner} />}
      <Collapse open={open} class="border-t border-line px-3 py-2">
        {p.error && <p class="text-danger">{p.error}</p>}
        {p.approval?.reason && <p class="text-muted">{t('tool.reason', { reason: p.approval.reason })}</p>}
      </Collapse>
    </div>
  );
}
