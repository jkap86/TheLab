import { ToolGrid } from "@/features/tools";

export default function ToolsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-16">
      <header className="mb-12">
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          The Lab
        </h1>
        <p className="mt-3 text-lg text-foreground/60">
          Pick a tool to get started.
        </p>
      </header>

      <ToolGrid />
    </main>
  );
}
