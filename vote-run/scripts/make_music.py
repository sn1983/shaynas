"""Original action bed for the vote-run film: 150 BPM, D minor, 30 s.

Structure (bar = 1.6 s):
  0.0 - 1.6   riser + pulse intro
  1.6 - 9.6   main groove (kick/snare/hats/bass/stabs)
  9.6 - 11.2  half-bar breakdown before the rooftop jump, impact at 11.2
 11.2 - 25.6  full groove, bigger stabs
 25.6 - 26.4  everything drops, riser
 26.4         final impact, then a low pad tail under the voiceover
Writes assets/audio/music.wav (44.1 kHz stereo).
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 150
BEAT = 60 / BPM
BAR = BEAT * 4
DUR = 30.0
N = int(SR * DUR)
rng = np.random.default_rng(7)

L = np.zeros(N)
R = np.zeros(N)


def add(sig, t, pan=0.0, gain=1.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[: N - i] * gain
    L[i : i + len(sig)] += sig * np.sqrt(0.5 * (1 - pan))
    R[i : i + len(sig)] += sig * np.sqrt(0.5 * (1 + pan))


def env(n, a=0.002, d=0.2):
    t = np.arange(n) / SR
    e = np.minimum(t / a, 1) * np.exp(-t / d)
    return e


def kick(gain=1.0):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 35)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * 9)
    s += 0.3 * rng.standard_normal(n) * np.exp(-t * 300)
    return np.tanh(s * 2.0) * gain


def snare(gain=1.0):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(8) / 8, "same")
    s = noise * np.exp(-t * 18) * 0.8 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.6
    return s * gain


def hat(open_=False, gain=1.0):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = np.diff(np.concatenate([[0], noise]))
    return noise * np.exp(-t * (14 if open_ else 80)) * 0.35 * gain


def saw(freq, n, detune=0.0):
    t = np.arange(n) / SR
    out = np.zeros(n)
    for d in (-detune, 0, detune):
        out += 2 * ((t * freq * (1 + d)) % 1.0) - 1
    return out / 3


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


def note(m):
    return 440 * 2 ** ((m - 69) / 12)


def bass(m, length, gain=1.0):
    n = int(length * SR)
    s = saw(note(m), n, 0.004) + 0.6 * np.sin(2 * np.pi * note(m - 12) * np.arange(n) / SR)
    s = lowpass(s, 700)
    e = env(n, 0.003, length * 0.9)
    return np.tanh(s * 2.2) * e * 0.55 * gain


def stab(chord, length, gain=1.0, cutoff=2600):
    n = int(length * SR)
    s = sum(saw(note(m), n, 0.006) for m in chord) / len(chord)
    s = lowpass(s, cutoff)
    return s * env(n, 0.004, length * 0.5) * 0.5 * gain


def riser(length, gain=1.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    noise = noise - np.convolve(noise, np.ones(4) / 4, "same")
    sweep = np.sin(2 * np.pi * np.cumsum(200 + 1600 * (t / length) ** 2) / SR)
    return (noise * 0.25 + sweep * 0.15) * (t / length) ** 2 * gain


def impact(gain=1.0):
    n = int(2.5 * SR)
    t = np.arange(n) / SR
    f = 30 + 80 * np.exp(-t * 12)
    boom = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    crash = rng.standard_normal(n) * np.exp(-t * 3.5) * 0.35
    crash = crash - np.convolve(crash, np.ones(6) / 6, "same")
    return np.tanh((boom * 1.4 + crash) * 1.5) * gain


def pad(chord, length, gain=1.0):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = sum(np.sin(2 * np.pi * note(m) * t) + 0.3 * np.sin(4 * np.pi * note(m) * t) for m in chord)
    e = np.minimum(t / 0.4, 1) * np.minimum((length - t) / 1.2, 1)
    return s / len(chord) * e * 0.25 * gain


# D minor riff, one root per bar: Dm  Bb  C  A
roots = [38, 34, 36, 33]
chords = [[62, 65, 69], [58, 62, 65], [60, 64, 67], [57, 61, 64]]

# intro: riser + muted pulse
add(riser(BAR, 0.9), 0.0)
for b in range(4):
    add(kick(0.6), b * BEAT)
    add(bass(38, BEAT * 0.45, 0.6), b * BEAT + BEAT / 2)


def groove(bar_start, bars, big=False):
    for k in range(bars):
        t0 = bar_start + k * BAR
        r = roots[k % 4]
        ch = chords[k % 4]
        for b in range(4):
            tb = t0 + b * BEAT
            add(kick(1.0), tb)
            if b in (1, 3):
                add(snare(0.9), tb, pan=0.05)
            for s16 in range(4):
                add(hat(open_=(s16 == 2 and b == 3), gain=0.8 if s16 % 2 == 0 else 0.5), tb + s16 * BEAT / 4, pan=0.35)
            # galloping 16th bass
            for s16, ok in enumerate([1, 0, 1, 1]):
                if ok:
                    add(bass(r, BEAT / 4 * 0.9), tb + s16 * BEAT / 4)
        # stabs on the push (and of 2, and of 4)
        add(stab(ch, BEAT * 0.5, 0.9 if big else 0.7), t0 + BEAT * 1.5, pan=-0.3)
        add(stab(ch, BEAT * 0.5, 0.9 if big else 0.7), t0 + BEAT * 3.5, pan=0.3)
        if big:
            add(stab([m + 12 for m in ch], BEAT * 0.3, 0.45, 4000), t0 + BEAT * 2.75, pan=0.5)
        if k % 4 == 3:  # snare fill
            for s16 in range(4):
                add(snare(0.5 + 0.12 * s16), t0 + 3 * BEAT + s16 * BEAT / 4)


groove(BAR * 1, 5)                      # 1.6 - 9.6
add(riser(BAR, 1.0), BAR * 6)            # 9.6 - 11.2 breakdown
for b in range(2):
    add(kick(0.7), BAR * 6 + b * BEAT * 2)
add(impact(0.9), BAR * 7)               # 11.2 rooftop landing
groove(BAR * 7, 9, big=True)            # 11.2 - 25.6
add(riser(0.8, 1.1), BAR * 16)          # 25.6 - 26.4
add(impact(1.0), 26.4)
add(pad([50, 57, 62, 65], DUR - 26.4, 0.9), 26.4)

mix = np.stack([L, R], axis=1)
# gentle bus glue + master fade
mix = np.tanh(mix * 0.9)
fade = np.ones(N)
fn = int(0.6 * SR)
fade[-fn:] = np.linspace(1, 0, fn)
mix *= fade[:, None]
peak = np.max(np.abs(mix))
mix = mix / peak * 0.89  # about -1 dBFS

out = sys.argv[1] if len(sys.argv) > 1 else "assets/audio/music.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("wrote", out)
