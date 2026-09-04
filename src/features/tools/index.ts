// The tools page. `ToolsHome` is the whole of it — the grid, the cards and the
// account lookup are its own composition and have no caller outside this folder.
//
// `LabWordmark` used to be the exception: the page passed it in as `ToolsHome`'s
// heading. The rack above every page engraves the same string, so the plate is
// gone from that page and the heading it wrapped is a visually-hidden `<h1>`
// written inline — which keeps that one piece of static copy on the server side
// of the client boundary just as the plate did. The component is kept, because
// it is the treatment `ManagerPlate` and the rack's own wordmark both cite for
// the decisions they take, but it is out of the barrel on the barrel's own
// rule: nothing outside this folder builds on it. `tools`, `toolHref`, `Tool`
// and `ToolsMenu` stay out for the same reason, `AppRack` included.
//
// `AppRack` is the app's navigation and is mounted in `layout.tsx` rather than
// by a page. It is here rather than in `features/shared` because it is built
// entirely from this folder's own parts — the registry, `toolHref`, the flask
// mark, the engraved wordmark — and `features/tools` may read
// `features/shared` where the reverse would invert the layering.

export { AppRack } from "./components/app-rack";
export { ToolsHome } from "./components/tools-home";
