import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { clamp, lerp, smooth, easeOut, easeInOut, mulberry32, noise1, mat, phys, mesh, Batcher } from "./util.js";
import { makeCharacter, basePose, runPose, walkPose, mixPose, applyPose, place } from "./character.js";
import * as W from "./world.js";

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;
const RUN_HZ = 2.5; // one full stride cycle per 0.4 s beat pair: footfalls land on 8th notes at 150 BPM

// ---- cuts (seconds). Every visibility window and shot reads these. ----
const CUT = {
  bolt: 1.6,
  street: 3.2,
  front: 6.4,
  roof: 9.6,
  roof2: 11.2,
  drop: 14.4,
  jam: 16.0,
  jamLow: 18.4,
  slide: 20.8,
  school: 22.4,
  box: 24.0,
  face: 25.6,
  end: 26.4,
};

export function createFilm(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.45;

  const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.05, 1200);

  const sky = W.makeSky();
  scene.add(sky);
  scene.fog = new THREE.Fog("#cfe6f5", 60, 330);

  const hemi = new THREE.HemisphereLight("#cfe6ff", "#b59a78", 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight("#fff3dc", 3.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 160;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.05;
  sun.shadow.radius = 4;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight("#b9d4ff", 1.2);
  scene.add(rim, rim.target);

  const world = new THREE.Group();
  scene.add(world);
  const B = new Batcher();
  const rnd = mulberry32(2026);

  // =========== A: the neighborhood street (x -40..110) ===========
  W.street(B, { x0: -40, x1: 110, zc: 0, half: 4, walk: 3.5 });
  // far side (where the hero runs): z front face = -7.5
  {
    let x = -40;
    let i = 0;
    while (x < 108) {
      const w = 9 + rnd() * 7;
      const shops = x > 18 && x < 75 && rnd() > 0.2;
      W.building(B, rnd, { x0: x, x1: x + w, zf: -7.5, depth: 12, h: 9 + Math.floor(rnd() * 3) * 3 + (shops ? 3 : 0), face: 1, shops });
      x += w + 0.6;
      i++;
    }
    // near side
    x = -40;
    while (x < 108) {
      const w = 10 + rnd() * 6;
      W.building(B, rnd, { x0: x, x1: x + w, zf: 7.5, depth: 12, h: 9 + Math.floor(rnd() * 3) * 3, face: -1, shops: rnd() > 0.5 });
      x += w + 0.6;
    }
    for (let tx = -36; tx < 108; tx += 9) {
      if (tx > -3 && tx < 4) continue;
      if (tx < 12 || tx > 78) W.ficus(B, rnd, tx + rnd() * 2, -4.6 - rnd() * 0.3, 0.9 + rnd() * 0.2);
      W.ficus(B, rnd, tx + 4 + rnd() * 2, 4.7, 0.9 + rnd() * 0.25);
    }
    for (let lx = -30; lx < 108; lx += 18) if (lx < 12 || lx > 78) W.lamp(B, lx, -4.4, 1);
  }
  // entrance of the hero's building at x=0
  {
    const door = mesh(new RoundedBoxGeometry(1.6, 2.5, 0.2, 2, 0.05), W.M.glass);
    door.position.set(0, 1.25, -7.48);
    world.add(door);
    const frame = mesh(new RoundedBoxGeometry(2.1, 2.9, 0.18, 2, 0.06), mat("#8a6a4a", 0.6));
    frame.position.set(0, 1.4, -7.56);
    world.add(frame);
    const canopy = mesh(new RoundedBoxGeometry(3, 0.16, 1.4, 2, 0.06), W.M.band);
    canopy.position.set(0, 3.0, -6.9);
    world.add(canopy);
    const num = W.signBoard("12", 0.5, 0.36, { bg: "#1d4fa8", fg: "#ffffff", border: "#ffffff", size: 160 });
    num.position.set(1.4, 2.4, -7.42);
    world.add(num);
  }
  // shop signs on the street
  const shopSigns = [["פלאפל", 24], ["מכולת", 41], ["פיצה", 57], ["פרחים", 70]];
  for (const [t, sx] of shopSigns) {
    const s = W.signBoard(t, 2.6, 0.7, { bg: "#ffffff", fg: "#c8372d", border: "#c8372d" });
    s.position.set(sx, 3.6, -7.4);
    world.add(s);
  }
  // parked cars
  const carColors = ["#e8e6e0", "#c0392b", "#2c5aa0", "#9aa3ad", "#1f1f22", "#f2c14e", "#5b7f4b", "#e07b39"];
  for (let i = 0; i < 12; i++) {
    const c = W.makeCar(carColors[i % carColors.length], { seed: i + 3, driver: false });
    c.position.set(-30 + i * 11 + rnd() * 3, 0, i % 2 ? 2.9 : -2.9);
    c.rotation.y = i % 2 ? Math.PI : 0;
    world.add(c);
  }
  const stand = W.fruitStand(rnd);
  stand.position.set(62.5, 0.14, -5.8);
  world.add(stand);

  // =========== B: rooftops (x 270..360) ===========
  const RX = { r1a: 282, r1b: 304, r2a: 307.5, r2b: 322, r3a: 324, r3b: 342 };
  const RH = { r1: 14, r2: 13, r3: 9 };
  W.street(B, { x0: 250, x1: 380, zc: 0, half: 4, walk: 3.5, curbBlueWhite: true });
  W.building(B, rnd, { x0: RX.r1a, x1: RX.r1b, zf: -5.5, depth: 13, h: RH.r1, roof: false });
  W.building(B, rnd, { x0: RX.r2a, x1: RX.r2b, zf: -5.5, depth: 13, h: RH.r2, roof: false });
  W.building(B, rnd, { x0: RX.r3a, x1: RX.r3b, zf: -5.5, depth: 13, h: RH.r3, roof: false, shops: true });
  W.building(B, rnd, { x0: 256, x1: 280, zf: -5.5, depth: 13, h: 18 });
  W.building(B, rnd, { x0: 344, x1: 362, zf: -5.5, depth: 13, h: 15 });
  W.building(B, rnd, { x0: 363, x1: 380, zf: -5.5, depth: 13, h: 12 });
  // roof furniture placed by hand so the run path stays clear (path is z ~ -11)
  for (const [x0, x1, h] of [[RX.r1a, RX.r1b, RH.r1], [RX.r2a, RX.r2b, RH.r2], [RX.r3a, RX.r3b, RH.r3]]) {
    W.roofStuff(B, rnd, x0, x1, -18.5, -14.5, h);
  }
  // stair hut the hero bursts out of
  {
    const hut = mesh(new RoundedBoxGeometry(2.6, 2.6, 2.4, 2, 0.08), phys("#ece0c4", 0.85));
    hut.position.set(295.2, RH.r1 + 1.3, -8.6);
    world.add(hut);
    const hd = mesh(new THREE.BoxGeometry(0.06, 2.1, 1.1), mat("#6b7d8f", 0.5));
    hd.position.set(296.52, RH.r1 + 1.05, -8.6);
    world.add(hd);
  }
  // background city behind the rooftops + across the street
  for (let i = 0; i < 26; i++) {
    const x = 240 + i * 6.5 + rnd() * 2;
    const h = 6 + rnd() * 12;
    W.building(B, rnd, { x0: x, x1: x + 5.5 + rnd() * 2, zf: -22 - rnd() * 6, depth: 10, h, balconies: rnd() > 0.5 });
  }
  for (let i = 0; i < 9; i++) {
    const x = 252 + i * 14;
    W.building(B, rnd, { x0: x, x1: x + 12, zf: 7.5, depth: 12, h: 9 + Math.floor(rnd() * 4) * 3, face: -1, shops: true });
  }
  // shop awning the hero bounces off (front of R3)
  const awning = new THREE.Group();
  {
    const cloth = mesh(new RoundedBoxGeometry(3.4, 0.08, 1.8, 2, 0.03), phys("#d9483b", 0.85, { sheen: 1, sheenColor: new THREE.Color("#ffb3a8") }));
    awning.add(cloth);
    for (let i = 0; i < 5; i++) {
      const st = mesh(new THREE.BoxGeometry(0.34, 0.085, 1.81), phys("#f6f0e4", 0.85), { cast: false });
      st.position.x = -1.36 + i * 0.68;
      awning.add(st);
    }
    awning.position.set(331, 3.4, -4.6);
    awning.rotation.x = 0.25;
    world.add(awning);
  }
  // Tel Aviv-ish distant towers
  for (let i = 0; i < 14; i++) {
    const tw = mesh(new RoundedBoxGeometry(8 + rnd() * 6, 40 + rnd() * 60, 8, 2, 0.5), phys(["#9fb4c8", "#b8c6d3", "#8ea6bf"][i % 3], 0.2, { clearcoat: 0.5 }));
    tw.position.set(230 + i * 14 + rnd() * 6, tw.geometry.parameters.height / 2, -150 - rnd() * 40);
    tw.castShadow = false;
    world.add(tw);
  }

  // =========== C: the traffic jam junction (x 380..480) ===========
  W.street(B, { x0: 380, x1: 480, zc: 0, half: 7, walk: 3.5, dashes: false });
  for (let x = 382; x < 480; x += 6) {
    if (x > 424 && x < 436) continue;
    for (const z of [-3.5, 0, 3.5]) B.box("dash", W.M.dash, x, 0.005, z, 3, 0.02, 0.15);
  }
  // cross street along Z at x 426..434 + zebra crossings
  B.box("asphalt", W.M.asphalt, 430, -0.04, -30, 8, 0.1, 46);
  B.box("asphalt", W.M.asphalt, 430, -0.04, 30, 8, 0.1, 46);
  for (let z = -6.5; z <= 6.5; z += 1.1) B.box("dash", W.M.dash, 424.2, 0.006, z, 2.6, 0.02, 0.55);
  for (let z = -6.5; z <= 6.5; z += 1.1) B.box("dash", W.M.dash, 435.8, 0.006, z, 2.6, 0.02, 0.55);
  for (const s of [-1, 1]) {
    let x = 380;
    while (x < 478) {
      const w = 10 + rnd() * 5;
      if (x + w > 423 && x < 437) { x = 437; continue; }
      W.building(B, rnd, { x0: x, x1: Math.min(x + w, x < 423 ? 423 : 480), zf: s * 10.5, depth: 12, h: 12 + Math.floor(rnd() * 4) * 3, face: -s, shops: rnd() > 0.4 });
      x += w + 0.6;
    }
  }
  for (let lx = 384; lx < 478; lx += 12) {
    if (lx > 420 && lx < 440) continue;
    W.palm(B, rnd, lx, -8.6, 6.5 + rnd() * 2);
    W.palm(B, rnd, lx + 6, 8.6, 6.5 + rnd() * 2);
  }
  // traffic lights
  for (const [x, z, ry] of [[424, -7.6, 0], [436, 7.6, Math.PI]]) {
    B.add("pole", W.CYL, W.M.metal, new THREE.Matrix4().compose(new THREE.Vector3(x, 2.4, z), new THREE.Quaternion(), new THREE.Vector3(0.09, 4.8, 0.09)));
    const box = mesh(new RoundedBoxGeometry(0.4, 1.1, 0.35, 2, 0.06), mat("#222", 0.5));
    box.position.set(x, 4.6, z);
    world.add(box);
    const red = mesh(new THREE.SphereGeometry(0.12, 12, 10), mat("#f33", 0.3, { emissive: "#ff2a1a", emissiveIntensity: 2.2 }), { cast: false });
    red.position.set(x + (ry ? -0.2 : 0.2), 4.95, z);
    world.add(red);
  }
  // cars in the jam: lanes along X; gaps left open where the hero crosses
  const jamCars = [];
  const lanes = {
    "-5.25": [386, 393, 399.5, 406, 412.5, 419, 441, 448, 455],
    "-1.75": [388, 394.5, 401, 407.5, 414, 420.5, 440, 446.5, 453],
    "1.75": [387, 393.5, 401, 411, 424.5 - 3.6, 441.5, 448, 455],
    "5.25": [389, 395.5, 402, 408.5, 415, 421.5, 442, 449],
  };
  let ci = 0;
  for (const [zs, xs] of Object.entries(lanes)) {
    const z = parseFloat(zs);
    for (const x of xs) {
      let car;
      if (zs === "-5.25" && x === 406) {
        car = W.makeBus();
      } else {
        car = W.makeCar(carColors[(ci * 3) % carColors.length], { seed: ci + 50, taxi: ci % 7 === 3 });
      }
      car.position.set(x, 0, z);
      car.rotation.y = z > 0 ? Math.PI : 0;
      if (zs === "-5.25" && x === 406) car.position.x = 407.5;
      world.add(car);
      jamCars.push(car);
      ci++;
    }
  }
  // the taxi blocking the junction (along Z), the hero slides over its hood
  const taxi = W.makeCar("#f2f2ee", { taxi: true, seed: 99 });
  taxi.position.set(431, 0, 0.3);
  taxi.rotation.y = Math.PI / 2; // nose toward +z
  world.add(taxi);

  // =========== D: the school polling station (x 490..560) ===========
  W.street(B, { x0: 480, x1: 580, zc: 0, half: 4, walk: 3.5, curbBlueWhite: true });
  // boundary wall with gate opening x 518..522
  for (const [a, b2] of [[492, 518], [522, 560]]) {
    B.box("stone", W.M.stone, (a + b2) / 2, 1.1, -7.9, b2 - a, 2.2, 0.5, 0, "#e9dcc0");
    B.box("band", W.M.band, (a + b2) / 2, 2.25, -7.9, b2 - a + 0.1, 0.12, 0.62);
  }
  for (const gx of [517.7, 522.3]) B.box("stone", W.M.stone, gx, 1.6, -7.9, 0.8, 3.2, 0.8, 0, "#e3d2ad");
  const gateSign = W.signBoard("קלפי", 3.2, 0.95, { bg: "#ffffff", fg: "#0038b8", border: "#0038b8" });
  gateSign.position.set(520, 3.7, -7.75);
  world.add(gateSign);
  const gateBar = mesh(new THREE.BoxGeometry(5.4, 0.18, 0.18), W.M.metal);
  gateBar.position.set(520, 3.1, -7.9);
  world.add(gateBar);
  const smallSign = W.signBoard("בית ספר יסודי", 4.2, 0.6, { bg: "#0038b8", fg: "#ffffff", border: "#ffffff" });
  smallSign.position.set(509, 2.6, -7.6);
  world.add(smallSign);
  W.building(B, rnd, { x0: 500, x1: 540, zf: -14, depth: 12, h: 9, face: 1, balconies: false });
  W.building(B, rnd, { x0: 470, x1: 499, zf: -10, depth: 12, h: 15, face: 1 });
  W.building(B, rnd, { x0: 541, x1: 575, zf: -10, depth: 12, h: 12, face: 1 });
  for (let i = 0; i < 7; i++) W.building(B, rnd, { x0: 478 + i * 14, x1: 490 + i * 14, zf: 7.5, depth: 12, h: 9 + Math.floor(rnd() * 3) * 3, face: -1, shops: rnd() > 0.5 });
  for (const tx of [496, 506, 534, 546, 556]) W.ficus(B, rnd, tx, -10.5, 1.15);
  for (const tx of [488, 500, 540, 552]) W.ficus(B, rnd, tx, -4.7, 1);
  const flagTex = W.israeliFlag();
  const flags = [];
  for (const [fx, fz, h] of [[516.6, -7.6, 4.9], [523.4, -7.6, 4.9], [512, -14.2, 11], [528, -14.2, 11]]) {
    B.add("pole", W.CYL, W.M.metal, new THREE.Matrix4().compose(new THREE.Vector3(fx, h / 2, fz), new THREE.Quaternion(), new THREE.Vector3(0.04, h, 0.04)));
    const f = W.makeFlag(flagTex, 1.4, 1.0);
    f.position.set(fx, h - 0.55, fz);
    f.rotation.y = fx < 520 ? Math.PI : 0;
    world.add(f);
    flags.push(f);
  }
  // little queue of happy voters near the gate
  // (characters are created below)

  // =========== E: the classroom (x 600) ===========
  const room = new THREE.Group();
  room.position.set(600, 0, 0);
  world.add(room);
  {
    const floor = mesh(new THREE.BoxGeometry(10, 0.1, 10), phys("#c9b48f", 0.6));
    floor.position.y = -0.05;
    room.add(floor);
    const wallLow = phys("#9fc7b0", 0.8);
    const wallHigh = phys("#f4efe2", 0.9);
    const back = mesh(new THREE.BoxGeometry(10, 1.2, 0.2), wallLow);
    back.position.set(0, 0.6, -3.2);
    room.add(back);
    const backHi = mesh(new THREE.BoxGeometry(10, 2.6, 0.2), wallHigh);
    backHi.position.set(0, 2.5, -3.2);
    room.add(backHi);
    const board = mesh(new RoundedBoxGeometry(3.6, 1.3, 0.08, 2, 0.03), phys("#2f5a45", 0.7));
    board.position.set(-1.0, 2.0, -3.08);
    room.add(board);
    const boardFrame = mesh(new RoundedBoxGeometry(3.8, 1.5, 0.06, 2, 0.03), phys("#a8794d", 0.6));
    boardFrame.position.set(-1.0, 2.0, -3.11);
    room.add(boardFrame);
    const win = mesh(new THREE.BoxGeometry(1.8, 1.4, 0.06), mat("#fff6dd", 0.3, { emissive: "#ffe7b0", emissiveIntensity: 1.2 }), { cast: false });
    win.position.set(2.6, 2.1, -3.08);
    room.add(win);
    // committee table
    const table = mesh(new RoundedBoxGeometry(2.6, 0.08, 1.0, 2, 0.03), W.M.wood);
    table.position.set(0, 0.78, 0);
    room.add(table);
    for (const sx of [-1.2, 1.2]) for (const sz of [-0.4, 0.4]) {
      const leg = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.76, 8), W.M.metal);
      leg.position.set(sx, 0.38, sz);
      room.add(leg);
    }
    // voting screen (cardboard) on a side table
    const scr = phys("#7fb2e5", 0.9);
    for (const [px, ry] of [[-2.6, 0], [-3.35, 0.9], [-1.85, -0.9]]) {
      const p = mesh(new THREE.BoxGeometry(0.9, 0.8, 0.02), scr);
      p.position.set(px, 1.2, -1.9);
      p.rotation.y = ry;
      room.add(p);
    }
    const stable = mesh(new RoundedBoxGeometry(1.8, 0.06, 0.8, 2, 0.02), W.M.wood);
    stable.position.set(-2.6, 0.78, -1.6);
    room.add(stable);
  }
  // the ballot box
  const ballot = new THREE.Group();
  {
    const box = mesh(new RoundedBoxGeometry(0.6, 0.5, 0.45, 3, 0.03), phys("#2b6fd1", 0.55, { sheen: 0.4 }));
    box.position.y = 0.25;
    ballot.add(box);
    const lid = mesh(new RoundedBoxGeometry(0.64, 0.05, 0.49, 2, 0.02), phys("#2560b8", 0.5));
    lid.position.y = 0.52;
    ballot.add(lid);
    const slot = mesh(new THREE.BoxGeometry(0.26, 0.02, 0.035), mat("#0b1530", 0.8), { cast: false });
    slot.position.set(0, 0.545, 0.0);
    ballot.add(slot);
    const label = W.signBoard("קלפי", 0.42, 0.16, { bg: "#ffffff", fg: "#0038b8", border: "#ffffff" });
    label.scale.setScalar(0.9);
    label.position.set(0, 0.27, 0.23);
    ballot.add(label);
  }
  ballot.position.set(600, 0.82, 0.05);
  world.add(ballot);
  const envelope = mesh(new RoundedBoxGeometry(0.24, 0.17, 0.01, 1, 0.003), phys("#9cc7ef", 0.7));
  world.add(envelope);

  B.build(world);

  // =========== characters ===========
  const hero = makeCharacter({ watch: true, seed: 1 });
  scene.add(hero.root);

  const npcDefs = [
    // street A
    { id: "p1", shirt: "#e0a43a", pants: "#4b4f57", hairStyle: "short", hair: "#3b2a1e", skin: "#c98a62", scale: 0.84, seed: 3 },
    { id: "mom", shirt: "#e46f8f", pants: "#3c3f5a", hairStyle: "long", hair: "#5b3a22", skin: "#f0c4a0", scale: 0.78, seed: 4, skirt: "#3c3f5a" },
    { id: "old", shirt: "#e8e2d2", pants: "#6d5c48", hairStyle: "bald", skin: "#e2a77f", scale: 0.8, seed: 5, belly: 1.15 },
    { id: "phone", shirt: "#3c9d7a", pants: "#2b2b30", hairStyle: "short", hair: "#111", skin: "#a8704d", scale: 0.83, seed: 6 },
    { id: "seller", shirt: "#f4f1ea", pants: "#5d4f3f", hairStyle: "short", hair: "#222", skin: "#c98a62", scale: 0.8, seed: 7, belly: 1.25 },
    { id: "girl", shirt: "#9a6bd6", pants: "#2c4775", hairStyle: "bun", hair: "#2a1a10", skin: "#e2a77f", scale: 0.74, seed: 8 },
    // school D
    { id: "voterA", shirt: "#f1c84b", pants: "#454a52", hairStyle: "bun", hair: "#c9c9c9", skin: "#f0c4a0", scale: 0.76, seed: 9, skirt: "#6a4c8c" },
    { id: "voterB", shirt: "#5d8fc9", pants: "#30343c", hairStyle: "short", hair: "#6b4a2b", skin: "#e2a77f", scale: 0.82, seed: 10 },
    // classroom committee
    { id: "comm1", shirt: "#ffffff", pants: "#30343c", hairStyle: "long", hair: "#2a1a10", skin: "#e2a77f", scale: 0.78, seed: 11 },
    { id: "comm2", shirt: "#cfe0f2", pants: "#30343c", hairStyle: "short", hair: "#777", skin: "#c98a62", scale: 0.8, seed: 12, belly: 1.2 },
  ];
  const npc = {};
  for (const d of npcDefs) {
    npc[d.id] = makeCharacter(d);
    scene.add(npc[d.id].root);
  }
  const pram = W.stroller();
  scene.add(pram);
  const phoneProp = mesh(new RoundedBoxGeometry(0.08, 0.15, 0.015, 1, 0.006), mat("#111", 0.3));
  npc.phone.props.add(phoneProp);
  phoneProp.rotation.x = -1.2;
  const paper = mesh(new THREE.BoxGeometry(0.3, 0.4, 0.01), phys("#f2efe6", 0.9));
  npc.old.props.add(paper);
  paper.rotation.x = -1.1;
  paper.position.y = -0.06;

  // =========== helpers ===========
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const tmpLook = new THREE.Vector3();
  const heading = (dx, dz) => Math.atan2(dx, dz);

  function setCam(pos, look, fov = 40, shake = 0, t = 0) {
    camera.position.copy(pos);
    if (shake > 0) {
      camera.position.x += noise1(t * 3.1, 1) * shake;
      camera.position.y += noise1(t * 2.7, 2) * shake;
    }
    camera.fov = fov;
    camera.updateProjectionMatrix();
    tmpLook.copy(look);
    if (shake > 0) {
      tmpLook.x += noise1(t * 2.3, 3) * shake * 0.6;
      tmpLook.y += noise1(t * 2.9, 4) * shake * 0.6;
    }
    camera.lookAt(tmpLook);
  }

  // Run along a polyline of [time, x, y, z] keys with smooth interpolation; returns pos + heading.
  function track(keys, t) {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const u = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    const x = lerp(a[1], b[1], u);
    const y = lerp(a[2], b[2], u);
    const z = lerp(a[3], b[3], u);
    // heading from a short look-ahead
    const t2 = Math.min(t + 0.08, keys[keys.length - 1][0]);
    let j = 0;
    while (j < keys.length - 2 && t2 > keys[j + 1][0]) j++;
    const c = keys[j];
    const d = keys[j + 1];
    const w2 = clamp((t2 - c[0]) / (d[0] - c[0]), 0, 1);
    const x2 = lerp(c[1], d[1], w2);
    const z2 = lerp(c[3], d[3], w2);
    const hd = Math.abs(x2 - x) + Math.abs(z2 - z) > 1e-4 ? heading(x2 - x, z2 - z) : heading(b[1] - a[1], b[3] - a[3]);
    return { x, y, z, yaw: hd };
  }
  // Catmull-Rom smoothing of a key list for gentle swerves
  function smoothTrack(keys, t) {
    let i = 0;
    while (i < keys.length - 2 && t > keys[i + 1][0]) i++;
    const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(keys.length - 1, i + 2)];
    const u = clamp((t - p1[0]) / (p2[0] - p1[0]), 0, 1);
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u * u * u);
    const x = cr(p0[1], p1[1], p2[1], p3[1]);
    const y = cr(p0[2], p1[2], p2[2], p3[2]);
    const z = cr(p0[3], p1[3], p2[3], p3[3]);
    return { x, y, z };
  }
  function smoothTrackYaw(keys, t) {
    const a = smoothTrack(keys, t);
    const b = smoothTrack(keys, t + 0.05);
    const dx = b.x - a.x, dz = b.z - a.z;
    return { ...a, yaw: Math.abs(dx) + Math.abs(dz) > 1e-5 ? heading(dx, dz) : null };
  }

  function blinkAt(t, seed) {
    // a quick blink every ~2.7 s, deterministic
    const period = 2.7 + (seed % 3) * 0.4;
    const ph = (t + seed * 0.77) % period;
    return ph < 0.12 ? Math.sin((ph / 0.12) * Math.PI) : 0;
  }

  // NPC reaction: surprised lean when the hero passes at time tp
  function surprised(p, t, tp) {
    const k = smooth(tp - 0.25, tp, t) * (1 - smooth(tp + 0.9, tp + 1.6, t));
    p.lean = lerp(p.lean, -0.22, k);
    p.arm[0].x = lerp(p.arm[0].x, -0.6, k);
    p.arm[1].x = lerp(p.arm[1].x, -0.6, k);
    p.arm[0].z = lerp(p.arm[0].z, 0.9, k);
    p.arm[1].z = lerp(p.arm[1].z, 0.9, k);
    p.arm[0].el = lerp(p.arm[0].el, -1.3, k);
    p.arm[1].el = lerp(p.arm[1].el, -1.3, k);
    p.face.open = Math.max(p.face.open, k);
    p.face.brow = lerp(p.face.brow, 1, k);
    return k;
  }

  function hideAllNpcs() {
    for (const k in npc) npc[k].root.visible = false;
    pram.visible = false;
  }

  // ---- time of day: morning -> afternoon -> golden hour ----
  const TOD = [
    { t: 0, top: "#4d97e6", hor: "#d6ecf7", sun: "#fff1d6", sunI: 4.2, el: 0.85, az: 0.6, hemiS: "#d3e8ff", hemiG: "#b89d7a", hemiI: 0.8, fog: "#d6ecf7" },
    { t: 14, top: "#3f86da", hor: "#e6eaf0", sun: "#fff0d2", sunI: 4.2, el: 0.75, az: -0.4, hemiS: "#cfe2ff", hemiG: "#b39a7a", hemiI: 0.78, fog: "#e2e8ef" },
    { t: 21, top: "#4a7fcf", hor: "#f6d2a6", sun: "#ffc98a", sunI: 3.8, el: 0.4, az: -0.9, hemiS: "#c9d5f2", hemiG: "#b08a66", hemiI: 0.72, fog: "#f1d5b2" },
    { t: 30, top: "#3d63b8", hor: "#ffbb7d", sun: "#ffad62", sunI: 3.6, el: 0.28, az: -1.1, hemiS: "#bfc8ee", hemiG: "#a8805e", hemiI: 0.7, fog: "#f6c79a" },
  ];
  const cA = new THREE.Color(), cB = new THREE.Color();
  const mixCol = (a, b, u) => cA.set(a).lerp(cB.set(b), u).clone();
  function lighting(t, focus, indoor = false) {
    let i = 0;
    while (i < TOD.length - 2 && t > TOD[i + 1].t) i++;
    const a = TOD[i], b = TOD[i + 1];
    const u = smooth(a.t, b.t, t);
    sky.material.uniforms.top.value.copy(mixCol(a.top, b.top, u));
    sky.material.uniforms.horizon.value.copy(mixCol(a.hor, b.hor, u));
    sky.material.uniforms.sunCol.value.copy(mixCol(a.sun, b.sun, u));
    scene.fog.color.copy(mixCol(a.fog, b.fog, u));
    sun.color.copy(mixCol(a.sun, b.sun, u));
    sun.intensity = lerp(a.sunI, b.sunI, u);
    hemi.color.copy(mixCol(a.hemiS, b.hemiS, u));
    hemi.groundColor.copy(mixCol(a.hemiG, b.hemiG, u));
    hemi.intensity = lerp(a.hemiI, b.hemiI, u);
    const el = lerp(a.el, b.el, u);
    const az = lerp(a.az, b.az, u);
    const dir = v3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    sky.material.uniforms.sunDir.value.copy(dir);
    sun.position.copy(focus).addScaledVector(dir, 70);
    sun.target.position.copy(focus);
    rim.position.copy(focus).addScaledVector(v3(-dir.x, 0.5, -dir.z).normalize(), 30);
    rim.target.position.copy(focus);
    rim.intensity = indoor ? 1.6 : 1.3;
    sky.position.copy(camera.position);
    if (indoor) {
      hemi.intensity = 1.5;
      hemi.color.set("#fff4e0");
      hemi.groundColor.set("#c9a77d");
      sun.intensity = 2.4;
      sun.color.set("#ffe2b8");
    }
  }

  // =========== the film ===========
  function renderAt(T) {
    const t = clamp(T, 0, 29.999);
    hideAllNpcs();
    hero.root.visible = true;
    hero.body.rotation.set(0, 0, 0);
    hero.body.position.set(0, 0, 0);
    hero.head.scale.set(1, 1, 1);
    envelope.visible = false;
    let pose = basePose();
    let focus = v3(0, 1, 0);
    let indoor = false;
    const blink = blinkAt(t, 1);
    const phaseAt = (tt) => tt * RUN_HZ * Math.PI * 2;

    if (t < CUT.bolt) {
      // ---- S1: close-up at the front door; checks his watch, realizes. ----
      place(hero, 0, 0.14, -6.3, 0);
      const look = smooth(0.0, 0.25, t);
      const shock = smooth(0.62, 0.78, t);
      const antic = smooth(1.15, 1.55, t);
      pose = basePose();
      // left arm raised to look at the watch
      pose.arm[0].x = lerp(0.05, -0.75, look) + antic * 0.8;
      pose.arm[0].z = lerp(0.12, -0.35, look) + antic * 0.4;
      pose.arm[0].el = lerp(-0.3, -1.85, look) + antic * 0.6;
      pose.headPitch = lerp(0.05, 0.42, look) - shock * 0.5 + antic * 0.2;
      pose.headYaw = lerp(0, 0.18, look) * (1 - shock) - antic * 0.5;
      pose.face.lookY = lerp(0, -0.7, look) * (1 - shock) + shock * 0.15;
      pose.face.lookX = lerp(0, 0.25, look) * (1 - shock) - antic * 0.6;
      pose.face.smile = lerp(0.5, -0.4, shock);
      pose.face.open = shock * (1 - antic * 0.6);
      pose.face.brow = lerp(0, 1, shock) - antic * 1.3;
      pose.face.blink = t > 0.55 && t < 0.62 ? 1 : 0;
      // eyes pop: brief squash-stretch of the head
      const pop = Math.sin(clamp((t - 0.62) / 0.3, 0, 1) * Math.PI) * 0.06;
      hero.head.scale.set(1 - pop * 0.5, 1 + pop, 1);
      // anticipation crouch, twist toward the run direction
      pose.bob = -0.1 * antic;
      pose.leg[0].kn = pose.leg[1].kn = 0.05 + 0.4 * antic;
      pose.leg[0].x = pose.leg[1].x = -0.25 * antic;
      pose.lean = 0.25 * antic;
      pose.twist = 0.35 * antic;
      hero.root.rotation.y = lerp(0, 0.9, antic);
      pose.arm[1].x = 0.05 + antic * 0.9;
      pose.arm[1].el = -0.25 - antic * 1.2;
      const push = easeInOut(t / CUT.bolt);
      setCam(v3(0.15 + 0.1 * push, 1.62, lerp(-3.55, -4.05, push)), v3(0.05, 1.5, -6.3), 34, 0.012, t);
      focus = v3(0, 1, -6.3);
      // neighbor girl walking past in the background
      const g = npc.girl;
      g.root.visible = true;
      place(g, 6 - t * 1.1, 0.14, -5.4, -Math.PI / 2);
      applyPose(g, walkPose(t * 8));
    } else if (t < CUT.street) {
      // ---- S1b: he bolts past a low camera ----
      hero.head.scale.set(1, 1, 1);
      const lt = t - CUT.bolt;
      const x = 0.4 + 7.2 * lt * smooth(0, 0.45, lt) + 0.6 * lt;
      const z = lerp(-6.3, -5.4, smooth(0, 0.5, lt));
      place(hero, x, 0.14, z, Math.PI / 2 - 0.1 * (1 - smooth(0, 0.4, lt)));
      pose = runPose(phaseAt(t), smooth(0, 0.2, lt));
      pose.face.brow = 0.6;
      pose.face.open = 0.3;
      pose.face.smile = -0.2;
      setCam(v3(9.5, 0.9, -1.4), v3(x + 0.4, 1.2, z), 48, 0.03, t);
      focus = v3(x, 1, z);
      const g = npc.girl;
      g.root.visible = true;
      place(g, 6 - t * 1.1, 0.14, -5.4, -Math.PI / 2);
      const gp = walkPose(t * 8);
      surprised(gp, t, 2.4);
      g.root.rotation.y = -Math.PI / 2 + smooth(2.3, 2.8, t) * 1.2;
      applyPose(g, gp);
    } else if (t < CUT.front) {
      // ---- S2: side tracking down the busy street, dodging people ----
      const keys = [
        [3.2, 18.5, 0, -5.6], [3.75, 22.3, 0, -5.4], [4.15, 25.1, 0, -4.35], [4.5, 27.5, 0, -4.4], [4.85, 30, 0, -5.6],
        [5.2, 32.4, 0, -4.3], [5.55, 34.8, 0, -4.5], [5.9, 37.2, 0, -5.2], [6.4, 40.7, 0, -5.6],
      ];
      const p = smoothTrackYaw(keys, t);
      place(hero, p.x, 0.14, p.z, p.yaw ?? Math.PI / 2);
      pose = runPose(phaseAt(t));
      pose.face.brow = 0.4;
      pose.face.smile = 0.1;
      // a quick spin around the old man at x~37
      const spin = smooth(5.62, 6.02, t);
      hero.root.rotation.y += spin * Math.PI * 2;
      pose.twist += Math.sin(spin * Math.PI) * 0.3;
      setCam(v3(p.x + 4.2, 1.45, -0.6), v3(p.x - 0.4, 1.1, -5.3), 46, 0.04, t);
      focus = v3(p.x, 1, -5);
      // people
      const p1 = npc.p1;
      p1.root.visible = true;
      const p1x = 28.5 - (t - 3.2) * 1.15;
      place(p1, p1x, 0.14, -5.7, -Math.PI / 2);
      const pp1 = walkPose((t - 3.2) * 7);
      surprised(pp1, t, 4.2);
      pp1.headYaw = smooth(4.2, 4.7, t) * 1.2;
      applyPose(p1, pp1);
      const mom = npc.mom;
      mom.root.visible = true;
      const mx = 29.6 + (t - 3.2) * 0.75;
      place(mom, mx, 0.14, -6.1, Math.PI / 2);
      const pm = walkPose((t - 3.2) * 6, 0.8);
      pm.arm[0].x = pm.arm[1].x = -0.75;
      pm.arm[0].el = pm.arm[1].el = -0.5;
      surprised(pm, t, 4.95);
      pm.arm[0].x = Math.min(pm.arm[0].x, -0.7);
      applyPose(mom, pm);
      pram.visible = true;
      pram.position.set(mx + 0.95, 0.14, -6.1);
      pram.rotation.y = 0;
      const old = npc.old;
      old.root.visible = true;
      place(old, 37.3, 0.14, -6.0, Math.PI * 0.85 + smooth(5.7, 6.2, t) * 1.4);
      const po = basePose();
      po.arm[1].x = -0.7;
      po.arm[1].el = -1.0;
      po.headPitch = 0.3 * (1 - smooth(5.5, 5.8, t));
      po.face.lookY = -0.5 * (1 - smooth(5.5, 5.8, t));
      const k = surprised(po, t, 5.8);
      po.headRoll = 0.2 * k;
      po.face.blink = blinkAt(t, 5);
      applyPose(old, po);
    } else if (t < CUT.roof) {
      // ---- S3: low front tracking shot, hurdling the fruit stand ----
      const lt = t - CUT.front;
      const keys = [
        [6.4, 46, 0, -5.4], [7.0, 50.2, 0, -5.4], [7.35, 52.6, 0, -4.4], [7.7, 55, 0, -4.3], [8.1, 57.8, 0, -5.2],
        [8.6, 61.4, 0, -5.8], [9.0, 64.2, 0, -5.8], [9.6, 68.4, 0, -5.6],
      ];
      const p = smoothTrackYaw(keys, t);
      // hurdle over the crates at x 61.7..63.3
      const j = clamp((t - 8.62) / 0.42, 0, 1);
      const jump = Math.sin(j * Math.PI) * 1.05;
      place(hero, p.x, 0.14 + jump, p.z, p.yaw ?? Math.PI / 2);
      pose = runPose(phaseAt(t));
      if (j > 0 && j < 1) {
        const k = Math.sin(j * Math.PI);
        pose.leg[0].x = lerp(pose.leg[0].x, -1.5, k);
        pose.leg[0].kn = lerp(pose.leg[0].kn, 0.25, k);
        pose.leg[1].x = lerp(pose.leg[1].x, 0.6, k);
        pose.leg[1].kn = lerp(pose.leg[1].kn, 1.6, k);
        pose.arm[0].x = lerp(pose.arm[0].x, -1.6, k);
        pose.arm[1].x = lerp(pose.arm[1].x, 0.9, k);
        pose.lean += 0.25 * k;
        pose.face.open = 0.6 * k;
        pose.face.brow = 0.9 * k;
      } else {
        pose.face.smile = 0.5;
        pose.face.brow = 0.2;
      }
      const cx = p.x + 6.2 - lt * 0.35;
      setCam(v3(cx, 0.55, -4.2), v3(p.x, 1.2 + jump * 0.5, -5.2), 44, 0.05, t);
      focus = v3(p.x, 1, -5);
      const ph = npc.phone;
      ph.root.visible = true;
      const phx = 56.5 - lt * 1.1;
      place(ph, phx, 0.14, -5.75, -Math.PI / 2 + smooth(7.6, 8.0, t) * 2.2);
      const pp = walkPose(lt * 7);
      pp.arm[1].x = -0.9;
      pp.arm[1].el = -1.3;
      pp.headPitch = 0.45 * (1 - smooth(7.5, 7.75, t));
      pp.face.lookY = -0.6 * (1 - smooth(7.5, 7.75, t));
      surprised(pp, t, 7.7);
      applyPose(ph, pp);
      const se = npc.seller;
      se.root.visible = true;
      place(se, 63, 0.14, -7.0, Math.PI * 0.1 + smooth(8.7, 9.2, t) * 1.1);
      const ps = basePose();
      ps.face.blink = blinkAt(t, 7);
      surprised(ps, t, 8.85);
      ps.face.smile = 0.6;
      applyPose(se, ps);
    } else if (t < CUT.roof2) {
      // ---- S4: bursts out of the stair hut onto the roof; the big leap ----
      const lt = t - CUT.roof;
      const takeoff = 10.6;
      let x, y, z = -8;
      if (t < takeoff) {
        x = 297.0 + 7.0 * (t - CUT.roof) * smooth(0, 0.15, lt) + 0.3;
        y = RH.r1;
        pose = runPose(phaseAt(t));
        pose.face.brow = 0.6;
        pose.face.smile = 0.3;
        // last step: plant and spring
        const plant = smooth(10.42, 10.6, t);
        pose.leg[1].kn = lerp(pose.leg[1].kn, 0.9, plant);
        pose.bob -= 0.12 * plant;
      } else {
        const u = (t - takeoff) / (CUT.roof2 - takeoff);
        x = lerp(304.0, 309.3, u);
        y = lerp(RH.r1, RH.r2, u) + Math.sin(u * Math.PI) * 1.6;
        pose = basePose();
        pose.lean = 0.35;
        pose.leg[0].x = lerp(-1.6, -0.9, u);
        pose.leg[0].kn = lerp(0.3, 1.2, u);
        pose.leg[1].x = lerp(0.9, -0.4, u);
        pose.leg[1].kn = lerp(1.4, 1.0, u);
        pose.arm[0].x = lerp(-2.6, -1.2, u);
        pose.arm[1].x = lerp(-2.4, -1.0, u);
        pose.arm[0].z = pose.arm[1].z = 0.5;
        pose.arm[0].el = pose.arm[1].el = -0.3;
        pose.face.open = 0.8;
        pose.face.brow = 1;
        pose.headPitch = 0.2;
      }
      place(hero, x, y, z, Math.PI / 2);
      // out in the air in front of the facade: roof, the gap and the street far below
      const cu = easeInOut(lt / 1.6);
      setCam(v3(lerp(301.0, 305.5, cu), RH.r1 + lerp(3.6, 3.0, cu), lerp(1.5, 0.8, cu)), v3(x + 1.2, y - 0.8, -7.5), lerp(52, 50, cu), 0.03, t);
      focus = v3(x, y, z);
    } else if (t < CUT.drop) {
      // ---- S5: landing roll, sprint across, leap down to the lower roof ----
      const lt = t - CUT.roof2;
      let x, y, z = -8;
      if (t < 11.75) {
        // land + forward roll
        const u = (t - CUT.roof2) / 0.55;
        x = 309.3 + u * 2.6;
        y = RH.r2;
        const roll = easeInOut(u);
        pose = basePose();
        pose.lean = 0.6;
        pose.bob = -0.35 * Math.sin(u * Math.PI);
        for (const l of pose.leg) { l.x = -1.6; l.kn = 2.2; }
        for (const a of pose.arm) { a.x = -1.2; a.el = -1.2; }
        pose.headPitch = 0.6;
        pose.face.blink = 0.7;
        hero.body.position.y = 0.55 * Math.sin(u * Math.PI);
        hero.body.rotation.x = roll * Math.PI * 2;
        hero.body.position.y += hero.hipH * 0.5 * (1 - Math.cos(roll * Math.PI * 2)) * 0;
      } else if (t < 13.55) {
        x = 311.9 + (t - 11.75) * 7.4;
        y = RH.r2;
        pose = runPose(phaseAt(t), smooth(11.75, 11.95, t));
        pose.face.smile = 0.7;
        pose.face.brow = 0.3;
      } else {
        const u = (t - 13.55) / (CUT.drop - 13.55 + 0.25);
        x = lerp(325.2, 329.6, clamp(u, 0, 1));
        y = lerp(RH.r2, RH.r3, easeOut(u) * 0.2 + u * u * 0.8) + Math.sin(clamp(u, 0, 1) * Math.PI) * 0.9;
        pose = basePose();
        pose.lean = 0.2;
        pose.leg[0].x = -1.2; pose.leg[0].kn = 0.8;
        pose.leg[1].x = 0.5; pose.leg[1].kn = 1.3;
        pose.arm[0].x = -2.8; pose.arm[1].x = -2.6;
        pose.arm[0].z = pose.arm[1].z = 0.3;
        pose.face.open = 1;
        pose.face.brow = 1;
        pose.face.smile = 0.6;
      }
      place(hero, x, y, z, Math.PI / 2);
      if (t < 12.0) {
        const shake = 0.12 * Math.exp(-lt * 6);
        setCam(v3(311.6, RH.r2 + 0.7, -4.6), v3(x, y + 0.5, z), 44, 0.02 + shake, t);
      } else {
        const cx = x + 2.5;
        setCam(v3(cx, RH.r2 + 3.4, 1.8), v3(x + 0.8, y - 0.6, -7.5), 50, 0.04, t);
      }
      focus = v3(x, y, z);
    } else if (t < CUT.jam) {
      // ---- S6: off the edge, onto the awning, down to the street (worm's-eye) ----
      const keys = [
        [14.4, 329.6, RH.r3, -8], [14.75, 330.6, RH.r3, -6.6], [14.95, 331.0, RH.r3 + 0.3, -5.6],
      ];
      let x, y, z;
      if (t < 14.95) {
        const p = track(keys, t);
        x = p.x; y = p.y; z = p.z;
        place(hero, x, y, z, 0);
        pose = runPose(phaseAt(t));
        pose.face.open = 0.5;
        pose.face.brow = 0.8;
      } else if (t < 15.35) {
        // fall onto the awning
        const u = (t - 14.95) / 0.4;
        x = 331.0; z = lerp(-5.6, -4.5, u);
        y = lerp(RH.r3 + 0.3, 3.55, u * u) + Math.sin(u * Math.PI) * 0.5;
        place(hero, x, y, z, 0);
        pose = basePose();
        pose.arm[0].x = pose.arm[1].x = -2.9;
        pose.arm[0].z = pose.arm[1].z = 0.6;
        pose.leg[0].kn = 0.5; pose.leg[1].kn = 0.9;
        pose.leg[1].x = -0.5;
        pose.face.open = 1;
        pose.face.brow = 1;
      } else if (t < 15.8) {
        // bounce: tuck flip down to the sidewalk
        const u = (t - 15.35) / 0.45;
        x = 331.0; z = lerp(-4.5, -2.6, u);
        y = lerp(3.55, 0.14, u * u) + Math.sin(u * Math.PI) * 1.0;
        place(hero, x, y, z, 0);
        hero.body.position.y = 0.6 * Math.sin(u * Math.PI);
        hero.body.rotation.x = easeInOut(u) * Math.PI * 2;
        pose = basePose();
        for (const l of pose.leg) { l.x = -1.7; l.kn = 2.1; }
        for (const a of pose.arm) { a.x = -1.0; a.el = -1.5; }
        pose.lean = 0.5;
        pose.face.smile = 1;
        pose.face.brow = 0.6;
      } else {
        // superhero landing
        const u = (t - 15.8) / 0.2;
        x = 331.0; z = -2.6; y = 0.14;
        place(hero, x, y, z, smooth(0, 1, u) * 1.2);
        pose = basePose();
        pose.bob = -0.32;
        pose.lean = 0.5;
        pose.leg[0].x = -1.3; pose.leg[0].kn = 2.0;
        pose.leg[1].x = 0.5; pose.leg[1].kn = 1.5;
        pose.arm[0].x = -0.6; pose.arm[0].z = 0.9;
        pose.arm[1].x = -0.4; pose.arm[1].el = -0.4;
        pose.face.smile = 1;
      }
      // awning squash when he hits it
      const hit = Math.sin(clamp((t - 15.3) / 0.25, 0, 1) * Math.PI);
      awning.scale.set(1, 1, 1);
      awning.position.y = 3.4 - 0.22 * hit;
      awning.rotation.x = 0.25 + 0.12 * hit;
      setCam(v3(333.6, 0.6, 3.2), v3(x - 0.3, y + 0.8, z), 50, 0.04 + 0.1 * hit, t);
      focus = v3(x, Math.max(1, y * 0.5), z);
    } else if (t < CUT.slide) {
      // ---- S7: weaving through the traffic jam ----
      const keys = [
        [16.0, 395, 0, 0], [17.2, 403.4, 0, 0], [17.8, 407.6, 0, 3.5], [19.2, 417.4, 0, 3.5],
        [19.8, 421.6, 0, 0.1], [20.8, 428.0, 0, 0],
      ];
      const p = smoothTrackYaw(keys, t);
      place(hero, p.x, 0.0, p.z, p.yaw ?? Math.PI / 2);
      pose = runPose(phaseAt(t));
      pose.face.smile = 0.3;
      pose.face.brow = 0.5;
      if (t < CUT.jamLow) {
        const lt = t - CUT.jam;
        setCam(v3(p.x - 5.0 + lt * 0.4, 10.5, p.z - 5.5), v3(p.x + 1.8, 0.4, p.z + 0.3), 46, 0.05, t);
      } else {
        setCam(v3(p.x + 7.5, 2.6, p.z * 0.85), v3(p.x, 1.0, p.z), 46, 0.05, t);
      }
      focus = v3(p.x, 1, p.z);
    } else if (t < CUT.school) {
      // ---- S8: slide across the taxi's hood ----
      const keys = [[20.8, 428.0, 0, -0.2], [21.25, 430.0, 0, -1.3], [21.75, 432.4, 0, -1.3], [22.4, 437.6, 0, -1.0]];
      const p = track(keys, t);
      let y = 0;
      const slide = clamp((t - 21.2) / 0.55, 0, 1);
      pose = runPose(phaseAt(t));
      if (slide > 0 && slide < 1) {
        const k = Math.sin(slide * Math.PI);
        y = 1.12 * Math.min(1, k * 1.6);
        hero.body.rotation.z = -0.95 * Math.min(1, k * 1.5);
        pose = basePose();
        pose.leg[0].x = -1.3; pose.leg[0].kn = 0.2;
        pose.leg[1].x = -0.6; pose.leg[1].kn = 1.4;
        pose.arm[1].x = -0.6; pose.arm[1].z = 1.4; pose.arm[1].el = -0.2;
        pose.arm[0].x = -1.0; pose.arm[0].z = 0.6;
        pose.headYaw = 0.3;
        pose.face.smile = 1;
        pose.face.brow = 0.8;
      } else if (slide >= 1) {
        pose.face.smile = 0.8;
      }
      place(hero, p.x, y, p.z, p.yaw ?? Math.PI / 2);
      setCam(v3(431.4, 1.3, -6.6), v3(p.x * 0.4 + 431 * 0.6, 1.0, -1.3), 46, 0.04, t);
      focus = v3(p.x, 1, p.z);
    } else if (t < CUT.box) {
      // ---- S9: arrives at the school polling station ----
      const keys = [[22.4, 509.5, 0.14, -5.6], [23.25, 515.6, 0.14, -5.6], [23.6, 518.7, 0.14, -6.4], [24.0, 520.0, 0.14, -8.6]];
      const p = smoothTrackYaw(keys, t);
      place(hero, p.x, 0.14, p.z, p.yaw ?? Math.PI / 2);
      pose = runPose(phaseAt(t), 1 - smooth(23.55, 24.0, t) * 0.35);
      pose.face.smile = 0.9;
      pose.face.brow = 0.4;
      const lt = t - CUT.school;
      setCam(v3(lerp(516.8, 518.6, lt / 1.6), 1.6, lerp(4.8, 4.0, lt / 1.6)), v3(lerp(p.x, 520, 0.45), 1.7, -6.6), 54, 0.02, t);
      focus = v3(520, 1, -7);
      const va = npc.voterA;
      va.root.visible = true;
      place(va, 521.4 + (t - 22.4) * 0.5, 0.14, -6.4, 1.2);
      const pa = walkPose((t - 22.4) * 5, 0.6);
      pa.face.smile = 0.9;
      pa.face.blink = blinkAt(t, 9);
      pa.headYaw = -0.6 * smooth(23.2, 23.6, t);
      pa.arm[1].x = lerp(pa.arm[1].x, -2.4, smooth(23.3, 23.6, t));
      pa.arm[1].z = lerp(pa.arm[1].z, 0.3, smooth(23.3, 23.6, t));
      applyPose(va, pa);
      const vb = npc.voterB;
      vb.root.visible = true;
      place(vb, 523.5, 0.14, -5.2, -1.9);
      const pb = basePose();
      pb.face.smile = 0.7;
      pb.face.blink = blinkAt(t, 10);
      pb.headYaw = -0.5;
      applyPose(vb, pb);
    } else if (t < CUT.end) {
      // ---- S10: the envelope goes in ----
      indoor = true;
      place(hero, 600, 0, -0.62, 0);
      pose = basePose();
      const reach = smooth(24.0, 24.45, t);
      const drop = smooth(24.85, 25.0, t);
      pose.arm[1].x = lerp(-0.4, -2.05, reach);
      pose.arm[1].z = lerp(0.05, -0.3, reach);
      pose.arm[1].el = lerp(-0.9, -0.55, reach);
      pose.arm[0].x = 0.05;
      pose.headPitch = lerp(0.25, 0.42, reach) - smooth(25.5, 25.9, t) * 0.4;
      pose.face.lookY = -0.6 * (1 - smooth(25.4, 25.7, t));
      pose.face.smile = lerp(0.4, 1.1, smooth(25.1, 25.5, t));
      pose.face.grin = smooth(25.2, 25.6, t);
      pose.face.brow = lerp(0.1, 0.6, smooth(25.1, 25.5, t));
      pose.face.blink = blink;
      pose.lean = 0.12 * reach;
      // envelope: in hand, released over the slot, drops in
      envelope.visible = true;
      hero.root.updateMatrixWorld(true);
      applyPose(hero, pose);
      hero.root.updateMatrixWorld(true);
      const handPos = new THREE.Vector3();
      hero.arms[1].wr.getWorldPosition(handPos);
      const slotPos = v3(600, 0.82 + 0.55, 0.05);
      if (t < 24.85) {
        envelope.position.set(handPos.x + 0.02, handPos.y + 0.02, handPos.z + 0.1);
        envelope.rotation.set(-0.5, 0, 0.15);
      } else {
        const u = clamp((t - 24.85) / 0.55, 0, 1);
        const start = v3(lerp(handPos.x, slotPos.x, 0.8), slotPos.y + 0.12, lerp(handPos.z, slotPos.z, 0.8));
        envelope.position.set(start.x, lerp(start.y, slotPos.y - 0.2, u * u), start.z);
        envelope.rotation.set(Math.PI / 2 - 0.02, 0, 0);
        envelope.visible = u < 1;
        envelope.rotation.x = 0;
        envelope.rotation.y = Math.PI / 2;
        envelope.rotation.z = Math.PI / 2;
      }
      if (t < CUT.face) {
        const lt = t - CUT.box;
        setCam(v3(600.3, 2.05, lerp(1.6, 1.45, lt / 1.6)), v3(600, 1.3, -0.3), 44, 0.008, t);
      } else {
        const lt = t - CUT.face;
        setCam(v3(600.1, 1.62, lerp(0.95, 0.85, lt / 0.8)), v3(600, 1.57, -0.62), 40, 0.006, t);
      }
      focus = v3(600, 1, 0);
      for (const [id, x, yaw] of [["comm1", 601.0, -0.4], ["comm2", 598.9, 0.35]]) {
        const c = npc[id];
        c.root.visible = true;
        place(c, x, 0, 0.75, Math.PI + yaw);
        const pc = basePose();
        pc.face.smile = 0.6 + smooth(25.1, 25.4, t) * 0.4;
        pc.face.blink = blinkAt(t, id === "comm1" ? 11 : 12);
        pc.headPitch = 0.2;
        pc.arm[0].x = pc.arm[1].x = -0.9;
        pc.arm[0].el = pc.arm[1].el = -0.6;
        // a little clap at the drop
        const clap = smooth(25.05, 25.3, t) * (1 - smooth(25.9, 26.3, t));
        pc.arm[0].z = pc.arm[1].z = lerp(0.12, -0.25, clap * (0.5 + 0.5 * Math.sin(t * 40)));
        applyPose(c, pc);
      }
      applyPose(hero, pose);
      hero.head.scale.set(1, 1, 1);
      lighting(t, focus, indoor);
      W.updateFlag(flags[0], t);
      renderer.render(scene, camera);
      return;
    } else {
      // ---- S11: the end card — he points at you ----
      place(hero, 527, 0.14, -6.0, 0);
      pose = basePose();
      const turn = smooth(26.4, 26.8, t);
      const point = smooth(27.55, 27.85, t);
      pose.face.smile = 1.1;
      pose.face.grin = 0.4 + 0.6 * point;
      pose.face.brow = 0.5 + point * 0.4;
      pose.face.blink = blinkAt(t, 1);
      pose.headYaw = lerp(0.5, 0, turn);
      pose.headRoll = 0.08 * point;
      pose.arm[1].x = lerp(0.05, -1.45, point);
      pose.arm[1].z = lerp(0.12, -0.05, point);
      pose.arm[1].el = lerp(-0.3, -0.1, point);
      pose.arm[0].x = 0.1;
      pose.arm[0].z = 0.35;
      pose.arm[0].el = -1.9 * (1 - point * 0.3); // hand on hip-ish
      pose.twist = 0.15 * point;
      pose.lean = -0.05 + 0.08 * point;
      hero.root.rotation.y = lerp(0.6, 0, turn);
      const u = easeOut((t - CUT.end) / 3.6);
      setCam(v3(lerp(527.45, 527.3, u), lerp(0.85, 0.95, u), lerp(-2.15, -2.5, u)), v3(527, 1.62, -6.0), 46, 0.006, t);
      focus = v3(527, 1, -6.3);
      const va = npc.voterA;
      va.root.visible = true;
      place(va, 529.6, 0.14, -7.0, -0.7);
      const pa = basePose();
      pa.face.smile = 0.9;
      pa.face.blink = blinkAt(t, 9);
      applyPose(va, pa);
    }

    pose.face.blink = Math.max(pose.face.blink, blink);
    applyPose(hero, pose);
    for (let i = 0; i < flags.length; i++) W.updateFlag(flags[i], t, i * 1.3);
    lighting(t, focus, indoor);
    renderer.render(scene, camera);
  }

  return { renderAt, renderer, scene, camera, CUT };
}
