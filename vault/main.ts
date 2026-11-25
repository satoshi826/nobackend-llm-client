// Key vault entry point. Embedded by the app in an iframe.
//   ?view=transport          … no UI. Relays send requests from the app
//   ?view=keys&provider=ID   … add, replace or delete the key of one provider (unlock if locked)
//   ?view=security           … passphrase (set, unlock, lock, change, remove) and deleting all keys
//   ?view=security&setup=1   … only the passphrase setup form (used in the first-run guide)
//   ?view=unlock             … only the unlock form (used on the app's lock screen)
// Every view is opened with ?session=<app page ID>; unlock state is shared only among vault pages with that ID
// No dependencies. The DOM is built with createElement and textContent only (no innerHTML).
import { VAULT_PROTOCOL, type ToVault } from '../src/lib/vault/protocol';
import { MIN_PASSPHRASE_LENGTH } from '../src/lib/crypto/passphrase';
import { handle } from './core';
import { allowedHosts, allStatus, clearAll, label as providerLabel, lock, onChange, remove, removePassphrase, saveKey, setPassphrase, status, unlock, vaultState } from './store';
import { ACCOUNT_IDS as PROVIDER_IDS, accountById } from '../src/lib/keys/accounts';
import './style.css';

// App origins allowed to embed us: the one given at build time (separate-origin hosting) and our own (same-origin hosting)
const APP_ORIGINS: string[] = [
  ...String((import.meta as any).env?.VITE_APP_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  location.origin
];
/** Origin of the embedding app (only available in Chromium-based browsers) */
const parentOrigin: string | undefined = (location as any).ancestorOrigins?.[0];
const isolated = parentOrigin ? parentOrigin !== location.origin : undefined;

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'transport';
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');

// ---- Connection to the app (MessagePort) ----
const ports = new Set<MessagePort>();

window.addEventListener('message', (e) => {
  if (!APP_ORIGINS.includes(e.origin)) return; // ignore anything but the allowed app origins
  if (e.data?.type !== 'connect' || e.data?.protocol !== VAULT_PROTOCOL || !e.ports[0]) return;
  const port = e.ports[0];
  ports.add(port);
  port.onmessage = (ev) => {
    void handle(ev.data as ToVault, (m, transfer) => port.postMessage(m, transfer ?? []));
  };
  void allStatus().then((s) => port.postMessage({ type: 'status', providers: s.keys, vault: s.vault }));
});

onChange(() => {
  void allStatus().then((s) => {
    for (const p of ports) p.postMessage({ type: 'status', providers: s.keys, vault: s.vault });
  });
  if (view === 'keys' || view === 'security' || view === 'unlock') void render();
});

// ---- Views ----
type Child = Node | string | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean | ((e: Event) => void)> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false) el.setAttribute(k, v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const root = document.getElementById('root')!;
let message: { ok: boolean; text: string } | null = null;
/** Action awaiting the second confirmation step (no confirm()) */
let confirming: 'clear-all' | null = null;
/** Whether the passphrase change/remove form is open */
let passMode: 'idle' | 'change' | 'remove' = 'idle';

function postHeight() {
  // The document height never drops below the iframe height, so measure the content (root) instead (follows shrinking too)
  const height = Math.ceil(root.getBoundingClientRect().height);
  for (const o of APP_ORIGINS) window.parent.postMessage({ type: 'vault-resize', height }, o);
}

function show(m: { ok: boolean; text: string }) {
  message = m;
  void render();
}

async function run(btn: HTMLButtonElement, busy: string, fn: () => Promise<{ ok: boolean; message: string }>) {
  message = null;
  btn.disabled = true;
  btn.textContent = busy;
  const r = await fn();
  show({ ok: r.ok, text: r.message });
}

function passFields(autocomplete: string): { box: HTMLElement; p1: HTMLInputElement; p2: HTMLInputElement; check(): string | null } {
  const p1 = h('input', { type: 'password', autocomplete, 'aria-label': 'パスフレーズ' });
  const p2 = h('input', { type: 'password', autocomplete, 'aria-label': 'パスフレーズ（確認）' });
  return {
    box: h('div', { class: 'grid2' }, h('label', {}, 'パスフレーズ', p1), h('label', {}, '確認用', p2)),
    p1,
    p2,
    check: () =>
      p1.value.length < MIN_PASSPHRASE_LENGTH ? `パスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上にしてください。` : p1.value !== p2.value ? 'パスフレーズが確認用と一致しません。' : null
  };
}

function unlockForm(note: string): HTMLElement {
  const pass = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'パスフレーズ', 'data-autofocus': true });
  const btn = h('button', { type: 'submit', class: 'btn primary' }, '解錠');
  const error = h('p', { class: 'err', role: 'alert' });
  return h(
    'form',
    { class: 'stack', onsubmit: async (e: Event) => {
      e.preventDefault();
      message = null;
      error.textContent = '';
      btn.disabled = true;
      btn.textContent = '解錠中…';
      const r = await unlock(pass.value);
      if (r.ok) return show({ ok: true, text: r.message });
      // Keep what was typed so the user can fix it, instead of re-rendering the whole page
      btn.disabled = false;
      btn.textContent = '解錠';
      error.textContent = r.message;
      pass.focus();
      pass.select();
      postHeight();
    } },
    h('label', {}, note, pass),
    btn,
    error
  );
}

