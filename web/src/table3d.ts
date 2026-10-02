// The poker table, in 3D: cards deal and flip, chips move to bets and sweep to the pot.
// Driven entirely by the server's hand events; it never decides anything itself.

import * as THREE from "three";
import { describe, type MadeHand } from "./hands";
import { dollars } from "./play/money";
import { OPPONENT_COLOR, OPPONENT_LABEL, ACTION_LABEL, type Message } from "./protocol";

export const CARD_W = 0.62, CARD_H = 0.87;
const FELT = "#1f5a40", RAIL = "#3b2a22"; // tournament green felt, leather rail
const PAPER = "#ede6d6", INK = "#0b0a10", RED = "#b3261e";
const CHIP_COLORS = ["#8c1d5b", "#e0533a", "#f7b538", "#fff6d8"]; // Fire, low to high value
const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
export const WIN = "#5cc777", LOSE = "#e0533a", HINT = "#f7b538"; // showdown green / red, your-hand gold

type Seat = "fly" | "opponent";
const SEAT_Z: Record<Seat, number> = { fly: 1.15, opponent: -1.25 };
export const NEAR_Z = SEAT_Z.fly, FAR_Z = SEAT_Z.opponent;
export const DECK = new THREE.Vector3(2.35, 0.02, -0.2);

// ── tiny tween runner ─────────────────────────────────────────────────────────
type Tween = { t0: number; dur: number; step: (k: number) => void; done: () => void };
const tweens = new Set<Tween>();
const ease = (k: number) => 1 - Math.pow(1 - k, 3);
let speed = 1; // < 1 while catching up with a backlog of events
export function tween(dur: number, step: (k: number) => void): Promise<void> {
  dur *= speed;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) dur = 1;
  return new Promise((done) => tweens.add({ t0: performance.now(), dur, step, done }));
}
export /** Seconds, shared by every spinning outline; advanced by runTweens each frame. */
const spin = { value: 0 };
export function runTweens(now: number): void {
  spin.value = now / 1000;
  for (const t of tweens) {
    const k = Math.min(1, (now - t.t0) / t.dur);
    t.step(ease(k));
    if (k >= 1) {
      tweens.delete(t);
      t.done();
    }
  }
}

