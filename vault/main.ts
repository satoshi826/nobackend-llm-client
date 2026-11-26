// Key vault entry point. Embedded by the app in an iframe.
//   ?view=transport          … no UI. Relays send requests from the app
//   ?view=keys&provider=ID   … add, show, replace or delete the key of one provider (unlock if locked)
//   ?view=security           … passphrase (set, unlock, lock, change, remove) and deleting all keys
//   ?view=security&setup=1   … only the passphrase setup form (used in the first-run guide)
//   ?view=unlock             … only the unlock form (used on the app's lock screen)
// Every view is opened with ?session=<app page ID>; unlock state is shared only among vault pages with that ID
// No dependencies. The DOM is built with createElement and textContent only (no innerHTML).
import { VAULT_PROTOCOL, type ToVault } from '../src/lib/vault/protocol';
import { detectLang, formatList, getLang, setLang } from '../src/lib/i18n';
import { MIN_PASSPHRASE_LENGTH } from '../src/lib/crypto/passphrase';
import { handle } from './core';
import {
  addPasskey,
  allowedHosts,
  allStatus,
  clearAll,
  label as providerLabel,
  listPasskeys,
  lock,
  onChange,
  passkeySupport,
  remove,
  removePasskey,
  removePassphrase,
  revealKey,
  saveKey,
  setPassphrase,
  status,
  unlock,
  unlockWithPasskey,
  vaultState
} from './store';
import { formatDateTime } from '../src/lib/i18n';
import { ACCOUNT_IDS as PROVIDER_IDS, accountById } from '../src/lib/keys/accounts';
import './style.css';
import { t } from './messages';

