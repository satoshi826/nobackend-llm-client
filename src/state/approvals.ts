// Tool calls waiting for the user's approval
import { signal } from '@preact/signals';
import { type ApprovalDecision, type ApprovalRequest } from '../lib/chat/runner';
import { saveSettings, settings } from './settings';
import { t } from './messages';

// ---- Pending tool approvals ----
export const pendingApprovals = signal<Record<string, { toolName: string; alwaysAsk: boolean }>>({});
const approvalResolvers = new Map<string, (d: ApprovalDecision) => void>();

export function waitForApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    const done = (d: ApprovalDecision) => {
      approvalResolvers.delete(req.toolCallId);
      const next = { ...pendingApprovals.value };
      delete next[req.toolCallId];
      pendingApprovals.value = next;
      resolve(d);
    };
    approvalResolvers.set(req.toolCallId, done);
    pendingApprovals.value = { ...pendingApprovals.value, [req.toolCallId]: { toolName: req.tool.name, alwaysAsk: !!req.tool.alwaysAsk } };
    req.signal.addEventListener('abort', () => done({ approved: false, reason: t('approval.stopped') }), { once: true });
  });
}

/** Answer from the approval card. "Always allow" sets that tool's setting to allow */
export async function resolveApproval(toolCallId: string, d: ApprovalDecision) {
  const p = pendingApprovals.value[toolCallId];
  if (d.approved && d.always && p && !p.alwaysAsk) await saveSettings({ toolPermissions: { ...settings.value.toolPermissions, [p.toolName]: 'allow' } });
  approvalResolvers.get(toolCallId)?.(d);
}
