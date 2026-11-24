// 設定（タブ: 接続とキー / チャット / Web 検索 / スキル / プライバシーとデータ）
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  currentConv,
  downloadExport,
  enabledProviders,
  hostOfProvider,
  importFromFile,
  keyStatus,
  modal,
  providerById,
  providers,
  saveSettings,
  setProviderEnabled,
  settings,
  settingsTab,
  showToast,
  visibleModels,
  wipeEverything,
  clearAllKeys,
  vaultState,
  providerSettingsOf,
  setProviderSetting,
  type SettingsTab
} from '../state/app';
import { vaultIsolated, VAULT_ORIGIN } from '../lib/vault/client';
import { accountById } from '../lib/keys/accounts';
import { SERVICE_ORDER } from '../lib/tools/services';
import { getPreset, PRESETS } from '../lib/providers/registry';
import type { Permission } from '../lib/tools/types';
import { KeyPanel, VaultSecurityPanel } from './KeyPanel';
import { SkillsTab } from './SkillsTab';
import { askConfirm } from './ConfirmDialog';
import { Badge, Button, Icon, Modal, cx } from './ui';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'connections', label: '接続とキー' },
  { id: 'chat', label: 'チャット' },
  { id: 'search', label: 'Web 検索' },
  { id: 'skills', label: 'スキル' },
  { id: 'privacy', label: 'プライバシーとデータ' }
];

const selectCls = 'rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950';

function Section({ title, children }: { title?: string; children: ComponentChildren }) {
  return (
    <section class="space-y-3">
      {title && <h3 class="text-sm font-semibold">{title}</h3>}
      {children}
    </section>
  );
}

function Toggle({ checked, onChange, title, desc, disabled }: { checked: boolean; onChange(v: boolean): void; title: string; desc?: string; disabled?: boolean }) {
  return (
    <label class={cx('flex items-start gap-2 text-sm', disabled && 'opacity-50')}>
      <input type="checkbox" class="mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>
        {title}
        {desc && <span class="block text-xs text-zinc-500">{desc}</span>}
      </span>
    </label>
  );
}

function KeyBadge({ id }: { id: string }) {
  const k = keyStatus(id);
  if (k.present) return <Badge tone={k.locked ? 'amber' : 'green'}>{k.locked ? 'ロック中' : 'キー設定済み'}</Badge>;
  return <Badge>{accountById(id)?.keyOptional ? 'キーなしで利用' : 'キー未設定'}</Badge>;
}

/** 開閉できるキー設定の行 */
function AccountRow(props: { id: string; title: string; host: string; open: boolean; onToggle(): void; right?: ComponentChildren; children: ComponentChildren }) {
  return (
    <div class="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <div class="flex items-center gap-2 px-3 py-2">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={props.onToggle} aria-expanded={props.open}>
          <Icon name="chevron-down" class={cx('size-3.5 shrink-0 transition', !props.open && '-rotate-90')} />
          <span class="font-medium">{props.title}</span>
          <span class="truncate text-xs text-zinc-500">{props.host}</span>
          <KeyBadge id={props.id} />
        </button>
        {props.right}
      </div>
      {props.open && <div class="border-t border-zinc-200 p-3 dark:border-zinc-800">{props.children}</div>}
    </div>
  );
}

/** 接続先のキーと、その接続先だけの設定 */
function ProviderDetails({ id }: { id: string }) {
  const preset = getPreset(providerById(id)!.preset);
  const values = providerSettingsOf(id, preset.settings);
  return (
    <div class="space-y-3">
      <KeyPanel accountId={id} compact />
      {preset.settings?.map((d) => (
        <Toggle key={d.key} checked={values[d.key]} onChange={(v) => setProviderSetting(id, d.key, v)} title={d.label} desc={d.desc} />
      ))}
    </div>
  );
}

