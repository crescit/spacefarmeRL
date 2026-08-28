"""Generate space-themed chiptune WAV sounds"""
import struct, math, io, os

def make_wave(freqs, sample_rate=44100):
    frames = []
    for freq, dur in freqs:
        n = int(dur * sample_rate)
        for i in range(n):
            t = i / sample_rate
            # Square wave + harmonics
            v = 0.5 if math.sin(2 * math.pi * freq * t) > 0 else -0.5
            v += 0.25 * math.sin(2 * math.pi * freq * 2 * t)
            v *= max(0, 1 - t / dur)  # decay
            frames.append(int(v * 127 + 128))
    return bytes(frames)

sounds = {
    'intro.wav': [(200, 0.5), (300, 0.5), (400, 0.5), (500, 0.5), (600, 1.0)],
    'select.wav': [(800, 0.1)],
    'confirm.wav': [(600, 0.15), (800, 0.15)],
    'harvest.wav': [(400, 0.2), (500, 0.2), (600, 0.2)],
    'star.wav': [(1000, 0.05), (1200, 0.05)],
}

os.makedirs('sounds', exist_ok=True)
for name, freqs in sounds.items():
    data = make_wave(freqs)
    buf = io.BytesIO()
    buf.write(b'RIFF')
    ds = len(data)
    buf.write(struct.pack('<I', 36 + ds))
    buf.write(b'WAVE')
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))
    buf.write(struct.pack('<H', 1))    # PCM
    buf.write(struct.pack('<H', 1))    # mono
    buf.write(struct.pack('<I', 44100))
    buf.write(struct.pack('<I', 44100))
    buf.write(struct.pack('<H', 1))
    buf.write(struct.pack('<H', 8))
    buf.write(b'data')
    buf.write(struct.pack('<I', ds))
    buf.write(data)
    with open(f'sounds/{name}', 'wb') as f:
        f.write(buf.getvalue())
    print(f'{name}: {len(data)} bytes audio')

print('Done!')
