import { PageHeading, PageShell } from "@/features/shared";
import { ToolsHome } from "@/features/tools";

export default function ToolsPage() {
  return (
    <PageShell>
      {/* The `hero` size is this page's alone: everywhere else the title names a
          tool the app bar has already named, where here the wordmark *is* the
          page. The aurora behind it is the root layout's now.

          It is handed to `ToolsHome` rather than rendered beside it because the
          title and the account card pin together as one plate, and the card is
          client state. The lede went with the pin — it says to pick a tool, which
          is only true once an account is resolved, so `ToolsHome` renders it
          below the card instead of here. */}
      <ToolsHome
        heading={
          <PageHeading
            eyebrow="Fantasy football tools"
            title="The Lab"
            size="hero"
          />
        }
      />
    </PageShell>
  );
}
