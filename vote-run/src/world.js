import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { Batcher, UNIT_BOX, compose, mat, phys, mesh, mulberry32, textTexture } from "./util.js";

// ---------- shared materials ----------
const M = {
  stone: phys("#ffffff", 0.88), // tinted per instance
  band: mat("#efe0bf", 0.85),
  glass: phys("#3b5a78", 0.12, { clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.2 }),
  frame: mat("#f7f5ef", 0.6),
  shutter: mat("#d7d4cc", 0.7),
  rail: mat("#fbfaf6", 0.55),
  panel: phys("#1f3f73", 0.25, { clearcoat: 1, clearcoatRoughness: 0.1 }),
  panelFrame: mat("#c9ccd1", 0.4, { metalness: 0.5 }),
  boiler: phys("#f2f2ee", 0.35),
  tank: mat("#b9bdc2", 0.5, { metalness: 0.3 }),
  metal: mat("#6d7278", 0.45, { metalness: 0.6 }),
  asphalt: mat("#4a4d55", 0.95),
  dash: mat("#f2f2f2", 0.8),
  paving: mat("#c9b9a0", 0.9),
  curb: mat("#ffffff", 0.7),
  trunk: mat("#7a5a3f", 0.9),
  leaf: phys("#ffffff", 0.75, { sheen: 0.4, sheenColor: new THREE.Color("#d8ff9a") }),
  palm: phys("#4f8f3a", 0.7, { side: THREE.DoubleSide }),
  awningRed: phys("#d9483b", 0.8),
  dark: mat("#2a2c31", 0.6),
  roofTar: mat("#b8ada0", 0.95),
  wood: phys("#b07a4a", 0.55),
};

const STONE = ["#e9d2a4", "#e0c595", "#eed9b0", "#d9bd8c", "#e8d1a6", "#e4cb9c"];

// ---------- sky ----------
export function makeSky() {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color("#3f8fe0") },
      horizon: { value: new THREE.Color("#cfe6f5") },
      sunCol: { value: new THREE.Color("#fff1d0") },
      sunDir: { value: new THREE.Vector3(0.3, 0.6, 0.4).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 sunCol; uniform vec3 sunDir; varying vec3 vDir;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(horizon, top, pow(h, 0.55));
        float s = clamp(dot(normalize(vDir), normalize(sunDir)), 0.0, 1.0);
        c += sunCol * (pow(s, 8.0) * 0.35 + pow(s, 400.0) * 1.5);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(geo, m);
  sky.frustumCulled = false;
  return sky;
}

// soft cartoon clouds
export function makeClouds(group, seed, cx, cz, spread, y) {
  const r = mulberry32(seed);
  const cm = phys("#ffffff", 1, { emissive: new THREE.Color("#f4f6ff"), emissiveIntensity: 0.35 });
  const b = new Batcher();
  for (let i = 0; i < 14; i++) {
    const x = cx + (r() - 0.5) * spread;
    const z = cz - 120 - r() * 160;
    const yy = y + r() * 40;
    for (let k = 0; k < 6; k++) {
      const s = 8 + r() * 10;
      b.add("cloud", new THREE.IcosahedronGeometry(1, 2), cm, compose(x + (k - 3) * 7 + r() * 4, yy + r() * 4, z + r() * 6, 0, 0, 0, s * 1.4, s * 0.8, s));
    }
  }
  b.build(group, { cast: false, receive: false });
}

