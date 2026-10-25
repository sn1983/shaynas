import * as THREE from "three";

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn = (t) => Math.pow(clamp(t, 0, 1), 3);
export const easeInOut = (t) => {
  t = clamp(t, 0, 1);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// smooth deterministic noise for handheld camera shake
export function noise1(x, seed = 0) {
  const h = (n) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

const matCache = new Map();
export function mat(color, rough = 0.7, extra = {}) {
  const key = color + "|" + rough + "|" + JSON.stringify(extra);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, ...extra });
  matCache.set(key, m);
  return m;
}
export function phys(color, rough = 0.6, extra = {}) {
  const key = "p" + color + "|" + rough + "|" + JSON.stringify(extra);
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: rough, metalness: 0, ...extra });
  matCache.set(key, m);
  return m;
}

export function mesh(geo, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geo, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// Collects many copies of one geometry+material and emits a single InstancedMesh.
export class Batcher {
  constructor() {
    this.kinds = new Map();
  }
  add(kind, geo, material, matrix, color) {
    if (!this.kinds.has(kind)) this.kinds.set(kind, { geo, material, items: [] });
    this.kinds.get(kind).items.push({ matrix: matrix.clone(), color });
  }
  box(kind, material, x, y, z, sx, sy, sz, ry = 0, color, rx = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
      new THREE.Vector3(sx, sy, sz),
    );
    this.add(kind, UNIT_BOX, material, m, color);
  }
  build(parent, { cast = true, receive = true } = {}) {
    for (const [, k] of this.kinds) {
      const im = new THREE.InstancedMesh(k.geo, k.material, k.items.length);
      k.items.forEach((it, i) => {
        im.setMatrixAt(i, it.matrix);
        if (it.color !== undefined) im.setColorAt(i, new THREE.Color(it.color));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = cast;
      im.receiveShadow = receive;
      im.computeBoundingSphere();
      parent.add(im);
    }
  }
}
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);

export function compose(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

// Canvas texture with Hebrew (or any) text, drawn with the loaded Rubik face.
export function textTexture(text, { w = 512, h = 128, bg = "#ffffff", fg = "#0038b8", size = 84, weight = 900, border } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  if (border) {
    g.strokeStyle = border;
    g.lineWidth = h * 0.08;
    g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, w - g.lineWidth, h - g.lineWidth);
  }
  g.fillStyle = fg;
  g.font = `${weight} ${size}px Rubik`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.direction = "rtl";
  g.fillText(text, w / 2, h / 2 + size * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
