// The tools page. `ToolsHome` is the whole of it — the grid, the cards and the
// account lookup are its own composition and have no caller outside this folder.
//
// `LabWordmark` is the exception: the page passes it in as `ToolsHome`'s
// heading, which is what keeps that one piece of static copy on the server side
// of the client boundary. `tools`, `toolHref` and `Tool` stay out — only this
// folder's own modules build on them, `AppRack` included.
//
// `AppRack` is the app's navigation and is mounted in `layout.tsx` rather than
// by a page. It is here rather than in `features/shared` because it is built
// entirely from this folder's own parts — the registry, `toolHref`, the flask
// mark, the engraved wordmark — and `features/tools` may read
// `features/shared` where the reverse would invert the layering.

export { AppRack } from "./components/app-rack";
export { ToolsHome } from "./components/tools-home";
export { LabWordmark } from "./components/lab-wordmark";