// ---------- buildings ----------
// Front face faces +Z when face=1 or -Z when face=-1. (x0,x1) span along X; zf is the front face z.
export function building(b, rnd, { x0, x1, zf, depth = 11, h = 12, face = 1, shops = false, balconies = true, roof = true, color }) {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const cz = zf - face * depth / 2;
  const stone = color || STONE[Math.floor(rnd() * STONE.length)];
  b.box("stone", M.stone, cx, h / 2, cz, w, h, depth, 0, stone);
  // horizontal floor bands
  const floors = Math.max(1, Math.floor((h - 0.6) / 3));
  for (let f = 1; f <= floors; f++) {
    b.box("band", M.band, cx, f * 3 + 0.05, cz, w + 0.12, 0.18, depth + 0.12);
  }
  // parapet
  b.box("band", M.band, cx, h + 0.35, zf - face * 0.12, w, 0.7, 0.24);
  b.box("band", M.band, cx, h + 0.35, zf - face * (depth - 0.12), w, 0.7, 0.24);
  b.box("band", M.band, x0 + 0.12, h + 0.35, cz, 0.24, 0.7, depth);
  b.box("band", M.band, x1 - 0.12, h + 0.35, cz, 0.24, 0.7, depth);
  b.box("roof", M.roofTar, cx, h + 0.02, cz, w - 0.3, 0.06, depth - 0.3);

  const cols = Math.max(1, Math.floor(w / 3.2));
  const step = w / cols;
  const fz = zf + face * 0.02;
  for (let f = 0; f < floors; f++) {
    const base = f * 3;
    if (f === 0 && shops) {
      // shopfront: wide glass, awning, sign board
      for (let c = 0; c < cols; c++) {
        const x = x0 + step * (c + 0.5);
        b.box("glass", M.glass, x, 1.4, fz, step - 0.6, 2.2, 0.06);
        b.box("frame", M.frame, x, 2.6, fz + face * 0.03, step - 0.4, 0.14, 0.08);
        const aw = ["#d9483b", "#2f7bd6", "#e8a33a", "#3f9a5b", "#f1e9d6"][Math.floor(rnd() * 5)];
        b.box("awning", M.stone, x, 2.95, zf + face * 0.75, step - 0.5, 0.08, 1.5, 0, aw, face * 0.28);
      }
      continue;
    }
    for (let c = 0; c < cols; c++) {
      const x = x0 + step * (c + 0.5);
      const y = base + 1.65;
      const wide = (c + f) % 3 === 0;
      const ww = wide ? 1.8 : 1.15;
      b.box("glass", M.glass, x, y, fz, ww, 1.35, 0.06);
      b.box("frame", M.frame, x, y - 0.72, fz + face * 0.05, ww + 0.25, 0.1, 0.16);
      b.box("frame", M.frame, x, y + 0.72, fz + face * 0.03, ww + 0.2, 0.08, 0.1);
      // roller shutter box, partly lowered
      const drop = rnd() * 0.6;
      b.box("shutter", M.shutter, x, y + 0.6 - drop / 2, fz + face * 0.04, ww, 0.15 + drop, 0.04);
      if (balconies && f > 0 && c % 2 === 1 && rnd() > 0.25) {
        const bw = ww + 1.1;
        b.box("rail", M.rail, x, base + 0.15, zf + face * 0.6, bw, 0.18, 1.2);
        b.box("rail", M.rail, x, base + 0.7, zf + face * 1.18, bw, 0.95, 0.07);
        b.box("rail", M.rail, x - bw / 2, base + 0.7, zf + face * 0.6, 0.07, 0.95, 1.2);
        b.box("rail", M.rail, x + bw / 2, base + 0.7, zf + face * 0.6, 0.07, 0.95, 1.2);
      }
    }
  }
  // AC units on the side
  for (let f = 0; f < floors; f++) {
    if (rnd() > 0.5) b.box("frame", M.frame, x0 + 0.6 + rnd() * (w - 1.2), f * 3 + 1.0, zf + face * 0.25, 0.8, 0.55, 0.45);
  }
  if (roof) roofStuff(b, rnd, x0, x1, zf - face * depth, zf, h);
}

// solar water heaters, boilers, tanks, antennas — the Israeli roofline
export function roofStuff(b, rnd, x0, x1, za, zb, h) {
  const zmin = Math.min(za, zb) + 1.2;
  const zmax = Math.max(za, zb) - 1.2;
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const x = x0 + 1.5 + rnd() * (x1 - x0 - 3);
    const z = zmin + rnd() * (zmax - zmin);
    // two tilted collectors facing south (-z here) + horizontal white boiler behind
    for (const dx of [-0.6, 0.6]) {
      b.box("panel", M.panel, x + dx, h + 0.75, z, 1.05, 0.06, 1.9, 0, undefined, 0.6);
      b.box("pframe", M.panelFrame, x + dx, h + 0.4, z - 0.5, 0.05, 0.8, 0.05);
    }
    const m = compose(x, h + 1.6, z + 0.9, 0, 0, Math.PI / 2, 0.32, 1.5, 0.32);
    b.add("boiler", CYL, M.boiler, m);
    b.box("pframe", M.panelFrame, x, h + 0.7, z + 0.9, 1.4, 0.06, 0.1);
  }
  if (rnd() > 0.4) {
    const x = x0 + 1 + rnd() * (x1 - x0 - 2);
    const z = zmin + rnd() * (zmax - zmin);
    b.add("tank", CYL, M.tank, compose(x, h + 0.8, z, 0, 0, 0, 0.7, 1.4, 0.7));
  }
  const ax = x0 + 1 + rnd() * (x1 - x0 - 2);
  b.add("antenna", CYL, M.metal, compose(ax, h + 1.6, zmin + rnd() * (zmax - zmin), 0, 0, 0, 0.03, 3.2, 0.03));
}

