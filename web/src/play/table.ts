// The table for a person playing the fly: you sit at the near seat with your cards face up,
// the fly sits across with its cards face down until the hand ends. Built from the fair
// display's pieces (cards, chips, lens); driven by the engine's events, never deciding anything.

import * as THREE from "three";
import type { GameEvent } from "../engine/game";
import { ACTION_LABEL } from "../protocol";
import { describe, type MadeHand } from "../hands";
import {
  buildTable, Card, chipStack, DECK, FACET, FAR_Z, FLY_COLOR, showVerdict, YOU_COLOR, handWords, HINT, lensFragment, lensVertex, LOSE, markShowdown, NEAR_Z,
  ROBOT_Z, runTweens, SeatRings, tween, WIN,
} from "../table3d";
import { FlyAvatar } from "./avatar";
import { dollars } from "./money";

type Seat = "you" | "fly";
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Where everything sits. "wide" is the desktop table; "portrait" is a phone's: the table turned so
 * its long side runs up the screen, the fly at the top end, you at the bottom, camera overhead. */
interface Layout {
  table: { w: number; d: number; turn: boolean; see?: number };
  seat: Record<Seat, number>; // z of each seat's cards
  avatarZ: number;
  avatarScale: number;
  boardZ: number;
  potZ: number; // where bets are swept to
  anchors: { fly: THREE.Vector3; you: THREE.Vector3; pot: THREE.Vector3; verdict: THREE.Vector3; bubble: THREE.Vector3 };
  bubbleBeside: boolean; // bubble to the left of the fly (wide) or under it (portrait)
  fit: THREE.Vector3[] | null; // points the camera keeps in frame (portrait), else the desktop framing
}
const WIDE: Layout = {
  table: { w: 6.0, d: 3.6, turn: false },
  seat: { you: NEAR_Z, fly: FAR_Z },
  avatarZ: ROBOT_Z,
  avatarScale: 1.1,
  boardZ: -0.1,
  potZ: 0.42,
  anchors: { fly: V(1.8, 1.1, ROBOT_Z), you: V(-2.1, 0.1, NEAR_Z), pot: V(0, 0.1, 0.7), verdict: V(0, -0.2, 2.75), bubble: V(-0.95, 1.05, ROBOT_Z) },
  bubbleBeside: true,
  fit: null,
};
const P_AVATAR = -3.6;
const PORTRAIT: Layout = {
  table: { w: 5.8, d: 4.0, turn: true, see: 0.72 }, // the brain behind shows through the felt
  seat: { you: 1.9, fly: -1.95 },
  avatarZ: P_AVATAR,
  avatarScale: 1.0,
  boardZ: -0.05,
  potZ: 0.75,
  // The thinking bubble sits left of the fly's head, clear of its cards (they flip at showdown).
  anchors: { fly: V(1.55, 0.55, P_AVATAR), you: V(-1.75, 0.1, 1.9), pot: V(0, 0.1, 1.2), verdict: V(0, 0.1, 2.85), bubble: V(-0.75, 1.3, P_AVATAR) },
  bubbleBeside: true,
  fit: [V(-2.3, 0, 3.2), V(2.3, 0, 3.2), V(-2.3, 0, -3.2), V(2.3, 0, -3.2), V(0, 1.75, P_AVATAR), V(-0.9, 1.55, P_AVATAR), V(0.9, 1.55, P_AVATAR)],
};

