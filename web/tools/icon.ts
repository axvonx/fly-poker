// Renders the site icon: the fly avatar's head, framed tight, drawn natively at each size
// (not downscaled), on a transparent background. Dev-only; run by tools/render_icons.mjs:
//   (cd web && pnpm exec vite --port 5199) then node tools/render_icons.mjs
import * as THREE from "three";
import { FlyAvatar } from "../src/play/avatar";
import { ROBOT_Z } from "../src/table3d";

function render(size: number): string {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight("#d8cfe8", "#0b0a10", 1.3));
  const key = new THREE.DirectionalLight("#fff1dc", 2.2);
  key.position.set(0.6, 2, 3);
  scene.add(key);
  const fly = new FlyAvatar();
  fly.thinking(0.35); // a little glow in the eyes
  // Just the head (and the wings behind it): hide the body, abdomen and legs, the group's own meshes.
  for (const child of fly.group.children) if (child instanceof THREE.Mesh) child.visible = false;
  scene.add(fly.group);
  // In world space the head spans y 0.47 (proboscis) to 1.35 (wing tips), x ±0.62 (eyes).
  const target = new THREE.Vector3(0, 0.92, ROBOT_Z);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
  camera.position.set(0, 1.15, ROBOT_Z + 3.2);
  camera.lookAt(target);
  renderer.render(scene, camera);
  const url = canvas.toDataURL("image/png");
  renderer.dispose();
  return url;
}

(window as unknown as { renderIcon: typeof render }).renderIcon = render;
