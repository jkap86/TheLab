import { AdpControlsProvider, PageShell } from "@/features/shared";
import { LineupCheckerHome } from "@/features/lineupchecker";
import { getActiveSeason } from "@/shared/season";

/**
 * The season the ADP board opens on is resolved per request, not compiled in —
 * so this page must not be prerendered, or that resolution is baked into the
 * bundle and it is a hardcoded constant again. The same call `/trades` makes,
 * for the same reason.
 */
export const dynamic = "force-dynamic";

/**
 * `wide` for the same reason the manager tabs are: this is a list of a hundred-odd
 * rows carrying stat columns, and the default gutters give those columns less
 * room than the names beside them need.
 *
 * The ADP board's store is mounted here because the player-shares sheet — one of
 * the two doors on this page's filter row — prices its rows off that board. It is
 * this page's own provider rather than one hoisted to the root, the rule the
 * trades page keeps: what a board *means* differs per tool, so a selection made
 * in the manager tool's drawer has no business following a reader here. The
 * season is a server-side fact, and a page is a server component, so it crosses
 * to the client store as a prop rather than being re-derived from a clock.
 */
export default async function LineupCheckerPage() {
  return (
    <PageShell width="wide">
      <AdpControlsProvider season={await getActiveSeason()}>
        <LineupCheckerHome />
      </AdpControlsProvider>
    </PageShell>
  );
}
