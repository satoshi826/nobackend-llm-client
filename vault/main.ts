// キー金庫のエントリ。本体アプリから iframe で埋め込まれる。
//   ?view=transport          … 画面なし。本体からの送信依頼を中継する
//   ?view=keys&provider=ID   … 1 つの接続先のキーの登録・差し替え・削除（ロック中なら解錠）
//   ?view=security           … パスフレーズ（設定・解錠・ロック・変更・解除）と、すべてのキーの削除
// 依存ライブラリなし。DOM は createElement と textContent だけで組み立てる（innerHTML 不使用）。
import { VAULT_PROTOCOL, type ToVault } from '../src/lib/vault/protocol';
import { MIN_PASSPHRASE_LENGTH } from '../src/lib/crypto/passphrase';
import { handle } from './core';
import { allowedHosts, allStatus, clearAll, label as providerLabel, lock, onChange, remove, removePassphrase, saveKey, setPassphrase, status, unlock, vaultState } from './store';
import { ACCOUNT_IDS as PROVIDER_IDS, accountById } from '../src/lib/keys/accounts';
import './style.css';

// 埋め込みを受け付ける本体のオリジン: ビルド時の指定（別オリジン配置）と、自分自身（同一オリジン配置）
const APP_ORIGINS: string[] = [
  ...String((import.meta as any).env?.VITE_APP_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  location.origin
];
/** 埋め込んでいる本体のオリジン（Chromium 系のみ取得できる） */
const parentOrigin: string | undefined = (location as any).ancestorOrigins?.[0];
const isolated = parentOrigin ? parentOrigin !== location.origin : undefined;

const params = new URLSearchParams(location.search);
const view = params.get('view') ?? 'transport';
if (params.get('theme') === 'dark') document.documentElement.classList.add('dark');

// ---- 本体との接続（MessagePort） ----
const ports = new Set<MessagePort>();

window.addEventListener('message', (e) => {
  if (!APP_ORIGINS.includes(e.origin)) return; // 許可した本体オリジン以外は無視
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
  if (view === 'keys' || view === 'security') void render();
});

// ---- 画面 ----
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
/** 2 段階の確認中の操作（confirm() を使わない） */
let confirming: 'clear-all' | 'remove-pass' | null = null;
let changingPass = false;

function postHeight() {
  // 文書全体の高さは iframe の高さ以下にならないので、中身（root）の高さを測る（縮むときも追従する）
  const height = Math.ceil(root.getBoundingClientRect().height);
  for (const o of APP_ORIGINS) window.parent.postMessage({ type: 'vault-resize', height }, o);
}

function show(m: { ok: boolean; text: string }) {
  message = m;
  void render();
}

async function run(btn: HTMLButtonElement, busy: string, fn: () => Promise<{ ok: boolean; message: string }>) {
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
  const pass = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'パスフレーズ' });
  const btn = h('button', { type: 'submit', class: 'btn primary' }, '解錠');
  return h(
    'form',
    { class: 'stack', onsubmit: (e: Event) => {
      e.preventDefault();
      void run(btn, '解錠中…', () => unlock(pass.value));
    } },
    h('label', {}, note, pass),
    btn
  );
}

/** 確認ボタン付きの危険な操作 */
function dangerAction(kind: 'clear-all' | 'remove-pass', label: string, warning: string, action: () => Promise<{ ok: boolean; message: string }>): HTMLElement {
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

/** 1 つの接続先のキー（登録・差し替え・削除）。金庫がロック中なら解錠 */
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

/** 金庫全体: パスフレーズ（設定・解錠・ロック・変更・解除）と、すべてのキーの削除 */
async function renderSecurity(): Promise<Node[]> {
  const vs = await vaultState();
  const nodes: Node[] = [];
  if (!vs.hasPassphrase) {
    const f = passFields('new-password');
    const btn = h('button', { type: 'submit', class: 'btn primary' }, 'パスフレーズを設定');
    nodes.push(
      h('p', { class: 'muted' }, 'キーは暗号化せずに保存されています。パスフレーズを設定すると、保存済みのキーと今後保存するキーをすべて暗号化します（起動のたびに 1 回解錠が必要になります）。'),
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
    nodes.push(unlockForm('パスフレーズで解錠'), h('p', { class: 'muted' }, 'パスフレーズを忘れた場合は元に戻せません。下の「すべてのキーを削除」から入れ直してください。'));
  } else {
    nodes.push(
      h(
        'div',
        { class: 'card row' },
        h('div', {}, h('div', { class: 'strong' }, '🔒 キーはパスフレーズで暗号化されています（解錠中）'), h('div', { class: 'muted' }, 'ロックすると、次に使うときにパスフレーズが必要になります。')),
        h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onclick: () => lock() }, 'ロック'))
      )
    );
    if (changingPass) {
      const f = passFields('new-password');
      const btn = h('button', { type: 'submit', class: 'btn primary' }, '変更');
      nodes.push(
        h(
          'form',
          { class: 'stack', onsubmit: (e: Event) => {
            e.preventDefault();
            const err = f.check();
            if (err) return show({ ok: false, text: err });
            changingPass = false;
            void run(btn, '暗号化し直しています…', () => setPassphrase(f.p1.value));
          } },
          h('div', { class: 'strong' }, '新しいパスフレーズ'),
          f.box,
          h('div', { class: 'btns' }, btn, h('button', { type: 'button', class: 'btn outline', onclick: () => {
            changingPass = false;
            void render();
          } }, 'やめる'))
        )
      );
    } else {
      nodes.push(
        h(
          'div',
          { class: 'btns' },
          h('button', { type: 'button', class: 'btn outline', onclick: () => {
            changingPass = true;
            void render();
          } }, 'パスフレーズを変更'),
          dangerAction('remove-pass', 'パスフレーズを外す', 'キーを暗号化せずに保存し直します。端末やバックアップからの流出に弱くなります。', removePassphrase)
        )
      );
    }
  }
  nodes.push(
    h('hr', {}),
    dangerAction('clear-all', 'すべてのキーを削除', `保存されているすべての API キー${vs.hasPassphrase ? 'とパスフレーズ' : ''}を削除します。元に戻せません。`, async () => {
      await clearAll();
      return { ok: true, message: 'すべてのキーを削除しました。' };
    })
  );
  return nodes;
}

async function render() {
  const nodes = view === 'security' ? await renderSecurity() : await renderKey(params.get('provider') ?? '');
  if (message) nodes.push(h('p', { class: message.ok ? 'ok' : 'err', role: 'status' }, message.text));
  root.replaceChildren(...nodes);
  postHeight();
}

if (view === 'keys' || view === 'security') {
  // Esc は親（本体）に伝えて、開いている画面を閉じてもらう
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const o of APP_ORIGINS) window.parent.postMessage({ type: 'vault-escape' }, o);
  });
  if (window.parent === window) {
    // 直接開かれた場合（埋め込みでない）は保存領域が別になるため操作させない
    root.replaceChildren(h('p', { class: 'muted' }, 'このページはアプリから埋め込まれて使われます。直接開いても操作できません。'));
  } else {
    void render();
    new ResizeObserver(postHeight).observe(root);
  }
}
