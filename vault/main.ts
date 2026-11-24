// キー金庫のエントリ。本体アプリから iframe で埋め込まれる。
//   ?view=transport          … 画面なし。本体からの送信依頼を中継する
//   ?view=keys&provider=ID   … キーの登録・解錠・ロック・削除の画面
// 依存ライブラリなし。DOM は createElement と textContent だけで組み立てる（innerHTML 不使用）。
import { VAULT_PROTOCOL, type ToVault } from '../src/lib/vault/protocol';
import { MIN_PASSPHRASE_LENGTH } from '../src/lib/crypto/passphrase';
import { handle } from './core';
import { allowedHosts, allStatus, label as providerLabel, lock, onChange, remove, saveKey, status, unlock, type Mode } from './store';
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
  void allStatus().then((providers) => port.postMessage({ type: 'status', providers }));
});

onChange(() => {
  void allStatus().then((providers) => {
    for (const p of ports) p.postMessage({ type: 'status', providers });
  });
  if (view === 'keys') void render();
});

// ---- 画面（キーの管理） ----
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
let mode: Mode = 'plain';

function postHeight() {
  const height = Math.ceil(document.documentElement.scrollHeight);
  for (const o of APP_ORIGINS) window.parent.postMessage({ type: 'vault-resize', height }, o);
}

async function render() {
  const id = params.get('provider') ?? '';
  if (!PROVIDER_IDS.includes(id)) {
    root.replaceChildren(h('p', { class: 'muted' }, '未対応の接続先です。'));
    return postHeight();
  }
  const st = await status(id);
  const name = providerLabel(id);
  const nodes: Node[] = [];

  if (params.get('compact') !== '1') nodes.push(
    isolated === false
      ? h('p', { class: 'badge-line' }, '🔑 キーはこのブラウザ内のキー保管領域に保存されます（アプリと同じオリジン）。キー金庫を別オリジンに置くと、さらに安全になります。')
      : h('p', { class: 'badge-line' }, '🔒 このフォームはキー金庫（', h('code', {}, location.host), '）の中にあります。入力したキーはアプリ本体には渡りません。')
  );
  if (accountById(id)?.keyOptional && !st.present) nodes.push(h('p', { class: 'muted' }, 'この接続先はキーなしでも使えます（制限付き）。キーを設定すると上限が上がります。'));

  if (st.present) {
    const row = h(
      'div',
      { class: 'card row' },
      h('div', {}, h('div', { class: 'strong' }, `登録済みのキー${st.last4 ? `: ••••${st.last4}` : ''}${st.locked ? '（ロック中）' : ''}`), h('div', { class: 'muted' }, `送信先: ${st.hosts.join(', ')}`))
    );
    const btns = h('div', { class: 'btns' });
    if (st.mode === 'encrypted' && !st.locked) btns.append(h('button', { type: 'button', class: 'btn outline', onclick: () => lock(id) }, 'ロック'));
    btns.append(
      h('button', { type: 'button', class: 'btn outline', onclick: async () => {
        await remove(id);
        message = { ok: true, text: 'キーを削除しました。' };
      } }, '削除')
    );
    row.append(btns);
    nodes.push(row);
  }

  if (st.present && st.locked) {
    const pass = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'パスフレーズ' });
    const form = h(
      'form',
      { class: 'stack', onsubmit: async (e: Event) => {
        e.preventDefault();
        const r = await unlock(id, pass.value);
        message = { ok: r.ok, text: r.message };
        void render();
      } },
      h('label', {}, 'パスフレーズで解錠', pass),
      h('button', { type: 'submit', class: 'btn primary' }, '解錠')
    );
    nodes.push(form);
  } else {
    const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: `${name} の API キーを貼り付け`, class: 'mono', 'aria-label': `${name} の API キー` });
    const p1 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'パスフレーズ' });
    const p2 = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'パスフレーズ（確認）' });
    const passBox = h('div', { class: 'grid2', hidden: mode !== 'encrypted' }, h('label', {}, 'パスフレーズ', p1), h('label', {}, '確認用', p2));
    const radios = h('fieldset', { class: 'stack' }, h('legend', {}, '保存方法'));
    const opts: [Mode, string, string][] = [
      ['plain', isolated === false ? 'このブラウザに保存' : 'この金庫に保存', '次回から入力不要。'],
      ['encrypted', 'パスフレーズで暗号化して保存', '起動のたびに解錠。端末やバックアップからの流出に強い。'],
      ['session', 'このセッションのみ', '保存しない。タブを閉じると消える。']
    ];
    for (const [m, title, desc] of opts) {
      const input = h('input', { type: 'radio', name: 'mode', value: m, checked: mode === m, onchange: () => {
        mode = m;
        passBox.hidden = m !== 'encrypted';
        postHeight();
      } });
      radios.append(h('label', { class: 'radio' }, input, h('span', {}, title, h('span', { class: 'muted block' }, desc))));
    }
    const submit = h('button', { type: 'submit', class: 'btn primary' }, '確認して保存');
    const form = h(
      'form',
      { class: 'stack', onsubmit: async (e: Event) => {
        e.preventDefault();
        if (mode === 'encrypted') {
          if (p1.value.length < MIN_PASSPHRASE_LENGTH) return show({ ok: false, text: `パスフレーズは ${MIN_PASSPHRASE_LENGTH} 文字以上にしてください。` });
          if (p1.value !== p2.value) return show({ ok: false, text: 'パスフレーズが確認用と一致しません。' });
        }
        submit.disabled = true;
        submit.textContent = '確認中…';
        const r = await saveKey(id, key.value, mode, p1.value);
        show({ ok: r.ok, text: r.message });
      } },
      h('label', {}, st.present ? 'キーを差し替える' : `${name} の API キー`, key),
      radios,
      passBox,
      submit
    );
    nodes.push(form);
  }

  if (message) nodes.push(h('p', { class: message.ok ? 'ok' : 'err', role: 'status' }, message.text));
  nodes.push(h('p', { class: 'muted small' }, `キーは ${allowedHosts(id).join(', ')} への通信にだけ付けて送られます。${isolated === false ? '' : 'アプリ本体が乗っ取られても、キーそのものは読み出せません。'}`));
  root.replaceChildren(...nodes);
  postHeight();
}

function show(m: { ok: boolean; text: string }) {
  message = m;
  void render();
}

if (view === 'keys') {
  // Esc は親（本体）に伝えて、開いている画面を閉じてもらう
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const o of APP_ORIGINS) window.parent.postMessage({ type: 'vault-escape' }, o);
  });
  if (window.parent === window) {
    // 直接開かれた場合（埋め込みでない）は保存領域が別になるため操作させない
    root.replaceChildren(h('p', { class: 'muted' }, 'このページはアプリから埋め込まれて使われます。直接開いても操作できません。'));
  } else {
    void render();
    new ResizeObserver(postHeight).observe(document.body);
  }
}
