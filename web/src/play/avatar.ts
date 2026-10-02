// The fly across the table: built from the same flat-shaded boxes as the fair display's robot,
// so it belongs in the same scene. Big red compound eyes that glow while it thinks, wings that
// buzz when it acts, front legs resting on the rail.

import * as THREE from "three";
import { ROBOT_Z, tween } from "../table3d";

const CHITIN = "#a07c4e", DARK = "#2a1f18", EYE = "#c0272d", WING = "#d6deea";

export class FlyAvatar {
  readonly group = new THREE.Group();
  private head = new THREE.Group();
  private wings: THREE.Group[] = [];
  private eyeMat = new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.3, emissive: EYE, emissiveIntensity: 0.15 });

  constructor() {
    const chitin = new THREE.MeshStandardMaterial({ color: CHITIN, roughness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.5 });
    const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      b.position.set(x, y, z);
      return b;
    };

    // Thorax, with bristles on top and the striped abdomen tucked behind it.
    this.group.add(box(0.95, 0.75, 0.6, chitin, 0, 0.45));
    for (const x of [-0.24, 0, 0.24]) this.group.add(box(0.03, 0.14, 0.03, dark, x, 0.88, 0.05));
    for (let i = 0; i < 3; i++) {
      this.group.add(box(0.82 - i * 0.14, 0.5 - i * 0.07, 0.22, i % 2 ? chitin : dark, 0, 0.38 - i * 0.03, -0.41 - i * 0.22));
    }

    // Front legs: shoulder to elbow, then the forearm lying on the rail.
    for (const side of [-1, 1]) {
      const upper = box(0.1, 0.1, 0.5, dark, side * 0.5, 0.5, 0.42);
      upper.rotation.x = 0.35;
      const fore = box(0.09, 0.09, 0.5, dark, side * 0.56, 0.4, 0.86);
      this.group.add(upper, fore);
    }

    // Wings: translucent blades swept back from the top of the thorax, in a V.
    const wingMat = new THREE.MeshStandardMaterial({
      color: WING, emissive: WING, emissiveIntensity: 0.25, roughness: 0.2, transparent: true, opacity: 0.55,
      side: THREE.DoubleSide, depthWrite: false,
    });
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.22, 0.84, -0.15);
      pivot.add(box(0.4, 0.015, 1.2, wingMat, 0, 0, -0.6));
      pivot.rotation.set(0.6, side * 0.6, 0);
      pivot.userData.side = side;
      this.group.add(pivot);
      this.wings.push(pivot);
    }

    // Head: nearly all eye. The eyes carry a grid of facets.
    this.eyeMat.map = facets();
    this.head.position.y = 1.1;
    this.head.add(box(0.46, 0.4, 0.4, chitin));
    for (const side of [-1, 1]) {
      this.head.add(box(0.36, 0.5, 0.44, this.eyeMat, side * 0.38, 0.03, 0.05));
      const antenna = box(0.05, 0.18, 0.05, dark, side * 0.08, 0.26, 0.2);
      antenna.rotation.z = -side * 0.3;
      this.head.add(antenna);
    }
    this.head.add(box(0.12, 0.16, 0.1, dark, 0, -0.24, 0.18)); // proboscis
    this.group.add(this.head);

    this.group.scale.setScalar(1.1);
    this.group.position.set(0, -0.35, ROBOT_Z);
  }

  /** Brain activity 0..1: the eyes glow brighter as it thinks. */
  thinking(level: number): void {
    this.eyeMat.emissiveIntensity = 0.15 + 0.85 * level;
  }

  /** Acting: a nod and a buzz of the wings. */
  async act(): Promise<void> {
    await tween(420, (k) => {
      const s = Math.sin(k * Math.PI);
      this.head.rotation.x = s * 0.3;
      for (const w of this.wings) w.rotation.x = 0.6 + 0.35 * Math.sin(k * Math.PI * 14) * s;
    });
  }

  idle(now: number): void {
    this.head.rotation.y = 0.16 * Math.sin(now / 1500);
    this.group.position.y = -0.35 + 0.03 * Math.sin(now / 700);
  }
}

/** A compound eye's texture: dark facet walls on red. */
function facets(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#5a5a5a";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.beginPath();
    g.arc(x * 8 + (y % 2 ? 4 : 0), y * 8 + 4, 1.4, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
