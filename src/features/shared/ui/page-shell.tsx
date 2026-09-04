export function PageShell({
  children,
  width = "default",
}: {
  children: React.ReactNode;
  /**
   * `wide` relaxes the gutters for dense content like the tool grid.
   *
   * `console` is wider still, and it exists for one measurable reason: the
   * leagues page is rows of *readouts*, and a readout that truncates is not a
   * readout. It arrived when the grid was three across and a league card
   * landed at ~241px at `wide`, clipping every metric tile to "ROS STA…" over
   * "1st o…" — the rank the tile exists to show. One card per row spends the
   * width differently but on the same thing: the tiles are a strip across the
   * card, and an open card's team browser gets a real pane each.
   *
   * The shell governs *width* and nothing else now. The ground it used to sit
   * on — a rounded panel each page drew for itself — moved to `layout.tsx` and
   * runs to the viewport edges; what a page keeps is this gutter, plus the
   * padding that used to belong to the panel.
   */
  width?: "default" | "wide" | "console";
}) {
  const size = width === "console" ? "max-w-6xl" : "max-w-4xl";
  // `console` carries what was the panel's own inset, and it steps down at a
  // phone's width where the gutter is the only room left to give the content.
  //
  // **The top padding is the rack's clearance, on every arm**, read from one
  // token rather than spelled per breakpoint here. The rack is `fixed`, so it
  // is out of flow and this padding is the only thing keeping a page's first
  // row from sitting under it; its height and this number are one fact, and two
  // spellings of it drift the first time a key's padding changes. See
  // `--rack-clear`.
  //
  // All three arms take it, not just `console`: the rack renders above every
  // route, so `/tools` — the one page on `wide` — would have had its first row
  // of cards under it. Only the bottom and the gutters are each arm's own.
  // `ConsoleGround` needs nothing either way, being fixed and viewport-sized.
  const padding =
    width === "default"
      ? "px-6 pb-16"
      : width === "wide"
        ? "px-4 pb-10"
        : "px-3.5 pb-8 sm:px-4 sm:pb-12";
  return (
    <main
      className={`mx-auto w-full flex-1 pt-[var(--rack-clear)] ${size} ${padding}`}
    >
      {children}
    </main>
  );
}