// ── card faces ────────────────────────────────────────────────────────────────
const faceCache = new Map<string, THREE.Texture>();
function cardTexture(code: string | null): THREE.Texture {
  const key = code ?? "back";
  const hit = faceCache.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = 248;
  c.height = 348;
  const g = c.getContext("2d")!;
  const r = 18;
  g.beginPath();
  g.roundRect(4, 4, c.width - 8, c.height - 8, r);
  if (!code) {
    g.fillStyle = "#2b2836";
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = "rgba(237,230,214,0.09)";
    for (let x = 14; x < c.width; x += 9) g.fillRect(x, 0, 3, c.height); // punch-card columns
    g.restore();
  } else {
    g.fillStyle = PAPER;
    g.fill();
    const rank = code[0] === "T" ? "10" : code[0], suit = code[1];
    g.fillStyle = suit === "h" || suit === "d" ? RED : INK;
    g.textAlign = "center";
    g.font = '700 92px "IBM Plex Sans Condensed"';
    g.fillText(rank, c.width / 2, 150);
    g.font = '700 120px "IBM Plex Sans"';
    g.fillText(SUIT[suit], c.width / 2, 290);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  faceCache.set(key, tex);
  return tex;
}

/** Half one colour, half the other, split by a line through the centre that turns slowly. */
function splitMaterial(a: string, b: string): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { a: { value: new THREE.Color(a) }, b: { value: new THREE.Color(b) }, opacity: { value: 0 }, time: spin },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 a;
      uniform vec3 b;
      uniform float opacity;
      uniform float time;
      varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * vec2(0.71, 1.0); // card aspect, so the split stays even
        float t = fract(atan(p.y, p.x) / 6.2831853 + time * 0.3);
        float k = smoothstep(0.0, 0.03, t) * (1.0 - smoothstep(0.5, 0.53, t));
        gl_FragColor = vec4(mix(b, a, k), opacity);
      }
    `,
  });
}

export class Card {
  readonly group = new THREE.Group();
  private front: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  constructor(code: string | null) {
    const geo = new THREE.PlaneGeometry(CARD_W, CARD_H);
    this.front = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: cardTexture(code), roughness: 0.7 }));
    const back = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: cardTexture(null), roughness: 0.7 }));
    back.rotation.y = Math.PI;
    this.group.add(this.front, back);
    this.group.rotation.x = Math.PI / 2; // lying flat, face down
  }
  private outline: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial | THREE.ShaderMaterial> | null = null;
  private restY: number | null = null; // height before the lift, while lifted
  /** A coloured border (and a small lift) marks the cards that make a hand; null removes it.
   * Two colours: a card in both players' hands, its border half each, circling the edge. */
  highlight(color: string | null, second?: string): void {
    if (this.outline) this.group.remove(this.outline);
    this.outline = null;
    if (color) {
      const material = second ? splitMaterial(color, second) : new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0 });
      this.outline = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W + 0.12, CARD_H + 0.12), material);
      this.outline.position.z = -0.004; // just behind the face
      this.group.add(this.outline);
      const fade = (k: number) =>
        material instanceof THREE.ShaderMaterial ? (material.uniforms.opacity.value = 0.95 * k) : (material.opacity = 0.95 * k);
      void tween(350, fade);
    }
    // Tween to an absolute height: highlight(null) then highlight(colour) in one frame must not stack.
    const lift = color !== null;
    if (lift !== (this.restY !== null)) {
      const rest = this.restY ?? this.group.position.y;
      this.restY = lift ? rest : null;
      const y0 = this.group.position.y, y1 = lift ? rest + 0.06 : rest;
      void tween(300, (k) => (this.group.position.y = y0 + (y1 - y0) * k));
    }
  }
  reveal(code: string): void {
    this.front.material.map = cardTexture(code);
    this.front.material.needsUpdate = true;
  }
  async moveTo(to: THREE.Vector3, faceUp: boolean, dur = 420): Promise<void> {
    const from = this.group.position.clone();
    const r0 = this.group.rotation.x, r1 = faceUp ? -Math.PI / 2 : Math.PI / 2;
    await tween(dur, (k) => {
      this.group.position.lerpVectors(from, to, k);
      this.group.position.y = to.y + Math.sin(k * Math.PI) * 0.35;
      this.group.rotation.x = r0 + (r1 - r0) * k;
    });
  }
  async flip(): Promise<void> {
    const r0 = this.group.rotation.x;
    const y0 = this.group.position.y;
    await tween(380, (k) => {
      this.group.rotation.x = r0 - Math.PI * k;
      this.group.position.y = y0 + Math.sin(k * Math.PI) * 0.25;
    });
  }
}

// ── chips ─────────────────────────────────────────────────────────────────────
const chipGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.032, 28);
const chipMats = CHIP_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.05 }));

export function chipStack(amount: number): THREE.Group {
  const g = new THREE.Group();
  // Height grows with the log of the amount, so an all-in towers over a blind.
  const n = Math.max(1, Math.min(18, Math.round(2.2 * Math.log2(amount / 25))));
  for (let i = 0; i < n; i++) {
    const tier = Math.min(CHIP_COLORS.length - 1, Math.floor((i / 18) * CHIP_COLORS.length + Math.log10(amount) - 2));
    const m = new THREE.Mesh(chipGeo, chipMats[Math.max(0, tier)]);
    m.position.y = 0.016 + i * 0.034;
    m.rotation.y = i * 0.7;
    g.add(m);
  }
  return g;
}


// ── the result: rings at each seat, cards that made the winning hand ────────────
/** Green ring under the winner's seat, red under the loser's, gently pulsing. */
export class SeatRings {
  readonly group = new THREE.Group();
  private rings = new Map<number, THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>>();
  constructor(seatZ: number[]) {
    for (const z of seatZ) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.98, 1.16, 64),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(0, 0.007, z + (z > 0 ? 0.05 : -0.05));
      ring.scale.set(1.3, 0.55, 1);
      ring.userData.level = 0;
      this.rings.set(z, ring);
      this.group.add(ring);
    }
  }
  async show(z: number, color: string): Promise<void> {
    const r = this.rings.get(z)!;
    r.material.color.set(color);
    await tween(450, (k) => (r.userData.level = k));
  }
  clear(): void {
    for (const r of this.rings.values()) r.userData.level = 0;
  }
  tick(now: number): void {
    for (const r of this.rings.values()) r.material.opacity = r.userData.level * (0.7 + 0.3 * Math.sin(now / 260));
  }
}

/** Light up a showdown: the winner's hand cards green, the loser's red, shared ones both.
 * On a split pot pass both hands as winners and no loser. */
export function markShowdown(cards: Map<string, Card>, winners: MadeHand[], loser: MadeHand | null): void {
  for (const c of cards.values()) c.highlight(null);
  const win = new Set(winners.flatMap((h) => h.core)), lose = new Set(loser?.core ?? []);
  for (const code of lose) if (!win.has(code)) cards.get(code)?.highlight(LOSE);
  for (const code of win) cards.get(code)?.highlight(WIN, lose.has(code) ? LOSE : undefined);
}

/** The result line under the table: "The fly wins $50", the name in its seat's colour and the
 * amount green or red for whoever's side this screen is on. who = null means a split pot. */
export function showVerdict(el: HTMLElement, who: { name: string; color: string } | null, amount: string, good: boolean, exclaim = false): void {
  const inner = document.createElement("span");
  inner.className = "verdict__inner"; // pops from its own centre; el's transform positions it
  el.replaceChildren(inner);
  if (!who) {
    inner.textContent = "Split pot";
  } else {
    const name = document.createElement("span");
    name.className = "verdict__who";
    name.style.color = who.color;
    name.textContent = who.name;
    const money = document.createElement("span");
    money.className = `verdict__amount ${good ? "is-good" : "is-bad"}`;
    money.textContent = amount;
    inner.append(name, document.createTextNode(who.name === "You" ? " win " : " wins "), money, document.createTextNode(exclaim ? "!" : ""));
  }
  el.classList.remove("is-shown");
  void el.offsetWidth; // restart the entrance animation
  el.classList.add("is-shown");
}
export const FLY_COLOR = "#f7b538", YOU_COLOR = "#ffffff";

/** The words under a seat's name at the end: "Two pair" over "Kings and 8s" (two lines). */
export function handWords(h: MadeHand): string {
  return `${h.name}\n${h.detail}`;
}

// ── the opponent's avatar ─────────────────────────────────────────────────────
// One robot behind the far seat, repainted in each bot's colour. More bots, more colours.
export const ROBOT_Z = -2.75;
class Robot {
  readonly group = new THREE.Group();
  private paint = new THREE.MeshStandardMaterial({ color: "#888", roughness: 0.45, metalness: 0.25 });
  private head = new THREE.Group();
  constructor() {
    const dark = new THREE.MeshStandardMaterial({ color: "#14121a", roughness: 0.25, metalness: 0.4 });
    const glow = new THREE.MeshBasicMaterial({ color: "#fff6d8" });
    const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      return b;
    };
    this.group.add(box(1.0, 0.8, 0.5, this.paint, 0, 0.4));
    this.group.add(box(0.2, 0.62, 0.2, this.paint, -0.62, 0.45), box(0.2, 0.62, 0.2, this.paint, 0.62, 0.45));
    this.head.position.y = 1.08;
    this.head.add(box(0.76, 0.52, 0.52, this.paint));
    this.head.add(box(0.6, 0.24, 0.04, dark, 0, 0.02, 0.27));
    for (const x of [-0.14, 0.14]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), glow);
      eye.position.set(x, 0.02, 0.3);
      this.head.add(eye);
    }
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.26), dark);
    stalk.position.y = 0.39;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 16, 12), glow);
    bulb.position.y = 0.54;
    this.head.add(stalk, bulb);
    this.group.add(this.head);
    this.group.position.set(0, -0.35, ROBOT_Z);
  }
  wear(color: string): void {
    this.paint.color.set(color);
  }
  async nod(): Promise<void> {
    await tween(420, (k) => (this.head.rotation.x = Math.sin(k * Math.PI) * 0.35));
  }
  idle(now: number): void {
    this.head.rotation.y = 0.18 * Math.sin(now / 1500);
    this.group.position.y = -0.35 + 0.03 * Math.sin(now / 700);
  }
}

// ── the fly's-eye lens ────────────────────────────────────────────────────────
// A compound eye. The view is tiled with small hexagonal facets laid on a curved eye (they shrink
// toward the rim), and each facet is its own tiny lens: it shows an inverted, magnified patch of
// the scene around its centre. On top: a strong fisheye that breathes slowly, colour fringing
// toward the rim, dark walls between facets, a glint on each lens, and a faint per-facet shimmer.
export const FACET = 10; // facet size in CSS pixels
export const lensVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
export const lensFragment = /* glsl */ `
  uniform sampler2D scene;
  uniform vec2 resolution;
  uniform float facet;
  uniform float time;
  uniform vec3 background;
  varying vec2 vUv;
  const float CURVE = 0.6;   // how much the facet grid compresses toward the rim
  const float LENS = 1.4;    // each facet's magnification
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 fisheye(vec2 uv) {
    vec2 c = uv - 0.5;
    return 0.5 + c * (0.8 + 1.0 * dot(c, c) + 0.03 * sin(time * 0.7));
  }
  vec3 look(vec2 uv) {
    vec4 s = texture2D(scene, uv);
    return mix(background, s.rgb, s.a);
  }
  void main() {
    float aspect = resolution.x / resolution.y;
    vec2 e = (vUv - 0.5) * vec2(aspect, 1.0);           // eye coordinates, height 1
    float r = length(e);
    vec2 p = e * (1.0 + CURVE * r * r) * resolution.y / facet;
    vec2 rr = vec2(1.0, 1.7320508), h = rr * 0.5;
    vec2 a = mod(p, rr) - h, b = mod(p - h, rr) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;            // position within the facet
    vec2 id = p - gv;                                    // the facet
    vec2 cw = id * facet / resolution.y;
    vec2 centre = cw / (1.0 + CURVE * dot(cw, cw)) / vec2(aspect, 1.0) + 0.5;
    vec2 local = -gv * facet / resolution.y / vec2(aspect, 1.0) * LENS;   // inverted, magnified
    vec2 uv = fisheye(centre + local);
    vec2 fringe = (uv - 0.5) * (0.004 + 0.014 * r);
    vec3 col = vec3(look(uv + fringe).r, look(uv).g, look(uv - fringe).b);
    float n = hash(id);
    col *= mix(vec3(1.04, 0.97, 0.9), vec3(0.92, 0.98, 1.06), hash(id + 3.1)) * (0.88 + 0.24 * n);
    col *= 0.95 + 0.05 * sin(time * 2.0 + n * 6.2832);
    vec2 q = abs(gv);
    float d = max(dot(q, normalize(rr)), q.x);          // 0 at a facet's centre, 0.5 at its rim
    col *= 1.0 - 0.45 * smoothstep(0.4, 0.5, d);        // dark walls between facets
    col += 0.22 * exp(-dot(gv - vec2(-0.16, 0.18), gv - vec2(-0.16, 0.18)) * 60.0); // the glint
    col = mix(background, col * 1.3, smoothstep(1.05, 0.62, r));            // the eye's edge, a little brighter inside
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── the table itself: lights, felt, rail ──────────────────────────────────────
export function buildTable(scene: THREE.Scene): void {
  scene.add(new THREE.HemisphereLight("#d8cfe8", "#0b0a10", 1.1));
  const key = new THREE.SpotLight("#fff1dc", 60, 14, 0.75, 0.6);
  key.position.set(0, 6, 1.2);
  scene.add(key, key.target);

  // A stadium-shaped table: felt top inside a padded rail.
  const shape = (w: number, d: number) => {
    const s = new THREE.Shape(), r = d / 2;
    s.absarc(-w / 2 + r, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false);
    s.absarc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false);
    return s;
  };
  const railShape = shape(6.6, 4.2);
  railShape.holes.push(shape(6.0, 3.6)); // a padded ring around the felt, not a lid over it
  const rail = new THREE.Mesh(
    new THREE.ExtrudeGeometry(railShape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, curveSegments: 48 }),
    new THREE.MeshStandardMaterial({ color: RAIL, roughness: 0.6 }),
  );
  rail.rotation.x = -Math.PI / 2;
  rail.position.y = -0.17;
  const felt = new THREE.Mesh(new THREE.ShapeGeometry(shape(6.0, 3.6), 48), new THREE.MeshStandardMaterial({ color: FELT, roughness: 0.95 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = 0.001;
  scene.add(rail, felt);
}

// ── the table ─────────────────────────────────────────────────────────────────
export class Table3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  private cards: Card[] = [];
  private oppCards: Card[] = [];
  private board: Card[] = [];
  private faces = new Map<string, Card>(); // every face-up card on the table, by code
  private flyCodes: string[] = [];
  private boardCodes: string[] = [];
  private rings = new SeatRings([SEAT_Z.fly, SEAT_Z.opponent]);
  private bets: Record<Seat, { amount: number; stack: THREE.Group | null }> = {
    fly: { amount: 0, stack: null },
    opponent: { amount: 0, stack: null },
  };
  private pot = { amount: 0, stack: null as THREE.Group | null };
  private lastTotal = 0;
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private glow: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private labels: Record<"opponent" | "fly" | "pot", HTMLElement>;
  private verdict: HTMLElement; // "The fly wins $50", in the dead space under the table
  private opponent: { name: string; color: string } = { name: "", color: "#fff" };
  private robot = new Robot();
  private lens = false;
  private target = new THREE.WebGLRenderTarget(1, 1);
  private post = new THREE.Scene();
  private postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lensMaterial = new THREE.ShaderMaterial({
    vertexShader: lensVertex,
    fragmentShader: lensFragment,
    uniforms: {
      scene: { value: null },
      resolution: { value: new THREE.Vector2(1, 1) },
      facet: { value: FACET },
      time: { value: 0 },
      background: { value: new THREE.Color("#0b0a10") },
    },
  });

  constructor(private canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera.position.set(0, 6.6, 5.8);
    this.camera.lookAt(0, 0, -0.35); // framed to include the robot behind the far seat

    buildTable(this.scene);

    // The fly's seat glows while it thinks, in the brain's own colours.
    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.08, 64),
      new THREE.MeshBasicMaterial({ color: "#f7b538", transparent: true, opacity: 0, blending: THREE.AdditiveBlending }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.set(0, 0.005, SEAT_Z.fly + 0.05);
    this.glow.scale.set(1.3, 0.55, 1);
    this.scene.add(this.glow);

    this.scene.add(this.robot.group, this.rings.group);
    this.lensMaterial.uniforms.scene.value = this.target.texture;
    this.post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lensMaterial));

    const tag = (cls: string) => {
      const el = document.createElement("div");
      el.className = `tag ${cls}`;
      overlay.append(el);
      return el;
    };
    this.labels = { opponent: tag("tag--opponent"), fly: tag("tag--fly"), pot: tag("tag--pot") };
    this.verdict = tag("verdict");

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  /** Brain activity level 0..1 while the fly is thinking (drives the seat glow). */
  thinking(level: number): void {
    this.glow.material.opacity = 0.15 + 0.85 * level;
  }

  /** See the table through a compound eye. */
  setLens(on: boolean): void {
    this.lens = on;
  }

  /** Animate one event. Events play in order, never overlapping; resolves when done. */
  handle(m: Message): Promise<void> {
    this.pending++;
    this.queue = this.queue
      .then(() => this.play(m))
      .catch((e) => console.error(e))
      .finally(() => this.pending--);
    return this.queue;
  }

  private async play(m: Message): Promise<void> {
    speed = this.pending > 1 ? 0.25 : 1;
    switch (m.type) {
      case "hand": {
        this.clear();
        this.flyCodes = m.fly_cards;
        this.robot.wear(OPPONENT_COLOR[m.opponent]);
        this.opponent = { name: OPPONENT_LABEL[m.opponent], color: OPPONENT_COLOR[m.opponent] };
        this.setTag("opponent", this.opponent.name, "");
        (this.labels.opponent.querySelector(".tag__name") as HTMLElement).style.color = this.opponent.color;
        this.setTag("fly", "The fly", m.fly_button ? "Dealer" : "Big blind");
        const flyBlind = m.fly_button ? 50 : 100;
        this.lastTotal = 150;
        await Promise.all([this.bet("fly", flyBlind), this.bet("opponent", 150 - flyBlind)]);
        for (let i = 0; i < 2; i++) {
          const mine = this.deal(m.fly_cards[i]);
          await mine.moveTo(new THREE.Vector3(-0.36 + i * 0.72, 0.01 + i * 0.002, SEAT_Z.fly), true);
          const theirs = this.deal(null);
          this.oppCards.push(theirs);
          await theirs.moveTo(new THREE.Vector3(-0.36 + i * 0.72, 0.01 + i * 0.002, SEAT_Z.opponent), false);
        }
        break;
      }
      case "board": {
        this.boardCodes = m.cards;
        await this.sweepBets();
        for (let i = this.board.length; i < m.cards.length; i++) {
          const c = this.deal(m.cards[i]);
          this.board.push(c);
          await c.moveTo(new THREE.Vector3(-1.44 + i * 0.72, 0.01, -0.1), true, 360);
        }
        break;
      }
      case "action":
        this.setTag("opponent", null, ACTION_LABEL[m.action]);
        await Promise.all([this.robot.nod(), this.contribute("opponent", m.pot, m.action === "fold")]);
        break;
      case "thinking":
        this.setTag("fly", null, "Thinking…");
        this.labels.pot.textContent = `Pot ${dollars(m.pot)}`;
        break;
      case "decision":
        this.thinking(0);
        this.setTag("fly", null, ACTION_LABEL[m.action]);
        await this.contribute("fly", m.pot, m.action === "fold");
        break;
      case "result": {
        if (m.showdown) {
          this.oppCards.forEach((c, i) => {
            c.reveal(m.opponent_cards[i]);
            this.faces.set(m.opponent_cards[i], c);
          });
          await Promise.all(this.oppCards.map((c) => c.flip()));
        }
        await this.sweepBets();
        const winner: Seat | null = m.fly_bb > 0 ? "fly" : m.fly_bb < 0 ? "opponent" : null;
        const amount = dollars(Math.abs(m.fly_bb) * 100);
        // This screen is on the fly's side: its winnings are green, the bot's are red.
        this.labels.pot.textContent = "";
        showVerdict(this.verdict, winner === "fly" ? { name: "The fly", color: FLY_COLOR } : winner ? this.opponent : null,
          amount, winner === "fly");
        const loser: Seat | null = winner === "fly" ? "opponent" : winner ? "fly" : null;
        if (m.showdown) {
          const board = this.boardCodes;
          const hands: Record<Seat, MadeHand> = {
            fly: describe([...this.flyCodes, ...board]),
            opponent: describe([...m.opponent_cards, ...board]),
          };
          for (const seat of ["fly", "opponent"] as Seat[]) this.setTag(seat, null, handWords(hands[seat]));
          markShowdown(this.faces, winner ? [hands[winner]] : [hands.fly, hands.opponent], loser ? hands[loser] : null);
        }
        if (winner && loser) {
          this.labels[winner].classList.add("is-winner");
          this.labels[loser].classList.add("is-loser");
          void this.rings.show(SEAT_Z[winner], WIN);
          void this.rings.show(SEAT_Z[loser], LOSE);
        }
        if (winner && this.pot.stack) {
          const s = this.pot.stack;
          const from = s.position.clone(), to = new THREE.Vector3(1.2, 0, SEAT_Z[winner] * 0.85);
          await tween(650, (k) => s.position.lerpVectors(from, to, k));
        }
        break;
      }
    }
  }

  private deal(code: string | null): Card {
    const c = new Card(code);
    if (code) this.faces.set(code, c);
    c.group.position.copy(DECK);
    this.scene.add(c.group);
    this.cards.push(c);
    return c;
  }

  private async contribute(seat: Seat, total: number, folded: boolean): Promise<void> {
    if (folded || !total) return;
    const added = total - this.lastTotal;
    this.lastTotal = total;
    if (added > 0) await this.bet(seat, added);
    this.labels.pot.textContent = `Pot ${dollars(total)}`;
  }

  private async bet(seat: Seat, added: number): Promise<void> {
    const b = this.bets[seat];
    b.amount += added;
    const old = b.stack;
    const stack = chipStack(b.amount);
    const to = new THREE.Vector3(0.95, 0, SEAT_Z[seat] * 0.55);
    stack.position.set(1.4, 0, SEAT_Z[seat] * 0.95);
    this.scene.add(stack);
    b.stack = stack;
    const from = stack.position.clone();
    await tween(380, (k) => stack.position.lerpVectors(from, to, k));
    if (old) this.scene.remove(old);
  }

  private async sweepBets(): Promise<void> {
    const moving = (Object.keys(this.bets) as Seat[]).filter((s) => this.bets[s].stack);
    if (!moving.length) return;
    const center = new THREE.Vector3(0, 0, 0.42);
    await Promise.all(
      moving.map((s) => {
        const st = this.bets[s].stack!, from = st.position.clone();
        return tween(420, (k) => st.position.lerpVectors(from, center, k));
      }),
    );
    for (const s of moving) {
      this.pot.amount += this.bets[s].amount;
      this.scene.remove(this.bets[s].stack!);
      this.bets[s] = { amount: 0, stack: null };
    }
    if (this.pot.stack) this.scene.remove(this.pot.stack);
    this.pot.stack = chipStack(this.pot.amount);
    this.pot.stack.position.copy(center);
    this.scene.add(this.pot.stack);
  }

  private clear(): void {
    for (const c of this.cards) this.scene.remove(c.group);
    for (const s of [this.bets.fly.stack, this.bets.opponent.stack, this.pot.stack]) if (s) this.scene.remove(s);
    this.cards = [];
    this.oppCards = [];
    this.board = [];
    this.faces.clear();
    this.boardCodes = [];
    this.rings.clear();
    for (const el of [this.labels.fly, this.labels.opponent]) el.classList.remove("is-winner", "is-loser");
    this.bets = { fly: { amount: 0, stack: null }, opponent: { amount: 0, stack: null } };
    this.pot = { amount: 0, stack: null };
    this.labels.pot.textContent = "";
    this.verdict.classList.remove("is-shown");
    this.thinking(0);
  }

  private setTag(which: "opponent" | "fly", name: string | null, action: string): void {
    const el = this.labels[which];
    if (name !== null) el.innerHTML = `<span class="tag__name"></span><span class="tag__action"></span>`;
    if (name !== null) el.querySelector(".tag__name")!.textContent = name;
    el.querySelector(".tag__action")!.textContent = action;
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    const px = this.renderer.getPixelRatio();
    this.target.setSize(Math.round(w * px), Math.round(h * px));
    this.lensMaterial.uniforms.resolution.value.set(w * px, h * px);
    this.lensMaterial.uniforms.facet.value = FACET * px;
    this.camera.aspect = w / h;
    // Keep the whole table in frame on narrow screens.
    this.camera.fov = w / h < 1.6 ? 42 * (1.6 / (w / h)) ** 0.8 : 42;
    this.camera.updateProjectionMatrix();
  }

  private place(el: HTMLElement, p: THREE.Vector3): void {
    const v = p.clone().project(this.camera);
    el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * this.canvas.clientWidth}px, ${((1 - v.y) / 2) * this.canvas.clientHeight}px)`;
  }

  private tick(now: number): void {
    runTweens(now);
    this.robot.idle(now);
    this.rings.tick(now);
    this.place(this.labels.opponent, new THREE.Vector3(1.45, 1.1, ROBOT_Z));
    this.place(this.labels.fly, new THREE.Vector3(-2.1, 0.1, SEAT_Z.fly));
    this.place(this.labels.pot, new THREE.Vector3(0, 0.1, 0.7));
    this.place(this.verdict, new THREE.Vector3(0, -0.2, 2.75));
    if (this.lens) {
      this.lensMaterial.uniforms.time.value = now / 1000;
      this.renderer.setRenderTarget(this.target);
      this.renderer.render(this.scene, this.camera);
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.post, this.postCamera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
