// The arguments of a tool call against the tool's parameters schema, before the tool's own prepare: an unknown or
// missing parameter, or a value of the wrong type, goes back to the model naming what was wrong and what the tool
// takes, instead of running the tool on what the model did not mean. Only what a schema declares is checked: the
// types below, enums and array items; other keywords (minimum, pattern, nested properties) are left to prepare
import { TranslatedError } from '../i18n';
import type { Tool } from './types';
import { t } from './messages';

type Schema = { type?: unknown; enum?: unknown; items?: unknown; properties?: unknown; required?: unknown; additionalProperties?: unknown };

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const TYPES = {
  string: (v: unknown) => typeof v === 'string',
  number: (v: unknown) => typeof v === 'number' && Number.isFinite(v),
  integer: (v: unknown) => Number.isInteger(v),
  boolean: (v: unknown) => typeof v === 'boolean',
  array: Array.isArray,
  object: isObject
} as const;
type TypeName = keyof typeof TYPES;
const KEYS = { string: 'check.string', number: 'check.number', integer: 'check.integer', boolean: 'check.boolean', array: 'check.array', object: 'check.object' } as const;

/** Why `v` does not fit the schema of the parameter `name`, or undefined when it fits */
function misfit(name: string, s: Schema, v: unknown): TranslatedError | undefined {
  const declared: unknown[] = Array.isArray(s.type) ? s.type : [s.type];
  if (v === null && declared.includes('null')) return undefined;
  const types = declared.filter((x): x is TypeName => typeof x === 'string' && x in TYPES);
  if (types.length && !types.some((x) => TYPES[x](v))) return new TranslatedError(() => t(KEYS[types[0]], { name }));
  if (Array.isArray(s.enum) && !s.enum.includes(v)) {
    const values = s.enum.map((x) => JSON.stringify(x)).join(', ');
    return new TranslatedError(() => t('check.enum', { name, values }));
  }
  if (Array.isArray(v) && isObject(s.items)) {
    for (let i = 0; i < v.length; i++) {
      const e = misfit(`${name}[${i}]`, s.items, v[i]);
      if (e) return e;
    }
  }
  return undefined;
}

/**
 * The call's arguments when they fit the tool's parameters schema, with optional parameters given as null left out (some
 * models send null for what they leave out); throws a TranslatedError saying what does not fit. Unknown parameters are
 * refused unless the schema allows other properties (additionalProperties other than false)
 */
export function checkArguments(tool: Pick<Tool, 'name' | 'parameters'>, raw: unknown): Record<string, unknown> {
  const schema = tool.parameters as Schema;
  const props = (isObject(schema.properties) ? schema.properties : {}) as Record<string, Schema>;
  const required = Array.isArray(schema.required) ? schema.required.filter((x): x is string => typeof x === 'string') : [];
  const names = Object.keys(props);
  const takes = () => (names.length ? names.map((n) => (required.includes(n) ? t('check.requiredName', { name: n }) : n)).join(', ') : t('check.none'));
  const args = raw ?? {};
  if (!isObject(args)) throw new TranslatedError(() => t('check.notObject', { tool: tool.name, params: takes() }));
  const open = schema.additionalProperties !== undefined && schema.additionalProperties !== false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (!(k in props)) {
      if (open) out[k] = v;
      else throw new TranslatedError(() => t('check.unknown', { name: k, tool: tool.name, params: takes() }));
      continue;
    }
    if (v === null && !required.includes(k)) continue;
    const e = misfit(k, props[k], v);
    if (e) throw e;
    out[k] = v;
  }
  const missing = required.find((k) => !(k in out));
  if (missing) throw new TranslatedError(() => t('check.missing', { name: missing }));
  return out;
}
