import * as THREE from "three";
import { createFilm } from "./film.js";

window.THREE = window.THREE || THREE;
window.__hf = window.__hf || {};
window.__hf.buildReady = window.__hf.buildReady || {};

let film = null;
let lastT = 0;
async function build() {
  const faces = [
    ["assets/fonts/rubik-hebrew-900-normal.woff2", "900", "U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F"],
    ["assets/fonts/rubik-latin-900-normal.woff2", "900", "U+0000-00FF"],
    ["assets/fonts/rubik-hebrew-700-normal.woff2", "700", "U+0590-05FF, U+200C-2010, U+20AA, U+25CC, U+FB1D-FB4F"],
    ["assets/fonts/rubik-latin-700-normal.woff2", "700", "U+0000-00FF"],
  ];
  await Promise.all(
    faces.map(([url, weight, range]) =>
      new FontFace("Rubik", `url(${url})`, { weight, unicodeRange: range }).load().then((f) => document.fonts.add(f)),
    ),
  ).catch(() => {});
  film = createFilm(document.getElementById("film-canvas"));
  film.renderAt(window.__hfThreeTime || lastT);
  window.__film = film;
}
window.__hf.buildReady["vote-run-film"] = build();
window.addEventListener("hf-seek", (e) => {
  lastT = e.detail.time;
  if (film) film.renderAt(lastT);
});
