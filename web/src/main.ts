import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./style.css";

import { BrainView } from "./brain";
import { parseFrame, type Message, type Meta } from "./protocol";
import { Rail } from "./rail";
import { TableView } from "./table";

const $ = (id: string) => document.getElementById(id)!;

async function boot(): Promise<void> {
  const meta: Meta = await (await fetch("/api/meta")).json();
  const buf = await (await fetch("/api/neurons")).arrayBuffer();
  const xyz = new Float32Array(buf, 0, meta.neurons * 3);

  $("specimen-meta").textContent =
    `MaleCNS v1.0 · ${meta.neurons.toLocaleString()} neurons · cards in through ` +
    `${meta.sensory_count.toLocaleString()} sensory neurons, choices out through ${meta.readout.length.toLocaleString()} descending neurons`;

  const scale = () => {
    const px = 100 / brain.umPerPixel();
    ($("scalebar").querySelector(".scalebar__bar") as HTMLElement).style.width = `${px}px`;
  };
  const brain = new BrainView($("brain") as HTMLCanvasElement, xyz, meta.readout, () => scale());
  const table = new TableView();
  const rail = new Rail();

  connect((m) => {
    table.handle(m);
    rail.handle(m);
    if (m.type === "thinking") $("clock").textContent = "t = 0 / 8";
    if (m.type === "decision" || m.type === "result") brain.rest();
  }, (frame) => {
    brain.frame(frame.activity);
    $("clock").textContent = `t = ${frame.step} / ${frame.steps}`;
  });
}

function connect(onMessage: (m: Message) => void, onFrame: (f: ReturnType<typeof parseFrame>) => void): void {
  let delay = 500;
  const open = () => {
    const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      delay = 500;
      document.body.classList.remove("is-offline");
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") onMessage(JSON.parse(e.data));
      else onFrame(parseFrame(e.data));
    };
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