const CYL = new THREE.CylinderGeometry(1, 1, 1, 16);
const BALL = new THREE.IcosahedronGeometry(1, 2);

// ---------- street ----------
export function street(b, { x0, x1, zc = 0, half = 4, walk = 3.5, dashes = true, curbBlueWhite = false }) {
  const len = x1 - x0;
  const cx = (x0 + x1) / 2;
  b.box("asphalt", M.asphalt, cx, -0.05, zc, len, 0.1, half * 2);
  if (dashes) {
    for (let x = x0 + 1; x < x1; x += 6) b.box("dash", M.dash, x, 0.005, zc, 3, 0.02, 0.15);
  }
  for (const s of [-1, 1]) {
    b.box("paving", M.paving, cx, 0.07, zc + s * (half + walk / 2), len, 0.14, walk);
    // painted curb stones: red/white or blue/white
    const n = Math.floor(len / 1.0);
    for (let i = 0; i < n; i++) {
      const col = i % 2 === 0 ? "#f5f5f2" : curbBlueWhite ? "#2a5fb8" : "#c8372d";
      b.box("curb", M.curb, x0 + i + 0.5, 0.09, zc + s * (half + 0.12), 0.98, 0.2, 0.24, 0, col);
    }
  }
}

export function ficus(b, rnd, x, z, s = 1) {
  b.add("trunk", CYL, M.trunk, compose(x, 1.4 * s, z, 0, 0, 0, 0.16 * s, 2.8 * s, 0.16 * s));
  const greens = ["#4f8f3a", "#5d9c42", "#457f35", "#679f48"];
  for (let k = 0; k < 6; k++) {
    const a = rnd() * Math.PI * 2;
    const r = 0.6 + rnd() * 0.7;
    const sz = (1.0 + rnd() * 0.6) * s;
    b.add("leaf", BALL, M.leaf, compose(x + Math.cos(a) * r * s, (3.2 + rnd() * 1.1) * s, z + Math.sin(a) * r * s, 0, 0, 0, sz, sz * 0.85, sz), greens[k % 4]);
  }
}

const FROND = (() => {
  const g = new THREE.PlaneGeometry(0.7, 3.2, 1, 6);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + 1.6;
    p.setY(i, y);
    p.setZ(i, -0.12 * y * y);
    p.setX(i, p.getX(i) * Math.sin((y / 3.2) * Math.PI) * 1.2);
  }
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
})();

export function palm(b, rnd, x, z, h = 7) {
  for (let i = 0; i < 6; i++) {
    const y = (i + 0.5) * (h / 6);
    b.add("palmtrunk", CYL, M.trunk, compose(x, y, z, 0, 0, 0, 0.24 - i * 0.012, h / 6 + 0.05, 0.24 - i * 0.012));
  }
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * Math.PI * 2 + rnd() * 0.3;
    b.add("frond", FROND, M.palm, compose(x, h, z, 0.15 + rnd() * 0.35, a, 0));
  }
}

export function lamp(b, x, z, face = 1) {
  b.add("pole", CYL, M.metal, compose(x, 3, z, 0, 0, 0, 0.07, 6, 0.07));
  b.box("pole2", M.metal, x, 6, z + face * 0.8, 0.1, 0.1, 1.6);
  b.box("lamphead", M.frame, x, 5.9, z + face * 1.5, 0.35, 0.12, 0.6);
}

// ---------- vehicles ----------
const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 20);
wheelGeo.rotateX(Math.PI / 2);
const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.28, 12);
hubGeo.rotateX(Math.PI / 2);

