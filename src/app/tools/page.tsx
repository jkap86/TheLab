import { PageShell } from "@/features/shared";
import { ToolsHome } from "@/features/tools";

export default function ToolsPage() {
  return (
    // `wide` because the grid is three across now; the default gutters were cut
    // for a two-column page.
    <PageShell width="wide">
      {/*
        The engraved `LabWordmark` plate used to be the heading here. It is
        gone: the app rack above already engraves "The Lab" on every page, and
        two engravings of the same string on one screen read as a duplicate
        rather than as a hierarchy.

        What stays is the heading itself, for assistive tech. `app-rack.tsx` is
        explicit that the rack renders no `<h1>` precisely so each page keeps
        its own, so dropping the plate without this would leave the page with
        no heading at all — and it is still passed in from the server side of
        the client boundary, which is what it was doing before.
      */}
      <ToolsHome heading={<h1 className="sr-only">The Lab</h1>} />
    </PageShell>
  );
}
