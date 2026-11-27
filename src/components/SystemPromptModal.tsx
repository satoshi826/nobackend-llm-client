import { useEffect, useState } from 'preact/hooks';
import { currentConv, updateConversation } from '../state/conversations';
import { textSettings } from '../state/settings';
import { modal, showToast } from '../state/ui';
import { deleteSavedPrompt, listSavedPrompts, savePrompt } from '../state/prompts';
import type { SavedPrompt } from '../lib/db/schema';
import { Button, EmptyState, Icon, IconButton, Modal, TextArea, TextField } from './ui';
import { askConfirm } from './ConfirmDialog';
import { t } from './messages';

export function SystemPromptModal() {
  const conv = currentConv.value;
  const [text, setText] = useState(conv.systemPrompt);
  const [saved, setSaved] = useState<SavedPrompt[]>([]);
  const [name, setName] = useState('');

  useEffect(() => {
    listSavedPrompts().then(setSaved);
  }, []);

  const apply = async () => {
    await updateConversation({ systemPrompt: text });
    modal.value = null;
  };

  return (
    <Modal title={t('sys.title')} onClose={() => (modal.value = null)} wide>
      <div class="space-y-4">
        <TextArea
          class="h-48 w-full"
          placeholder={t('sys.placeholder')}
          value={text}
          onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          aria-label={t('sys.label')}
        />
        <div class="flex flex-wrap gap-2">
          <Button variant="primary" onClick={apply}>
            <Icon name="check" />
            {t('sys.apply')}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await textSettings.save({ defaultSystemPrompt: text });
              showToast(t('sys.madeDefault'));
            }}
          >
            <Icon name="pin" />
            {t('sys.makeDefault')}
          </Button>
          {textSettings.value.value.defaultSystemPrompt && (
            <Button
              onClick={async () => {
                await textSettings.save({ defaultSystemPrompt: '' });
                showToast(t('sys.defaultCleared'));
              }}
            >
              <Icon name="x" />
              {t('sys.clearDefault')}
            </Button>
          )}
        </div>
        <section class="border-t border-line pt-4">
          <h3 class="mb-2 text-sm font-semibold">{t('sys.saved')}</h3>
          <form
            class="mb-3 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!name.trim() || !text.trim()) return;
              const p = await savePrompt(name.trim(), text);
              setSaved([p, ...saved]);
              setName('');
            }}
          >
            <TextField
              class="flex-1"
              placeholder={t('sys.namePlaceholder')}
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              aria-label={t('sys.nameLabel')}
            />
            <Button type="submit" variant="outline" disabled={!name.trim() || !text.trim()}>
              <Icon name="check" />
              {t('sys.save')}
            </Button>
          </form>
          <ul class="space-y-1">
            {saved.map((p) => (
              <li key={p.id} class="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-glass">
                <button type="button" class="min-w-0 flex-1 text-left" onClick={() => setText(p.content)}>
                  <div class="truncate text-sm font-medium">{p.name}</div>
                  <div class="truncate text-xs text-muted">{p.content}</div>
                </button>
                <IconButton
                  label={t('sys.deleteNamed', { name: p.name })}
                  variant="remove"
                  onClick={async () => {
                    if (!(await askConfirm({ title: t('sys.deleteTitle'), message: t('sys.deleteMessage', { name: p.name }), confirmLabel: t('sys.delete'), danger: true }))) return;
                    await deleteSavedPrompt(p.id);
                    setSaved(saved.filter((x) => x.id !== p.id));
                  }}
                >
                  <Icon name="trash" class="size-3.5" />
                </IconButton>
              </li>
            ))}
            {saved.length === 0 && (
              <li>
                <EmptyState compact>{t('sys.none')}</EmptyState>
              </li>
            )}
          </ul>
        </section>
      </div>
    </Modal>
  );
}