export function makeCar(color, { taxi = false, driver = true, seed = 1, len = 4.2 } = {}) {
  const g = new THREE.Group();
  const paint = phys(color, 0.3, { clearcoat: 1, clearcoatRoughness: 0.08 });
  const glass = M.glass;
  const body = mesh(new RoundedBoxGeometry(len, 0.75, 1.85, 4, 0.28), paint);
  body.position.y = 0.68;
  g.add(body);
  const cabin = mesh(new RoundedBoxGeometry(len * 0.52, 0.66, 1.66, 4, 0.25), glass);
  cabin.position.set(-0.15, 1.28, 0);
  g.add(cabin);
  const roofM = mesh(new RoundedBoxGeometry(len * 0.48, 0.1, 1.6, 2, 0.04), paint);
  roofM.position.set(-0.15, 1.62, 0);
  g.add(roofM);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const w = mesh(wheelGeo, M.dark);
      w.position.set(sx * len * 0.31, 0.36, sz * 0.86);
      g.add(w);
      const hub = mesh(hubGeo, M.panelFrame, { cast: false });
      hub.position.copy(w.position);
      g.add(hub);
    }
    // lights
    const hl = mesh(new THREE.SphereGeometry(0.12, 12, 10), sx > 0 ? mat("#fff7d6", 0.2, { emissive: "#fff2c0", emissiveIntensity: 0.6 }) : mat("#d22", 0.3, { emissive: "#a00", emissiveIntensity: 0.5 }), { cast: false });
    for (const sz of [-1, 1]) {
      const l = hl.clone();
      l.position.set(sx * (len / 2 - 0.02), 0.8, sz * 0.62);
      l.scale.set(0.5, 1, 1.4);
      g.add(l);
    }
  }
  const bumperM = mat("#3a3c40", 0.6);
  for (const sx of [-1, 1]) {
    const bp = mesh(new RoundedBoxGeometry(0.2, 0.22, 1.9, 2, 0.08), bumperM);
    bp.position.set(sx * len / 2, 0.42, 0);
    g.add(bp);
  }
  if (taxi) {
    const sign = mesh(new RoundedBoxGeometry(0.7, 0.24, 0.3, 2, 0.06), mat("#f6c823", 0.4, { emissive: "#f6c823", emissiveIntensity: 0.25 }));
    sign.position.set(-0.15, 1.8, 0);
    g.add(sign);
  }
  if (driver) {
    const r = mulberry32(seed);
    const skins = ["#e2a77f", "#c98a62", "#f0c4a0", "#a8704d"];
    const head = mesh(new THREE.SphereGeometry(0.2, 16, 12), phys(skins[Math.floor(r() * 4)], 0.6), { cast: false });
    head.position.set(0.25, 1.3, 0.38);
    g.add(head);
    const hair = mesh(new THREE.SphereGeometry(0.21, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), phys(["#2a1a10", "#5b3a22", "#888", "#111"][Math.floor(r() * 4)], 0.6), { cast: false });
    hair.position.copy(head.position).add(new THREE.Vector3(-0.02, 0.03, 0));
    g.add(hair);
  }
  return g;
}

export function makeBus() {
  const g = new THREE.Group();
  const paint = phys("#2f8f55", 0.35, { clearcoat: 1, clearcoatRoughness: 0.1 });
  const white = phys("#f4f4ef", 0.35, { clearcoat: 1 });
  const body = mesh(new RoundedBoxGeometry(11.5, 2.4, 2.5, 4, 0.3), paint);
  body.position.y = 1.75;
  g.add(body);
  const band = mesh(new RoundedBoxGeometry(11.4, 1.0, 2.54, 3, 0.1), M.glass);
  band.position.y = 2.15;
  g.add(band);
  const top = mesh(new RoundedBoxGeometry(11.0, 0.3, 2.3, 2, 0.12), white);
  top.position.y = 3.05;
  g.add(top);
  for (const sx of [-3.8, 3.8]) {
    for (const sz of [-1, 1]) {
      const w = mesh(wheelGeo, M.dark);
      w.position.set(sx, 0.45, sz * 1.15);
      w.scale.setScalar(1.25);
      g.add(w);
    }
  }
  return g;
}

