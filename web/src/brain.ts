// The specimen: every neuron at its real soma position, shown the way a calcium-imaging
// recording is — a fixed projection, a scale bar, and ImageJ's "Fire" lookup table.

import * as THREE from "three";

const RISE = 0.55; // fraction of the gap closed per animation frame when activity rises
const FALL_PER_SEC = 0.35; // fraction of activity left after one second without input

// ImageJ "Fire", sampled to five stops (kept in sync with --fire-* in style.css).
const FIRE = ["#2a0b3d", "#8c1d5b", "#e0533a", "#f7b538", "#fff6d8"].map((c) => new THREE.Color(c));

const vertex = /* glsl */ `
  attribute float activity;
  attribute float readout;
  uniform float pixelRatio;
  varying float vA;
  varying float vReadout;
  void main() {
    vA = activity;
    vReadout = readout;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float base = mix(1.7, 3.2, readout);
    gl_PointSize = (base + 2.4 * activity) * pixelRatio;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 fire[5];
  uniform vec3 rest;
  varying float vA;
  varying float vReadout;
  vec3 lut(float t) {
    float x = clamp(t, 0.0, 1.0) * 4.0;
    int i = int(min(floor(x), 3.0));
    return mix(fire[i], fire[i + 1], x - float(i));
  }
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c);
    if (d > 0.25) discard;
    float soft = 1.0 - smoothstep(0.08, 0.25, d);
    vec3 color = vA > 0.02 ? lut(vA) : rest;
    float alpha = vA > 0.02 ? (0.35 + 0.65 * vA) : mix(0.20, 0.55, vReadout);
    gl_FragColor = vec4(color * soft, alpha * soft);
  }
`;

export class BrainView {
  readonly umPerPixel: () => number;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private group = new THREE.Group();
  private shown: Float32Array;
  private target: Float32Array;
  private activityAttr: THREE.BufferAttribute;
  private height: number;
  private width: number;
  private last = performance.now();
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor(
    private canvas: HTMLCanvasElement,
    xyz: Float32Array,
    readout: number[],
    onResize: () => void,
    maxPixelRatio = 2, // phones pass less: the point cloud is the heaviest thing on screen
  ) {
    const n = xyz.length / 3;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, maxPixelRatio));

    // Data axes: x left-right, z head-to-tail, y depth. Screen: x right, z down.
    let [minX, maxX, minZ, maxZ, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity];
    for (let i = 0; i < n; i++) {
      const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
    const pos = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) {
      pos[3 * i] = xyz[3 * i] - cx;
      pos[3 * i + 1] = -(xyz[3 * i + 2] - cz);
      pos[3 * i + 2] = xyz[3 * i + 1] - cy;
    }
    this.height = (maxZ - minZ) * 1.06;
    this.width = (maxX - minX) * 1.06;

    const isReadout = new Float32Array(n);
    for (const i of readout) isReadout[i] = 1;
    this.shown = new Float32Array(n);
    this.target = new Float32Array(n);

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.activityAttr = new THREE.BufferAttribute(this.shown, 1);
    this.activityAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute("activity", this.activityAttr);
    geom.setAttribute("readout", new THREE.BufferAttribute(isReadout, 1));

    const material = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        fire: { value: FIRE },
        rest: { value: new THREE.Color("#6f6880") },
        pixelRatio: { value: this.renderer.getPixelRatio() },
      },
      transparent: true,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });
    this.group.add(new THREE.Points(geom, material));
    this.scene.add(this.group);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000);
    this.umPerPixel = () => (this.camera.top - this.camera.bottom) / canvas.clientHeight;

    new ResizeObserver(() => {
      this.resize();
      onResize();
    }).observe(canvas);
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** A new timestep of whole-brain activity (one byte per neuron). */
  frame(activity: Uint8Array): void {
    const t = this.target;
    for (let i = 0; i < t.length; i++) t[i] = activity[i] / 255;
  }

  /** Let activity fade, e.g. after the decision is made. */
  rest(): void {
    this.target.fill(0);
  }

  private resize(): void {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false);
    // Fit the whole nervous system, whichever dimension binds.
    const halfH = Math.max(this.height / 2, (this.width / 2) * (h / w)), halfW = (halfH * w) / h;
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
  }

  private tick(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const fall = Math.pow(FALL_PER_SEC, dt);
    const s = this.shown, t = this.target;
    for (let i = 0; i < s.length; i++) {
      s[i] = t[i] > s[i] ? s[i] + (t[i] - s[i]) * RISE : Math.max(t[i], s[i] * fall);
    }
    this.activityAttr.needsUpdate = true;
    // A slow quarter-turn sway gives depth without leaving the familiar frontal view.
    if (!this.reducedMotion) this.group.rotation.y = 0.32 * Math.sin(now / 9000);
    this.renderer.render(this.scene, this.camera);
  }
}