export class PlayTable {
  readonly fly = new FlyAvatar();
  /** Called whenever your best hand changes (after the deal and each board card). */
  onHand: (h: MadeHand, hole: string[], board: string[]) => void = () => {};
  private L: Layout;
  private rings: SeatRings;
  private faces = new Map<string, Card>();
  private yourCodes: string[] = [];
  private boardCodes: string[] = [];
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50);
  private cards: Card[] = [];
  private flyCards: Card[] = [];
  private board: Card[] = [];
  private bets: Record<Seat, { amount: number; stack: THREE.Group | null }> = {
    you: { amount: 0, stack: null },
    fly: { amount: 0, stack: null },
  };
  private pot = { amount: 0, stack: null as THREE.Group | null };
  private lastTotal = 0;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0; // bumped by reset(): queued events from an abandoned hand are dropped
  private glow: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private labels: Record<Seat | "pot", HTMLElement>;
  private verdict: HTMLElement; // "You win $50!", in the dead space under the table
  /** After the hand, what the fly was thinking, in a bubble beside its head. */
  readonly bubble: HTMLElement;
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

  constructor(
    private canvas: HTMLCanvasElement,
    overlay: HTMLElement,
    { layout = "wide", maxPixelRatio = 2 }: { layout?: "wide" | "portrait"; maxPixelRatio?: number } = {},
  ) {
    this.L = layout === "portrait" ? PORTRAIT : WIDE;
    this.rings = new SeatRings([this.L.seat.you, this.L.seat.fly]);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (this.L.fit) this.camera.position.set(0, 11, 2.6); // nearly overhead
    else this.camera.position.set(0, 6.6, 5.8);
    this.camera.lookAt(0, 0, this.L.fit ? -0.25 : -0.35); // framed to include the fly behind the far seat
    this.fly.group.position.z = this.L.avatarZ;
    this.fly.group.scale.setScalar(this.L.avatarScale);

    buildTable(this.scene, this.L.table);
    // The fly's seat glows while it thinks, in the brain's own colours.
    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1.08, 64),
      new THREE.MeshBasicMaterial({ color: "#f7b538", transparent: true, opacity: 0, blending: THREE.AdditiveBlending }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.position.set(0, 0.005, this.L.seat.fly - 0.05);
    this.glow.scale.set(1.3, 0.55, 1);
    this.scene.add(this.glow, this.fly.group, this.rings.group);
    this.lensMaterial.uniforms.scene.value = this.target.texture;
    this.post.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.lensMaterial));

    const tag = (cls: string) => {
      const el = document.createElement("div");
      el.className = `tag ${cls}`;
      overlay.append(el);
      return el;
    };
    this.labels = { fly: tag("tag--fly"), you: tag("tag--you"), pot: tag("tag--pot") };
    this.verdict = tag("verdict");
    this.bubble = document.createElement("div");
    this.bubble.className = this.L.bubbleBeside ? "bubble" : "bubble bubble--below";
    this.bubble.hidden = true;
    overlay.append(this.bubble);

    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.tick(t));
  }

  /** Brain activity level 0..1 while the fly is thinking (seat glow and eyes). */
  thinking(level: number): void {
    this.glow.material.opacity = level ? 0.15 + 0.85 * level : 0;
    this.fly.thinking(level);
  }

  setLens(on: boolean): void {
    this.lens = on;
  }

  /** Animate one event. Events play in order, never overlapping; resolves when done. */
  handle(e: GameEvent): Promise<void> {
    const g = this.generation;
    this.queue = this.queue.then(() => (g === this.generation ? this.play(e) : undefined)).catch((err) => console.error(err));
    return this.queue;
  }

  /** Forget the current hand at once (a new fly was picked mid-hand). */
  reset(): void {
    this.generation++;
    this.queue = this.queue.then(() => this.clear());
  }

  private async play(e: GameEvent): Promise<void> {
    switch (e.type) {
      case "hand": {
        this.clear();
        this.setTag("fly", "The fly", e.human_button ? "Big blind" : "Dealer");
        this.setTag("you", "You", e.human_button ? "Dealer" : "Big blind");
        // Heads-up, the dealer posts the small blind.
        const yours = e.human_button ? 50 : 100;
        this.yourCodes = e.human_cards;
        this.lastTotal = 150;
        await Promise.all([this.bet("you", yours), this.bet("fly", 150 - yours)]);
        this.labels.pot.textContent = `Pot ${dollars(150)}`;
        for (let i = 0; i < 2; i++) {
          const mine = this.deal(e.human_cards[i]);
          await mine.moveTo(new THREE.Vector3(-0.36 + i * 0.72, 0.01 + i * 0.002, this.L.seat.you), true);
          const theirs = this.deal(null);
          this.flyCards.push(theirs);
          await theirs.moveTo(new THREE.Vector3(-0.36 + i * 0.72, 0.01 + i * 0.002, this.L.seat.fly), false);
        }
        this.hint();
        break;
      }
      case "board": {
        this.boardCodes = e.cards;
        await this.sweepBets();
        for (let i = this.board.length; i < e.cards.length; i++) {
          const c = this.deal(e.cards[i]);
          this.board.push(c);
          await c.moveTo(new THREE.Vector3(-1.44 + i * 0.72, 0.01, this.L.boardZ), true, 360);
        }
        this.hint();
        break;
      }
      case "thinking":
        this.setTag("fly", null, "Thinking…");
        break;
      case "decision":
        this.thinking(0);
        this.setTag("fly", null, ACTION_LABEL[e.action]);
        await Promise.all([this.fly.act(), this.contribute("fly", e.pot, e.action === "fold")]);
        break;
      case "action":
        this.setTag("you", null, ACTION_LABEL[e.action]);
        await this.contribute("you", e.pot, e.action === "fold");
        break;
      case "turn":
        this.setTag("you", null, "Your move");
        break;
      case "result": {
        // The fly's cards are always shown once the hand is over: that's the deal with visitors.
        this.flyCards.forEach((c, i) => {
          c.reveal(e.fly_cards[i]);
          this.faces.set(e.fly_cards[i], c);
        });
        await Promise.all(this.flyCards.map((c) => c.flip()));
        await this.sweepBets();
        const winner: Seat | null = e.human_bb > 0 ? "you" : e.human_bb < 0 ? "fly" : null;
        const loser: Seat | null = winner === "you" ? "fly" : winner ? "you" : null;
        const amount = dollars(Math.abs(e.human_bb) * 100);
        // This screen is on your side: your winnings are green, the fly's are red.
        this.labels.pot.textContent = "";
        showVerdict(this.verdict, winner === "you" ? { name: "You", color: YOU_COLOR } : winner ? { name: "The fly", color: FLY_COLOR } : null,
          amount, winner === "you", winner === "you");
        const hands: Record<Seat, MadeHand> = {
          you: describe([...this.yourCodes, ...e.board]),
          fly: describe([...e.fly_cards, ...e.board]),
        };
        if (e.showdown) {
          this.setTag("you", null, handWords(hands.you));
          this.setTag("fly", null, handWords(hands.fly));
          markShowdown(this.faces, winner ? [hands[winner]] : [hands.you, hands.fly], loser ? hands[loser] : null);
        } else {
          for (const c of this.faces.values()) c.highlight(null);
        }
        if (winner && loser) {
          this.labels[winner].classList.add("is-winner");
          this.labels[loser].classList.add("is-loser");
          void this.rings.show(this.L.seat[winner], WIN);
          void this.rings.show(this.L.seat[loser], LOSE);
        }
        if (winner && this.pot.stack) {
          const s = this.pot.stack;
          const from = s.position.clone(), to = new THREE.Vector3(1.2, 0, this.L.seat[winner] * 0.85);
          await tween(650, (k) => s.position.lerpVectors(from, to, k));
        }
        break;
      }
    }
  }

  /** Gold borders under the cards that make your hand (from a pair up), and tell the page. */
  private hint(): void {
    const h = describe([...this.yourCodes, ...this.boardCodes]);
    const core = new Set(h.rank >= 1 ? h.core : []);
    for (const [code, card] of this.faces) card.highlight(core.has(code) ? HINT : null);
    this.onHand(h, this.yourCodes, this.boardCodes);
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
    const to = new THREE.Vector3(0.95, 0, this.L.seat[seat] * 0.55);
    stack.position.set(1.4, 0, this.L.seat[seat] * 0.95);
    this.scene.add(stack);
    b.stack = stack;
    const from = stack.position.clone();
    await tween(380, (k) => stack.position.lerpVectors(from, to, k));
    if (old) this.scene.remove(old);
  }

  private async sweepBets(): Promise<void> {
    const moving = (Object.keys(this.bets) as Seat[]).filter((s) => this.bets[s].stack);
    if (!moving.length) return;
    const center = new THREE.Vector3(0, 0, this.L.potZ);
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
    for (const s of [this.bets.you.stack, this.bets.fly.stack, this.pot.stack]) if (s) this.scene.remove(s);
    this.cards = [];
    this.flyCards = [];
    this.board = [];
    this.faces.clear();
    this.boardCodes = [];
    this.rings.clear();
    for (const el of [this.labels.you, this.labels.fly]) el.classList.remove("is-winner", "is-loser");
    this.bets = { you: { amount: 0, stack: null }, fly: { amount: 0, stack: null } };
    this.pot = { amount: 0, stack: null };
    this.labels.pot.textContent = "";
    this.verdict.classList.remove("is-shown");
    this.bubble.hidden = true;
    this.thinking(0);
  }

  private setTag(which: Seat, name: string | null, action: string): void {
    const el = this.labels[which];
    if (name !== null) {
      el.innerHTML = `<span class="tag__name"></span><span class="tag__action"></span>`;
      el.querySelector(".tag__name")!.textContent = name;
    }
    el.querySelector(".tag__action")!.textContent = action;
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    const px = this.renderer.getPixelRatio();
    this.target.setSize(Math.round(w * px), Math.round(h * px));
    this.lensMaterial.uniforms.resolution.value.set(w * px, h * px);
    this.lensMaterial.uniforms.facet.value = FACET * px;
    this.camera.aspect = w / h;
    if (this.L.fit) {
      this.fitCamera(this.L.fit);
      return;
    }
    // Keep the whole table in frame on narrow screens.
    this.camera.fov = w / h < 1.6 ? 42 * (1.6 / (w / h)) ** 0.8 : 42;
    this.camera.updateProjectionMatrix();
  }

  private place(el: HTMLElement, p: THREE.Vector3): void {
    const v = p.clone().project(this.camera);
    el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * this.canvas.clientWidth}px, ${((1 - v.y) / 2) * this.canvas.clientHeight}px)`;
  }

  /** The smallest field of view (portrait) that keeps every point in frame, whatever the aspect. */
  private fitCamera(points: THREE.Vector3[]): void {
    let lo = 10, hi = 110;
    for (let k = 0; k < 18; k++) {
      this.camera.fov = (lo + hi) / 2;
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
      const fits = points.every((p) => {
        const v = p.clone().project(this.camera);
        return Math.abs(v.x) <= 0.97 && Math.abs(v.y) <= 0.97;
      });
      if (fits) hi = this.camera.fov;
      else lo = this.camera.fov;
    }
    this.camera.fov = hi;
    this.camera.updateProjectionMatrix();
  }

  /** Wide: right edge at the fly's left cheek, tail pointing at it. Portrait: centred under the
   * fly. Kept inside the canvas either way. */
  private placeBubble(): void {
    const v = this.L.anchors.bubble.clone().project(this.camera);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const bw = this.bubble.offsetWidth, bh = this.bubble.offsetHeight;
    const px = ((v.x + 1) / 2) * w, py = ((1 - v.y) / 2) * h;
    const x = Math.min(Math.max(8, this.L.bubbleBeside ? px - bw : px - bw / 2), w - bw - 8);
    const y = Math.min(Math.max(8, this.L.bubbleBeside ? py - bh / 2 : py), h - bh - 8);
    this.bubble.style.transform = `translate(${x}px, ${y}px)`;
  }

  private tick(now: number): void {
    runTweens(now);
    this.fly.idle(now);
    this.rings.tick(now);
    const a = this.L.anchors;
    this.place(this.labels.fly, a.fly);
    this.place(this.labels.you, a.you);
    this.place(this.labels.pot, a.pot);
    this.place(this.verdict, a.verdict);
    if (!this.bubble.hidden) this.placeBubble();
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
