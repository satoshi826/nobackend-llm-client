# Measuring UI performance

`npm run perf` builds two versions of the app, serves each, and runs the same scenarios on both in turn, each run in a
fresh Chromium with the CPU slowed 4×. It prints a Markdown report and keeps every value in `tmp/perf/results/<time>/`.

```bash
npm run perf                                  # the last commit (base) against the working tree (head)
npm run perf -- --base HEAD~1 --head HEAD     # any two commits
npm run perf -- --only                        # the working tree alone
npm run perf -- --scenarios chat,files --runs 7 --cpu 4
```

The first time: `npx playwright install chromium`. The mock server (`npm run mock`) is started when it is not running.

## What it measures

Each scenario fills an empty database (not measured), then measures its steps. For each step:

| Value | Meaning |
| --- | --- |
| `time` | From the start of the step until the screen is ready |
| `tbt` | Long tasks beyond 50 ms, summed: time the page could not answer input |
| `script` / `layout` / `style` | CPU time by kind (Chrome's Performance metrics) |
| `renders` / `mounts` / `unmounts` / `commits` | Preact's work: component renders, components made and removed, changes applied |
| `heap` | JS heap after a garbage collection, at the end of a scenario |

All but `time` are counted until the page has settled after it is ready (no long task for 1 s).

A difference is marked (🔴 slower, 🟢 faster) when the Mann–Whitney U test gives p < 0.01 and the medians differ by 3%
or more. Counts that are the same in every run are compared as they are. Use 7 runs or more (the default): with 5 a
side, even two sets of values that do not overlap stay above the limit.

## How it works

- The app counts its rendering work in perf mode: `window.__PERF__` set before it loads (or `?perf` in the address by
  hand). Perf mode also keeps its data in a database of its own, and exposes `window.__perf` (seeding data, a
  simulated streaming answer, and `start()` / `stop()` for counting by hand): `src/lib/perf/counter.ts`,
  `src/perf/index.ts`.
- Perf builds add a provider that needs no key and answers from the mock server, so the chat shows without keys.
- Scenarios: `scenarios.ts`. A step's `ready` condition runs in the page and looks at what is on screen
  (`data-message-id`, `data-entry`).

## Measuring by hand

Open the dev server with `?perf` (with `VITE_CUSTOM_PROVIDERS` set as in `run.ts`), then in the console:

```js
await __perf.seed({ conversations: 30, longMessages: 120, files: 300, folders: 6 }) // then reload
__perf.start(); /* do something */ __perf.stop() // prints what rendered, by component
await __perf.stream({ tokens: 600 }) // in a conversation that ends with an answer
```
