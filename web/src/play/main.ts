// The public page: play heads-up against the fly. Everything runs in the browser: the engine
// (a Web Worker) holds the frozen connectome and the trained readout. This file picks a view
// (desktop, or mobile for narrow screens) and starts the controller on it.

import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../style.css";
import "./play.css";

import { bootData } from "./boot";
import { PlayController } from "./controller";
import { DesktopView } from "./desktop";

// Phones (and narrow windows) get the portrait view, decided once at load.
const MOBILE = matchMedia("(max-width: 700px)").matches;

function fail(message: string): void {
  const el = document.getElementById("loading");
  if (!el) return;
  el.hidden = false;
  el.classList.add("is-error");
  document.getElementById("loading-text")!.textContent = `Something went wrong: ${message}`;
}

async function boot(): Promise<void> {
  // Card faces are drawn onto canvases, so the faces must be loaded before the first deal.
  const fonts = Promise.all([
    document.fonts.load('700 92px "IBM Plex Sans Condensed"'),
    document.fonts.load('700 120px "IBM Plex Sans"'),
  ]);
  const data = await bootData();
  await fonts;
  const view = MOBILE ? new (await import("./mobile/view")).MobileView(data) : new DesktopView(data);
  const ctl = new PlayController(view, data.snapshots);
  view.bind(ctl);
  await ctl.start();
}

boot().catch((err: unknown) => {
  console.error(err);
  fail(err instanceof Error ? err.message : String(err));
});
