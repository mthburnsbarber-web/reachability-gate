import { bus } from "./bus.js";
import { exportAll } from "./export.js";
import { openUrl } from "./links.js";

// URLs and regex literals hold "//", and none of them start a comment.
const HELP_URL = "http://example.com/help"; bus.register("help.open", () => openUrl(HELP_URL));
const DOCS_URL = 'https://example.com/docs//guide'; bus.register("docs.open", () => openUrl(DOCS_URL));
const isUrl = /^https?:\/\/[^/]+/; bus.register("link.check", ({ text }) => isUrl.test(text));
const label = `Open ${["a", "b"].map((n) => { return n; }).join("//")} // still text`; bus.register("label.show", () => label);

bus.register("export.run", () => exportAll());

// bus.register("ghost.lineComment", () => {});
/* bus.register("ghost.blockComment", () => {}); */
/*
 * bus.register("ghost.docComment", () => {});
 */
