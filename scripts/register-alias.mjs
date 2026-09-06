import { register } from "node:module";
import { pathToFileURL } from "node:url";

// Registered with `node --import ./scripts/register-alias.mjs`, which runs
// before the entry module is resolved — the hooks in `./alias-hooks.mjs` are
// therefore in place for the script itself and for everything it reaches.
register(new URL("./alias-hooks.mjs", import.meta.url), pathToFileURL("./"));
