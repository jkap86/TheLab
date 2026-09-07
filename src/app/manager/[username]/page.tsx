import { ConsoleGround, PageShell } from "@/features/shared";
import { LeaguesHome } from "@/features/manager";

export default async function ManagerPage({
  params,
  searchParams,
}: PageProps<"/manager/[username]">) {
  const { username } = await params;
  const { season } = await searchParams;

  return (
    <>
      {/* The page's surface runs to the viewport edges rather than being a
          panel drawn inside the shell — see `ConsoleGround`. It is rendered
          per route rather than in `layout.tsx` because the pages that still
          draw their own panel would get a panel on a panel. */}
      <ConsoleGround />
      {/* `console` rather than `wide`: every card carries four lit readouts,
          which clip to "1st o…" at the narrower shell. */}
      <PageShell width="console">
        {/* The heading is passed in rather than owned by `LeaguesHome`, which is a
            client component: this keeps the page's one piece of static copy on
            the server side of the boundary.

            In the console layout the copy is the plate's eyebrow rather than the
            plate's headline — the headline is the manager's display name, which
            only exists once the stream has answered. `ManagerPlate` renders this
            node above the engraved name, so the seam is unchanged. */}
        <LeaguesHome
          username={username}
          // Passed through as given; the route is what validates a season, so a
          // bad one comes back as a 400 the hook shows rather than being silently
          // dropped here. A repeated `?season=` is nobody's intent, so the array
          // case is treated as absent.
          season={typeof season === "string" ? season : undefined}
          heading={
            // A `span`, not a heading: the page's one `<h1>` is the manager's
            // name on the billet, and this sits above it as an eyebrow.
            //
            // It carries no styling of its own. The header owns the eyebrow's
            // ink and size — it is a caption stamped on metal there, and the
            // season rendered beside this word has to be inked with it rather
            // than to match it. What crosses this seam is the copy, which is
            // the one thing that has to stay on the server side of it.
            <span>Manager</span>
          }
        />
      </PageShell>
    </>
  );
}
