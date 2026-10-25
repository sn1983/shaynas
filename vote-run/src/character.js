import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { mesh, phys, mat, mulberry32, clamp, lerp } from "./util.js";

// A stylized, Pixar-proportioned character: big head, big eyes, soft materials.
// The rig is a plain hierarchy of pivots (FK). Character faces local +Z.
//
// Built at "rig scale" (about 2.15 m tall) and scaled by opts.scale.

const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 6, 14);
const sphere = (r, w = 28, h = 20) => new THREE.SphereGeometry(r, w, h);

export function makeCharacter(o = {}) {
  const opt = {
    skin: "#e2a77f",
    shirt: "#4f9be0",
    pants: "#2c4775",
    shoes: "#f4f4f2",
    hair: "#2a1a10",
    hairStyle: "curly", // curly | short | long | bun | bald
    eyes: "#4a2c17",
    scale: 0.82,
    belly: 1,
    skirt: null,
    watch: false,
    seed: 1,
    ...o,
  };
  const skinM = phys(opt.skin, 0.55, { sheen: 0.5, sheenColor: new THREE.Color("#ff8f70"), sheenRoughness: 0.6 });
  const shirtM = phys(opt.shirt, 0.85, { sheen: 1, sheenColor: new THREE.Color(opt.shirt).lerp(new THREE.Color("#ffffff"), 0.5), sheenRoughness: 0.8 });
  const pantsM = phys(opt.pants, 0.9, { sheen: 0.6, sheenColor: new THREE.Color("#8fa6cc"), sheenRoughness: 0.8 });
  const shoeM = phys(opt.shoes, 0.5);
  const soleM = mat("#9a9a96", 0.8);
  const hairM = phys(opt.hair, 0.55, { sheen: 0.6, sheenColor: new THREE.Color("#7a5a40") });
  const darkM = mat("#160b08", 0.4);
  const eyeWhite = phys("#fbfaf6", 0.15, { clearcoat: 1, clearcoatRoughness: 0.1 });
  const irisM = phys(opt.eyes, 0.2, { clearcoat: 1, clearcoatRoughness: 0.05 });
  const glintM = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  const lipM = phys("#b85c4c", 0.45);

  const root = new THREE.Group();
  const body = new THREE.Group(); // extra pivot for flips and rolls (about the waist)
  body.position.y = 0;
  root.add(body);

  const hipH = 0.94;
  const hips = new THREE.Group();
  hips.position.y = hipH;
  body.add(hips);

  const pelvis = mesh(sphere(0.2), pantsM);
  pelvis.scale.set(1.18 * opt.belly, 0.6, 0.86 * opt.belly);
  hips.add(pelvis);

  const spine = new THREE.Group();
  spine.position.y = 0.04;
  hips.add(spine);
  // t-shirt torso: a lathe profile (waist -> chest -> shoulders), flattened front-to-back
  const prof = [
    [0.0, -0.06], [0.2, -0.05], [0.215, 0.02], [0.2, 0.12], [0.215, 0.26], [0.235, 0.38], [0.22, 0.47], [0.17, 0.53], [0.08, 0.565], [0.0, 0.57],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const chest = mesh(new THREE.LatheGeometry(prof, 40), shirtM);
  chest.scale.set(1.12 * opt.belly, 1, 0.78 * opt.belly);
  spine.add(chest);
  const hem = mesh(new THREE.TorusGeometry(0.205, 0.02, 8, 40), shirtM);
  hem.rotation.x = Math.PI / 2;
  hem.position.y = -0.045;
  hem.scale.set(1.12 * opt.belly, 0.78 * opt.belly, 1);
  spine.add(hem);

  if (opt.skirt) {
    const sk = mesh(new THREE.CylinderGeometry(0.2, 0.36, 0.5, 20, 1, true), phys(opt.skirt, 0.9, { side: THREE.DoubleSide }));
    sk.position.y = -0.2;
    hips.add(sk);
  }

  // neck + head
  const neck = new THREE.Group();
  neck.position.y = 0.53;
  spine.add(neck);
  const neckM = mesh(capsule(0.075, 0.08), skinM);
  neckM.position.y = 0.04;
  neck.add(neckM);
  const head = new THREE.Group();
  head.position.y = 0.05;
  neck.add(head);
  const headGeo = new THREE.SphereGeometry(0.27, 48, 36);
  {
    const pa = headGeo.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      let x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const low = Math.max(0, -y / 0.27); // 0 at equator -> 1 at chin
      x *= 0.96 + 0.1 * low * (1 - low);
      z *= 1 + 0.12 * low * (z > 0 ? 1 : 0);
      y *= y < 0 ? 0.92 : 1.06;
      pa.setXYZ(i, x, y, z);
    }
    headGeo.computeVertexNormals();
  }
  const skull = mesh(headGeo, skinM);
  skull.position.y = 0.24;
  head.add(skull);
  const nose = mesh(sphere(0.055, 20, 16), skinM);
  nose.position.set(0, 0.2, 0.275);
  nose.scale.set(1, 0.95, 1.15);
  head.add(nose);
  for (const s of [-1, 1]) {
    const ear = mesh(sphere(0.06, 16, 12), skinM);
    ear.position.set(0.255 * s, 0.22, 0.0);
    ear.scale.set(0.45, 1, 0.75);
    head.add(ear);
  }

  // eyes: white, iris, pupil, glint; upper lid hemispheres for blinks/expressions
  const eyes = [];
  for (const s of [-1, 1]) {
    const eg = new THREE.Group();
    eg.position.set(0.098 * s, 0.285, 0.205);
    head.add(eg);
    const white = mesh(sphere(0.072, 28, 20), eyeWhite, { cast: false });
    white.scale.set(1, 1.12, 0.8);
    eg.add(white);
    const look = new THREE.Group();
    eg.add(look);
    const iris = mesh(sphere(0.042, 24, 16), irisM, { cast: false });
    iris.position.z = 0.04;
    iris.scale.set(1, 1.08, 0.6);
    look.add(iris);
    const pupil = mesh(sphere(0.024, 20, 14), darkM, { cast: false });
    pupil.position.z = 0.058;
    pupil.scale.set(1, 1.08, 0.5);
    look.add(pupil);
    const glint = mesh(sphere(0.009, 10, 8), glintM, { cast: false });
    glint.position.set(0.014, 0.02, 0.068);
    look.add(glint);
    const lid = mesh(new THREE.SphereGeometry(0.078, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), skinM, { cast: false });
    lid.scale.set(1, 1.12, 0.86);
    eg.add(lid);
    const brow = mesh(capsule(0.017, 0.085), hairM, { cast: false });
    brow.rotation.z = Math.PI / 2;
    brow.position.set(0.098 * s, 0.395, 0.235);
    head.add(brow);
    eyes.push({ group: eg, look, lid, brow, side: s });
  }

  // mouth: smile arc + open "O"
  const smile = mesh(new THREE.TorusGeometry(0.055, 0.012, 10, 24, Math.PI), lipM, { cast: false });
  smile.rotation.z = Math.PI;
  smile.position.set(0, 0.135, 0.245);
  head.add(smile);
  const mouthO = mesh(sphere(0.045, 20, 14), darkM, { cast: false });
  mouthO.position.set(0, 0.11, 0.235);
  mouthO.scale.set(1, 0.2, 0.5);
  head.add(mouthO);
  // open grin: lower half-disc with a strip of teeth
  const grin = new THREE.Group();
  const grinIn = mesh(new THREE.CircleGeometry(0.068, 28, Math.PI, Math.PI), mat("#5a1712", 0.6), { cast: false });
  grin.add(grinIn);
  const teeth = mesh(new THREE.PlaneGeometry(0.11, 0.022), mat("#fbf8f0", 0.4), { cast: false });
  teeth.position.set(0, -0.012, 0.001);
  grin.add(teeth);
  const tongue = mesh(new THREE.CircleGeometry(0.03, 16, 0, Math.PI), mat("#d45b5b", 0.6), { cast: false });
  tongue.position.set(0, -0.06, 0.001);
  tongue.scale.set(1.3, 0.6, 1);
  grin.add(tongue);
  grin.position.set(0, 0.15, 0.262);
  grin.rotation.x = -0.25;
  head.add(grin);

  // hair
  const rnd = mulberry32(opt.seed * 977 + 13);
  if (opt.hairStyle !== "bald") {
    const parts = [];
    if (opt.hairStyle === "curly" || opt.hairStyle === "short") {
      const n = opt.hairStyle === "curly" ? 70 : 60;
      const capG = new THREE.SphereGeometry(0.275, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.5);
      capG.rotateX(-0.42);
      capG.translate(0, 0.27, -0.015);
      parts.push(capG);
      for (let i = 0; i < n; i++) {
        const u = rnd() * Math.PI * 2;
        const v = Math.acos(lerp(1, -0.25, rnd()));
        const x = Math.sin(v) * Math.sin(u);
        const y = Math.cos(v);
        const z = Math.sin(v) * Math.cos(u);
        if (z > 0.25 && y < 0.62) continue; // keep the forehead and face clear
        if (y < 0.1 && Math.abs(x) > 0.75 && z > -0.2) continue; // above the ears
        const r = opt.hairStyle === "curly" ? 0.06 + rnd() * 0.035 : 0.05 + rnd() * 0.02;
        const out = opt.hairStyle === "curly" ? 0.27 : 0.255;
        const g = new THREE.SphereGeometry(r, 22, 16);
        g.translate(x * out * 0.95, 0.26 + y * out * 1.05, z * out);
        parts.push(g);
      }
    } else if (opt.hairStyle === "long" || opt.hairStyle === "bun") {
      const cap = new THREE.SphereGeometry(0.29, 32, 20, 0, Math.PI * 2, 0, Math.PI * 0.55);
      cap.rotateX(-0.25);
      cap.translate(0, 0.27, -0.02);
      parts.push(cap);
      if (opt.hairStyle === "long") {
        const back = new THREE.CapsuleGeometry(0.22, 0.28, 6, 16);
        back.scale(1.1, 1, 0.55);
        back.translate(0, 0.08, -0.15);
        parts.push(back);
      } else {
        const bun = new THREE.SphereGeometry(0.11, 20, 14);
        bun.translate(0, 0.5, -0.16);
        parts.push(bun);
      }
    }
    const merged = mergeGeometries(parts.map((p) => p.toNonIndexed()));
    head.add(mesh(merged, hairM));
  }

  // arms
  const arms = [];
  for (const s of [1, -1]) {
    // s=+1 is the character's left (local +X)
    const sh = new THREE.Group();
    sh.position.set(0.3 * s * opt.belly, 0.47, 0);
    spine.add(sh);
    const sleeve = mesh(capsule(0.095, 0.14), shirtM);
    sleeve.position.y = -0.08;
    sh.add(sleeve);
    const upper = mesh(capsule(0.066, 0.22), skinM);
    upper.position.y = -0.17;
    sh.add(upper);
    const el = new THREE.Group();
    el.position.y = -0.3;
    sh.add(el);
    const elbowBall = mesh(sphere(0.064, 16, 12), skinM);
    el.add(elbowBall);
    const fore = mesh(capsule(0.06, 0.2), skinM);
    fore.position.y = -0.13;
    el.add(fore);
    const wr = new THREE.Group();
    wr.position.y = -0.27;
    el.add(wr);
    const hand = mesh(sphere(0.078, 20, 14), skinM);
    hand.position.y = -0.04;
    hand.scale.set(0.85, 1.1, 0.7);
    wr.add(hand);
    const thumb = mesh(capsule(0.025, 0.05), skinM);
    thumb.position.set(-0.05 * s, -0.02, 0.05);
    thumb.rotation.z = 0.5 * s;
    wr.add(thumb);
    if (opt.watch && s === 1) {
      const band = mesh(new THREE.TorusGeometry(0.062, 0.016, 8, 20), mat("#222", 0.5));
      band.rotation.x = Math.PI / 2;
      band.position.y = -0.22;
      el.add(band);
      const face = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), phys("#dfe6ee", 0.2, { metalness: 0.6 }));
      face.rotation.z = Math.PI / 2;
      face.position.set(0.065, -0.22, 0);
      el.add(face);
    }
    arms.push({ sh, el, wr, side: s });
  }

  // legs
  const legs = [];
  for (const s of [1, -1]) {
    const hp = new THREE.Group();
    hp.position.set(0.12 * s, -0.03, 0);
    hips.add(hp);
    const thigh = mesh(capsule(0.1, 0.3), pantsM);
    thigh.position.y = -0.21;
    hp.add(thigh);
    const kn = new THREE.Group();
    kn.position.y = -0.42;
    hp.add(kn);
    const kneeBall = mesh(sphere(0.092, 16, 12), pantsM);
    kn.add(kneeBall);
    const shin = mesh(capsule(0.085, 0.3), pantsM);
    shin.position.y = -0.19;
    kn.add(shin);
    const an = new THREE.Group();
    an.position.y = -0.4;
    kn.add(an);
    const shoe = mesh(new RoundedBoxGeometry(0.16, 0.11, 0.31, 3, 0.05), shoeM);
    shoe.position.set(0, -0.025, 0.07);
    an.add(shoe);
    const sole = mesh(new RoundedBoxGeometry(0.165, 0.035, 0.32, 2, 0.015), soleM);
    sole.position.set(0, -0.08, 0.07);
    an.add(sole);
    legs.push({ hp, kn, an, side: s });
  }

  root.scale.setScalar(opt.scale);
  root.traverse((o) => {
    if (o.isMesh) {
      o.frustumCulled = false;
      o.receiveShadow = false; // avoids self-shadow acne on the round shapes
    }
  });
  const props = new THREE.Group(); // attach point in the right hand
  arms[1].wr.add(props);
  props.position.y = -0.1;

  return { root, body, hips, spine, neck, head, eyes, arms, legs, smile, mouthO, grin, props, hipH, opt };
}

