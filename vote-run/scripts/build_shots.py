"""Generate one 2.5D cutout-animation scene per shot: compositions/a{n}.html.

Each scene stacks the layers from scripts/make_layers.py inside a "world" (the camera):
  bg plate -> other people -> world props -> hero (back parts, body, front parts) -> front props
and animates them with GSAP. Per-shot motion lives in SHOTS below.
"""
import json

SHOTS = [(1, 0, 2.4), (2, 2.4, 3.2), (3, 5.6, 2.4), (4, 8.0, 3.2), (5, 11.2, 3.2),
         (6, 14.4, 3.2), (7, 17.6, 3.2), (8, 20.8, 2.4), (9, 23.2, 3.2), (10, 26.4, 3.6)]

# Shared helpers, available to every scene script. Every loop is finite and every
# value is a function of timeline time, so any frame renders on its own.
HELPERS = r"""
    const tl = gsap.timeline({ paused: true });
    function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
    // up-down bob, two footfalls per stride
    function bob(sel, t0, t1, amp, period) {
      for (let t = t0; t < t1 - 0.001; t += period / 2) {
        tl.to(sel, { y: -amp, duration: period / 4, ease: "sine.out" }, t);
        tl.to(sel, { y: 0, duration: period / 4, ease: "sine.in" }, t + period / 4);
      }
    }
    // alternating rotation around an origin (arm swing, body sway)
    function swing(sel, origin, t0, t1, deg, period, phase = 1) {
      let i = 0;
      for (let t = t0; t < t1 - 0.001; t += period / 2, i++) {
        tl.to(sel, { rotation: (i % 2 ? 1 : -1) * deg * phase, transformOrigin: origin, duration: period / 2, ease: "sine.inOut" }, t);
      }
    }
    // seeded nervous jitter
    function jitter(sel, t0, t1, amp, seed, rot = 0) {
      const r = rng(seed);
      for (let t = t0; t < t1 - 0.001; t += 1 / 15) {
        tl.to(sel, { x: (r() - 0.5) * amp, y: (r() - 0.5) * amp, rotation: (r() - 0.5) * rot, duration: 1 / 15, ease: "sine.inOut" }, t);
      }
      tl.to(sel, { x: 0, y: 0, rotation: 0, duration: 0.1 }, t1 - 0.1);
    }
"""

