// UI extension points. Features (src/features/*) register their pieces here at startup, so the core
// screens (sidebar, composer, header, message list, tool cards, settings, main area) never import feature code.
import type { ComponentType } from 'preact';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import type { SendExtras } from '../state/generation';
import type { MediaItem } from '../state/media';
import type { IconName } from './ui';

export type ToolPart = Extract<Part, { type: 'tool' }>;

/**
 * UI text a feature registers. Registration runs at module load, and the language can change later,
 * so pass a function (e.g. () => t('tab')) to have it translated at render time.
 */
export type Text = string | (() => string);
/** Resolve a registered text during render */
export const textOf = (x: Text): string => (typeof x === 'function' ? x() : x);

// ---- input box ----
/** A mode that takes over the input box (e.g. image mode: the text becomes an image prompt) */
export interface ComposerMode {
  id: string;
  placeholder: string;
  touchPlaceholder: string;
  /** Whether sending can work now (e.g. a model with a key is chosen); the send button waits for it */
  ready: boolean;
  send(text: string, conv: Conversation): void | Promise<void>;
  /** Inside the box, before the text (where attaching is in a chat) and after it (before the send button) */
  Start?: ComponentType<{ api: ComposerApi }>;
  End?: ComponentType<{ api: ComposerApi }>;
  /** Where its prompts go, in place of the chat model (bottom right) */
  Model?: ComponentType;
}

/** What a key handler or add-on can do with the input box */
export interface ComposerApi {
  text: string;
  setText(v: string): void;
  focus(): void;
  /** The input box (anchor for popovers such as suggestion lists; components/menu.tsx) */
  box: HTMLElement | null;
}

/** Something added to the input box: a button, content above the text area, extras sent with the message */
export interface ComposerAddon {
  id: string;
  /** Where the button goes: inside the box at the bottom left ('inside', e.g. attach), or in the chip row below the box (default) */
  placement?: 'inside' | 'below';
  /** Still shown while another add-on's mode is active (the mode's own add-on is always shown) */
  alwaysShown?: boolean;
  Button?: ComponentType<{ conv: Conversation }>;
  Above?: ComponentType<{ conv: Conversation; api: ComposerApi }>;
  /** The add-on's mode, when it is active for this conversation */
  mode?(conv: Conversation): ComposerMode | null;
  /** Keys in the text area; return true when handled (the input box then does nothing else) */
  onKeyDown?(e: KeyboardEvent, api: ComposerApi): boolean;
  /** Whether the add-on holds something to send (lets the message be sent without text) */
  hasContent?(): boolean;
  /** Extras for the user message; called once when sending */
  collect?(conv: Conversation): Promise<SendExtras>;
  /** Files dropped or pasted into the input box */
  onFiles?(files: File[], conv: Conversation): void;
}

// ---- sidebar, main area, header ----
/** A tab at the top of the sidebar (the conversation list is the built-in first tab) */
export interface SidebarTab {
  id: string;
  label: Text;
  icon: IconName;
  Panel: ComponentType;
  /** Called when the tab is chosen (e.g. show the feature's screen in the main area) */
  onSelect?(): void;
}

/** A screen shown in the main area instead of the chat (e.g. a file) */
export interface MainView {
  kind: string;
  Component: ComponentType<{ id?: string }>;
}

// ---- messages and tool cards ----
/** How a tool card shows calls of specific tools */
export interface ToolView {
  names: string[];
  /** Card title, e.g. "ファイルの作成" */
  label?(name: string): string | undefined;
  icon?: IconName;
  /** Short text after the title (default: the raw arguments) */
  summary?(p: ToolPart): string | undefined;
  /** Status text once the tool finished (default: "完了") */
  doneStatus?(p: ToolPart): string | undefined;
  /** Extra content under the card header (shown in every state; it decides itself) */
  Detail?: ComponentType<{ p: ToolPart; live: boolean; owner?: { conversationId: string; messageId: string } }>;
  /** Approval card: the input field the user may edit before running (e.g. the search query) */
  editableField?: { key: string; label: Text };
  /** Approval card: where the input goes and what it costs */
  approvalNote?(p: ToolPart): string;
  /** A whole approval card of its own (replaces the default one) */
  Approval?: ComponentType<{ p: ToolPart }>;
}