// ---------- poses ----------
export function basePose() {
  return {
    bob: 0, lean: 0, twist: 0, roll: 0, pelvisTwist: 0,
    headPitch: 0, headYaw: 0, headRoll: 0,
    arm: [ // [left, right]
      { x: 0.05, z: 0.12, el: -0.25, wr: 0 },
      { x: 0.05, z: 0.12, el: -0.25, wr: 0 },
    ],
    leg: [
      { x: 0, z: 0, kn: 0.05, an: 0 },
      { x: 0, z: 0, kn: 0.05, an: 0 },
    ],
    face: { smile: 0.4, open: 0, brow: 0, blink: 0, lookX: 0, lookY: 0, grin: 0 },
  };
}

export function runPose(phase, amt = 1) {
  const p = basePose();
  const s = Math.sin(phase);
  p.bob = (0.05 * Math.cos(2 * phase) - 0.03) * amt;
  p.lean = 0.24 * amt;
  p.twist = 0.2 * s * amt;
  p.pelvisTwist = -0.14 * s * amt;
  p.headPitch = -0.16 * amt;
  p.headYaw = -0.08 * s * amt;
  for (let i = 0; i < 2; i++) {
    const ph = phase + (i === 0 ? 0 : Math.PI);
    const ls = Math.sin(ph);
    p.leg[i].x = -0.95 * ls * amt - 0.1 * amt;
    p.leg[i].kn = 0.2 + 1.45 * Math.pow(Math.max(0, Math.cos(ph + 0.35)), 1.3) * amt;
    p.leg[i].an = 0.25 * Math.max(0, -ls) * amt;
    p.arm[i].x = 0.95 * ls * amt; // opposite to the same-side leg
    p.arm[i].z = 0.14;
    p.arm[i].el = -1.45 * amt - 0.2 * ls * amt;
  }
  p.face.smile = 0.15;
  p.face.brow = 0.3;
  return p;
}

