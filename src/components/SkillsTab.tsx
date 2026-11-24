// 設定 > スキル: 一覧・作成・編集・SKILL.md の取り込み/書き出し
import { useRef, useState } from 'preact/hooks';
import { downloadSkill, importSkillFiles, removeSkill, saveSkill, setModelInvocable, showToast, skills } from '../state/app';
import type { Skill } from '../lib/db/schema';
import { DESCRIPTION_MAX, NAME_MAX, type SkillDraft } from '../lib/skills/skill';
import { askConfirm } from './ConfirmDialog';
import { Button, Icon, cx } from './ui';

const inputCls = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950';
const EMPTY: SkillDraft = { name: '', description: '', body: '', modelInvocable: true };

function SkillEditor({ skill, onDone }: { skill?: Skill; onDone(): void }) {
  const [d, setD] = useState<SkillDraft>(skill ? { name: skill.name, description: skill.description, body: skill.body, modelInvocable: skill.modelInvocable } : EMPTY);
  const [error, setError] = useState('');
  const set = (patch: Partial<SkillDraft>) => setD({ ...d, ...patch });
  const save = async () => {
    try {
      await saveSkill(d, skill?.id);
      showToast(skill ? `「${d.name}」を保存しました` : `スキル「${d.name}」を作りました`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div class="space-y-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700" role="group" aria-label={skill ? 'スキルの編集' : '新しいスキル'}>
      <label class="block text-sm">
        名前
        <input
          class={cx(inputCls, 'mt-1 font-mono')}
          value={d.name}
          maxLength={NAME_MAX}
          placeholder="code-review"
          onInput={(e) => set({ name: (e.target as HTMLInputElement).value.toLowerCase().replace(/[\s_]+/g, '-') })}
        />
        <span class="mt-0.5 block text-xs text-zinc-500">半角の小文字・数字・ハイフン。入力欄で「/名前」と打っても呼び出せます。</span>
      </label>
      <label class="block text-sm">
        説明
        <textarea
          class={cx(inputCls, 'mt-1')}
          rows={2}
          maxLength={DESCRIPTION_MAX}
          value={d.description}
          placeholder="何をするスキルか、どんな依頼のときに使うか"
          onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })}
        />
        <span class="mt-0.5 block text-xs text-zinc-500">モデルはこの説明だけを見て、本文を読み込むかどうかを決めます。</span>
      </label>
      <label class="block text-sm">
        指示（Markdown）
        <textarea
          class={cx(inputCls, 'mt-1 font-mono text-xs leading-5')}
          rows={12}
          value={d.body}
          placeholder={'# 手順\n1. ...\n2. ...'}
          onInput={(e) => set({ body: (e.target as HTMLTextAreaElement).value })}
        />
      </label>
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-1" checked={d.modelInvocable} onChange={(e) => set({ modelInvocable: (e.target as HTMLInputElement).checked })} />
        <span>
          モデルが必要に応じて使う
          <span class="block text-xs text-zinc-500">オフにすると、入力欄から指定したときだけ使います。</span>
        </span>
      </label>
      {error && (
        <p role="alert" class="text-xs text-rose-700 dark:text-rose-400">
          {error}
        </p>
      )}
      <div class="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          キャンセル
        </Button>
        <Button variant="primary" onClick={() => void save()}>
          保存
        </Button>
      </div>
    </div>
  );
}

function SkillRow({ s, onEdit }: { s: Skill; onEdit(): void }) {
  return (
    <li class="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div class="flex items-start gap-2">
        <Icon name="book" class="mt-0.5 size-4 shrink-0 text-zinc-400" />
        <div class="min-w-0 flex-1">
          <div class="font-mono text-sm font-medium">{s.name}</div>
          <p class="mt-0.5 line-clamp-2 text-xs text-zinc-500">{s.description}</p>
          <label class="mt-2 flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={s.modelInvocable} onChange={(e) => void setModelInvocable(s.id, (e.target as HTMLInputElement).checked)} />
            モデルが必要に応じて使う
          </label>
        </div>
        <div class="flex shrink-0 items-center">
          <Button aria-label={`${s.name} を編集`} title="編集" onClick={onEdit}>
            <Icon name="edit" class="size-4" />
          </Button>
          <Button aria-label={`${s.name} を SKILL.md として書き出す`} title="SKILL.md として書き出す" onClick={() => downloadSkill(s)}>
            <Icon name="download" class="size-4" />
          </Button>
          <Button
            aria-label={`${s.name} を削除`}
            title="削除"
            onClick={() =>
              void askConfirm({ title: 'スキルを削除', message: `「${s.name}」を削除します。元に戻せません。`, confirmLabel: '削除', danger: true }).then((ok) => {
                if (ok) void removeSkill(s.id);
              })
            }
          >
            <Icon name="trash" class="size-4" />
          </Button>
        </div>
      </div>
    </li>
  );
}

export function SkillsTab() {
  const list = skills.value;
  const [editing, setEditing] = useState<string | null>(null); // 'new' | skill id
  const file = useRef<HTMLInputElement>(null);

  const onImport = async (files: FileList | null) => {
    if (!files?.length) return;
    const r = await importSkillFiles([...files]);
    const done = [...r.added, ...r.updated];
    if (done.length) showToast(`${done.length} 件のスキルを取り込みました${r.updated.length ? `（${r.updated.length} 件は同じ名前のものを更新）` : ''}`);
    if (r.errors.length) showToast(`取り込めなかったファイル: ${r.errors.join(' / ')}`, 'error');
    if (file.current) file.current.value = '';
  };

  return (
    <div class="space-y-4">
      <p class="text-xs leading-5 text-zinc-500">
        スキルは、特定の作業のやり方をまとめた指示書です。モデルには名前と説明だけを渡し、依頼に合うときだけ本文を読み込ませます（ツール呼び出しに対応したモデルのみ）。入力欄の「スキル」ボタンや「/名前」で、自分で指定して使うこともできます。
      </p>
      <p class="rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
        スキルの指示はそのままモデルに渡ります。他の人が作ったスキルは、中身を確認してから取り込んでください。Claude の SKILL.md を取り込めますが、同梱のスクリプトや参照ファイルにはまだ対応していません。
      </p>
      <div class="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setEditing('new')} disabled={editing === 'new'}>
          <Icon name="plus" class="size-4" />
          新しいスキル
        </Button>
        <Button variant="outline" onClick={() => file.current?.click()}>
          <Icon name="upload" class="size-4" />
          SKILL.md を取り込む
        </Button>
        <input ref={file} type="file" accept=".md,.markdown,text/markdown,text/plain" multiple class="hidden" onChange={(e) => void onImport((e.target as HTMLInputElement).files)} />
      </div>
      {editing === 'new' && <SkillEditor onDone={() => setEditing(null)} />}
      {list.length === 0 && editing !== 'new' ? (
        <p class="py-6 text-center text-sm text-zinc-500">スキルはまだありません</p>
      ) : (
        <ul class="space-y-2">
          {list.map((s) => (editing === s.id ? <SkillEditor key={s.id} skill={s} onDone={() => setEditing(null)} /> : <SkillRow key={s.id} s={s} onEdit={() => setEditing(s.id)} />))}
        </ul>
      )}
    </div>
  );
}
