import { render } from "preact";

import { App } from "./app.js";
import { AppContext } from "./app-context.js";
import { requireElement } from "./shared.js";
import { applyTheme, loadThemePreference, resolveTheme } from "./theme.js";

applyTheme(
  resolveTheme(
    loadThemePreference(),
    globalThis.matchMedia("(prefers-color-scheme: dark)").matches,
  ),
);
const context = new AppContext();
await context.initialize();

render(<App context={context} />, requireElement(document, "#app"));