export function walkPose(phase, amt = 1) {
  const p = basePose();
  const s = Math.sin(phase);
  p.bob = 0.025 * Math.cos(2 * phase) * amt;
  p.twist = 0.08 * s * amt;
  for (let i = 0; i < 2; i++) {
    const ph = phase + (i === 0 ? 0 : Math.PI);
    const ls = Math.sin(ph);
    p.leg[i].x = -0.42 * ls * amt;
    p.leg[i].kn = 0.08 + 0.6 * Math.pow(Math.max(0, Math.cos(ph + 0.3)), 2) * amt;
    p.arm[i].x = 0.4 * ls * amt;
    p.arm[i].el = -0.35;
  }
  return p;
}

export function mixPose(a, b, t) {
  const out = basePose();
  const mixObj = (o, x, y) => {
    for (const k of Object.keys(x)) {
      if (typeof x[k] === "number") o[k] = lerp(x[k], y[k], t);
    }
  };
  mixObj(out, a, b);
  for (let i = 0; i < 2; i++) {
    mixObj(out.arm[i], a.arm[i], b.arm[i]);
    mixObj(out.leg[i], a.leg[i], b.leg[i]);
  }
  mixObj(out.face, a.face, b.face);
  return out;
}

export function applyPose(c, p) {
  c.hips.position.y = c.hipH + p.bob;
  c.hips.rotation.set(0, p.pelvisTwist, 0);
  c.spine.rotation.set(p.lean, p.twist - p.pelvisTwist, p.roll);
  c.head.rotation.set(p.headPitch, p.headYaw, p.headRoll);
  c.arms.forEach((a, i) => {
    const q = p.arm[i];
    a.sh.rotation.set(q.x, 0, q.z * a.side);
    a.el.rotation.set(q.el, 0, 0);
    a.wr.rotation.set(q.wr, 0, 0);
  });
  c.legs.forEach((l, i) => {
    const q = p.leg[i];
    l.hp.rotation.set(q.x, 0, q.z * l.side);
    l.kn.rotation.set(q.kn, 0, 0);
    l.an.rotation.set(q.an, 0, 0);
  });
  const f = p.face;
  for (const e of c.eyes) {
    // lid: -1.75 rad tucked behind (open), +0.35 closed
    const openAng = -1.75 + clamp(-f.brow, 0, 1) * 0.35;
    e.lid.rotation.x = lerp(openAng, 0.35, clamp(f.blink, 0, 1));
    e.look.rotation.set(-f.lookY * 0.5, f.lookX * 0.6, 0);
    e.brow.position.y = 0.395 + f.brow * 0.035;
    e.brow.rotation.z = Math.PI / 2 + f.brow * 0.18 * e.side;
  }
  c.smile.scale.set(1 + 0.25 * f.smile, clamp(0.25 + f.smile, 0.15, 1.4) * (1 - f.open), 1);
  c.smile.visible = f.open < 0.6;
  c.mouthO.scale.set(lerp(0.6, 1, f.open), lerp(0.12, 1.15, f.open), 0.5);
  c.mouthO.visible = f.open > 0.05;
  c.grin.visible = f.grin > 0.05 && f.open < 0.3;
  c.grin.scale.set(lerp(0.7, 1.05, f.grin), lerp(0.3, 1, f.grin), 1);
  if (c.grin.visible) c.smile.visible = false;
}

// Places a character so its feet stand on ground height y, heading = yaw (0 faces +Z).
export function place(c, x, y, z, yaw) {
  c.root.position.set(x, y, z);
  c.root.rotation.set(0, yaw, 0);
}
