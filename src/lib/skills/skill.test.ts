import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { parseSkillMd, serializeSkillMd, skillCatalog, validateSkill, withAttachedSkills, withSkillCatalog } from './skill';
import { makeSkillTool } from '../tools/skill';
import { buildRequestMessages } from '../chat/request';
import type { MessageRecord, Skill } from '../db/schema';
import { db } from '../db/schema';
import { exportAll, importAll, validate } from '../db/export';

const ctx = { signal: new AbortController().signal, transport: { fetch: () => Promise.reject(new Error('no network')) }, authFor: () => undefined } as any;

describe('SKILL.md', () => {
  it('reads name, description and body (Claude format)', () => {
    const s = parseSkillMd(`---\nname: pdf-summary\ndescription: Summarize PDFs. Use when the user shares a PDF.\nlicense: MIT\n---\n\n# PDF summary\n\n1. Read it\n`);
    expect(s).toEqual({ name: 'pdf-summary', description: 'Summarize PDFs. Use when the user shares a PDF.', body: '# PDF summary\n\n1. Read it', modelInvocable: true });
  });
  it('handles quotes, folded blocks, BOM, CRLF and disable-model-invocation', () => {
    const md = '﻿---\r\nname: "deploy"\r\ndescription: >\r\n  Deploy the app.\r\n  Only when asked.\r\ndisable-model-invocation: true\r\n---\r\nRun it.\r\n';
    const s = parseSkillMd(md);
    expect(s.name).toBe('deploy');
    expect(s.description).toBe('Deploy the app. Only when asked.');
    expect(s.body).toBe('Run it.');
    expect(s.modelInvocable).toBe(false);
  });
  it('rejects files without frontmatter', () => {
    expect(() => parseSkillMd('# just markdown')).toThrow();
  });
  it('round-trips through serialize', () => {
    const d = { name: 'x-y', description: 'Says "hi": always', body: '## Steps\n- a', modelInvocable: false };
    expect(parseSkillMd(serializeSkillMd(d))).toEqual(d);
  });
  it('validates names and required fields', () => {
    const ok = { name: 'code-review', description: 'd', body: 'b', modelInvocable: true };
    expect(validateSkill(ok)).toBeNull();
    expect(validateSkill({ ...ok, name: 'Code Review' })).not.toBeNull();
    expect(validateSkill({ ...ok, name: '-x' })).not.toBeNull();
    expect(validateSkill({ ...ok, description: ' ' })).not.toBeNull();
    expect(validateSkill({ ...ok, body: '' })).not.toBeNull();
  });
});

describe('skills sent to the model', () => {
  it('catalog lists only names and descriptions', () => {
    const cat = skillCatalog([{ name: 'a', description: 'does A\nwell' }]);
    expect(cat).toContain('- a: does A well');
    expect(cat).toContain('load_skill');
    expect(withSkillCatalog('', [])).toBe('');
    expect(withSkillCatalog('be nice', [{ name: 'a', description: 'A' }])).toMatch(/^be nice\n\n## スキル/);
  });
  it('attached skills are prepended to the user message', () => {
    const t = withAttachedSkills('please review', [{ name: 'review', body: 'Check bugs' }]);
    expect(t).toMatch(/^<skill name="review">\nCheck bugs\n<\/skill>/);
    expect(t.endsWith('please review')).toBe(true);
    expect(withAttachedSkills('', [{ name: 'r', body: 'B' }])).not.toContain('---');
  });
  it('buildRequestMessages expands attached skills but keeps the stored message clean', () => {
    const u: MessageRecord = {
      id: 'u',
      conversationId: 'c',
      parentId: null,
      role: 'user',
      parts: [{ type: 'text', text: 'hello' }],
      createdAt: 1,
      status: 'done',
      skills: [{ name: 'greet', body: 'Reply in haiku' }]
    };
    const out = buildRequestMessages([u], '');
    expect(out).toHaveLength(1);
    const text = (out[0].parts[0] as { text: string }).text;
    expect(text).toContain('Reply in haiku');
    expect(text.endsWith('hello')).toBe(true);
    expect((u.parts[0] as { text: string }).text).toBe('hello');
  });
  it('load_skill returns the body, or an error listing available skills', async () => {
    const tool = makeSkillTool([{ name: 'a', body: 'Body A' }]);
    expect((tool.parameters as any).properties.name.enum).toEqual(['a']);
    expect(tool.prepare({ name: ' /a ' })).toEqual({ name: 'a' });
    expect(() => tool.prepare({})).toThrow();
    const ok = await tool.execute({ name: 'a' }, ctx);
    expect(ok.content).toContain('Body A');
    expect(ok.isError).toBeFalsy();
    const ng = await tool.execute({ name: 'b' }, ctx);
    expect(ng.isError).toBe(true);
    expect(ng.content).toContain('a');
  });
});

describe('skills in backups', () => {
  const skill = (id: string, name: string): Skill => ({ id, name, description: 'd', body: 'b', modelInvocable: true, createdAt: 1, updatedAt: 1 });
  it('exports skills and skips same-name ones on import', async () => {
    await db().skills.put(skill('s1', 'alpha'));
    const ex = await exportAll();
    expect(ex.skills?.map((s) => s.name)).toEqual(['alpha']);
    await db().skills.clear();
    await db().skills.put(skill('other', 'alpha'));
    const r = await importAll({ ...ex, skills: [...ex.skills!, skill('s2', 'beta')] });
    expect(r.skills).toBe(1);
    expect((await db().skills.toArray()).map((s) => s.name).sort()).toEqual(['alpha', 'beta']);
  });
  it('drops invalid skills and keeps attached skills on messages', () => {
    const v = validate({
      format: 'nobackend-llm-client/export',
      version: 3,
      conversations: [{ id: 'c', title: 't', createdAt: 1, updatedAt: 1 }],
      messages: [{ id: 'm', conversationId: 'c', role: 'user', parts: [{ type: 'text', text: 'x' }], skills: [{ name: 'a', body: 'B' }, { name: 1 }] }],
      prompts: [],
      skills: [skill('ok', 'fine'), { ...skill('bad', 'Bad Name') }, { id: 'x' }]
    });
    expect(v.skills?.map((s) => s.id)).toEqual(['ok']);
    expect(v.messages[0].skills).toEqual([{ name: 'a', body: 'B' }]);
  });
});