export function stroller() {
  const g = new THREE.Group();
  const c = phys("#d65a7a", 0.7);
  const basket = mesh(new RoundedBoxGeometry(0.8, 0.45, 0.5, 3, 0.15), c);
  basket.position.y = 0.6;
  g.add(basket);
  const hood = mesh(new THREE.SphereGeometry(0.33, 16, 10, 0, Math.PI, 0, Math.PI / 2), c);
  hood.rotation.y = -Math.PI / 2;
  hood.position.set(-0.2, 0.8, 0);
  g.add(hood);
  const handle = mesh(CYL, M.metal);
  handle.scale.set(0.02, 0.55, 0.02);
  handle.position.set(0.5, 0.95, 0);
  handle.rotation.z = -0.5;
  g.add(handle);
  for (const sx of [-0.3, 0.3]) for (const sz of [-0.22, 0.22]) {
    const w = mesh(wheelGeo, M.dark);
    w.scale.setScalar(0.38);
    w.position.set(sx, 0.14, sz);
    g.add(w);
  }
  return g;
}

export function fruitStand(rnd) {
  const g = new THREE.Group();
  const crateM = phys("#c9955c", 0.8);
  const fruits = ["#e8442e", "#f39a1f", "#f5d33b", "#6fb43c", "#9b2f8f"];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const cr = mesh(new RoundedBoxGeometry(0.75, 0.4, 0.55, 2, 0.04), crateM);
      cr.position.set(i * 0.8 - 0.8, 0.2 + j * 0.4, 0);
      g.add(cr);
    }
    const fm = phys(fruits[i % 5], 0.4, { clearcoat: 0.6 });
    for (let k = 0; k < 10; k++) {
      const f = mesh(new THREE.SphereGeometry(0.075, 12, 10), fm, { cast: false });
      f.position.set(i * 0.8 - 0.8 + (rnd() - 0.5) * 0.55, 0.85 + rnd() * 0.06, (rnd() - 0.5) * 0.38);
      g.add(f);
    }
  }
  return g;
}

export function israeliFlag() {
  const c = document.createElement("canvas");
  c.width = 440;
  c.height = 320;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 440, 320);
  g.fillStyle = "#0038b8";
  g.fillRect(0, 30, 440, 50);
  g.fillRect(0, 240, 440, 50);
  // star of David
  g.strokeStyle = "#0038b8";
  g.lineWidth = 11;
  const cx = 220, cy = 160, r = 62;
  for (const off of [-Math.PI / 2, Math.PI / 2]) {
    g.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = off + (i * 2 * Math.PI) / 3;
      const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A flag that ripples: a plane whose vertices are moved by updateFlag(t)
export function makeFlag(tex, w = 1.5, h = 1.1) {
  const geo = new THREE.PlaneGeometry(w, h, 16, 8);
  geo.translate(w / 2, 0, 0);
  const m = mesh(geo, phys("#ffffff", 0.8, { map: tex, side: THREE.DoubleSide, sheen: 0.5 }));
  m.userData.base = geo.attributes.position.array.slice();
  m.userData.w = w;
  return m;
}
export function updateFlag(m, t, phase = 0) {
  const p = m.geometry.attributes.position;
  const base = m.userData.base;
  for (let i = 0; i < p.count; i++) {
    const x = base[i * 3];
    const y = base[i * 3 + 1];
    const k = x / m.userData.w;
    p.setZ(i, Math.sin(x * 3.2 - t * 6 + phase + y * 0.8) * 0.12 * k);
    p.setY(i, y - 0.06 * k * k);
  }
  p.needsUpdate = true;
  m.geometry.computeVertexNormals();
}

export function signBoard(text, w, h, colors = {}) {
  const tex = textTexture(text, { w: 1024, h: Math.round((1024 * h) / w), size: Math.round(((1024 * h) / w) * 0.62), ...colors });
  const g = new THREE.Group();
  const board = mesh(new RoundedBoxGeometry(w + 0.12, h + 0.12, 0.1, 2, 0.04), mat(colors.border || "#0038b8", 0.5));
  g.add(board);
  const face = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), { cast: false });
  face.position.z = 0.056;
  g.add(face);
  return g;
}

export { M, STONE, CYL, BALL };
