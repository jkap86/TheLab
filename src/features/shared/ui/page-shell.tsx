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