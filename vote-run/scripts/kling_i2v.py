"""Animate the 10 Pixar-style shots with Kling image-to-video.

Usage:
  python3 scripts/kling_i2v.py            # all shots in scripts/kling_shots.json
  python3 scripts/kling_i2v.py 2 6        # only these shots
  python3 scripts/kling_i2v.py --dry-run  # print what would be sent, spend nothing

Reads KLING_API_KEY (Bearer) and optional KLING_API_BASE_URL
(default https://api-singapore.klingai.com). Writes assets/clips/{n}.mp4.
Standard library only; goes through the session's HTTPS proxy.
"""
import base64
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ.get("KLING_API_BASE_URL", "https://api-singapore.klingai.com").rstrip("/")
CA = "/root/.ccr/ca-bundle.crt"
CTX = ssl.create_default_context(cafile=CA if os.path.exists(CA) else None)


def call(method, path, key, body=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=120) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} on {path}: {e.read().decode()[:600]}")
    if data.get("code") not in (0, None):
        sys.exit(f"Kling error on {path}: {json.dumps(data)[:600]}")
    return data.get("data") or {}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    cfg = json.load(open("scripts/kling_shots.json"))
    shots = [s for s in cfg["shots"] if not args or str(s["n"]) in args]
    key = os.environ.get("KLING_API_KEY")
    if not key and not dry:
        sys.exit("KLING_API_KEY is not set in this session")
    os.makedirs("assets/clips", exist_ok=True)

    tasks = {}
    for s in shots:
        with open(f"assets/shots/{s['n']}.jpg", "rb") as f:
            image = base64.b64encode(f.read()).decode()
        body = {
            "model_name": cfg.get("model", "kling-v3"),
            "image": image,
            "prompt": s["prompt"],
            "negative_prompt": cfg.get("negative_prompt", ""),
            "duration": str(s.get("duration", 5)),
            "mode": cfg.get("mode", "std"),
            "sound": "off",
        }
        if dry:
            print(s["n"], {k: (v if k != "image" else f"<{len(v)} b64 chars>") for k, v in body.items()})
            continue
        d = call("POST", "/v1/videos/image2video", key, body)
        tasks[s["n"]] = d["task_id"]
        print("submitted", s["n"], d["task_id"], flush=True)
    if dry:
        return

    pending = dict(tasks)
    while pending:
        time.sleep(15)
        for n, tid in list(pending.items()):
            d = call("GET", f"/v1/videos/image2video/{tid}", key)
            status = d.get("task_status")
            if status == "succeed":
                url = d["task_result"]["videos"][0]["url"]
                with urllib.request.urlopen(url, context=CTX, timeout=300) as r, open(f"assets/clips/{n}.mp4", "wb") as f:
                    f.write(r.read())
                print("done", n, "->", f"assets/clips/{n}.mp4", flush=True)
                del pending[n]
            elif status == "failed":
                print("FAILED", n, d.get("task_status_msg"), flush=True)
                del pending[n]


if __name__ == "__main__":
    main()