/** Dangerous action with a confirm button */
function dangerAction(kind: 'clear-all', label: string, warning: string, action: () => Promise<{ ok: boolean; message: string }>): HTMLElement {
  if (confirming !== kind)
    return h('button', { type: 'button', class: 'btn outline', onclick: () => {
      confirming = kind;
      void render();
    } }, label);
  const yes = h('button', { type: 'button', class: 'btn danger' }, label);
  yes.addEventListener('click', () => {
    confirming = null;
    void run(yes, '処理中…', action);
  });
  return h(
    'div',
    { class: 'card stack', role: 'alert' },
    h('p', {}, warning),
    h('div', { class: 'btns' }, yes, h('button', { type: 'button', class: 'btn outline', onclick: () => {
      confirming = null;
      void render();
    } }, 'やめる'))
  );
}

/** Key of one provider (add, replace, delete). Unlock if the vault is locked */
async function renderKey(id: string): Promise<Node[]> {
  if (!PROVIDER_IDS.includes(id)) return [h('p', { class: 'muted' }, '未対応の接続先です。')];
  const [st, vs] = await Promise.all([status(id), vaultState()]);
  const name = providerLabel(id);
  const nodes: Node[] = [];
  if (params.get('compact') !== '1')
    nodes.push(
      isolated === false
        ? h('p', { class: 'badge-line' }, '🔑 キーはこのブラウザ内のキー保管領域に保存されます（アプリと同じオリジン）。キー金庫を別オリジンに置くと、さらに安全になります。')
        : h('p', { class: 'badge-line' }, '🔒 このフォームはキー金庫（', h('code', {}, location.host), '）の中にあります。入力したキーはアプリ本体には渡りません。')
    );
  if (vs.locked) {
    nodes.push(unlockForm('パスフレーズで解錠（保存済みのすべてのキー）'));
    return nodes;
  }
  if (accountById(id)?.keyOptional && !st.present) nodes.push(h('p', { class: 'muted' }, 'この接続先はキーなしでも使えます（制限付き）。キーを設定すると上限が上がります。'));
  if (st.present) {
    nodes.push(
      h(
        'div',
        { class: 'card row' },
        h('div', {}, h('div', { class: 'strong' }, `登録済みのキー${st.last4 ? `: ••••${st.last4}` : ''}${st.encrypted ? '（暗号化済み）' : ''}`), h('div', { class: 'muted' }, `送信先: ${st.hosts.join(', ')}`)),
        h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onclick: async () => {
          await remove(id);
          show({ ok: true, text: 'キーを削除しました。' });
        } }, '削除'))
      )
    );
  }
  const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: `${name} の API キーを貼り付け`, class: 'mono', 'aria-label': `${name} の API キー` });
  const submit = h('button', { type: 'submit', class: 'btn primary' }, '確認して保存');
  nodes.push(
    h(
      'form',
      { class: 'stack', onsubmit: (e: Event) => {
        e.preventDefault();
        void run(submit, '確認中…', () => saveKey(id, key.value));
      } },
      h('label', {}, st.present ? 'キーを差し替える' : `${name} の API キー`, key),
      h('p', { class: 'muted' }, vs.hasPassphrase ? 'パスフレーズで暗号化して保存します。' : `${isolated === false ? 'このブラウザ' : 'この金庫'}に保存します。暗号化したい場合は、設定の「接続とキー」でパスフレーズを設定してください。`),
      submit
    )
  );
  nodes.push(h('p', { class: 'muted small' }, `キーは ${allowedHosts(id).join(', ')} への通信にだけ付けて送られます。${isolated === false ? '' : 'アプリ本体が乗っ取られても、キーそのものは読み出せません。'}`));
  return nodes;
}

