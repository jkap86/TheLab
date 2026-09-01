import { PageShell } from "@/features/shared";
import { LeaguesHome } from "@/features/manager";

export default async function ManagerPage({
  params,
  searchParams,
}: PageProps<"/manager/[username]">) {
  const { username } = await params;
  const { season } = await searchParams;

  return (
    <PageShell width="wide">
      {/* The heading is passed in rather than owned by `LeaguesHome`, which is a
          client component: this keeps the page's one piece of static copy on
          the server side of the boundary. */}
      <LeaguesHome
        username={username}
        // Passed through as given; the route is what validates a season, so a
        // bad one comes back as a 400 the hook shows rather than being silently
        // dropped here. A repeated `?season=` is nobody's intent, so the array
        // case is treated as absent.
        season={typeof season === "string" ? season : undefined}
        heading={
          <h1 className="font-display text-[0.6875rem] font-medium uppercase tracking-[0.28em] text-active">
            Manager
          </h1>
        }
      />
    </PageShell>
  );
}