/** Content a feature renders inside an assistant message (e.g. generated images) */
export interface AssistantExtra {
  id: string;
  Component: ComponentType<{ m: MessageRecord }>;
  /** The message is answered by the feature, not a chat model (no "waiting" text, no "regenerate with another model") */
  owns?(m: MessageRecord): boolean;
  /** For a message it owns: what the line under the answer shows after regenerate, in place of a chat model's name, tokens and cost */
  Footer?: ComponentType<{ m: MessageRecord }>;
}

/** Extra content above a user message's text (e.g. attached files, picked skills, an image request) */
export type MessageExtra = ComponentType<{ m: MessageRecord }>;

// ---- settings ----
/** A whole settings tab (placed between the core tabs and "プライバシーとデータ", in registration order) */
export interface SettingsTabDef {
  id: string;
  label: Text;
  icon: IconName;
  Component: ComponentType;
}

// ---- registries ----
export const composerAddons: ComposerAddon[] = [];
export const sidebarTabs: SidebarTab[] = [];
export const mainViews: MainView[] = [];
export const toolViews: ToolView[] = [];
export const assistantExtras: AssistantExtra[] = [];
export const userMessageExtras: MessageExtra[] = [];
export const settingsTabs: SettingsTabDef[] = [];

const upsert = <T extends { id?: string; kind?: string }>(list: T[], item: T, key: keyof T) => {
  const i = list.findIndex((x) => x[key] === item[key]);
  if (i >= 0) list[i] = item;
  else list.push(item);
};
const once = <T>(list: T[], item: T) => {
  if (!list.includes(item)) list.push(item);
};

export const registerComposerAddon = (a: ComposerAddon) => upsert(composerAddons, a, 'id');
export const registerSidebarTab = (t: SidebarTab) => upsert(sidebarTabs, t, 'id');
export const registerMainView = (v: MainView) => upsert(mainViews, v, 'kind');
export const registerToolView = (v: ToolView) => once(toolViews, v);
export const registerAssistantExtra = (x: AssistantExtra) => upsert(assistantExtras, x, 'id');
export const registerUserMessageExtra = (c: MessageExtra) => once(userMessageExtras, c);
export const registerSettingsTab = (t: SettingsTabDef) => upsert(settingsTabs, t, 'id');

export const toolViewFor = (name: string) => toolViews.find((v) => v.names.includes(name));

/** The active input mode for a conversation, and the add-on that owns it */
export function activeComposerMode(conv: Conversation): { addon: ComposerAddon; mode: ComposerMode } | null {
  for (const addon of composerAddons) {
    const mode = addon.mode?.(conv);
    if (mode) return { addon, mode };
  }
  return null;
}

/** Add-ons shown in the input box right now */
export function visibleComposerAddons(conv: Conversation): ComposerAddon[] {
  const active = activeComposerMode(conv);
  return active ? composerAddons.filter((a) => a === active.addon || a.alwaysShown) : composerAddons;
}

/** Merge the extras of the visible add-ons (arrays are concatenated) */
export async function collectComposerExtras(conv: Conversation): Promise<SendExtras> {
  const out: SendExtras = {};
  for (const a of visibleComposerAddons(conv)) {
    if (!a.collect) continue;
    const e = await a.collect(conv);
    if (e.attachments?.length) out.attachments = [...(out.attachments ?? []), ...e.attachments];
    if (e.skills?.length) out.skills = [...(out.skills ?? []), ...e.skills];
  }
  return out;
}

// ---- connections ----
/** Something a feature does with a connection, named on that connection in Settings → 接続とキー */
export interface ConnectionFeature {
  id: string;
  label: Text;
  icon: IconName;
  /** Whether this connection (a provider id) offers it */
  offeredBy(providerId: string): boolean;
}
export const connectionFeatures: ConnectionFeature[] = [];
export const registerConnectionFeature = (f: ConnectionFeature) => upsert(connectionFeatures, f, 'id');

// ---- the image viewer ----
/** Something a feature makes from an image in the viewer (an edit, an upscale, a video); it runs in the image's chat */
export interface MediaAction {
  id: string;
  icon: IconName;
  label: Text;
  /** Whether it is offered for this image now, and what it does and costs (its tooltip); undefined: not offered */
  offer(item: MediaItem): { title: string } | undefined;
  /** It runs on an instruction (an edit): the placeholder of the field that asks for it; run gets the text */
  instruction?: Text;
  run(item: MediaItem, text?: string): void | Promise<void>;
}
export const mediaActions: MediaAction[] = [];
export const registerMediaAction = (a: MediaAction) => upsert(mediaActions, a, 'id');
