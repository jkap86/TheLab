import { ConsoleGround, PageShell } from "@/features/shared";
import { LineupCheckerHome } from "@/features/lineupchecker";

export default async function LineupCheckerPage({
  params,
}: PageProps<"/lineupchecker/[username]">) {
  const { username } = await params;

  return (
    <>
      {/* The page's surface runs to the viewport edges rather than being a
          panel drawn inside the shell — the leagues console's arrangement, and
          this page is the same cards over the same leagues. It is rendered per
          route rather than in `layout.tsx` because the pages that still draw
          their own panel would get a panel on a panel. */}
      <ConsoleGround />
      {/* `console` rather than `wide`, the leagues console's measured reason: the
          cards carry lit readouts, and at the narrower shell a tile clips to the
          very figure it exists to show. It is also what makes a card here
          exactly as wide as a league card on `/manager` — one shell, one gutter,
          and no panel inset between them. */}
      <PageShell width="console">
        {/* The heading is passed in rather than owned by `LineupCheckerHome`,
            which is a client component: this keeps the page's one piece of static
            copy on the server side of the boundary. It is the billet's eyebrow,
            not its headline — the headline is the manager's display name, which
            only exists once the stream has answered. */}
        <LineupCheckerHome
          username={username}
          heading={
            // A `span`, not a heading: the page's one `<h1>` is the manager's
            // name on the billet, and this sits above it as an eyebrow.
            //
            // It carries no ink and no size of its own, on `/manager`'s page's
            // terms: the header owns the eyebrow's treatment — it is a caption
            // stamped on metal there, and the season rendered beside this word
            // has to be inked with it rather than to match it. What crosses
            // this seam is the copy, which is the one thing that has to stay on
            // the server side of it.
            //
            // The copy is two spellings switched by the cascade, which is the
            // rack's own `Tool.short` rule at the eyebrow's grain: below `sm`
            // the billet's name column shares its row with the Filters and
            // Clear keys and is ~116px at 390, where `Lineup Checker · 2026`
            // wants ~150 — rendered, it broke inside the tool's name and left
            // the middot orphaned on the line above the year. `Lineups` is
            // the word the rack's readout already uses at exactly these
            // widths, so the page and the rack name the tool the same way on
            // a phone. `whitespace-nowrap` is what keeps a break from landing
            // inside either spelling; the season beside it is its own span
            // and drops whole if it has to.
            <span className="whitespace-nowrap">
              <span className="sm:hidden">Lineups</span>
              <span className="hidden sm:inline">Lineup Checker</span>
            </span>
          }
        />
      </PageShell>
    </>
  );
}
