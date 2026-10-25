"""Split a shot into 2.5D layers for cutout animation.

Inputs (per shot n):
  assets/shots/{n}.jpg        the full frame (1080x1920)
  assets/layers/{n}_fg.png    people cutout from `hyperframes remove-background`
  scripts/layers.json         per-shot config: which cutout component is the hero,
                              and puppet parts (polygon + pivot, in 1080x1920 px)

Outputs (assets/layers/):
  {n}_bg.jpg         background plate with every person inpainted out
  {n}_p{k}.png       each extra person as its own full-frame RGBA layer
  {n}_hero.png       the hero with puppet parts removed and the gap filled
  {n}_{part}.png     each puppet part as a full-frame RGBA layer

Usage: python3 scripts/make_layers.py 2 [3 ...]
"""
import json
import sys

import cv2
import numpy as np
from scipy import ndimage

CFG = json.load(open("scripts/layers.json"))


def feather(alpha, r=2):
    return cv2.GaussianBlur(alpha, (0, 0), r) if r else alpha


def poly_mask(shape, pts):
    m = np.zeros(shape, np.uint8)
    cv2.fillPoly(m, [np.array(pts, np.int32)], 255)
    return m


def inpaint(img, mask, radius=9):
    # inpaint at half size for speed, then paste only the masked area back
    h, w = mask.shape
    small = cv2.inpaint(cv2.resize(img, (w // 2, h // 2)), cv2.resize(mask, (w // 2, h // 2)), radius, cv2.INPAINT_TELEA)
    up = cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)
    up = cv2.GaussianBlur(up, (0, 0), 3)
    k = (mask > 0)[..., None]
    return np.where(k, up, img)


def rgba(img, alpha):
    return np.dstack([img, alpha])


def run(n):
    cfg = CFG.get(str(n), {})
    img = cv2.imread(f"assets/shots/{n}.jpg")
    fg = cv2.imread(f"assets/layers/{n}_fg.png", cv2.IMREAD_UNCHANGED)
    alpha = fg[:, :, 3]
    lab, cnt = ndimage.label(alpha > 128)
    sizes = ndimage.sum(alpha > 128, lab, range(1, cnt + 1))
    order = [i + 1 for i in np.argsort(sizes)[::-1] if sizes[i] > cfg.get("min_area", 15000)]
    hero_rank = cfg.get("hero", 0)
    people = []
    for rank, comp in enumerate(order):
        m = ndimage.binary_dilation(lab == comp, iterations=3)
        a = np.where(m, alpha, 0).astype(np.uint8)
        a = cv2.erode(a, np.ones((5, 5), np.uint8))  # trim the light halo the matte leaves
        people.append((rank, a))

    # background: inpaint every person (dilated) out of the plate, plus any image
    # parts (props) that move on their own
    all_people = (alpha > 20).astype(np.uint8) * 255
    if cfg.get("bg_remove") == "hero":
        all_people = (people[hero_rank][1] > 20).astype(np.uint8) * 255
        people = [people[hero_rank]]
    hole = cv2.dilate(all_people, np.ones((31, 31), np.uint8))
    for p in cfg.get("parts", []):
        if p.get("src") == "image" and p.get("inpaint"):
            hole = cv2.max(hole, cv2.dilate(poly_mask(alpha.shape, p["poly"]), np.ones((15, 15), np.uint8)))
    bg = inpaint(img, hole)
    cv2.imwrite(f"assets/layers/{n}_bg.jpg", bg, [cv2.IMWRITE_JPEG_QUALITY, 92])

    meta = {"people": [], "parts": []}
    if "hero_clip" in cfg:
        # split the hero's component: inside the clip is the hero, the rest is other people
        clip = poly_mask(alpha.shape, cfg["hero_clip"])
        a = people[hero_rank][1]
        people[hero_rank] = (hero_rank, cv2.min(a, clip))
        rest = cv2.subtract(a, clip)
        lab2, c2 = ndimage.label(rest > 128)
        props = np.zeros_like(alpha)
        for pp in cfg.get("parts", []):
            if pp.get("src") == "image":
                props = cv2.max(props, cv2.dilate(poly_mask(alpha.shape, pp["poly"]), np.ones((41, 41), np.uint8)))
        for j in range(1, c2 + 1):
            comp = lab2 == j
            if comp.sum() > 6000 and (props[comp] > 0).mean() < 0.5:  # skip props the matte caught
                people.append((100 + j, np.where(ndimage.binary_dilation(lab2 == j, iterations=2), rest, 0).astype(np.uint8)))
    k = 0
    for rank, a in people:
        if rank == hero_rank:
            hero_a = a
            continue
        cv2.imwrite(f"assets/layers/{n}_p{k}.png", rgba(img, feather(a, 1)))
        ys, xs = np.where(a > 128)
        meta["people"].append({"name": f"p{k}", "feet": [int(xs.mean()), int(ys.max())], "box": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]})
        k += 1

    # puppet parts: cut from the hero, then fill the gap they leave in the body
    image_parts = [p for p in cfg.get("parts", []) if p.get("src") == "image"]
    for p in image_parts:
        pm = feather(poly_mask(alpha.shape, p["poly"]), 1.5)
        cv2.imwrite(f"assets/layers/{n}_{p['name']}.png", rgba(img, pm))
    parts = [p for p in cfg.get("parts", []) if p.get("src") != "image"]
    body_img = img.copy()
    body_a = hero_a.copy()
    cut_union = np.zeros_like(hero_a)
    for p in parts:
        pm = poly_mask(hero_a.shape, p["poly"])
        part_a = cv2.min(hero_a, feather(pm, 2))
        cv2.imwrite(f"assets/layers/{n}_{p['name']}.png", rgba(img, part_a))
        cut_union = cv2.max(cut_union, pm)
    if parts:
        body_img = inpaint(img, cv2.dilate(cut_union, np.ones((9, 9), np.uint8)), 7)
        cut_big = cv2.dilate(cut_union, np.ones((11, 11), np.uint8))
        rest = cv2.subtract(hero_a, cut_big)
        # drop slivers the cut leaves behind (thin outlines of the arm)
        rest = cv2.morphologyEx(rest, cv2.MORPH_OPEN, np.ones((9, 9), np.uint8))
        # fill the body back in where the parts covered it (the "fill" polygon is the torso
        # behind the arms), so rotating parts never show a hole
        fill = poly_mask(hero_a.shape, cfg["fill"]) if "fill" in cfg else np.zeros_like(hero_a)
        body_a = cv2.max(rest, cv2.min(fill, cv2.dilate(hero_a, np.ones((25, 25), np.uint8))))
    cv2.imwrite(f"assets/layers/{n}_hero.png", rgba(body_img, feather(body_a, 1)))
    ys, xs = np.where(hero_a > 128)
    meta["hero"] = {"feet": [int(xs.mean()), int(ys.max())], "center": [int(xs.mean()), int(ys.mean())], "box": [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]}
    meta["parts"] = [{k2: p[k2] for k2 in ("name", "pivot", "z", "src") if k2 in p} for p in cfg.get("parts", [])]
    json.dump(meta, open(f"assets/layers/{n}_meta.json", "w"), indent=1)
    print(n, "people:", len(people), "parts:", [p["name"] for p in parts])


if __name__ == "__main__":
    for a in sys.argv[1:]:
        run(int(a))
