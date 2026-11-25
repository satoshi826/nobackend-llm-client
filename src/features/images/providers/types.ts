// Image providers: one adapter per service (Venice, OpenRouter, Gemini, OpenAI; see docs/specs/image-providers.md).
// The image state calls providers only through this interface.
import type { ImageParams } from '../../../lib/db/schema';
import type { AuthRef, ProviderConfig, Transport } from '../../../lib/providers/types';
import type { ImageModelInfo } from './common';

export type { ImageModelInfo };

export interface ImageCallContext {
  config: ProviderConfig;
  auth: AuthRef | undefined;
  transport: Transport;
  signal?: AbortSignal;
}

export interface GeneratedImages {
  images: Blob[];
  blurred?: boolean;
  /** Variants dropped by the provider's content policy */
  violations?: number;
  enhancedPrompt?: string;
  /** Cost the provider reported for this request (recorded as spend, not an estimate) */
  costUsd?: number;
}

export interface ImageProvider {
  id: string;
  label: string;
  /** Vault account holding the key (an LLM provider id or a service id) */
  account: string;
  /** Image models. auth is set for providers whose list needs the key (keyedList) */
  listModels(config: ProviderConfig, transport: Transport, auth?: AuthRef): Promise<ImageModelInfo[]>;
  /** The model list needs the key (fetched through the key vault) */
  keyedList?: boolean;
  /** Prices fetched separately for one model (OpenRouter); returns the model with pricing filled in */
  loadPricing?(model: ImageModelInfo, config: ProviderConfig, transport: Transport): Promise<ImageModelInfo>;
  listStyles?(ctx: ImageCallContext): Promise<string[]>;
  generate(p: ImageParams, model: ImageModelInfo | undefined, ctx: ImageCallContext): Promise<GeneratedImages>;
  upscale?(source: Blob, scale: 2 | 4, ctx: ImageCallContext): Promise<Blob>;
  edit?(source: Blob, p: ImageParams, ctx: ImageCallContext): Promise<Blob>;
  removeBackground?(source: Blob, ctx: ImageCallContext): Promise<Blob>;
  /** Estimated price in USD; undefined when unknown */
  estimateCost(p: ImageParams, model: ImageModelInfo | undefined): number | undefined;
  /** Who sees the prompt, for the header badge and the tool approval card */
  privacyLabel(model: ImageModelInfo | undefined): { tone: 'green' | 'amber' | 'zinc'; label: string; title: string };
}

const providers = new Map<string, ImageProvider>();

export function registerImageProvider(p: ImageProvider) {
  providers.set(p.id, p);
}

export function imageProviderOf(id: string): ImageProvider | undefined {
  return providers.get(id);
}

export function imageProviderList(): ImageProvider[] {
  return [...providers.values()];
}