// App origins allowed to embed us: the one given at build time (separate-origin hosting) and our own (same-origin hosting)
const APP_ORIGINS: string[] = [
  ...String((import.meta as any).env?.VITE_APP_ORIGIN || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  // never 'null', the origin of every sandboxed frame
  ...(location.origin !== 'null' ? [location.origin] : [])
];
/** Origin of the embedding app (only available in Chromium-based browsers) */
const parentOrigin: string | undefined = (location as any).ancestorOrigins?.[0];
const isolated = parentOrigin ? parentOrigin !== location.origin : undefined;

const params = new URLSearchParams(location.search);
/** Touch-first device (same test as the app's components/device.ts, which the vault cannot import) */
const touchDevice = matchMedia('(pointer: coarse)').matches;
const view = params.get('view') ?? 'transport';
// The app passes its language; a vault opened on its own follows the browser
{
  const l = params.get('lang');
  setLang(l === 'ja' || l === 'en' || l === 'zh' ? l : detectLang());
  document.documentElement.lang = getLang();
}
// Dark unless the app asks for light (the app is dark only for now)
document.documentElement.classList.toggle('dark', params.get('theme') !== 'light');

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
  reveal = null; // hide the shown key whenever the vault changes (lock, replace, delete)
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
let confirming: 'clear-all' | 'delete-key' | null = null;
/** Passkey (credential id) whose removal awaits confirmation */
let confirmingPasskey: string | null = null;
/** Whether the passphrase change/remove form is open */
let passMode: 'idle' | 'change' | 'remove' = 'idle';
/** Showing the saved key: asking for the passphrase, or the key shown in full */
let reveal: 'asking' | { key: string } | null = null;

function postHeight() {
  // The document height never drops below the iframe height, so measure the content (root) instead (follows shrinking too)
  const height = Math.ceil(root.getBoundingClientRect().height);
  for (const o of APP_ORIGINS) window.parent.postMessage({ type: 'vault-resize', height }, o);
}

function show(m: { ok: boolean; text: string }) {
  message = m;
  void render();
}

/** Run a button's action: the button keeps its label and shows a spinner over it (aria-busy) until it is done */
async function run(btn: HTMLButtonElement, fn: () => Promise<{ ok: boolean; message: string }>) {
  message = null;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  const r = await fn();
  show({ ok: r.ok, text: r.message });
}

function passFields(autocomplete: string): { box: HTMLElement; p1: HTMLInputElement; p2: HTMLInputElement; check(): string | null } {
  const p1 = h('input', { type: 'password', autocomplete, 'aria-label': t('pass.label') });
  const p2 = h('input', { type: 'password', autocomplete, 'aria-label': t('pass.confirmAria') });
  return {
    box: h('div', { class: 'grid2' }, h('label', {}, t('pass.label'), p1), h('label', {}, t('pass.confirm'), p2)),
    p1,
    p2,
    check: () =>
      p1.value.length < MIN_PASSPHRASE_LENGTH ? t('pass.tooShort', { min: MIN_PASSPHRASE_LENGTH }) : p1.value !== p2.value ? t('pass.mismatch') : null
  };
}

/** Passkey button for the unlock forms (focused first, so Enter uses it) */
function passkeyUnlockButton(): HTMLElement {
  const error = h('p', { class: 'err', role: 'alert' });
  const btn = h('button', { type: 'button', class: 'btn primary', 'data-autofocus': true }, t('passkey.unlock'));
  btn.addEventListener('click', async () => {
    message = null;
    error.textContent = '';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    const r = await unlockWithPasskey();
    if (r.ok) return show({ ok: true, text: r.message });
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    error.textContent = r.message;
    postHeight();
  });
  return h('div', { class: 'stack' }, btn, error);
}

function unlockForm(note: string, passkeys = false): HTMLElement {
  const pass = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': t('pass.label'), 'data-autofocus': !passkeys });
  const btn = h('button', { type: 'submit', class: 'btn primary' }, t('unlock.button'));
  const error = h('p', { class: 'err', role: 'alert' });
  return h(
    'form',
    { class: 'stack', onsubmit: async (e: Event) => {
      e.preventDefault();
      message = null;
      error.textContent = '';
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      const r = await unlock(pass.value);
      if (r.ok) return show({ ok: true, text: r.message });
      // Keep what was typed so the user can fix it, instead of re-rendering the whole page
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      error.textContent = r.message;
      pass.focus();
      pass.select();
      postHeight();
    } },
    passkeys && passkeyUnlockButton(),
    passkeys && h('div', { class: 'muted small' }, t('passkey.or')),
    h('label', {}, note, pass),
    btn,
    error
  );
}

/** Registered passkeys and registering a new one (security view, while unlocked with a passphrase) */
async function passkeySection(): Promise<Node[]> {
  const [list, support] = await Promise.all([listPasskeys(), passkeySupport()]);
  const add = h('button', { type: 'button', class: 'btn outline' }, t('passkey.add'));
  add.addEventListener('click', () => void run(add, addPasskey));
  return [
    h('hr', {}),
    h('div', { class: 'strong' }, t('passkey.title')),
    h('p', { class: 'muted' }, t('passkey.desc')),
    ...(list.length
      ? list.map((p) =>
          h(
            'div',
            { class: 'card row' },
            h(
              'div',
              { class: 'fill' },
              h('div', {}, t('passkey.item', { date: formatDateTime(p.createdAt) })),
              p.lastUsedAt ? h('div', { class: 'muted small' }, t('passkey.lastUsed', { date: formatDateTime(p.lastUsedAt) })) : null
            ),
            confirmingPasskey === p.credentialId
              ? null
              : h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn danger', onclick: () => {
                  confirmingPasskey = p.credentialId;
                  void render();
                } }, t('common.delete')))
          )
        )
        .flatMap((row, i) => {
          const p = list[i];
          if (confirmingPasskey !== p.credentialId) return [row];
          const yes = h('button', { type: 'button', class: 'btn danger' }, t('common.delete'));
          yes.addEventListener('click', () => {
            confirmingPasskey = null;
            void run(yes, async () => {
              await removePasskey(p.credentialId);
              return { ok: true, message: t('passkey.removed') };
            });
          });
          return [
            row,
            h(
              'div',
              { class: 'card stack', role: 'alert' },
              h('p', {}, t('passkey.deleteWarning')),
              h('div', { class: 'btns' }, yes, h('button', { type: 'button', class: 'btn outline', onclick: () => {
                confirmingPasskey = null;
                void render();
              } }, t('common.cancel')))
            )
          ];
        })
      : [h('p', { class: 'muted small' }, t('passkey.listEmpty'))]),
    support === false ? h('p', { class: 'muted small' }, t('passkey.unsupportedNote')) : h('div', { class: 'btns' }, add),
    h('p', { class: 'muted small' }, t('passkey.changeNote'))
  ];
}

