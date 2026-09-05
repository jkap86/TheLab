import { PageShell } from "@/features/shared";
import { ToolsHome } from "@/features/tools";

export default function ToolsPage() {
  return (
    // `console`, not `wide`. `wide` and `default` are both `max-w-4xl` — they
    // differ only in gutters — so a three-across grid inside `tools-home`'s own
    // panel inset landed a card at 241px and wrapped "Lineup Checker" and
    // "Pick Tracker" onto two lines at `--fs-28`. At `console` (`max-w-6xl`) a
    // card is 334px and every title sets on one line. It is the same reading
    // `/manager` made when its cards clipped their tiles: the honest answer to
    // a readout that does not fit is a wider shell, not smaller type.
    <PageShell width="console">
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
