# -*- coding: utf-8 -*-
"""宣传片配乐：62 秒、120 BPM，纯 numpy 合成（无采样、无版权问题）。
小节线与画面切换对齐：4 / 8 / 16 / 28 / 38 / 44 / 54 / 58 秒各有一个转场。输出 promo/out/music.wav"""
import os
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

SR, DUR, BEAT = 44100, 62.0, 0.5
CUTS = ((4, 0.7), (8, 1.0), (16, 0.9), (28, 0.9), (38, 0.7), (44, 0.9), (54, 0.7), (58, 1.0))
FINAL = 29  # bar where the end card lands (58 s)
N = int(SR * DUR)
rng = np.random.default_rng(2027)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
os.makedirs(OUT, exist_ok=True)

def hz(m): return 440.0 * 2 ** ((m - 69) / 12)
def lp(x, f, order=2): return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)
def hp(x, f, order=2): return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)
def bp(x, lo, hi): return sosfilt(butter(2, [lo, hi], "band", fs=SR, output="sos"), x)
def env_adsr(n, a, r):
    e = np.ones(n); na, nr = int(a * SR), int(r * SR)
    if na: e[:na] = np.linspace(0, 1, na)
    if nr: e[-nr:] *= np.linspace(1, 0, nr)
    return e
def put(bus, sig, t):
    i = int(t * SR); j = min(N, i + sig.shape[-1])
    if i < N: bus[:, i:j] += sig[:, : j - i] if sig.ndim == 2 else sig[: j - i]
def stereo(x, pan=0.0):  # pan -1..1, equal power
    a = (pan + 1) * np.pi / 4
    return np.vstack([x * np.cos(a), x * np.sin(a)])

# progression: bars of 2 s.  Am F C G looping, then F → G → C (IV–V–I) landing on the end card at 58 s
CH = {"Am": (45, [57, 60, 64, 67]), "F": (41, [53, 57, 60, 64]), "C": (48, [55, 60, 62, 64]), "G": (43, [55, 59, 62, 67])}
BARS = (["Am", "F", "C", "G"] * 7)[:27] + ["F", "G", "C", "C"]

pad = np.zeros((2, N)); pluck = np.zeros((2, N)); bass = np.zeros((2, N)); drums = np.zeros((2, N)); fx = np.zeros((2, N))

# ---- pad: three detuned saws per note, soft attack, overlapping bars
for b, name in enumerate(BARS):
    root, notes = CH[name]
    t0 = b * 2.0
    if b > FINAL: continue  # the final chord rings through to the end
    length = 2.6 if b < FINAL else DUR - t0
    n = int(length * SR); t = np.arange(n) / SR
    sig = np.zeros(n)
    for m in notes:
        for det, ph in ((-0.07, 0.1), (0.0, 0.5), (0.07, 0.8)):
            f = hz(m + det)
            sig += 2 * ((t * f + ph) % 1.0) - 1
    sig = lp(sig, 1500 if b < FINAL else 2200) * env_adsr(n, 0.35, 0.6) * 0.022
    sig *= 0.6 if b < 2 else 1.0
    put(pad, np.vstack([sig, np.roll(sig, 180)]), t0)

# ---- bass: long notes in the intro, pulsing quarter notes from 8 s
for b, name in enumerate(BARS):
    root, _ = CH[name]; f = hz(root)
    if b > FINAL: continue
    if b < 4 or b == FINAL or 14 <= b < 16:  # long notes in the intro, the reasoning breakdown and the ending
        n = int((2.0 if b < FINAL else DUR - b * 2.0) * SR); t = np.arange(n) / SR
        s = np.sin(2 * np.pi * f * t) * env_adsr(n, 0.2, 0.5) * (0.16 if b >= 2 else 0.10)
        put(bass, stereo(s), b * 2.0)
    else:
        for k in range(4):
            n = int(0.48 * SR); t = np.arange(n) / SR
            s = np.tanh(1.6 * np.sin(2 * np.pi * f * t)) * np.exp(-t / 0.22) * 0.17
            put(bass, stereo(s), b * 2.0 + k * BEAT)

# ---- pluck arpeggio (Karplus–Strong) from 4 s, 8th notes
def ks(f, length=0.6, damp=0.996):
    n = int(length * SR); p = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, p); out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        buf[i % p] = damp * 0.5 * (buf[i % p] + buf[(i + 1) % p])
    return lp(out, 5000)
cache = {}
for b in range(2, FINAL):
    root, notes = CH[BARS[b]]
    seq = [notes[0] + 12, notes[1] + 12, notes[2] + 12, notes[3] + 12, notes[2] + 12, notes[1] + 12, notes[2] + 12, notes[3] + 12]
    for k, m in enumerate(seq):
        if m not in cache: cache[m] = ks(hz(m))
        g = 0.22 if b < 4 else 0.18
        put(pluck, stereo(cache[m] * g, pan=-0.35 if k % 2 else 0.35), b * 2.0 + k * 0.25)

