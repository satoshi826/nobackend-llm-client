import { useEffect, useRef, useState } from 'preact/hooks';
import {
  currentProviderId,
  downloadExport,
  enabledProviders,
  hostOfProvider,
  importFromFile,
  keyInfos,
  modal,
  providers,
  saveSettings,
  setProviderEnabled,
  settings,
  showToast,
  wipeEverything
} from '../state/app';
import { DEFAULT_PROVIDER_ID, providerById, visibleModels } from '../state/app';
import { SERVICE_ORDER, serviceById, serviceHost } from '../lib/tools/services';
import type { Permission } from '../lib/tools/types';
import { KeyForm } from './KeyForm';
import { askConfirm } from './ConfirmDialog';
import { Badge, Button, Icon, Modal, cx } from './ui';

const MODE_TEXT: Record<string, string> = { session: 'このセッションのみ（保存なし）', encrypted: 'パスフレーズで暗号化して保存', plain: 'このブラウザに平文で保存' };

function ProviderSection() {
  const [open, setOpen] = useState<string>(currentProviderId.value);
  const enabled = new Set(enabledProviders.value.map((p) => p.id));
  return (
    <section>
      <h3 class="mb-2 text-sm font-semibold">接続先と API キー</h3>
      <div class="space-y-2">
        {providers.value.map((p) => {
          const k = keyInfos.value[p.id];
          const on = enabled.has(p.id);
          const isOpen = open === p.id;
          return (
            <div key={p.id} class="rounded-lg border border-zinc-200 dark:border-zinc-800">
              <div class="flex items-center gap-2 px-3 py-2">
                <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setOpen(isOpen ? '' : p.id)} aria-expanded={isOpen}>
                  <Icon name="chevron-down" class={cx('size-3.5 transition', !isOpen && '-rotate-90')} />
                  <span class="font-medium">{p.name}</span>
                  <span class="truncate text-xs text-zinc-500">{hostOfProvider(p.id)}</span>
                  {k?.present ? (
                    <Badge tone={k.locked ? 'amber' : 'green'}>{k.locked ? 'ロック中' : 'キー設定済み'}</Badge>
                  ) : (
                    <Badge>キー未設定</Badge>
                  )}
                </button>
                {p.id !== DEFAULT_PROVIDER_ID && (
                  <label class="flex shrink-0 items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={on} onChange={(e) => setProviderEnabled(p.id, (e.target as HTMLInputElement).checked)} />
                    使う
                  </label>
                )}
              </div>
              {isOpen && (
                <div class="border-t border-zinc-200 p-3 dark:border-zinc-800">
                  {on ? <KeyForm providerId={p.id} /> : <p class="text-xs text-zinc-500">「使う」をオンにすると、モデル一覧に表示され、キーを設定できます。</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SettingsModal() {
  const s = settings.value;
  return (
    <Modal title="設定" onClose={() => (modal.value = null)}>
      <div class="space-y-6">
        <ProviderSection />
        <section class="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 class="text-sm font-semibold">表示と動作</h3>
          <label class="flex items-center justify-between gap-3 text-sm">
            テーマ
            <select
              class="rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
              value={s.theme}
              onChange={(e) => saveSettings({ theme: (e.target as HTMLSelectElement).value as any })}
            >
              <option value="system">システムに合わせる</option>
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
            </select>
          </label>
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>
              温度（temperature）
              <span class="block text-xs text-zinc-500">空欄ならモデルの既定値</span>
            </span>
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              class="w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
              value={s.temperature ?? ''}
              onChange={(e) => {
                const v = (e.target as HTMLInputElement).value;
                void saveSettings({ temperature: v === '' ? null : Math.max(0, Math.min(2, Number(v))) });
              }}
            />
          </label>
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" class="mt-1" checked={s.includeVeniceSystemPrompt} onChange={(e) => saveSettings({ includeVeniceSystemPrompt: (e.target as HTMLInputElement).checked })} />
            <span>
              Venice 既定のシステムプロンプトを付ける
              <span class="block text-xs text-zinc-500">オフ（既定）なら、あなたが書いた指示だけがモデルに渡ります。</span>
            </span>
          </label>
        </section>
        <SearchSection />
        <ContextSection />
      </div>
    </Modal>
  );
}

const PERM_LABEL: Record<Permission, string> = { ask: '毎回確認する', allow: '確認せずに実行', deny: '使わない' };

/** Web 検索（Venice 内蔵 / ツール: Tavily + Jina） */
function SearchSection() {
  const s = settings.value;
  const [open, setOpen] = useState<string>('');
  return (
    <section class="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 class="text-sm font-semibold">Web 検索</h3>
      <p class="text-xs text-zinc-500">
        入力欄の「Web 検索」をオンにすると、モデルが必要に応じて検索します。ツール方式では、モデルが Tavily で検索し、Jina Reader でページ本文を読みます（ツール呼び出しに対応したモデルのみ。OpenRouter はこの方式だけ）。
      </p>
      <label class="flex items-center justify-between gap-3 text-sm">
        Venice での検索方式
        <select
          class="rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
          value={s.searchEngine}
          onChange={(e) => saveSettings({ searchEngine: (e.target as HTMLSelectElement).value as 'venice' | 'tools' })}
        >
          <option value="venice">Venice 内蔵（キー不要・$0.01/回）</option>
          <option value="tools">ツール（Tavily + Jina）</option>
        </select>
      </label>
      {(['web_search', 'fetch_url'] as const).map((name) => (
        <label key={name} class="flex items-center justify-between gap-3 text-sm">
          <span>
            {name === 'web_search' ? 'ツール: Web 検索' : 'ツール: ページ本文の取得'}
            <span class="block text-xs text-zinc-500">{name === 'web_search' ? '検索語が Tavily に送られます' : 'URL が Jina Reader に送られます'}</span>
          </span>
          <select
            class="rounded-lg border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-950"
            value={s.toolPermissions[name] ?? 'ask'}
            onChange={(e) => saveSettings({ toolPermissions: { ...s.toolPermissions, [name]: (e.target as HTMLSelectElement).value as Permission } })}
          >
            {(['ask', 'allow', 'deny'] as Permission[]).map((v) => (
              <option key={v} value={v}>
                {PERM_LABEL[v]}
              </option>
            ))}
          </select>
        </label>
      ))}
      {SERVICE_ORDER.map((id) => {
        const k = keyInfos.value[id];
        const svc = serviceById(id)!;
        const isOpen = open === id;
        return (
          <div key={id} class="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <button type="button" class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={() => setOpen(isOpen ? '' : id)} aria-expanded={isOpen}>
              <Icon name="chevron-down" class={cx('size-3.5 transition', !isOpen && '-rotate-90')} />
              <span class="font-medium">{svc.label}</span>
              {k?.present ? (
                <Badge tone={k.locked ? 'amber' : 'green'}>{k.locked ? 'ロック中' : 'キー設定済み'}</Badge>
              ) : (
                <Badge>{svc.keyOptional ? 'キーなしで利用' : 'キー未設定'}</Badge>
              )}
            </button>
            {isOpen && (
              <div class="border-t border-zinc-200 p-3 dark:border-zinc-800">
                <KeyForm providerId={id} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** 会話の長さと費用（圧縮・思考の送り返し・プロンプトキャッシュ） */
function ContextSection() {
  const s = settings.value;
  const choices = visibleModels.value.filter((m) => keyInfos.value[m.providerId]?.present);
  const pct = Math.round(s.compactThreshold * 100);
  return (
    <section class="space-y-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <h3 class="text-sm font-semibold">会話の長さと費用</h3>
      <p class="text-xs text-zinc-500">
        送信のたびに、それまでの会話（表示中の枝）をまとめてモデルに送ります。会話が長くなるほど入力が増えるため、古い部分を要約に置き換える「圧縮」を使えます。
        ヘッダーの <Icon name="compress" class="inline size-3.5" /> ボタンでいつでも手動で圧縮できます（元の履歴は表示用に残ります）。
      </p>
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-1" checked={s.autoCompact} onChange={(e) => saveSettings({ autoCompact: (e.target as HTMLInputElement).checked })} />
        <span>
          長くなったら自動で圧縮する
          <span class="block text-xs text-zinc-500">送ろうとしている入力がモデルの文脈長の一定割合を超えたら、送信前に古い部分を要約します（要約 1 回ぶんの料金がかかります）。</span>
        </span>
      </label>
      <label class="flex items-center justify-between gap-3 text-sm">
        <span class={cx(!s.autoCompact && 'text-zinc-400')}>自動で圧縮する目安</span>
        <select
          disabled={!s.autoCompact}
          class="rounded-lg border border-zinc-300 bg-white px-2 py-1 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950"
          value={String(pct)}
          onChange={(e) => saveSettings({ compactThreshold: Number((e.target as HTMLSelectElement).value) / 100 })}
        >
          {[50, 60, 70, 80, 90].map((v) => (
            <option key={v} value={v}>
              文脈長の {v}%
            </option>
          ))}
        </select>
      </label>
      <label class="block text-sm">
        要約に使うモデル
        <select
          class="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-950"
          value={s.compactModel}
          onChange={(e) => saveSettings({ compactModel: (e.target as HTMLSelectElement).value })}
        >
          <option value="">会話と同じモデル</option>
          {choices.map((m) => (
            <option key={m.providerId + m.id} value={`${m.providerId}|${m.id}`}>
              {providerById(m.providerId)?.name} / {m.name}
              {m.pricing?.inputPerMTok != null ? `（入力 $${m.pricing.inputPerMTok.toFixed(2)}/M）` : ''}
            </option>
          ))}
        </select>
        <span class="mt-1 block text-xs text-zinc-500">安いモデルを選ぶと要約の費用を抑えられます。</span>
      </label>
      <label class="flex items-start gap-2 text-sm">
        <input type="checkbox" class="mt-1" checked={s.resendReasoning} onChange={(e) => saveSettings({ resendReasoning: (e.target as HTMLInputElement).checked })} />
        <span>
          前回までの思考をモデルに送り返す
          <span class="block text-xs text-zinc-500">
            思考するモデルの思考内容（reasoning_content）を次の送信にも含めます。Venice のドキュメントでは推奨されていますが、思考のトークンにも毎回課金されます。オフ（既定）でも回答の本文は送ります。
          </span>
        </span>
      </label>
      <p class="text-xs text-zinc-500">
        プロンプトキャッシュ: Venice には会話ごとのキャッシュキーを送り、送り直す履歴部分を安く処理させます（会話の先頭が変わらない限り有効）。回答の下に「キャッシュ」と表示されたトークンは通常より安く課金されています。
      </p>
    </section>
  );
}

export function PrivacyModal() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [usage, setUsage] = useState<{ used: number; quota: number; persisted: boolean } | null>(null);
  const s = settings.value;
  useEffect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = (await navigator.storage?.persisted?.()) ?? false;
      setUsage({ used: est?.usage ?? 0, quota: est?.quota ?? 0, persisted });
    })();
  }, []);
  const provs = enabledProviders.value;

  return (
    <Modal title="プライバシーとデータ" onClose={() => (modal.value = null)}>
      <div class="space-y-6 text-sm">
        <section>
          <h3 class="mb-2 font-semibold">このアプリが通信する相手</h3>
          <table class="w-full text-left text-xs">
            <thead class="text-zinc-500">
              <tr>
                <th class="py-1 font-medium">宛先</th>
                <th class="py-1 font-medium">送るもの</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
              {provs.map((p) => (
                <tr key={p.id}>
                  <td class="py-1.5 pr-2 font-mono">{hostOfProvider(p.id)}</td>
                  <td class="py-1.5">
                    {p.name}: 会話の内容・API キー（チャット時）、モデル一覧の取得（キーなし）
                    {p.preset === 'openrouter' && '。OpenRouter から実際に処理する提供元へ中継されます（データ収集する提供元は既定で除外）'}
                  </td>
                </tr>
              ))}
              <tr>
                <td class="py-1.5 pr-2 font-mono">{serviceHost('tavily')}</td>
                <td class="py-1.5">Tavily: ツール方式の Web 検索をしたときの検索語（とキー）</td>
              </tr>
              <tr>
                <td class="py-1.5 pr-2 font-mono">{serviceHost('jina')}</td>
                <td class="py-1.5">Jina Reader: ツール方式でページ本文を読むときの URL（Jina がそのページを取得します）</td>
              </tr>
              <tr>
                <td class="py-1.5 pr-2">Venice の検索提供元</td>
                <td class="py-1.5">Web 検索をオンにしたときの検索クエリ（Venice 経由）</td>
              </tr>
              <tr>
                <td class="py-1.5 pr-2">外部 AI 事業者</td>
                <td class="py-1.5">「外部中継」のモデルを使ったときの会話（Venice が匿名化して中継）</td>
              </tr>
              <tr>
                <td class="py-1.5 pr-2">このサイトの配信元</td>
                <td class="py-1.5">ページの読み込みのみ。会話は送りません</td>
              </tr>
            </tbody>
          </table>
          <p class="mt-2 text-xs text-zinc-500">解析ツール・広告・外部スクリプト・外部フォントは使っていません。通信先はブラウザのセキュリティポリシー（CSP）でも制限しています。</p>
        </section>

        <section class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 class="mb-2 font-semibold">保存データ</h3>
          {usage && (
            <p class="text-xs text-zinc-500">
              使用量 {(usage.used / 1024 / 1024).toFixed(1)} MB / 上限 {(usage.quota / 1024 / 1024 / 1024).toFixed(1)} GB ・{' '}
              {usage.persisted ? '永続化されています（自動削除されにくい）' : '永続化されていません（ブラウザが容量不足時に削除する可能性があります）'}
            </p>
          )}
          <p class="mt-1 text-xs text-zinc-500">API キー: {provs.map((p) => `${p.name}: ${keyInfos.value[p.id]?.present ? MODE_TEXT[keyInfos.value[p.id].mode ?? 'plain'] : '未登録'}`).join(' / ')}</p>
          <div class="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => downloadExport().then(() => showToast('バックアップを書き出しました'))}>
              バックアップを書き出す（JSON）
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              読み込む
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              class="hidden"
              onChange={async (e) => {
                const f = (e.target as HTMLInputElement).files?.[0];
                if (!f) return;
                try {
                  const r = await importFromFile(f);
                  showToast(`会話 ${r.conversations} 件を読み込みました（重複 ${r.skipped} 件はスキップ）`);
                } catch (err) {
                  showToast((err as Error).message, 'error');
                } finally {
                  (e.target as HTMLInputElement).value = '';
                }
              }}
            />
          </div>
          <p class="mt-2 text-xs text-zinc-500">
            {s.lastBackupAt ? `最終バックアップ: ${new Date(s.lastBackupAt).toLocaleString()}` : 'まだバックアップしていません。'} バックアップに API キーは含まれません。
          </p>
        </section>

        <section class="border-t border-zinc-200 pt-4 dark:border-zinc-800">
          <h3 class="mb-2 flex items-center gap-1 font-semibold text-rose-700 dark:text-rose-400">
            <Icon name="trash" />
            すべて削除
          </h3>
          <p class="mb-2 text-xs text-zinc-500">会話・設定・API キーを含む、このブラウザ内のすべてのデータを削除します。元に戻せません。</p>
          <Button
            variant="danger"
            onClick={() => {
              void askConfirm({
                title: 'すべてのデータを削除',
                message: 'このブラウザ内のすべての会話・設定・API キーを削除します。元に戻せません。必要ならバックアップを書き出してから実行してください。',
                confirmLabel: 'すべて削除',
                danger: true,
                requireText: '削除'
              }).then((ok) => {
                if (ok) void wipeEverything();
              });
            }}
          >
            すべてのデータを削除
          </Button>
        </section>
      </div>
    </Modal>
  );
}
