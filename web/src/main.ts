import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";

import { BrainView } from "./brain";
import { Hud } from "./hud";
import { parseFrame, type BrainFrame, type Message, type Meta } from "./protocol";
import { Table3D } from "./table3d";
import { Training } from "./training";

const $ = (id: string) => document.getElementById(id)!;

async function boot(): Promise<void> {
  // Card faces are drawn onto canvases, so the faces must be loaded before the first deal.
  await Promise.all([
    document.fonts.load('700 92px "IBM Plex Sans Condensed"'),
    document.fonts.load('700 120px "IBM Plex Sans"'),
  ]);
  const meta: Meta = await (await fetch("/api/meta")).json();
  const buf = await (await fetch("/api/neurons")).arrayBuffer();
  const xyz = new Float32Array(buf, 0, meta.neurons * 3);
  $("specimen-meta").textContent = `${meta.neurons.toLocaleString()} neurons`;

  const scale = () => {
    ($("scalebar").querySelector(".scalebar__bar") as HTMLElement).style.width = `${100 / brain.umPerPixel()}px`;
  };
  const brain = new BrainView($("brain") as HTMLCanvasElement, xyz, meta.readout, () => scale());
  const table = new Table3D($("table") as HTMLCanvasElement, $("tags"));
  const hud = new Hud();
  const training = new Training();

  const lens = $("lens");
  const setLens = (on: boolean) => {
    table.setLens(on);
    lens.setAttribute("aria-pressed", String(on));
    try {
      localStorage.setItem("fly-lens", on ? "1" : "0");
    } catch {}
  };
  lens.addEventListener("click", () => setLens(lens.getAttribute("aria-pressed") !== "true"));
  addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") setLens(lens.getAttribute("aria-pressed") !== "true");
  });
  // ?lens forces the fly's-eye view on (for a kiosk); otherwise remember the last choice.
  try {
    setLens(new URLSearchParams(location.search).has("lens") || localStorage.getItem("fly-lens") === "1");
  } catch {
    setLens(new URLSearchParams(location.search).has("lens"));
  }

  connect(
    (m) => {
      // The HUD follows the table, so the bars never show a decision before the table does.
      if (m.type === "stats") training.handle(m);
      table.handle(m).then(() => hud.handle(m));
      if (m.type === "decision" || m.type === "result") brain.rest();
    },
    (f) => {
      brain.frame(f.activity);
      let sum = 0;
      for (let i = 0; i < f.activity.length; i += 7) sum += f.activity[i];
      table.thinking(Math.min(1, (sum / (f.activity.length / 7)) / 60));
    },
  );
}

function connect(onMessage: (m: Message) => void, onFrame: (f: BrainFrame) => void): void {
  let delay = 500;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      delay = 500;
      document.body.classList.remove("is-offline");
    };
    ws.onmessage = (e) => (typeof e.data === "string" ? onMessage(JSON.parse(e.data)) : onFrame(parseFrame(e.data)));
    ws.onclose = () => {
      document.body.classList.add("is-offline");
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 8000);
    };
  };
  open();
}

boot().catch((err) => {
  document.body.classList.add("is-offline");
  console.error(err);
});
