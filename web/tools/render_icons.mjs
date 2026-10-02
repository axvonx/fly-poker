// Saves web/public/icon-{32,180,512}.png from tools/icon.html, served by `pnpm exec vite --port 5199`.
// Usage (from web/): node tools/render_icons.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = 9400 + Math.floor(Math.random() * 400);
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "icon-"))}`,
  "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); pending.get(d.id)?.(d); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.navigate", { url: "http://localhost:5199/tools/icon.html" });
for (let i = 0; i < 60; i++) {
  await sleep(250);
  const r = await send("Runtime.evaluate", { expression: "typeof window.renderIcon", returnByValue: true });
  if (r.result?.result?.value === "function") break;
}
for (const size of [32, 180, 512]) {
  const r = await send("Runtime.evaluate", { expression: `renderIcon(${size})`, returnByValue: true });
  const data = r.result.result.value.split(",")[1];
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), Buffer.from(data, "base64"));
  console.log(`icon-${size}.png`);
}
ws.close();
chrome.kill();
process.exit(0);
