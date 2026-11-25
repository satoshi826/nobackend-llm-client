// The option bar shown above the input box in image mode
import { useEffect, useState } from 'preact/hooks';
import { aspectsOf, estimateImageCost } from '../lib/images/venice';
import {
  currentImageModel,
  imageModels,
  imageModelsError,
  imageReady,
  imageStyles,
  loadImageModels,
  loadImageStyles,
  openSettings,
  paramsFromBar,
  setImageDefaults,
  settings
} from '../state/app';
import { Button, Icon, Spinner, cx } from './ui';

const sel = 'min-w-0 rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-950';

export function ImageBar() {
  const [details, setDetails] = useState(false);
  useEffect(() => {
    void loadImageModels();
    void loadImageStyles();
  }, [imageReady.value]);
  if (!imageReady.value)
    return (
      <div class="flex flex-wrap items-center gap-2 px-3 pt-2.5 text-xs text-amber-700 dark:text-amber-400">
        画像の生成には Venice の API キーが必要です。
        <Button class="text-xs" variant="outline" onClick={() => openSettings('connections')}>
          キーを設定
        </Button>
      </div>
    );
  const d = settings.value.imageDefaults;
  const m = currentImageModel.value;
  const list = imageModels.value;
  if (!list.length)
    return (
      <div class="flex items-center gap-2 px-3 pt-2.5 text-xs text-zinc-500">
        {imageModelsError.value ? (
          <>
            画像モデルの一覧を取得できませんでした: {imageModelsError.value}
            <Button class="text-xs" onClick={() => void loadImageModels(true)}>
              再試行
            </Button>
          </>
        ) : (
          <>
            <Spinner class="size-3" />
            画像モデルを読み込んでいます
          </>
        )}
      </div>
    );
  const aspects = aspectsOf(m);
  const cost = estimateImageCost(paramsFromBar(''), m);
  return (
    <div class="space-y-1.5 px-3 pt-2.5 text-xs" role="group" aria-label="画像の設定">
      <div class="flex flex-wrap items-center gap-1.5">
        <select aria-label="画像モデル" class={cx(sel, 'max-w-[12rem]')} value={m?.id ?? ''} onChange={(e) => void setImageDefaults({ model: (e.target as HTMLSelectElement).value, resolution: '' })}>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
              {x.privacy === 'private' ? '' : '（外部中継）'}
            </option>
          ))}
        </select>
        <select aria-label="縦横比" class={sel} value={aspects.includes(d.aspectRatio) ? d.aspectRatio : (m?.constraints.defaultAspectRatio ?? aspects[0])} onChange={(e) => void setImageDefaults({ aspectRatio: (e.target as HTMLSelectElement).value })}>
          {aspects.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        {!!m?.constraints.resolutions?.length && (
          <select aria-label="解像度" class={sel} value={d.resolution || m.constraints.defaultResolution || m.constraints.resolutions[0]} onChange={(e) => void setImageDefaults({ resolution: (e.target as HTMLSelectElement).value })}>
            {m.constraints.resolutions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <select aria-label="枚数" class={sel} value={String(d.variants)} onChange={(e) => void setImageDefaults({ variants: Number((e.target as HTMLSelectElement).value) })}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} 枚
            </option>
          ))}
        </select>
        {imageStyles.value.length > 0 && (
          <select aria-label="スタイル" class={cx(sel, 'max-w-[9rem]')} value={d.style} onChange={(e) => void setImageDefaults({ style: (e.target as HTMLSelectElement).value })}>
            <option value="">スタイルなし</option>
            {imageStyles.value.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <button type="button" class="flex items-center gap-0.5 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" aria-expanded={details} onClick={() => setDetails(!details)}>
          詳細
          <Icon name="chevron-down" class={cx('size-3 transition', details && 'rotate-180')} />
        </button>
        <span class="ml-auto text-zinc-500 tabular-nums" title="モデルの単価からの目安">
          {cost !== undefined ? `約 $${cost.toFixed(cost < 0.1 ? 3 : 2)}${d.enhancePrompt ? ' + 補強の追加料金' : ''}` : '費用不明'}
        </span>
      </div>
      {details && (
        <div class="grid gap-1.5 sm:grid-cols-[1fr_auto]">
          <input
            class={cx(sel, 'py-1')}
            placeholder="入れたくないもの（ネガティブプロンプト）"
            value={d.negativePrompt}
            onInput={(e) => void setImageDefaults({ negativePrompt: (e.target as HTMLInputElement).value })}
            aria-label="ネガティブプロンプト"
          />
          <input
            class={cx(sel, 'w-32 py-1 tabular-nums')}
            inputMode="numeric"
            placeholder="シード（空でランダム）"
            value={d.seed}
            onInput={(e) => void setImageDefaults({ seed: (e.target as HTMLInputElement).value.replace(/[^\d-]/g, '') })}
            aria-label="シード"
          />
          <label class="flex items-center gap-1.5 text-zinc-600 sm:col-span-2 dark:text-zinc-300">
            <input type="checkbox" checked={d.enhancePrompt} onChange={(e) => void setImageDefaults({ enhancePrompt: (e.target as HTMLInputElement).checked })} />
            プロンプトを自動で補強する（追加料金がかかります）
          </label>
        </div>
      )}
    </div>
  );
}
