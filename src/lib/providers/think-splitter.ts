// 本文中の <think>…</think> を思考として分離するインクリメンタルなステートマシン。
// タグがチャンク境界で分割されても正しく扱う。

export interface Segment {
  kind: 'text' | 'reasoning';
  text: string;
}

const OPEN = '<think>';
const CLOSE = '</think>';

export class ThinkSplitter {
  private inThink = false;
  private pending = '';

  push(chunk: string): Segment[] {
    const out: Segment[] = [];
    let s = this.pending + chunk;
    this.pending = '';
    while (s.length > 0) {
      const tag = this.inThink ? CLOSE : OPEN;
      const idx = s.indexOf(tag);
      if (idx >= 0) {
        if (idx > 0) out.push({ kind: this.inThink ? 'reasoning' : 'text', text: s.slice(0, idx) });
        s = s.slice(idx + tag.length);
        this.inThink = !this.inThink;
        continue;
      }
      // 末尾がタグの途中かもしれない部分は保留
      const keep = partialSuffix(s, tag);
      const emit = s.slice(0, s.length - keep);
      if (emit) out.push({ kind: this.inThink ? 'reasoning' : 'text', text: emit });
      this.pending = s.slice(s.length - keep);
      break;
    }
    return merge(out);
  }

  flush(): Segment[] {
    const rest = this.pending;
    this.pending = '';
    return rest ? [{ kind: this.inThink ? 'reasoning' : 'text', text: rest }] : [];
  }
}

function partialSuffix(s: string, tag: string): number {
  const max = Math.min(tag.length - 1, s.length);
  for (let len = max; len > 0; len--) {
    if (tag.startsWith(s.slice(s.length - len))) return len;
  }
  return 0;
}

function merge(segs: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segs) {
    const last = out[out.length - 1];
    if (last && last.kind === seg.kind) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}
