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

Path alias: `@/*` → `src/*`. There is no `allowImportingTsExtensions`, so imports
carry no `.ts` extension — worth knowing when porting a file from TheLabX, whose
tsconfig sets that flag for its Node test runner.

### Known drift

`PageShell` sits at `src/shared/ui/page-shell/page-shell.tsx`, which is UI inside
`shared/` and so on the wrong side of the split above. It belongs at
`src/features/shared/ui/page-shell.tsx`; moving it also touches
`src/app/tools/page.tsx`. Left alone deliberately rather than overlooked.
