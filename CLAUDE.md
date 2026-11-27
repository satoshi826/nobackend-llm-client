# nobackend-llm-client

## Before you change anything

- Read [docs/principles.md](docs/principles.md) (what the app is, security, data, code structure).
- For any UI change, also read [docs/design-system.md](docs/design-system.md) and go through its "When UI changes" checklist.
- For any UI text, follow [docs/writing.md](docs/writing.md).

## Commands

- `npm test`, `npm run typecheck`, `npm run lint` (oxlint, `.oxlintrc.json`), `npm run lint:deps` — all must pass.
- `npm run dev` (http://localhost:5173); `npm run mock` plus the `VITE_*_BASE_URL` variables in the README to run without real providers.

## Docs

- Docs state the current rules and facts only. They do not describe the implementation (the code, types and tests are the reference) and do not record history (git has it: write the why in commit messages and PRs).
- When a rule changes, update the doc in the same commit. Adding or changing a rule needs the owner's OK: propose it first.
- When a problem slips through, name the principle or rule it broke; if none covers it, propose one, and check the rest of the app against it.
- Token values in docs/design-system.md §3 and `src/styles.css` change together.

## Commits

- Commit messages are in English. Line 1 says what changed in a way that shows why; the body holds intent and background the diff cannot show.
- A visible UI change is shown to the owner (the dev server or a screenshot) before it is committed; tweaks asked for along the way go into that one commit.
