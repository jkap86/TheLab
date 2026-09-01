@AGENTS.md

## Layering

```
src/app/       Routes only — pages and API handlers. No business logic.
src/features/  Client UI, one folder per tool. `features/shared/` holds
               cross-feature client pieces.
src/shared/    Domain logic and the API contract, one folder per concern.
               Never UI.
```

Two rules are easy to get wrong, and both are load-bearing:

- **`shared/` must never import from `features/`.** The reverse is fine. The
  direction is what keeps server-side domain code out of the client bundle.
- **Import from a folder's barrel `index.ts`, not its internals**
  (`@/features/shared`, not `@/features/shared/account`). Add new exports to the
  barrel. A module that only the barrel's own siblings build on stays out of it —
  `local-store.ts` is the current example.

`src/shared/contract/` is the seam between the two: types only, zero runtime
imports, so a `"use client"` module can import from it without pulling a database
client into the browser.

Path aliases: `@/*` → `src/*`, plus `@thelab/http` → `src/shared/http`. The second
exists only so a file ported from TheLabX needs no edit to that import; new code
here should write `@/shared/http`.

`allowImportingTsExtensions` is on, for the same reason it is in TheLabX: tests
run under Node's own runner (`npm test`), which resolves the file it is given.
Extensions therefore follow a rule rather than a habit:

- Alias imports (`@/…`, `@thelab/http`) — **never** carry `.ts`.
- Ordinary relative imports in a runtime module — **no** extension.
- A test importing the module under test — **explicit `.ts`**.

`npm test` needs Node ≥ 22.6 for `--experimental-strip-types`; on 23.6+ the flag
is redundant but harmless.

## Reaching Sleeper

Four `shared/` concerns stack, and the order is the whole design:

```
shared/http     fetch + bounded retry. Knows nothing about Sleeper.
shared/sleeper  the client, the process-wide concurrency bound, the 404 rule.
shared/season   which season "now" means, resolved rather than compiled in.
shared/util/user  a typed name -> a Sleeper user, memoized.
```

**`shared/http` is native `fetch`, where TheLabX uses axios + axios-retry behind
a `@thelab/http` alias.** This app carries no runtime dependency outside React
and Next, and axios-retry's ladder — three retries on top of a 30s timeout each,
`shouldResetTimeout` and all — is up to ~141s of a request's life re-dialling an
upstream, which `shared/season` documents as the thing that made a cold season
resolve unacceptable in front of a request. The *contract* is kept identical so a
port back would touch no caller: `http.get<T>(url)` resolves to a `{ data }`
envelope, and a non-2xx throws with `response.status` — which is all
`sleeper/missing` reads.

The retry ladder is the part of it to distrust: hand-rolled, where axios-retry
has been wrong in production and fixed. `http.test.ts` pins the decisions that
are silent when wrong — a 404 and a 429 are final, a 5xx and a timeout are not,
and a caller's abort ends the ladder even when it fires *during* a backoff rather
than during an attempt.

**Every Sleeper call goes through `sleeperGet`, and that is why the concurrency
bound can.** Local per-caller bounds do not add up; the one in
`sleeper/limiter.ts` is per process. Two functions rather than a flag:
`sleeperGet` throws on a 404, `sleeperGetOptional` folds it — reach for the
second only where an absent resource is an answer the caller can act on.

**Never default a season from `DEFAULT_SEASON`.** It is a release note disguised
as a string; call `getActiveSeason()`. An *explicitly requested* season
(`?season=2024`) must never go through the resolver — it is the caller's answer,
and routes reading it stay deterministic. Validate it with `isPlausibleSeason`,
the same predicate the resolver accepts Sleeper's answer with, so "looks like a
season" has one spelling.

### Known drift

`PageShell` sits at `src/shared/ui/page-shell/page-shell.tsx`, which is UI inside
`shared/` and so on the wrong side of the split above. It belongs at
`src/features/shared/ui/page-shell.tsx`; moving it also touches
`src/app/tools/page.tsx`. Left alone deliberately rather than overlooked.

`sleeper/limiter.ts` is a **narrow** port. TheLabX's also carries an admission
half — `tryAcquire` for callers that shed rather than queue, `AbortSignal` and
`maxWaitMs` bounds on the wait, and the `AdmissionAbortedError` /
`AdmissionTimeoutError` pair that lets a caller tell a refusal from failed work.
Every one of those serves something this app has not ported yet (a streaming
leagues route holding a response open, a request budget, advisory-locked syncs).
Bring that half over with the route that needs it; the FIFO queue here is the
part it builds on and is faithful, including the slot *transfer* in `release()`
that keeps the bound from widening across the microtask gap.

Four files under `src/shared/util/` are now one-line re-exports of the modules
that superseded them — `get-active-season.ts`, `is-season.ts`,
`sleeper-avatar-url.ts` and `user/get-sleeper-user.ts`. They exist only because
the session that moved them could not run `rm`. Nothing imports them; delete
them.

`sleeper/types/sleeper.types.ts` doc comments still cite `SLEEPER_DATA_BASE` and
`manager/crawl-ttl`, which arrive with the projections and crawler ports.
`Tool.icon` and `Tool.pattern` are likewise set on every tool and read by
nothing — the tool-icon component and the app bar that consume them in TheLabX
have not been ported.