/** A translated sentence with one placeholder shown as <code> (one template per sentence, so word order can differ) */
function withCode(text: string, placeholder: string, code: string): Child[] {
  const i = text.indexOf(placeholder);
  if (i < 0) return [text];
  return [text.slice(0, i), h('code', {}, code), text.slice(i + placeholder.length)];
}

function registeredLabel(last4: string, encrypted: boolean): string {
  if (last4) return t(encrypted ? 'key.registeredLast4Encrypted' : 'key.registeredLast4', { last4 });
  return t(encrypted ? 'key.registeredEncrypted' : 'key.registered');
}

async function showKey(id: string, pass?: string): Promise<string | null> {
  const r = await revealKey(id, pass);
  if (!r.ok) return r.message;
  reveal = { key: r.key };
  void render();
  return null;
}

/** Passphrase asked again before showing a saved key */
function revealForm(id: string): HTMLElement {
  const pass = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': t('pass.label'), 'data-autofocus': true });
  const btn = h('button', { type: 'submit', class: 'btn primary' }, t('key.show'));
  const error = h('p', { class: 'err', role: 'alert' });
  const cancel = h('button', { type: 'button', class: 'btn outline', onclick: () => {
    reveal = null;
    void render();
  } }, t('common.cancel'));
  return h(
    'form',
    { class: 'stack', onsubmit: async (e: Event) => {
      e.preventDefault();
      error.textContent = '';
      btn.disabled = true;
      const failed = await showKey(id, pass.value);
      if (!failed) return;
      btn.disabled = false;
      error.textContent = failed;
      pass.focus();
      pass.select();
      postHeight();
    } },
    h('label', {}, t('key.revealNote'), pass),
    h('div', { class: 'btns' }, btn, cancel),
    error
  );
}

/** The second step of a destructive action: what will happen, then the action or cancel */
function confirmCard(warning: string, label: string, action: () => Promise<{ ok: boolean; message: string }>): HTMLElement {
  const yes = h('button', { type: 'button', class: 'btn danger' }, label);
  yes.addEventListener('click', () => {
    confirming = null;
    void run(yes, action);
  });
  return h(
    'div',
    { class: 'card stack', role: 'alert' },
    h('p', {}, warning),
    h('div', { class: 'btns' }, yes, h('button', { type: 'button', class: 'btn outline', onclick: () => {
      confirming = null;
      void render();
    } }, t('common.cancel')))
  );
}

/** Dangerous action: a button that turns into its confirm card */
function dangerAction(kind: 'clear-all', label: string, warning: string, action: () => Promise<{ ok: boolean; message: string }>): HTMLElement {
  if (confirming === kind) return confirmCard(warning, label, action);
  return h('button', { type: 'button', class: 'btn danger', onclick: () => {
    confirming = kind;
    void render();
  } }, label);
}

