import { CompsHome } from "@/features/comps";
import { ConsoleGround, PageShell } from "@/features/shared";

export default function CompsPage() {
  return (
    <>
      {/* The page's surface runs to the viewport edges rather than being a
          panel drawn inside the shell — see `ConsoleGround`, and the trades
          page for why it is rendered per route. */}
      <ConsoleGround />
      {/* `console` is the 72rem shell the handoff draws the page at; `default`
          and `wide` are both `max-w-4xl`. A comp card is two side-by-side
          panes of figures, and the narrower shell truncates them for the same
          reason it truncates a trade card. */}
      <PageShell width="console">
        {/* The heading is passed in rather than owned by `CompsHome`, which is
            a client component — the page's one piece of static copy stays on
            the server side of the boundary, the arrangement every console page
            makes. */}
        <CompsHome
          heading={
            <h1 className="font-mono text-[length:var(--fs-11)] uppercase tracking-[0.16em] text-foreground/60">
              Comps
            </h1>
          }
        />
      </PageShell>
    </>
  );
}
