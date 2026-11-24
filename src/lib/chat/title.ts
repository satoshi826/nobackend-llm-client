// 会話のタイトル（最初の発言から作る）
export function titleFrom(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t || '新しいチャット';
}
