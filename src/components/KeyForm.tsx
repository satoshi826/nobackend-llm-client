import { useState } from 'preact/hooks';
import { currentProviderId, hostOfProvider, keyInfos, lockKey, providerById, removeKey, saveKey, showToast, unlockKey } from '../state/app';
import type { SecretMode } from '../lib/db/repo';
import { MIN_PASSPHRASE_LENGTH } from '../lib/crypto/passphrase';
import { VENICE_KEY_GUIDE } from '../lib/providers/presets/venice';
import { OPENROUTER_KEY_GUIDE } from '../lib/providers/presets/openrouter';

import { vaultEnabled } from '../lib/vault/client';
import { serviceById, serviceHost } from '../lib/tools/services';
import { VaultKeyFrame } from './VaultKeyFrame';

const GUIDES: Record<string, string> = { venice: VENICE_KEY_GUIDE, openrouter: OPENROUTER_KEY_GUIDE };
const EMPTY = { present: false, mode: null, locked: false, hosts: [] as string[], last4: '' };
import { Button, Icon, cx } from './ui';

const MODE_LABEL: Record<SecretMode, string> = {
  plain: 'このブラウザに保存',
  encrypted: 'パスフレーズで暗号化して保存',
  session: 'このセッションのみ（タブを閉じると消える）'
};

const MODES: { id: SecretMode; title: string; desc: string }[] = [
  { id: 'plain', title: 'このブラウザに保存', desc: '次回から入力不要。手軽さ優先。' },
  { id: 'encrypted', title: 'パスフレーズで暗号化して保存', desc: '起動のたびにパスフレーズで解錠。端末やバックアップからの流出に強い。' },
  { id: 'session', title: 'このセッションのみ', desc: '保存しない。タブを閉じると消える（共有 PC 向け）。' }
];

const inputCls = 'mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950';

export function KeyForm({ providerId, onSaved }: { providerId: string; onSaved?(): void }) {
  if (vaultEnabled) return <VaultKeyForm providerId={providerId} />;
  return <DirectKeyForm providerId={providerId} onSaved={onSaved} />;
}

function VaultKeyForm({ providerId }: { providerId: string }) {
  const cfg = providerById(providerId);
  const svc = serviceById(providerId);
  return (
    <div class="space-y-3">
      <VaultKeyFrame providerId={providerId} />
      <div class="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
        <div class="mb-1 flex items-center gap-1 font-semibold">
          <Icon name="shield" class="size-3.5" />
          安全に使うために
        </div>
        {GUIDES[cfg?.preset ?? ''] ?? svc?.keyGuide ?? ''}
      </div>
    </div>
  );
}

