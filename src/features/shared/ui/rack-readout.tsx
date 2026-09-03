"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/** Whose page this is: the subject the rack's lit pill names. */
export type RackReadout = { username: string; season: string | null };

/**
 * The season readout in the app rack, and who owns it.
 *
 * The pill is manager data sitting in app-level chrome, which is the one thing
 * about the rack that needed deciding rather than building. Three answers were
 * possible and only this one is *true*: the stored account names whoever last
 * logged in, which is the wrong person on `/manager/someone-else`; the URL
 * names the right person but not the season, which is resolved on the server
 * and arrives on the leagues stream. So the page that knows publishes, and the
 * rack reads.
 *
 * **A page that publishes nothing gets no pill**, which is exactly what "only
 * where a manager is resolved" has to mean — the rack must not depend on
 * manager state, and it does not: it depends on a null.
 *
 * Read and write are two contexts on purpose. A publisher takes only the
 * setter, which is stable, so `/manager` does not re-render itself every time
 * it moves its own pill.
 */
const ReadContext = createContext<RackReadout | null>(null);
const WriteContext = createContext<
  ((readout: RackReadout | null) => void) | null
>(null);

export function RackReadoutProvider({ children }: { children: ReactNode }) {
  const [readout, setReadout] = useState<RackReadout | null>(null);
  return (
    <WriteContext.Provider value={setReadout}>
      <ReadContext.Provider value={readout}>{children}</ReadContext.Provider>
    </WriteContext.Provider>
  );
}

/** What the rack should be showing, or null on a page that claims no subject. */
export function useRackReadout(): RackReadout | null {
  return useContext(ReadContext);
}

/**
 * Publish this page's subject to the rack for as long as it is mounted.
 *
 * In an effect rather than during render, because it writes to an ancestor's
 * state and React forbids that on the way down. One frame late is the right
 * trade here: the season it carries arrives on a stream anyway, so there is no
 * first paint at which the pill could have been complete.
 *
 * The cleanup is the half that matters — without it, navigating from a manager
 * page to `/trades` would leave the previous manager's name lit in the rack.
 */
export function usePublishRackReadout(
  username: string,
  season: string | null,
): void {
  const publish = useContext(WriteContext);
  useEffect(() => {
    if (!publish) return;
    publish({ username, season });
    return () => publish(null);
  }, [publish, username, season]);
}
