import { PageShell } from "@/features/shared";
import { ToolsBackdrop, ToolsHome } from "@/features/tools";

export default function ToolsPage() {
  return (
    <>
      <ToolsBackdrop />
      <PageShell>
        <header className="mb-12">
          <p className="font-display text-[11px] font-medium uppercase tracking-[0.34em] text-active/85">
            Fantasy football tools
          </p>
          {/* Gradient wordmark: the `foreground` token fading into a pale teal.
              That second stop is a literal — a gradient stop has no token to
              read, the same exception the flask's liquid makes — and the cyan
              glow is the `active` value. */}
          <h1 className="mt-4 bg-gradient-to-b from-foreground to-[#8feee6] bg-clip-text font-display text-5xl font-bold tracking-tight text-transparent [text-shadow:0_0_46px_rgba(0,255,229,0.2)] sm:text-6xl">
            The Lab
          </h1>
          <p className="mt-3 text-lg text-foreground/60">
            Pick a tool to get started.
          </p>
        </header>

        <ToolsHome />
      </PageShell>
    </>
  );
}