/** Key of one provider (add, show, replace, delete). Unlock if the vault is locked */
async function renderKey(id: string): Promise<Node[]> {
  if (!PROVIDER_IDS.includes(id)) return [h('p', { class: 'muted' }, t('common.unsupportedProvider'))];
  const [st, vs] = await Promise.all([status(id), vaultState()]);
  const name = providerLabel(id);
  const nodes: Node[] = [];
  if (params.get('compact') !== '1')
    nodes.push(
      isolated === false
        ? h('p', { class: 'badge-line' }, t('key.sameOrigin'))
        : h('p', { class: 'badge-line' }, ...withCode(t('key.isolated'), '{host}', location.host))
    );
  if (vs.locked) {
    nodes.push(unlockForm(t('key.unlockAll'), (await listPasskeys()).length > 0));
    return nodes;
  }
  if (accountById(id)?.keyOptional && !st.present) nodes.push(h('p', { class: 'muted' }, t('key.optional')));
  if (st.present) {
    const shown = reveal !== null && reveal !== 'asking' ? reveal.key : null;
    const toggle = shown
      ? h('button', { type: 'button', class: 'btn outline', onclick: () => {
          reveal = null;
          void render();
        } }, t('key.hide'))
      : h('button', { type: 'button', class: 'btn outline', onclick: async () => {
          if (vs.hasPassphrase) {
            reveal = 'asking';
            return void render();
          }
          const failed = await showKey(id);
          if (failed) show({ ok: false, text: failed });
        } }, t('key.show'));
    nodes.push(
      h(
        'div',
        { class: 'card row' },
        h(
          'div',
          { class: 'fill' },
          h('div', { class: 'strong' }, registeredLabel(st.last4, st.encrypted)),
          shown && h('div', { class: 'mono secret' }, shown),
          h('div', { class: 'muted' }, t('key.hosts', { hosts: formatList(st.hosts) }))
        ),
        h('div', { class: 'btns' }, toggle, h('button', { type: 'button', class: 'btn danger', onclick: () => {
          confirming = 'delete-key';
          void render();
        } }, t('common.delete')))
      )
    );
    if (confirming === 'delete-key')
      nodes.push(
        confirmCard(t('key.deleteWarning', { name }), t('common.delete'), async () => {
          await remove(id);
          return { ok: true, message: t('key.deleted') };
        })
      );
    if (reveal === 'asking') nodes.push(revealForm(id));
  }
  const key = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', placeholder: t('key.placeholder', { name }), class: 'mono', 'aria-label': t('key.label', { name }) });
  const submit = h('button', { type: 'submit', class: 'btn primary' }, t('key.save'));
  nodes.push(
    h(
      'form',
      { class: 'stack', onsubmit: (e: Event) => {
        e.preventDefault();
        void run(submit, () => saveKey(id, key.value));
      } },
      h('label', {}, st.present ? t('key.replace') : t('key.label', { name }), key),
      h('p', { class: 'muted' }, vs.hasPassphrase ? t('key.encryptNote') : isolated === false ? t('key.plainNoteBrowser') : t('key.plainNoteVault')),
      submit
    )
  );
  nodes.push(h('p', { class: 'muted small' }, t(isolated === false ? 'key.scope' : 'key.scopeIsolated', { hosts: formatList(allowedHosts(id)) })));
  return nodes;
}

