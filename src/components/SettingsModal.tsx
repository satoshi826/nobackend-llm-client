// Settings (tabs: Connections & keys / Chat / Web search / Skills / Usage / Privacy & data)
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  currentConv,
  downloadExport,
  enabledProviders,
  hostOfProvider,
  importFromFile,
  BackupPasswordNeeded,
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
import { imageUsage } from '../lib/db/images';
import { SkillsTab } from './SkillsTab';
import { UsageTab } from './UsageTab';
import { askConfirm } from './ConfirmDialog';
import { Badge, Button, Icon, Modal, cx } from './ui';
import { PERM_LABEL, Section, Toggle, selectCls } from './settings-ui';
import { settingsSections } from './extensions';

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'connections', label: '接続とキー' },
  { id: 'chat', label: 'チャット' },
  { id: 'search', label: 'Web 検索' },
  { id: 'skills', label: 'スキル' },
  { id: 'usage', label: '使用量' },
  { id: 'privacy', label: 'プライバシーとデータ' }
];

function KeyBadge({ id }: { id: string }) {
  const k = keyStatus(id);
  if (k.present) return <Badge tone={k.locked ? 'amber' : 'green'}>{k.locked ? 'ロック中' : 'キー設定済み'}</Badge>;
  return <Badge>{accountById(id)?.keyOptional ? 'キーなしで利用' : 'キー未設定'}</Badge>;
}

/** Collapsible key settings row */
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