/** Whole vault: passphrase (set, unlock, lock, change, remove) and deleting all keys */
async function renderSecurity(): Promise<Node[]> {
  const vs = await vaultState();
  const setup = params.get('setup') === '1';
  const nodes: Node[] = [];
  if (setup && vs.hasPassphrase) return [h('p', { class: 'ok' }, '🔒 パスフレーズを設定しました。キーと会話は暗号化して保存されます。')];
  if (!vs.hasPassphrase) {
    const f = passFields('new-password');
    const btn = h('button', { type: 'submit', class: 'btn primary' }, setup ? 'パスフレーズを設定して暗号化' : 'パスフレーズを設定');
    nodes.push(
      setup
        ? h('p', { class: 'muted' }, `${MIN_PASSPHRASE_LENGTH} 文字以上。このブラウザでアプリを開くたびに 1 回入力します。`)
        : h('p', { class: 'muted' }, 'キーと会話は暗号化せずに保存されています。パスフレーズを設定すると、API キーと会話（保存済みのプロンプト・スキルを含む）をすべて暗号化し、アプリを開くたびに 1 回の解錠が必要になります。'),
      h(
        'form',
        { class: 'stack', onsubmit: (e: Event) => {
          e.preventDefault();
          const err = f.check();
          if (err) return show({ ok: false, text: err });
          void run(btn, '暗号化中…', () => setPassphrase(f.p1.value));
        } },
        f.box,
        btn
      )
    );
  } else if (vs.locked) {
    nodes.push(unlockForm('パスフレーズで解錠'), h('p', { class: 'muted' }, 'パスフレーズを忘れた場合は元に戻せません。'));
  } else {
    nodes.push(
      h(
        'div',
        { class: 'card row' },
        h('div', {}, h('div', { class: 'strong' }, '🔒 キーと会話はパスフレーズで暗号化されています（解錠中）'), h('div', { class: 'muted' }, 'ロックすると、アプリを読み込み直し、もう一度パスフレーズが必要になります。')),
        h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onclick: () => lock() }, 'ロック'))
      )
    );
    const cancel = h('button', { type: 'button', class: 'btn outline', onclick: () => {
      passMode = 'idle';
      void render();
    } }, 'やめる');
    const current = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': '今のパスフレーズ' });
    if (passMode === 'change') {
      const f = passFields('new-password');
      const btn = h('button', { type: 'submit', class: 'btn primary' }, '変更');
      nodes.push(
        h(
          'form',
          { class: 'stack', onsubmit: (e: Event) => {
            e.preventDefault();
            const err = f.check();
            if (err) return show({ ok: false, text: err });
            void run(btn, '暗号化し直しています…', async () => {
              const r = await setPassphrase(f.p1.value, current.value);
              if (r.ok) passMode = 'idle';
              return r;
            });
          } },
          h('label', {}, '今のパスフレーズ', current),
          h('div', { class: 'strong' }, '新しいパスフレーズ'),
          f.box,
          h('div', { class: 'btns' }, btn, cancel)
        )
      );
    } else if (passMode === 'remove') {
      const btn = h('button', { type: 'submit', class: 'btn danger' }, 'パスフレーズを外す');
      nodes.push(
        h(
          'form',
          { class: 'stack card', onsubmit: (e: Event) => {
            e.preventDefault();
            void run(btn, '復号しています…', async () => {
              const r = await removePassphrase(current.value);
              if (r.ok) passMode = 'idle';
              return r;
            });
          } },
          h('p', {}, 'API キーと会話を暗号化せずに保存し直します。端末のデータやバックアップからの流出に弱くなり、解錠なしで開けるようになります。'),
          h('label', {}, '今のパスフレーズ', current),
          h('div', { class: 'btns' }, btn, cancel)
        )
      );
    } else {
      nodes.push(
        h(
          'div',
          { class: 'btns' },
          h('button', { type: 'button', class: 'btn outline', onclick: () => {
            passMode = 'change';
            void render();
          } }, 'パスフレーズを変更'),
          h('button', { type: 'button', class: 'btn outline', onclick: () => {
            passMode = 'remove';
            void render();
          } }, 'パスフレーズを外す')
        )
      );
    }
  }
  if (setup) return nodes;
  nodes.push(
    h('hr', {}),
    dangerAction('clear-all', 'すべてのキーを削除', `保存されているすべての API キー${vs.hasPassphrase ? 'とパスフレーズを削除します。会話の暗号化も解除されます（会話は残ります）' : 'を削除します'}。元に戻せません。`, async () => {
      await clearAll();
      return { ok: true, message: 'すべてのキーを削除しました。' };
    })
  );
  return nodes;
}

/** The app's lock screen: only the unlock form */
async function renderUnlock(): Promise<Node[]> {
  const vs = await vaultState();
  if (!vs.locked) return [h('p', { class: 'ok' }, '解錠しました。')];
  return [unlockForm('パスフレーズ')];
}

async function render() {
  const nodes = view === 'security' ? await renderSecurity() : view === 'unlock' ? await renderUnlock() : await renderKey(params.get('provider') ?? '');
  if (message) nodes.push(h('p', { class: message.ok ? 'ok' : 'err', role: 'status' }, message.text));
  root.replaceChildren(...nodes);
  postHeight();
  // Put the cursor in the unlock field (unless the user is already working inside this page)
  if (!root.contains(document.activeElement)) root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}

if (view === 'keys' || view === 'security' || view === 'unlock') {
  // Forward Esc to the parent (app) so it closes the open view
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const o of APP_ORIGINS) window.parent.postMessage({ type: 'vault-escape' }, o);
  });
  if (window.parent === window) {
    // When opened directly (not embedded), storage is partitioned differently, so do not allow any actions
    root.replaceChildren(h('p', { class: 'muted' }, 'このページはアプリから埋め込まれて使われます。直接開いても操作できません。'));
  } else {
    void render();
    new ResizeObserver(postHeight).observe(root);
  }
}