# Per-shot motion. `S` is the scene id prefix, `D` its duration, feet/center come from meta.
SHOTS_JS = {
    1: """
    tl.fromTo("#S-world", { scale: 1.04, transformOrigin: "50% 40%" }, { scale: 1.1, duration: 0.9, ease: "power1.inOut" }, 0);
    tl.to("#S-world", { scale: 1.22, y: 90, duration: 0.16, ease: "expo.out" }, 0.9);
    tl.to("#S-world", { scale: 1.27, duration: D - 1.06, ease: "none" }, 1.06);
    // shaking the watch arm in disbelief
    jitter("#S-watch img", 0.25, 1.6, 6, 11, 5);
    // the jolt of realization, then he leans in to bolt
    tl.fromTo("#S-hero", { y: 0, scale: 1, transformOrigin: "FEET" }, { y: -24, duration: 0.12, ease: "power3.out" }, 0.86);
    tl.to("#S-hero", { y: 0, duration: 0.3, ease: "bounce.out" }, 0.98);
    tl.to("#S-hero", { scale: 1.08, rotation: -2, duration: D - 1.6, ease: "power2.in" }, 1.6);
    """,
    2: """
    tl.fromTo("#S-bg", { scale: 1.1, transformOrigin: "50% 45%" }, { scale: 1.02, duration: D, ease: "none" }, 0);
    tl.fromTo("#S-hero", { scale: 1.02, y: 0, transformOrigin: "FEET" }, { scale: 1.3, y: 90, duration: D, ease: "power1.in" }, 0);
    bob("#S-heroin", 0, D, 22, 0.4);
    swing("#S-heroin", "FEET", 0, D, 2.4, 0.4);
    swing("#S-armR img", "PIV_armR", 0, D, 20, 0.4);
    swing("#S-armL img", "PIV_armL", 0, D, 16, 0.4, -1);
    tl.fromTo("#S-p0", { y: 0, rotation: 0, transformOrigin: "FEET_p0" }, { y: -26, rotation: 6, duration: 0.3, ease: "power3.out" }, 0.55);
    tl.to("#S-p0", { y: 0, duration: 0.3, ease: "bounce.out" }, 0.85);
    tl.to("#S-p0", { rotation: 3, duration: D - 1.15, ease: "sine.inOut" }, 1.15);
    """,
    3: """
    tl.fromTo("#S-world", { scale: 1.08, y: 60, transformOrigin: "50% 50%" }, { scale: 1.12, y: -30, duration: D, ease: "power1.out" }, 0);
    // the hurdle: rise to the top of the arc, then start to come down
    tl.fromTo("#S-hero", { y: 18, rotation: -1.5, transformOrigin: "CENTER" }, { y: -22, rotation: 0.5, duration: 1.2, ease: "power2.out" }, 0);
    tl.to("#S-hero", { y: 4, rotation: 1.5, duration: D - 1.2, ease: "power2.in" }, 1.2);
    swing("#S-armA img", "PIV_armA", 0, D, 6, 0.8);
    swing("#S-armB img", "PIV_armB", 0, D, 12, 0.8, -1);
    // the shopkeeper flinches back, hands shaking
    tl.fromTo("#S-p0", { rotation: 0, transformOrigin: "FEET_p0" }, { rotation: 1.5, duration: 0.25, ease: "power3.out" }, 0.2);
    jitter("#S-p0 img", 0.2, D, 4, 31, 1);
    // fruit flies off the crates
    tl.fromTo("#S-apple", { y: 0, rotation: 0, transformOrigin: "PIV_apple" }, { y: -140, rotation: 90, duration: 0.6, ease: "power2.out" }, 0.3);
    tl.to("#S-apple", { y: 420, rotation: 260, duration: 0.9, ease: "power2.in" }, 0.9);
    tl.fromTo("#S-orange", { y: 0, x: 0, rotation: 0, transformOrigin: "PIV_orange" }, { y: 320, x: 60, rotation: 300, duration: 1.2, ease: "power2.in" }, 0.5);
    """,
    4: """
    tl.fromTo("#S-bg", { scale: 1.1, y: 30, transformOrigin: "50% 60%" }, { scale: 1.0, y: -10, duration: D, ease: "sine.inOut" }, 0);
    tl.fromTo("#S-hero", { x: -30, y: 30, scale: 0.98, rotation: 3, transformOrigin: "CENTER" }, { x: 30, y: -20, scale: 1.08, rotation: -2, duration: D, ease: "sine.inOut" }, 0);
    swing("#S-heroin", "CENTER", 0, D, 1.5, 1.6);
    """,
    5: """
    tl.fromTo("#S-world", { y: 0, transformOrigin: "50% 50%" }, { y: 0, duration: 0.01 }, 0);
    jitter("#S-world", 0, 0.45, 28, 51, 1.5);
    tl.fromTo("#S-bg", { scale: 1.08, transformOrigin: "50% 30%" }, { scale: 1.0, duration: D, ease: "power1.out" }, 0);
    // the tumble off the awning
    tl.fromTo("#S-hero", { y: -40, rotation: -7, transformOrigin: "CENTER" }, { y: 70, rotation: 9, duration: D, ease: "power1.in" }, 0);
    swing("#S-heroin", "CENTER", 0, D, 2.5, 0.8);
    """,
    6: """
    tl.fromTo("#S-world", { scale: 1.12, y: 120, transformOrigin: "50% 40%" }, { scale: 1.04, y: 0, duration: D, ease: "power2.inOut" }, 0);
    tl.fromTo("#S-hero", { scale: 1.0, transformOrigin: "FEET" }, { scale: 1.22, duration: D, ease: "power1.in" }, 0);
    bob("#S-heroin", 0, D, 18, 0.4);
    swing("#S-heroin", "FEET", 0, D, 2.2, 0.4);
    swing("#S-armA img", "PIV_armA", 0, D, 18, 0.4);
    swing("#S-armB img", "PIV_armB", 0, D, 14, 0.4, -1);
    """,
    7: """
    tl.fromTo("#S-bg", { x: 30, scale: 1.08, transformOrigin: "50% 50%" }, { x: -30, scale: 1.08, duration: D, ease: "none" }, 0);
    tl.fromTo("#S-hero", { x: -40, y: -10, rotation: 2, transformOrigin: "CENTER" }, { x: 40, y: 6, rotation: -2, duration: D, ease: "power1.out" }, 0);
    jitter("#S-world", 0, D, 6, 71, 0.4);
    """,
    8: """
    tl.fromTo("#S-world", { scale: 1.04, transformOrigin: "50% 40%" }, { scale: 1.12, duration: D, ease: "power1.inOut" }, 0);
    tl.fromTo("#S-hero", { scale: 1.0, transformOrigin: "FEET" }, { scale: 1.2, duration: D, ease: "power1.in" }, 0);
    bob("#S-heroin", 0, D, 20, 0.4);
    swing("#S-heroin", "FEET", 0, D, 2.2, 0.4);
    swing("#S-armA img", "PIV_armA", 0, D, 16, 0.4);
    swing("#S-armB img", "PIV_armB", 0, D, 14, 0.4, -1);
    bob("#S-p0", 0, D, 6, 1.0);
    swing("#S-p0", "FEET_p0", 0, D, 1.5, 1.0);
    """,
    9: """
    tl.fromTo("#S-world", { scale: 1.04, transformOrigin: "45% 60%" }, { scale: 1.14, duration: D, ease: "power1.inOut" }, 0);
    // the hand pushes the envelope down; the envelope slides into the slot
    tl.fromTo("#S-arm", { y: 0 }, { y: 46, duration: 0.8, ease: "power2.inOut" }, 0.5);
    tl.fromTo("#S-env", { y: 0 }, { y: 46, duration: 0.8, ease: "power2.inOut" }, 0.5);
    tl.to("#S-arm", { y: 26, duration: 0.6, ease: "power2.out" }, 1.4);
    tl.fromTo("#S-hero", { rotation: 0, transformOrigin: "FEET" }, { rotation: 1.5, duration: 0.8, ease: "sine.inOut" }, 0.5);
    tl.to("#S-hero", { rotation: -1, duration: 1.2, ease: "sine.inOut" }, 1.4);
    // the committee lights up when the envelope drops in
    tl.fromTo("#S-p0", { y: 0 }, { y: -12, duration: 0.18, ease: "power2.out" }, 1.65);
    tl.to("#S-p0", { y: 0, duration: 0.3, ease: "bounce.out" }, 1.83);
    swing("#S-p0 img", "FEET_p0", 0, D, 1.2, 1.4);
    """,
    10: """
    tl.fromTo("#S-world", { scale: 1.16, y: 50, transformOrigin: "50% 60%" }, { scale: 1.04, y: 0, duration: 0.6, ease: "expo.out" }, 0);
    tl.to("#S-world", { scale: 1.02, duration: D - 0.6, ease: "none" }, 0.6);
    // head: a confident tilt, then a nod on "צאו להצביע"
    tl.fromTo("#S-head img", { rotation: 0, transformOrigin: "PIV_head" }, { rotation: -4, duration: 0.5, ease: "sine.inOut" }, 0.2);
    tl.to("#S-head img", { rotation: 3, duration: 0.25, ease: "power2.out" }, 1.35);
    tl.to("#S-head img", { rotation: 0, duration: 0.6, ease: "sine.inOut" }, 1.6);
    // the point: a punch toward the lens on the call to action
    tl.fromTo("#S-point img", { scale: 1, rotation: 0, transformOrigin: "PIV_point" }, { scale: 1.12, rotation: -3, duration: 0.18, ease: "power3.out" }, 1.38);
    tl.to("#S-point img", { scale: 1.04, rotation: 0, duration: 0.5, ease: "elastic.out(1, 0.5)" }, 1.56);
    swing("#S-heroin", "FEET", 0, D, 1.2, 1.8);
    """,
}