/** A provider's key and its provider-specific settings */
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
      <Section title="パスフレーズ（キーと会話の保護）">
        <VaultSecurityPanel />
        {vaultState.value.hasPassphrase && (
          <label class="flex items-center justify-between gap-3 text-sm">
            <span>
              操作がないときに自動でロック
              <span class="block text-xs text-zinc-500">回答の生成中はロックしません</span>
            </span>
            <select class={selectCls} value={String(settings.value.autoLockMinutes)} onChange={(e) => saveSettings({ autoLockMinutes: Number((e.target as HTMLSelectElement).value) })}>
              {[0, 5, 15, 30, 60].map((m) => (
                <option key={m} value={m}>
                  {m ? `${m} 分` : 'しない'}
                </option>
              ))}
            </select>
          </label>
        )}
        <p class="text-xs text-zinc-500">パスフレーズを設定すると、API キー・会話・保存済みのプロンプト・スキルを暗号化します。アプリはタブごと・読み込み直すたびに解錠が必要です。バックアップは、書き出すときにパスワードで暗号化できます（プライバシーとデータ）。</p>
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
      <Section title="返信候補">
        <Toggle
          checked={s.replySuggestions}
          onChange={(v) => saveSettings({ replySuggestions: v })}
          title="回答のあとに返信候補を出す"
          desc="直前のやり取りから、次に送りそうな返信を作ります。押すと入力欄に入ります。回答ごとに小さな依頼が 1 回増えます（費用は「使用量」に「返信候補」として残ります）。"
        />
        <div class={cx('grid gap-3 sm:grid-cols-2', !s.replySuggestions && 'opacity-50')}>
          <label class="flex items-center justify-between gap-3 text-sm">
            候補の数
            <select disabled={!s.replySuggestions} class={selectCls} value={String(s.suggestionCount)} onChange={(e) => saveSettings({ suggestionCount: Number((e.target as HTMLSelectElement).value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} 個
                </option>
              ))}
            </select>
          </label>
          <label class="flex items-center justify-between gap-3 text-sm">
            参考にするやり取り
            <select disabled={!s.replySuggestions} class={selectCls} value={String(s.suggestionTurns)} onChange={(e) => saveSettings({ suggestionTurns: Number((e.target as HTMLSelectElement).value) })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  直前 {n} 回分
                </option>
              ))}
            </select>
          </label>
        </div>
        <label class={cx('block text-sm', !s.replySuggestions && 'opacity-50')}>
          返信候補に使うモデル
          <select disabled={!s.replySuggestions} class={cx(selectCls, 'mt-1 block w-full py-1.5')} value={s.suggestionModel} onChange={(e) => saveSettings({ suggestionModel: (e.target as HTMLSelectElement).value })}>
            <option value="">会話と同じモデル</option>
            {choices.map((m) => (
              <option key={m.providerId + m.id} value={`${m.providerId}|${m.id}`}>
                {providerById(m.providerId)?.name} / {m.name}
                {m.pricing?.inputPerMTok != null ? `（入力 $${m.pricing.inputPerMTok.toFixed(2)}/M）` : ''}
              </option>
            ))}
          </select>
        </label>
      </Section>
      <Section title="画像">
        <p class="text-xs text-zinc-500">入力欄の「画像」をオンにすると、入力した文で画像を作ります（Venice の API キーが必要）。作った画像はこのブラウザに保存され、パスフレーズがあれば暗号化されます。</p>
        <label class="flex items-center justify-between gap-3 text-sm">
          保存する画像の形式
          <select class={selectCls} value={s.imageFormat} onChange={(e) => saveSettings({ imageFormat: (e.target as HTMLSelectElement).value as 'webp' | 'png' | 'jpeg' })}>
            <option value="webp">WebP（小さい）</option>
            <option value="png">PNG（劣化なし）</option>
            <option value="jpeg">JPEG</option>
          </select>
        </label>
        <Toggle
          checked={s.imageTool}
          onChange={(v) => saveSettings({ imageTool: v })}
          title="チャットのモデルが画像を作れるようにする"
          desc="ツール呼び出しに対応したモデルが、会話の流れで必要と判断したときに画像を作ります。送信のたびにツールの説明が少し増えます。"
        />
        {s.imageTool && (
          <label class="flex items-center justify-between gap-3 text-sm">
            画像を作る前の確認
            <select
              class={selectCls}
              value={s.toolPermissions.generate_image ?? 'ask'}
              onChange={(e) => saveSettings({ toolPermissions: { ...s.toolPermissions, generate_image: (e.target as HTMLSelectElement).value as Permission } })}
            >
              {(['ask', 'allow', 'deny'] as Permission[]).map((v) => (
                <option key={v} value={v}>
                  {PERM_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
        )}
      </Section>
      {settingsSections
        .filter((x) => x.tab === 'chat')
        .map((x) => (
          <x.Component key={x.id} />
        ))}
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
  // Encrypted backups: on by default when the vault has a passphrase
  const [encrypt, setEncrypt] = useState(vaultState.value.hasPassphrase);
  const [pw1, setPw1] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [importPw, setImportPw] = useState('');
  const doImport = async (f: File, password?: string) => {
    try {
      const r = await importFromFile(f, password);
      setPendingFile(null);
      setImportPw('');
      showToast(`会話 ${r.conversations} 件${r.skills ? `・スキル ${r.skills} 件` : ''}${r.files ? `・ファイル ${r.files} 件` : ''}${r.images ? `・画像 ${r.images} 枚` : ''}を読み込みました（重複 ${r.skipped} 件はスキップ）`);
    } catch (err) {
      if (err instanceof BackupPasswordNeeded) setPendingFile(f);
      else showToast((err as Error).message, 'error');
    }
  };
  const [imgUsage, setImgUsage] = useState<{ count: number; bytes: number } | null>(null);
  useEffect(() => {
    void imageUsage().then(setImgUsage);
  }, []);
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
          <div class="space-y-1.5">
            <p class="text-xs text-zinc-500">
              使用量 {(usage.used / 1024 / 1024).toFixed(1)} MB / 上限 {(usage.quota / 1024 / 1024 / 1024).toFixed(1)} GB ・{' '}
              {usage.persisted ? '永続化されています（ブラウザが自動で消しにくくなっています）' : '永続化されていません（容量が足りなくなると、ブラウザに消される可能性があります）'}
            </p>
            {!usage.persisted && (
              <Button
                variant="outline"
                class="text-xs"
                onClick={async () => {
                  const ok = (await navigator.storage?.persist?.()) ?? false;
                  setUsage({ ...usage, persisted: ok });
                  showToast(
                    ok ? '永続化されました' : 'ブラウザが永続化を許可しませんでした。ブックマークする・ホーム画面に追加する（PWA）・しばらく使い続けると許可されやすくなります。',
                    ok ? 'info' : 'error'
                  );
                }}
              >
                永続化を要求する
              </Button>
            )}
          </div>
        )}
        <div class="space-y-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1" checked={encrypt} onChange={(e) => setEncrypt((e.target as HTMLInputElement).checked)} />
            <span>
              パスワードで暗号化して書き出す
              <span class="block text-xs text-zinc-500">読み込むときに同じパスワードが要ります。忘れると元に戻せません（キー金庫のパスフレーズと同じでも構いません）。</span>
            </span>
          </label>
          {encrypt && (
            <div class="grid gap-2 sm:grid-cols-2">
              <input type="password" autocomplete="new-password" class={selectCls} placeholder="パスワード（8 文字以上）" value={pw1} onInput={(e) => setPw1((e.target as HTMLInputElement).value)} aria-label="バックアップのパスワード" />
              <input type="password" autocomplete="new-password" class={selectCls} placeholder="確認用" value={pw2} onInput={(e) => setPw2((e.target as HTMLInputElement).value)} aria-label="バックアップのパスワード（確認）" />
            </div>
          )}
          <div class="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || (encrypt && (pw1.length < 8 || pw1 !== pw2))}
              title={encrypt && pw1.length >= 8 && pw1 !== pw2 ? 'パスワードが確認用と一致しません' : undefined}
              onClick={async () => {
                setBusy(true);
                try {
                  await downloadExport(encrypt ? pw1 : undefined);
                  showToast(encrypt ? '暗号化したバックアップを書き出しました' : 'バックアップを書き出しました');
                  setPw1('');
                  setPw2('');
                } catch (err) {
                  showToast((err as Error).message, 'error');
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Icon name="download" />
              {busy ? '書き出しています…' : 'バックアップを書き出す'}
            </Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" />
              読み込む
            </Button>
          </div>
          {pendingFile && (
            <form
              class="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void doImport(pendingFile, importPw);
              }}
            >
              <span class="text-xs text-zinc-600 dark:text-zinc-300">「{pendingFile.name}」は暗号化されています。</span>
              <input type="password" autocomplete="current-password" class={selectCls} placeholder="パスワード" value={importPw} onInput={(e) => setImportPw((e.target as HTMLInputElement).value)} aria-label="バックアップのパスワード" data-autofocus />
              <Button variant="primary" type="submit" disabled={!importPw}>
                復号して読み込む
              </Button>
              <Button onClick={() => setPendingFile(null)}>やめる</Button>
            </form>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            class="hidden"
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              (e.target as HTMLInputElement).value = '';
              if (f) await doImport(f);
            }}
          />
        </div>
        <label class="flex items-start gap-2 text-sm">
          <input type="checkbox" class="mt-1" checked={s.backupIncludeImages} onChange={(e) => saveSettings({ backupIncludeImages: (e.target as HTMLInputElement).checked })} />
          <span>
            バックアップに画像も含める
            <span class="block text-xs text-zinc-500">
              画像はファイルがかなり大きくなります。{imgUsage ? `今は ${imgUsage.count} 枚・${(imgUsage.bytes / 1024 / 1024).toFixed(1)} MB。` : ''}含めない場合、会話には画像の枠だけが残ります。
            </span>
          </span>
        </label>
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
        {tab === 'usage' && <UsageTab />}
        {tab === 'privacy' && <PrivacyTab />}
      </div>
    </Modal>
  );
}
