/**
 * The standard page container: centred, width-capped, and grown to fill the
 * flex column that `layout.tsx` sets up on `<body>`, so short pages still push
 * anything below them to the bottom.
 *
 * Every top-level page renders through this so the measurements live in one
 * place instead of being retyped per route.
 */
export function PageShell({
  children,
  width = "default",
}: {
  children: React.ReactNode;
  /** `wide` relaxes the gutters for dense content like the leagues list. */
  width?: "default" | "wide";
}) {
  const padding = width === "wide" ? "px-4 py-10" : "px-6 py-16";
  return (
    <main className={`mx-auto w-full max-w-4xl flex-1 ${padding}`}>
      {children}
    </main>
  );
}
