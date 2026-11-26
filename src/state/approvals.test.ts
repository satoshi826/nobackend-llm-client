import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { pendingApprovals, resolveApproval, waitForApproval } from './approvals';
import { DEFAULT_SETTINGS, settings } from './settings';
import type { Tool } from '../lib/tools/types';

const tool = (name: string, extra: Partial<Tool> = {}): Tool => ({
  name,
  label: name,
  description: '',
  parameters: {},
  risk: 'network',
  summarize: () => '',
  prepare: (x) => x,
  execute: async () => ({ content: '' }),
  ...extra
});
const ask = (toolCallId: string, t: Tool, signal = new AbortController().signal) => waitForApproval({ toolCallId, tool: t, input: {}, signal });

beforeEach(() => {
  settings.value = DEFAULT_SETTINGS;
  pendingApprovals.value = {};
});

describe('tool approvals', () => {
  it('shows a pending approval until it is answered', async () => {
    const p = ask('c1', tool('web_search'));
    expect(pendingApprovals.value).toEqual({ c1: { toolName: 'web_search', canAlwaysAllow: true } });
    await resolveApproval('c1', { approved: true });
    expect(await p).toEqual({ approved: true });
    expect(pendingApprovals.value).toEqual({});
    expect(settings.value.toolPermissions.web_search).toBe(DEFAULT_SETTINGS.toolPermissions.web_search);
  });

  it('"always allow" sets the tool to allow', async () => {
    const p = ask('c1', tool('generate_image'));
    await resolveApproval('c1', { approved: true, always: true });
    await p;
    expect(settings.value.toolPermissions.generate_image).toBe('allow');
  });

  it('never lets one press always allow tools that must ask or are allowed only in settings', async () => {
    const p1 = ask('c1', tool('save_skill', { alwaysAsk: true }));
    const p2 = ask('c2', tool('fetch_url', { allowOnlyInSettings: true }));
    expect(pendingApprovals.value.c1.canAlwaysAllow).toBe(false);
    expect(pendingApprovals.value.c2.canAlwaysAllow).toBe(false);
    await resolveApproval('c1', { approved: true, always: true });
    await resolveApproval('c2', { approved: true, always: true });
    await Promise.all([p1, p2]);
    expect(settings.value.toolPermissions.save_skill).toBeUndefined();
    expect(settings.value.toolPermissions.fetch_url).toBe('ask');
  });

  it('denies a pending approval when the reply is stopped', async () => {
    const ctrl = new AbortController();
    const p = ask('c1', tool('web_search'), ctrl.signal);
    ctrl.abort();
    expect(await p).toMatchObject({ approved: false });
    expect(pendingApprovals.value).toEqual({});
  });
});