# ---- drums: kick, hat, clap, scene-aware density
def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 45 + 85 * np.exp(-t / 0.035)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.16) * 0.55
def hat():
    n = int(0.06 * SR); t = np.arange(n) / SR
    return hp(rng.uniform(-1, 1, n), 7500) * np.exp(-t / 0.018) * 0.11
def clap():
    n = int(0.22 * SR); t = np.arange(n) / SR
    return bp(rng.uniform(-1, 1, n), 900, 3200) * np.exp(-t / 0.07) * 0.22
K, H, CL = kick(), hat(), clap()
for i in range(int(DUR / BEAT)):
    t = i * BEAT; beat = i % 4
    if 8 <= t < 58:
        four = 16 <= t < 28 or 44 <= t < 54          # agent and submission-details sections drive harder
        breakdown = 28 <= t < 33                     # the reasoning chain: hats only
        if not breakdown and (four or beat in (0, 2)): put(drums, stereo(K), t)
        if four and beat in (1, 3): put(drums, stereo(CL, 0.1), t)
        put(drums, stereo(H, 0.25), t + BEAT / 2)
        if four: put(drums, stereo(H * 0.6, -0.25), t)

# ---- fx: risers into each cut, sub drops on the big ones, chimes on the logo
for cut, size in CUTS:
    n = int(0.9 * SR); t = np.arange(n) / SR
    noise = rng.uniform(-1, 1, n)
    rise = np.zeros(n)
    for seg in range(9):  # sweep the band upward
        a, b2 = seg * n // 9, (seg + 1) * n // 9
        lo = 400 * 1.45 ** seg
        rise[a:b2] = bp(noise, lo, min(lo * 2.2, 16000))[a:b2]
    rise *= (t / t[-1]) ** 2 * 0.10 * size
    put(fx, np.vstack([rise, np.roll(rise, 300)]), cut - 0.9)
    if size >= 0.9:
        n2 = int(1.4 * SR); t2 = np.arange(n2) / SR
        f = 32 + 40 * np.exp(-t2 / 0.12)
        put(fx, stereo(np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t2 / 0.45) * 0.32), cut)
def bell(m, length=2.2, amp=0.08):
    n = int(length * SR); t = np.arange(n) / SR; f = hz(m)
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / (0.9 / r ** .5)) for r, a in ((1, 1), (2.76, .35), (5.4, .12), (8.93, .05)))
    return s * amp * env_adsr(n, 0.003, 0.2)
for t0, m, pan in ((0.62, 81, -0.3), (0.74, 84, 0.3), (0.86, 88, 0)):
    put(fx, stereo(bell(m), pan), t0)
for t0, m, pan in ((58.0, 72, -0.2), (58.08, 76, 0.2), (58.16, 79, 0), (58.24, 86, 0.1)):
    put(fx, stereo(bell(m, 3.6, 0.07), pan), t0)

# ---- room reverb on the melodic buses
ir_n = int(2.4 * SR); ti = np.arange(ir_n) / SR
ir = np.vstack([rng.standard_normal(ir_n), rng.standard_normal(ir_n)]) * np.exp(-ti / 0.55)
ir = np.vstack([lp(ir[0], 6000), lp(ir[1], 6000)]); ir /= np.abs(ir).sum(axis=1, keepdims=True) / 18
wet_src = pad + pluck * 1.2 + fx * 0.6
wet = np.vstack([fftconvolve(wet_src[0], ir[0])[:N], fftconvolve(wet_src[1], ir[1])[:N]])
mix = pad + pluck + bass + drums + fx + wet * 0.22
mix = np.vstack([hp(mix[0], 28), hp(mix[1], 28)])

# ---- master: gentle glue, fades, peak at -1 dBFS
mix = np.tanh(mix * 1.15) / 1.15
fade = np.ones(N); fi = int(0.25 * SR); fo0 = int((DUR - 1.4) * SR)
fade[:fi] = np.linspace(0, 1, fi); fade[fo0:] = np.linspace(1, 0, N - fo0) ** 1.6
mix *= fade
mix *= 10 ** (-1 / 20) / np.abs(mix).max()
wavfile.write(os.path.join(OUT, "music.wav"), SR, (mix.T * 32767).astype(np.int16))
print("music.wav", f"{DUR:.0f}s", "peak -1 dBFS", "rms", f"{20 * np.log10(np.sqrt((mix ** 2).mean())):.1f} dBFS")
