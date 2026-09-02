export function PageShell({
  children,
  width = "default",
}: {
  children: React.ReactNode;
  /**
   * `wide` relaxes the gutters for dense content like the tool grid.
   *
   * `console` is wider still, and it exists for one measurable reason: the
   * leagues grid is three across holding *readouts*, and a readout that
   * truncates is not a readout. At `wide` a league card lands at ~241px, which
   * clips every metric tile to "ROS STA…" over "1st o…" — the rank the tile
   * exists to show. The three columns are what the page is for, so the width
   * is what gives.
   */
  width?: "default" | "wide" | "console";
}) {
  const size = width === "console" ? "max-w-6xl" : "max-w-4xl";
  const padding = width === "default" ? "px-6 py-16" : "px-4 py-10";
  return (
    <main className={`mx-auto w-full flex-1 ${size} ${padding}`}>
      {children}
    </main>
  );
}