/** Whole vault: passphrase (set, unlock, lock, change, remove) and deleting all keys */
async function renderSecurity(): Promise<Node[]> {
  const vs = await vaultState();
  const setup = params.get('setup') === '1';
  const nodes: Node[] = [];
  if (setup && vs.hasPassphrase) return [h('p', { class: 'ok' }, t('security.setupDone'))];
  if (!vs.hasPassphrase) {
    const f = passFields('new-password');
    const btn = h('button', { type: 'submit', class: 'btn primary' }, setup ? t('security.setupButton') : t('security.setButton'));
    nodes.push(
      setup
        ? h('p', { class: 'muted' }, t('security.setupHint', { min: MIN_PASSPHRASE_LENGTH }))
        : h('p', { class: 'muted' }, t('security.unencrypted')),
      h(
        'form',
        { class: 'stack', onsubmit: (e: Event) => {
          e.preventDefault();
          const err = f.check();
          if (err) return show({ ok: false, text: err });
          void run(btn, () => setPassphrase(f.p1.value));
        } },
        f.box,
        btn
      )
    );
  } else if (vs.locked) {
    nodes.push(unlockForm(t('security.unlockLabel'), (await listPasskeys()).length > 0), h('p', { class: 'muted' }, t('security.forgotten')));
  } else {
    nodes.push(
      h(
        'div',
        { class: 'card row' },
        h('div', {}, h('div', { class: 'strong' }, t('security.unlocked')), h('div', { class: 'muted' }, t('security.lockHint'))),
        h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn outline', onclick: () => lock() }, t('security.lock')))
      )
    );
    const cancel = h('button', { type: 'button', class: 'btn outline', onclick: () => {
      passMode = 'idle';
      void render();
    } }, t('common.cancel'));
    const current = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': t('pass.current') });
    if (passMode === 'change') {
      const f = passFields('new-password');
      const btn = h('button', { type: 'submit', class: 'btn primary' }, t('security.change'));
      nodes.push(
        h(
          'form',
          { class: 'stack', onsubmit: (e: Event) => {
            e.preventDefault();
            const err = f.check();
            if (err) return show({ ok: false, text: err });
            void run(btn, async () => {
              const r = await setPassphrase(f.p1.value, current.value);
              if (r.ok) passMode = 'idle';
              return r;
            });
          } },
          h('label', {}, t('pass.current'), current),
          h('div', { class: 'strong' }, t('pass.new')),
          f.box,
          h('div', { class: 'btns' }, btn, cancel)
        )
      );
    } else if (passMode === 'remove') {
      const btn = h('button', { type: 'submit', class: 'btn danger' }, t('security.remove'));
      nodes.push(
        h(
          'form',
          { class: 'stack card', onsubmit: (e: Event) => {
            e.preventDefault();
            void run(btn, async () => {
              const r = await removePassphrase(current.value);
              if (r.ok) passMode = 'idle';
              return r;
            });
          } },
          h('p', {}, t('security.removeWarning')),
          h('label', {}, t('pass.current'), current),
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
          } }, t('security.changeOpen')),
          h('button', { type: 'button', class: 'btn outline', onclick: () => {
            passMode = 'remove';
            void render();
          } }, t('security.remove'))
        )
      );
    }
  }
  if (setup) return nodes;
  if (vs.hasPassphrase && !vs.locked && passMode === 'idle') nodes.push(...(await passkeySection()));
  nodes.push(
    h('hr', {}),
    dangerAction('clear-all', t('security.clearAll'), vs.hasPassphrase ? t('security.clearAllWarningPass') : t('security.clearAllWarning'), async () => {
      await clearAll();
      return { ok: true, message: t('security.clearedAll') };
    })
  );
  return nodes;
}

/** The app's lock screen: only the unlock form */
async function renderUnlock(): Promise<Node[]> {
  const vs = await vaultState();
  if (!vs.locked) return [h('p', { class: 'ok' }, t('unlock.done'))];
  return [unlockForm(t('pass.label'), (await listPasskeys()).length > 0)];
}

async function render() {
  const nodes = view === 'security' ? await renderSecurity() : view === 'unlock' ? await renderUnlock() : await renderKey(params.get('provider') ?? '');
  if (message) nodes.push(h('p', { class: message.ok ? 'ok' : 'err', role: 'status' }, message.text));
  root.replaceChildren(...nodes);
  postHeight();
  // Put the cursor in the unlock field (unless the user is already working inside this page). On touch devices only
  // on the app's lock screen, where typing is the only way on: elsewhere it would bring up the on-screen keyboard
  if (touchDevice && view !== 'unlock') return;
  if (!root.contains(document.activeElement)) root.querySelector<HTMLElement>('[data-autofocus]')?.focus();
}

if (view === 'keys' || view === 'security' || view === 'unlock') {
  // Forward Esc to the parent (app) so it closes the open view
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const o of APP_ORIGINS) window.parent.postMessage({ type: 'vault-escape' }, o);
  });
  if (window.parent === window) {
    // When opened directly (not embedded), storage is partitioned differently, so do not allow any actions
    root.replaceChildren(h('p', { class: 'muted' }, t('common.embedOnly')));
  } else {
    void render();
    new ResizeObserver(postHeight).observe(root);
  }
}