function ConnectionsTab() {
  const [open, setOpen] = useState<string>(currentConv.value.providerId || (enabledProviders.value[0]?.id ?? ''));
  const enabled = new Set(enabledProviders.value.map((p) => p.id));
  return (
    <div class="space-y-6">
      <div class={cx('rounded-lg p-3 text-xs leading-5', vaultIsolated ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200' : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300')}>
        <div class="mb-0.5 flex items-center gap-1 font-semibold">
          <Icon name={vaultIsolated ? 'shield' : 'key'} class="size-3.5" />
          {vaultIsolated ? `キー金庫: 別オリジン（${new URL(VAULT_ORIGIN).host}）` : 'キー金庫: このサイトと同じオリジン'}
        </div>
        {vaultIsolated
          ? 'API キーはアプリ本体とは別のオリジンに保管されます。アプリ本体で問題が起きても、キーそのものは読み出せません。'
          : 'API キーはこのブラウザ内のキー保管ページに保存され、アプリ本体の画面には渡りません。キー金庫を別オリジンに置くとさらに安全です（README の「キー金庫」）。'}
      </div>
      <Section title="キーの保護">
        <VaultSecurityPanel />
      </Section>
      <Section title="LLM の接続先">
        <div class="space-y-2">
          {providers.value.map((p) => {
            const on = enabled.has(p.id);
            return (
              <AccountRow
                key={p.id}
                id={p.id}
                title={p.name}
                host={hostOfProvider(p.id)}
                open={open === p.id}
                onToggle={() => setOpen(open === p.id ? '' : p.id)}
                right={
                  <label class="flex shrink-0 items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={on} onChange={(e) => setProviderEnabled(p.id, (e.target as HTMLInputElement).checked)} />
                    使う
                  </label>
                }
              >
                {on ? <ProviderDetails id={p.id} /> : <p class="text-xs text-zinc-500">{getPreset(p.preset).tagline} 「使う」をオンにすると、モデル一覧に表示され、キーを設定できます。</p>}
              </AccountRow>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function ChatTab() {
  const s = settings.value;
  const choices = visibleModels.value.filter((m) => keyStatus(m.providerId).present);
  return (
    <div class="space-y-6">
      <Section title="表示と生成">
        <label class="flex items-center justify-between gap-3 text-sm">
          テーマ
          <select class={selectCls} value={s.theme} onChange={(e) => saveSettings({ theme: (e.target as HTMLSelectElement).value as any })}>
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
            class={cx(selectCls, 'w-24')}
            value={s.temperature ?? ''}
            onChange={(e) => {
              const v = (e.target as HTMLInputElement).value;
              void saveSettings({ temperature: v === '' ? null : Math.max(0, Math.min(2, Number(v))) });
            }}
          />
        </label>
        <p class="text-xs text-zinc-500">接続先だけの設定（Venice 既定のシステムプロンプトなど）は「接続とキー」の各接続先にあります。</p>
      </Section>
      <Section title="会話の長さと費用">
        <p class="text-xs text-zinc-500">
          送信のたびに、それまでの会話（表示中の枝）をまとめて送ります。長くなったら、ヘッダーの <Icon name="compress" class="inline size-3.5" /> で古い部分を要約に置き換えられます（元の履歴は残ります）。
        </p>
        <Toggle checked={s.autoCompact} onChange={(v) => saveSettings({ autoCompact: v })} title="長くなったら自動で圧縮する" desc="送ろうとしている入力が文脈長の目安を超えたら、送信前に要約します（要約 1 回ぶんの料金がかかります）。" />
        <label class={cx('flex items-center justify-between gap-3 text-sm', !s.autoCompact && 'opacity-50')}>
          自動で圧縮する目安
          <select disabled={!s.autoCompact} class={selectCls} value={String(Math.round(s.compactThreshold * 100))} onChange={(e) => saveSettings({ compactThreshold: Number((e.target as HTMLSelectElement).value) / 100 })}>
            {[50, 60, 70, 80, 90].map((v) => (
              <option key={v} value={v}>
                文脈長の {v}%
              </option>
            ))}
          </select>
        </label>
        <label class="block text-sm">
          要約に使うモデル
          <select class={cx(selectCls, 'mt-1 block w-full py-1.5')} value={s.compactModel} onChange={(e) => saveSettings({ compactModel: (e.target as HTMLSelectElement).value })}>
            <option value="">会話と同じモデル</option>
            {choices.map((m) => (
              <option key={m.providerId + m.id} value={`${m.providerId}|${m.id}`}>
                {providerById(m.providerId)?.name} / {m.name}
                {m.pricing?.inputPerMTok != null ? `（入力 $${m.pricing.inputPerMTok.toFixed(2)}/M）` : ''}
              </option>
            ))}
          </select>
        </label>
        <Toggle
          checked={s.resendReasoning}
          onChange={(v) => saveSettings({ resendReasoning: v })}
          title="前回までの思考をモデルに送り返す"
          desc="思考するモデルの思考内容を次の送信にも含めます。提供元によっては推奨されていますが、思考のトークンにも毎回課金されます。"
        />
        <p class="text-xs text-zinc-500">プロンプトキャッシュ: 対応する接続先には会話ごとのキャッシュキーを送ります。回答の下の「キャッシュ」は通常より安く課金されたトークン数です。</p>
      </Section>
    </div>
  );
}

const PERM_LABEL: Record<Permission, string> = { ask: '毎回確認する', allow: '確認せずに実行', deny: '使わない' };

function SearchTab() {
  const s = settings.value;
  const builtin = Object.values(PRESETS).filter((p) => p.features?.builtInWebSearch);
  const [open, setOpen] = useState('');
  return (
    <div class="space-y-6">
      <Section>
        <p class="text-xs text-zinc-500">
          入力欄の「Web 検索」をオンにすると、モデルが必要に応じて検索します。ツール方式では、モデルが Tavily で検索し、Jina Reader でページ本文を読みます（ツール呼び出しに対応したモデルのみ）。内蔵の検索を持たない接続先は、ツール方式だけです。
        </p>
        {builtin.length > 0 && (
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>
              内蔵検索のある接続先での方式
              <span class="block text-xs text-zinc-500">{builtin.map((p) => p.label).join('・')}</span>
            </span>
            <select class={selectCls} value={s.searchEngine} onChange={(e) => saveSettings({ searchEngine: (e.target as HTMLSelectElement).value as 'builtin' | 'tools' })}>
              <option value="builtin">接続先の内蔵検索（追加のキー不要）</option>
              <option value="tools">ツール（Tavily + Jina）</option>
            </select>
          </label>
        )}
      </Section>
      <Section title="ツールの実行">
        {(['web_search', 'fetch_url'] as const).map((name) => (
          <label key={name} class="flex items-center justify-between gap-3 text-sm">
            <span>
              {name === 'web_search' ? 'Web 検索' : 'ページ本文の取得'}
              <span class="block text-xs text-zinc-500">{name === 'web_search' ? '検索語が Tavily に送られます' : 'URL が Jina Reader に送られます'}</span>
            </span>
            <select class={selectCls} value={s.toolPermissions[name] ?? 'ask'} onChange={(e) => saveSettings({ toolPermissions: { ...s.toolPermissions, [name]: (e.target as HTMLSelectElement).value as Permission } })}>
              {(['ask', 'allow', 'deny'] as Permission[]).map((v) => (
                <option key={v} value={v}>
                  {PERM_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </Section>
      <Section title="検索サービスのキー">
        <div class="space-y-2">
          {SERVICE_ORDER.map((id) => {
            const a = accountById(id)!;
            return (
              <AccountRow key={id} id={id} title={a.label} host={a.host} open={open === id} onToggle={() => setOpen(open === id ? '' : id)}>
                <KeyPanel accountId={id} compact />
              </AccountRow>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function PrivacyTab() {
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
  const rows: [string, string][] = [
    ...enabledProviders.value.map(
      (p) => {
        const note = getPreset(p.preset).copy?.destinationNote;
        return [hostOfProvider(p.id), `${p.name}: 会話の内容（チャット時、キー付き）・モデル一覧の取得（キーなし）${note ? `。${note}` : ''}`] as [string, string];
      }
    ),
    [accountById('tavily')!.host, 'Tavily: ツール方式の Web 検索の検索語'],
    [accountById('jina')!.host, 'Jina Reader: ツール方式で読むページの URL（Jina がそのページを取得）'],
    ...enabledProviders.value.flatMap((p) => getPreset(p.preset).copy?.extraDestinations ?? []),
    ['このサイトの配信元', 'ページの読み込みのみ。会話は送りません']
  ];
  return (
    <div class="space-y-6 text-sm">
      <Section title="このアプリが通信する相手">
        <table class="w-full text-left text-xs">
          <tbody class="divide-y divide-zinc-200 dark:divide-zinc-800">
            {rows.map(([dest, what]) => (
              <tr key={dest}>
                <td class="py-1.5 pr-3 align-top font-mono whitespace-nowrap">{dest}</td>
                <td class="py-1.5">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="text-xs text-zinc-500">解析ツール・広告・外部スクリプト・外部フォントは使っていません。通信先はブラウザのセキュリティポリシー（CSP）でも制限しています。</p>
      </Section>
      <Section title="保存データとバックアップ">
        {usage && (
          <p class="text-xs text-zinc-500">
            使用量 {(usage.used / 1024 / 1024).toFixed(1)} MB / 上限 {(usage.quota / 1024 / 1024 / 1024).toFixed(1)} GB ・{' '}
            {usage.persisted ? '永続化されています（自動削除されにくい）' : '永続化されていません（容量不足時に削除される可能性があります）'}
          </p>
        )}
        <div class="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => downloadExport().then(() => showToast('バックアップを書き出しました'))}>
            <Icon name="download" />
            バックアップを書き出す
          </Button>
          <Button variant="outline" onClick={() => fileRef.current?.click()}>
            <Icon name="upload" />
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
                showToast(`会話 ${r.conversations} 件${r.skills ? `・スキル ${r.skills} 件` : ''}を読み込みました（重複 ${r.skipped} 件はスキップ）`);
              } catch (err) {
                showToast((err as Error).message, 'error');
              } finally {
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
        </div>
        <p class="text-xs text-zinc-500">
          {s.lastBackupAt ? `最終バックアップ: ${new Date(s.lastBackupAt).toLocaleString()}。` : 'まだバックアップしていません。'}バックアップに API キーは含まれません。
        </p>
      </Section>
      <Section title="API キーの削除">
        <p class="text-xs text-zinc-500">保存されているすべての API キー{vaultState.value.hasPassphrase ? 'とパスフレーズ' : ''}を削除します。会話や設定は残ります。</p>
        <Button
          variant="outline"
          onClick={() =>
            void askConfirm({
              title: 'すべての API キーを削除',
              message: `キー金庫に保存されているすべての API キー${vaultState.value.hasPassphrase ? 'とパスフレーズ' : ''}を削除します。元に戻せません。使い続けるには、キーを入れ直してください。`,
              confirmLabel: 'すべてのキーを削除',
              danger: true
            }).then(async (ok) => {
              if (!ok) return;
              await clearAllKeys();
              showToast('すべての API キーを削除しました');
            })
          }
        >
          <Icon name="key" />
          すべての API キーを削除
        </Button>
      </Section>
      <Section title="すべて削除">
        <p class="text-xs text-zinc-500">会話・設定・スキル・API キーなど、このブラウザ内のアプリのデータをすべて削除します。元に戻せません。</p>
        <Button
          variant="danger"
          onClick={() =>
            void askConfirm({
              title: 'すべてのデータを削除',
              message: 'このブラウザ内のすべての会話・設定・API キーを削除します。元に戻せません。必要ならバックアップを書き出してから実行してください。',
              confirmLabel: 'すべて削除',
              danger: true,
              requireText: '削除'
            }).then((ok) => {
              if (ok) void wipeEverything();
            })
          }
        >
          すべてのデータを削除
        </Button>
      </Section>
    </div>
  );
}

export function SettingsModal() {
  const tab = settingsTab.value;
  return (
    <Modal title="設定" onClose={() => (modal.value = null)} wide>
      <div class="-mt-2 mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 [scrollbar-width:none] dark:border-zinc-800" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => (settingsTab.value = t.id)}
            class={cx('-mb-px shrink-0 border-b-2 px-3 py-2 text-sm', tab === t.id ? 'border-zinc-900 font-medium dark:border-zinc-100' : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'connections' && <ConnectionsTab />}
        {tab === 'chat' && <ChatTab />}
        {tab === 'search' && <SearchTab />}
        {tab === 'skills' && <SkillsTab />}
        {tab === 'privacy' && <PrivacyTab />}
      </div>
    </Modal>
  );
}