function DirectKeyForm({ providerId, onSaved }: { providerId: string; onSaved?(): void }) {
  const [key, setKey] = useState('');
  const [mode, setMode] = useState<SecretMode>('plain');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const info = keyInfos.value[providerId] ?? EMPTY;
  const cfg = providerById(providerId);
  const svc = serviceById(providerId);
  const name = cfg?.name ?? svc?.label ?? providerId;
  const host = hostOfProvider(providerId) || serviceHost(providerId);

  const passError =
    mode !== 'encrypted' ? null : pass.length > 0 && pass.length < MIN_PASSPHRASE_LENGTH ? `${MIN_PASSPHRASE_LENGTH} 文字以上にしてください` : pass2 && pass !== pass2 ? '確認用と一致しません' : null;
  const canSubmit = !!key.trim() && !busy && (mode !== 'encrypted' || (pass.length >= MIN_PASSPHRASE_LENGTH && pass === pass2));

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveKey(providerId, key, mode, mode === 'encrypted' ? pass : undefined);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) {
        setKey('');
        setPass('');
        setPass2('');
        onSaved?.();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="space-y-4">
      {info.present && (
        <div class="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
          <div class="min-w-0">
            <div class="font-medium">
              登録済みのキー{info.last4 ? `: ••••${info.last4}` : ''}
              {info.locked && <span class="ml-1 text-xs text-amber-700 dark:text-amber-400">（ロック中）</span>}
            </div>
            <div class="text-xs text-zinc-500">
              送信先: {info.hosts.join(', ')} / {info.mode ? MODE_LABEL[info.mode] : ''}
            </div>
          </div>
          <div class="flex shrink-0 gap-1">
            {info.mode === 'encrypted' && !info.locked && (
              <Button variant="outline" onClick={() => lockKey(providerId).then(() => showToast('ロックしました'))}>
                <Icon name="lock" />
                ロック
              </Button>
            )}
            <Button
              variant="outline"
              onClick={async () => {
                await removeKey(providerId);
                showToast('キーを削除しました');
              }}
            >
              削除
            </Button>
          </div>
        </div>
      )}
      <form onSubmit={submit} class="space-y-3">
        <label class="block text-sm font-medium">
          {info.present ? 'キーを差し替える' : `${name} の API キー`}
          <input
            type="password"
            autoComplete="off"
            spellcheck={false}
            value={key}
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
            placeholder={`${name} の API キーを貼り付け`}
            class={cx(inputCls, 'font-mono')}
          />
        </label>
        <fieldset class="space-y-1.5">
          <legend class="mb-1 text-sm font-medium">保存方法</legend>
          {MODES.map((m) => (
            <label key={m.id} class="flex items-start gap-2 text-sm">
              <input type="radio" name={`key-mode-${providerId}`} class="mt-1" checked={mode === m.id} onChange={() => setMode(m.id)} />
              <span>
                {m.title}
                <span class="block text-xs text-zinc-500">{m.desc}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode === 'encrypted' && (
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="block text-sm">
              パスフレーズ
              <input type="password" autoComplete="new-password" value={pass} onInput={(e) => setPass((e.target as HTMLInputElement).value)} class={inputCls} />
            </label>
            <label class="block text-sm">
              確認用
              <input type="password" autoComplete="new-password" value={pass2} onInput={(e) => setPass2((e.target as HTMLInputElement).value)} class={inputCls} />
            </label>
            <p class="text-xs text-zinc-500 sm:col-span-2">
              パスフレーズを忘れるとキーは復元できません（キーを登録し直せば使えます）。解錠中はメモリ上にキーがあるため、XSS への対策にはなりません。
            </p>
            {passError && <p class="text-xs text-rose-700 sm:col-span-2 dark:text-rose-400">{passError}</p>}
          </div>
        )}
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {busy ? (mode === 'encrypted' ? '確認・暗号化中…' : '確認中…') : '確認して保存'}
        </Button>
        {msg && (
          <p role="status" class={msg.ok ? 'text-sm text-emerald-700 dark:text-emerald-400' : 'text-sm text-rose-700 dark:text-rose-400'}>
            {msg.text}
          </p>
        )}
      </form>
      <div class="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
        <div class="mb-1 flex items-center gap-1 font-semibold">
          <Icon name="shield" class="size-3.5" />
          安全に使うために
        </div>
        {GUIDES[cfg?.preset ?? ''] ?? svc?.keyGuide ?? ''}
        <div class="mt-1">キーは登録したホスト（{info.hosts[0] ?? host}）への通信にだけ使われ、それ以外の宛先には送信されません。エクスポートにも含まれません。</div>
      </div>
    </div>
  );
}

/** 暗号化キーの解錠画面 */
export function UnlockForm() {
  if (vaultEnabled) {
    return (
      <div class="scroll-thin flex-1 overflow-y-auto">
        <div class="mx-auto max-w-md space-y-3 px-5 py-12">
          <h1 class="text-xl font-semibold">キーがロックされています</h1>
          <p class="text-sm text-zinc-500">{providerById(currentProviderId.value)?.name} の API キーはキー金庫の中で暗号化されています。下のフォーム（金庫の中）で解錠してください。</p>
          <VaultKeyFrame providerId={currentProviderId.value} />
        </div>
      </div>
    );
  }
  return <DirectUnlockForm />;
}

function DirectUnlockForm() {
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div class="scroll-thin flex-1 overflow-y-auto">
      <form
        class="mx-auto max-w-sm space-y-3 px-5 py-16"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr('');
          const r = await unlockKey(currentProviderId.value, pass);
          setBusy(false);
          if (!r.ok) setErr(r.message);
          else setPass('');
        }}
      >
        <div class="mb-2 grid size-12 place-items-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
          <Icon name="lock" class="size-6 text-zinc-500" />
        </div>
        <h1 class="text-xl font-semibold">キーがロックされています</h1>
        <p class="text-sm text-zinc-500">{providerById(currentProviderId.value)?.name} の API キーはパスフレーズで暗号化されています。解錠すると、このタブを閉じるまで使えます。</p>
        <label class="block text-sm">
          パスフレーズ
          <input type="password" autoComplete="current-password" autoFocus value={pass} onInput={(e) => setPass((e.target as HTMLInputElement).value)} class={inputCls} />
        </label>
        {err && (
          <p role="alert" class="text-sm text-rose-700 dark:text-rose-400">
            {err}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={!pass || busy} class="w-full">
          {busy ? '解錠中…' : '解錠'}
        </Button>
        <p class="text-xs text-zinc-500">パスフレーズを忘れた場合は、設定からキーを削除して登録し直してください。</p>
      </form>
    </div>
  );
}
