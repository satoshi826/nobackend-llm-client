import { useEffect, useState } from 'preact/hooks';
import { currentConv, modal, saveSettings, settings, showToast, updateConversation } from '../state/app';
import * as repo from '../lib/db/repo';
import type { SavedPrompt } from '../lib/db/schema';
import { Button, Icon, Modal } from './ui';

export function SystemPromptModal() {
  const conv = currentConv.value;
  const [text, setText] = useState(conv.systemPrompt);
  const [saved, setSaved] = useState<SavedPrompt[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    repo.listPrompts().then(setSaved);
  }, []);

  const apply = async () => {
    await updateConversation({ systemPrompt: text });
    modal.value = null;
  };

  return (
    <Modal title="システムプロンプト（この会話への指示）" onClose={() => (modal.value = null)} wide>
      <div class="space-y-4">
        <textarea
          class="h-48 w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          placeholder="例: あなたは簡潔に答えるアシスタントです。回答は日本語で、結論から書いてください。"
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          aria-label="システムプロンプト"
        />
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" onClick={apply}>
            この会話に適用
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await saveSettings({ defaultSystemPrompt: text });
              showToast('新しいチャットの既定にしました');
            }}
          >
            新しいチャットの既定にする
          </Button>
          {settings.value.defaultSystemPrompt && (
            <Button
              onClick={async () => {
                await saveSettings({ defaultSystemPrompt: '' });
                showToast('既定を解除しました');
              }}
            >
              既定を解除
            </Button>
          )}
        </div>
        <section class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 class="mb-2 text-sm font-semibold">保存したプロンプト</h3>
          <form
            class="mb-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim() || !text.trim()) return;
              const p = { id: repo.newId(), name: name.trim(), content: text, updatedAt: Date.now() };
              await repo.putPrompt(p);
              setSaved([p, ...saved]);
              setName('');
            }}
          >
            <input
              class="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              placeholder="名前を付けて今の内容を保存"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              aria-label="プロンプト名"
            />
            <Button type="submit" variant="outline" disabled={!name.trim() || !text.trim()}>
              保存
            </Button>
          </form>
          <ul class="space-y-1">
            {saved.map((p) => (
              <li key={p.id} class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                <button type="button" class="min-w-0 flex-1 text-left" onClick={() => setText(p.content)}>
                  <div class="truncate text-sm font-medium">{p.name}</div>
                  <div class="truncate text-xs text-zinc-500">{p.content}</div>
                </button>
                <Button
                  aria-label={`${p.name} を削除`}
                  onClick={async () => {
                    await repo.deletePrompt(p.id);
                    setSaved(saved.filter((x) => x.id !== p.id));
                  }}
                >
                  <Icon name="trash" class="size-3.5" />
                </Button>
              </li>
            ))}
            {saved.length === 0 && <li class="text-xs text-zinc-500">まだありません</li>}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