def scene_html(n, dur, meta):
    S = f"a{n}"
    parts = meta["parts"]
    people = meta["people"]
    img = lambda name: f'<img src="assets/layers/{n}_{name}.png" alt="" />'
    layer = lambda name, inner: f'      <div id="{S}-{name}" class="lay">{inner}</div>'
    world = [f'      <div id="{S}-bg" class="lay"><img src="assets/layers/{n}_bg.jpg" alt="" /></div>']
    world += [layer(p["name"], img(p["name"])) for p in people]
    world += [layer(p["name"], img(p["name"])) for p in parts if p.get("z") == "world"]
    hero = [layer(p["name"], img(p["name"])) for p in parts if p.get("z") == "back" and p.get("src") != "image"]
    hero += [f'          <div id="{S}-body" class="lay">{img("hero")}</div>']
    hero += [layer(p["name"], img(p["name"])) for p in parts if p.get("z", "front") == "front" and p.get("src") != "image"]
    world += [f'      <div id="{S}-hero" class="lay"><div id="{S}-heroin" class="lay">\n' + "\n".join(hero) + "\n      </div></div>"]
    world += [layer(p["name"], img(p["name"])) for p in parts if p.get("z") == "world_front"]

    js = SHOTS_JS[n].replace("#S-", f"#{S}-")
    fx, fy = meta["hero"]["feet"]
    cx, cy = meta["hero"]["center"]
    js = js.replace('"FEET"', f'"{fx}px {fy}px"').replace('"CENTER"', f'"{cx}px {cy}px"')
    for p in people:
        px, py = p["feet"]
        js = js.replace(f'"FEET_{p["name"]}"', f'"{px}px {py}px"')
    for p in parts:
        x, y = p["pivot"]
        js = js.replace(f'"PIV_{p["name"]}"', f'"{x}px {y}px"')
    return f"""<template>
  <style>
    #root {{ position: absolute; inset: 0; overflow: hidden; background: #000; }}
    #root .lay {{ position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; }}
    #root .lay img {{ position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; }}
  </style>
  <div id="root" data-composition-id="{S}" data-start="0" data-duration="{dur}" data-width="1080" data-height="1920">
    <div id="{S}-world" class="lay">
{chr(10).join(world)}
    </div>
  </div>
  <script>
    const D = {dur};
{HELPERS}
{js}
    window.__timelines["{S}"] = tl;
  </script>
</template>
"""


if __name__ == "__main__":
    for n, start, dur in SHOTS:
        meta = json.load(open(f"assets/layers/{n}_meta.json"))
        open(f"compositions/a{n}.html", "w").write(scene_html(n, dur, meta))
        print("wrote", f"compositions/a{n}.html")
