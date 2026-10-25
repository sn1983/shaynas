"""Generate a Pixar-style frame with the Gemini image model.

Usage:
  python3 scripts/gemini_image.py <out.png> "<prompt>" [reference.jpg ...]

Reads the key from GEMINI_API_KEY. Uses only the standard library and goes
through the session's HTTPS proxy (CA bundle from /root/.ccr/ca-bundle.crt).
"""
import base64
import json
import mimetypes
import os
import ssl
import sys
import urllib.request

MODEL = os.environ.get("GEMINI_IMAGE_MODEL", "gemini-2.5-flash-image")


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY is not set in this session")
    out, prompt, refs = sys.argv[1], sys.argv[2], sys.argv[3:]

    parts = []
    for ref in refs:
        mime = mimetypes.guess_type(ref)[0] or "image/jpeg"
        with open(ref, "rb") as f:
            parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(f.read()).decode()}})
    parts.append({"text": prompt})
    body = {
        "contents": [{"parts": parts}],
        "generationConfig": {"responseModalities": ["IMAGE"], "imageConfig": {"aspectRatio": "9:16"}},
    }
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    ca = "/root/.ccr/ca-bundle.crt"
    ctx = ssl.create_default_context(cafile=ca if os.path.exists(ca) else None)
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=180) as r:
            data = json.load(r)
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:800]}")

    for cand in data.get("candidates", []):
        for p in cand.get("content", {}).get("parts", []):
            inline = p.get("inlineData") or p.get("inline_data")
            if inline:
                with open(out, "wb") as f:
                    f.write(base64.b64decode(inline["data"]))
                print("wrote", out)
                return
    sys.exit("no image in response: " + json.dumps(data)[:800])


if __name__ == "__main__":
    main()
