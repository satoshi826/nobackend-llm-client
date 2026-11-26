// What a provider request body holds, read back for the developer view: each provider puts the system prompt and
// the tools in its own place (OpenAI-style messages / tools, Anthropic system / tools, Gemini systemInstruction /
// functionDeclarations)

/** The system prompt of an OpenAI-style, Anthropic or Gemini body */
export function systemOf(body: any): string | undefined {
  const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? '').join('\n') : '');
  if (body?.system !== undefined) return textOf(body.system);
  const m = Array.isArray(body?.messages) ? body.messages.find((x: any) => x?.role === 'system' || x?.role === 'developer') : undefined;
  if (m) return textOf(m.content);
  if (body?.systemInstruction) return textOf(body.systemInstruction.parts);
  return undefined;
}

/** The tools of an OpenAI-style, Anthropic or Gemini body (provider tools such as web search by their type) */
export function toolsOf(body: any): { name: string; description: string }[] {
  const list: any[] = Array.isArray(body?.tools) ? body.tools : [];
  return list.flatMap((x: any) => {
    if (x?.function?.name) return [{ name: String(x.function.name), description: String(x.function.description ?? '') }];
    if (Array.isArray(x?.functionDeclarations)) return x.functionDeclarations.map((f: any) => ({ name: String(f.name), description: String(f.description ?? '') }));
    if (x?.name) return [{ name: String(x.name), description: String(x.description ?? '') }];
    const kind = Object.keys(x ?? {})[0] ?? x?.type;
    return kind ? [{ name: String(x?.type ?? kind), description: '' }] : [];
  });
}
