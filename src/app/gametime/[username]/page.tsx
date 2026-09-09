import { ConsoleGround, PageShell } from "@/features/shared";
import { GametimeHome } from "@/features/gametime";

/**
 * `/gametime/[username]` — the lineup checker's route shape to the line: the
 * ground, the console shell, and the page's one piece of static copy handed
 * in from the server side of the client boundary. The tool's own eyebrow is
 * one word at every width, so there is no short form to switch.
 */
export default async function GametimePage({
  params,
}: PageProps<"/gametime/[username]">) {
  const { username } = await params;
  return (
    <>
      <ConsoleGround />
      <PageShell width="console">
        <GametimeHome
          username={username}
          heading={<span className="whitespace-nowrap">Gametime</span>}
        />
      </PageShell>
    </>
  );
}
