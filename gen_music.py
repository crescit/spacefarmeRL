"""Generate a 2000s JRPG-style background music loop for Space Farmer.

Warm, cozy Harvest Moon-ish town theme — loopable, gentle square/triangle chiptune
on top of a soft pad. Written to sounds/bgm_town.wav (~32s, seamless loop).
"""
import struct, math, io, os

SAMPLE_RATE = 32000  # small, GBA-friendly audio

def write_wav(filename, data):
    buf = io.BytesIO()
    buf.write(b'RIFF')
    buf.write(struct.pack('<I', 36 + len(data)))
    buf.write(b'WAVE')
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))
    buf.write(struct.pack('<H', 1))   # PCM
    buf.write(struct.pack('<H', 1))   # mono
    buf.write(struct.pack('<I', SAMPLE_RATE))
    buf.write(struct.pack('<I', SAMPLE_RATE))
    buf.write(struct.pack('<H', 1))
    buf.write(struct.pack('<H', 8))
    buf.write(b'data')
    buf.write(struct.pack('<I', len(data)))
    buf.write(data)
    with open(filename, 'wb') as f:
        f.write(buf.getvalue())
    print(f'{filename}: {len(data)/SAMPLE_RATE:.1f}s loop')

def note(freq, dur, wave='saw'):
    n = int(dur * SAMPLE_RATE)
    out = []
    for i in range(n):
        t = i / SAMPLE_RATE
        if wave == 'tri':
            v = (2 / math.pi) * math.asin(math.sin(2 * math.pi * freq * t))
        elif wave == 'square':
            v = 0.5 if math.sin(2 * math.pi * freq * t) > 0 else -0.5
        else:  # saw
            v = 2 * ((freq * t) % 1) - 1
        env = min(1.0, t / 0.01) * max(0.0, 1 - t / dur)
        out.append(v * env * 0.9)
    return out

def mix(tracks, dur):
    n = int(dur * SAMPLE_RATE)
    mixbuf = [0.0] * n
    for tr in tracks:
        for i, v in enumerate(tr):
            if i < n:
                mixbuf[i] += v
    return bytes(int(max(-1, min(1, v)) * 127 + 128) for v in mixbuf)

# ── Town theme (B-612 colony) — key of C major, gentle and cozy ──
# BPM ~72 → beat = 0.833s; 8-bar loop, 2 beats/measure
BEAT = 0.833
BARS = 8
LOOP = BARS * 2 * BEAT * 2  # 8 bars * 4 beats * beat = 26.7s

# bass: root movement C - Am - F - G  (I - vi - IV - V)
CHORDS = [
    [130.81, 164.81, 196.00],   # C
    [110.00, 146.83, 174.61],   # Am
    [87.31, 110.00, 130.81],    # F
    [98.00, 123.47, 146.83],    # G
]

# lead melody (playful, Harvest Moon-ish) — quarter notes
MELODY = [
    0, 392, 0, 523.25, 0, 659.25, 0, 523.25,
    0, 349.23, 0, 440, 0, 523.25, 0, 349.23,
    0, 293.66, 0, 349.23, 0, 440, 0, 349.23,
    0, 392, 0, 493.88, 0, 587.33, 0, 392,
]
def melody_track():
    tr = []
    for i, f in enumerate(MELODY):
        tr += note(f, BEAT * 0.9, 'tri') if f else [0.0] * int(BEAT * SAMPLE_RATE)
    return tr

# so a few bars of both parts fit the loop; build per-beat in lockstep
def build():
    nbeats = BARS * 4
    tr_bass = [0.0] * int(nbeats * BEAT * SAMPLE_RATE)
    tr_mel = [0.0] * int(nbeats * BEAT * SAMPLE_RATE)
    si = 0
    for bar in range(BARS):
        chord = CHORDS[bar % 4]
        for beat in range(4):
            start = int((bar * 4 + beat) * BEAT * SAMPLE_RATE)
            n = int(BEAT * SAMPLE_RATE)
            # bass: root on beats 0,2; other chord tones on 1,3
            bfreq = chord[0] / 2 if beat % 2 == 0 else chord[1] / 2
            b = note(bfreq, BEAT, 'saw')
            # melody
            mfreq = MELODY[(bar * 4 + beat) % len(MELODY)]
            m = note(mfreq, BEAT * 0.92, 'tri') if mfreq else [0.0] * n
            if len(m) < n: m = m + [0.0] * (n - len(m))  # pad to beat length
            for i in range(n):
                if start + i < len(tr_bass): tr_bass[start + i] = b[i] * 0.35
                if start + i < len(tr_mel):  tr_mel[start + i] = m[i] * 0.28
    data = mix([tr_bass, tr_mel], nbeats * BEAT + 0.3)
    write_wav('sounds/bgm_town.wav', data)


# ── Ship / cryo theme — softer, airier ambient for the tutorial ship ──
# Slow modal pad (C - G - Am - Em), sparse twinkling lead, gentle 2000s sci-fi-cozy.
SHIP_BEAT = 0.95
def build_ship():
    nbeats = 16
    CHORD = [130.81, 196.00, 110.00, 82.41]   # C G A E roots
    tr_bass = [0.0] * int(nbeats * SHIP_BEAT * SAMPLE_RATE)
    tr_mel = [0.0] * int(nbeats * SHIP_BEAT * SAMPLE_RATE)
    twinkle = [523.25, 0, 659.25, 0, 392, 0, 523.25, 0,
               440, 0, 587.33, 0, 493.88, 0, 659.25, 0]
    for beat in range(nbeats):
        start = int(beat * SHIP_BEAT * SAMPLE_RATE)
        n = int(SHIP_BEAT * SAMPLE_RATE)
        root = CHORD[(beat // 4) % 4]
        b = note(root / 2, SHIP_BEAT * 1.8, 'saw')
        mf = twinkle[beat]
        m = note(mf, SHIP_BEAT, 'tri') if mf else [0.0] * n
        if len(m) < n: m = m + [0.0] * (n - len(m))
        for i in range(n):
            if start + i < len(tr_bass): tr_bass[start + i] = b[i] * 0.26
            if start + i < len(tr_mel):  tr_mel[start + i] = m[i] * 0.24
    data = mix([tr_bass, tr_mel], nbeats * SHIP_BEAT + 0.3)
    write_wav('sounds/bgm_ship.wav', data)


if __name__ == '__main__':
    build()
    build_ship()
    # romance stinger (heart-event jingle)
    rom = mix([note(523.25, 0.22, 'tri'), note(659.25, 0.22, 'tri'), note(783.99, 0.34, 'tri')], 0.78)
    write_wav('sounds/romance.wav', rom)
    print('✅ bgm_town.wav + bgm_ship.wav + romance.wav generated')
