// UI extension points. Features (src/features/*) register their pieces here at startup, so the core
// screens (sidebar, composer, message list, tool cards, main area) do not import feature code.
import type { ComponentType } from 'preact';
import type { Conversation, MessageRecord } from '../lib/db/schema';
import type { Part } from '../lib/providers/types';
import type { SendExtras } from '../state/generation';
import type { IconName } from './ui';

type ToolPart = Extract<Part, { type: 'tool' }>;

/** Something added to the input box: a toolbar button, content above the text area, extras sent with the message */
export interface ComposerAddon {
  id: string;
  /** Not shown in image mode unless true */
  inImageMode?: boolean;
  Button?: ComponentType<{ conv: Conversation }>;
  Above?: ComponentType<{ conv: Conversation }>;
  /** Whether the addon holds something to send (lets the message be sent without text) */
  hasContent?(): boolean;
  /** Extras for the user message; called once when sending */
  collect?(conv: Conversation): Promise<SendExtras>;
  /** Files dropped or pasted into the input box */
  onFiles?(files: File[], conv: Conversation): void;
}

/** A tab at the top of the sidebar (the conversation list is the built-in first tab) */
export interface SidebarTab {
  id: string;
  label: string;
  icon: IconName;
  Panel: ComponentType;
  /** Called when the tab is chosen (e.g. show the feature's screen in the main area) */
  onSelect?(): void;
}

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
  /** Extra content under the card header */
  Detail?: ComponentType<{ p: ToolPart; live: boolean; owner?: { conversationId: string; messageId: string } }>;
}

/** A screen shown in the main area instead of the chat (e.g. a file) */
export interface MainView {
  kind: string;
  Component: ComponentType<{ id?: string }>;
}

/** A section a feature adds to a settings tab */
export interface SettingsSection {
  id: string;
  tab: 'chat' | 'privacy';
  Component: ComponentType;
}

/** Extra content under a user message (e.g. attached files) */
export type MessageExtra = ComponentType<{ m: MessageRecord }>;

export const composerAddons: ComposerAddon[] = [];
export const sidebarTabs: SidebarTab[] = [];
export const toolViews: ToolView[] = [];
export const mainViews: MainView[] = [];
export const userMessageExtras: MessageExtra[] = [];
export const settingsSections: SettingsSection[] = [];

const upsert = <T extends { id?: string; kind?: string }>(list: T[], item: T, key: keyof T) => {
  const i = list.findIndex((x) => x[key] === item[key]);
  if (i >= 0) list[i] = item;
  else list.push(item);
};

export const registerComposerAddon = (a: ComposerAddon) => upsert(composerAddons, a, 'id');
export const registerSidebarTab = (t: SidebarTab) => upsert(sidebarTabs, t, 'id');
export const registerMainView = (v: MainView) => upsert(mainViews, v, 'kind');
export const registerToolView = (v: ToolView) => toolViews.push(v);
export const registerUserMessageExtra = (c: MessageExtra) => userMessageExtras.push(c);
export const registerSettingsSection = (s: SettingsSection) => upsert(settingsSections, s, 'id');

export const toolViewFor = (name: string) => toolViews.find((v) => v.names.includes(name));

/** Merge the extras of every composer addon (arrays are concatenated) */
export async function collectComposerExtras(conv: Conversation, imageMode: boolean): Promise<SendExtras> {
  const out: SendExtras = {};
  for (const a of composerAddons) {
    if (!a.collect || (imageMode && !a.inImageMode)) continue;
    const e = await a.collect(conv);
    if (e.attachments?.length) out.attachments = [...(out.attachments ?? []), ...e.attachments];
  }
  return out;
}
