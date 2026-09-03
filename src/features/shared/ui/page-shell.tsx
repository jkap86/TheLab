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
  const padding =
    width === "default"
      ? "px-6 py-16"
      : width === "wide"
        ? "px-4 py-10"
        : "px-3.5 pb-8 pt-6 sm:px-4 sm:pb-12 sm:pt-11";
  return (
    <main className={`mx-auto w-full flex-1 ${size} ${padding}`}>
      {children}
    </main>
  );
}
