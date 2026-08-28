"""Generate 80s synthwave music for Space Farmer game"""
import struct, math, io, os, json
import numpy as np

SAMPLE_RATE = 44100
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'sounds')
os.makedirs(OUTPUT_DIR, exist_ok=True)

def write_wav(filename, data):
    buf = io.BytesIO()
    ds = len(data)
    buf.write(b'RIFF')
    buf.write(struct.pack('<I', 36 + ds))
    buf.write(b'WAVE')
    buf.write(b'fmt ')
    buf.write(struct.pack('<I', 16))
    buf.write(struct.pack('<H', 1))    # PCM
    buf.write(struct.pack('<H', 1))    # mono
    buf.write(struct.pack('<I', SAMPLE_RATE))
    buf.write(struct.pack('<I', SAMPLE_RATE))
    buf.write(struct.pack('<H', 1))
    buf.write(struct.pack('<H', 8))
    buf.write(b'data')
    buf.write(struct.pack('<I', ds))
    buf.write(data)
    filepath = os.path.join(OUTPUT_DIR, filename)
    with open(filepath, 'wb') as f:
        f.write(buf.getvalue())
    print(f'{filename}: {len(data)} bytes ({len(data)/SAMPLE_RATE:.1f}s)')
    return filepath

def synth_note(freq, dur, sample_rate=SAMPLE_RATE, amp=0.3):
    """Generate a synth note with 80s sawtooth + PWM character"""
    n = int(dur * sample_rate)
    t = np.arange(n) / sample_rate
    # Classic 80s sawtooth with chorus effect
    saw = 2 * np.pi * freq * t
    wave = (saw % (2 * np.pi)) / np.pi - 1  # sawtooth
    # Add chorus (detuned second oscillator)
    chorus_freq = freq * 1.003  # slight detune
    chorus = ((2 * np.pi * chorus_freq * t) % (2 * np.pi)) / np.pi - 1
    # PWM pulse (square with variable width)
    pwm_freq = freq * 0.5
    pwm_phase = 2 * np.pi * pwm_freq * t
    pulse_width = 0.25 + 0.25 * np.sin(2 * np.pi * 0.25 * t)  # slowly varying
    pulse = np.where(np.sin(pwm_phase) > np.sin(np.pi * (1 - pulse_width)), 1.0, -1.0)
    # Mix
    wave = 0.35 * wave + 0.25 * chorus + 0.25 * pulse
    # Add sub-oscillator (one octave down)
    sub = np.sin(2 * np.pi * (freq * 0.5) * t) * 0.15
    wave += sub
    # Envelope: attack + decay
    env = np.ones(n)
    attack_n = int(0.02 * sample_rate)
    decay_n = int(dur * sample_rate * 0.3)
    env[:attack_n] = np.linspace(0, 1, attack_n)
    env[-decay_n:] = np.linspace(1, 0, decay_n)
    # Filter: gentle low-pass via rolling average
    wave = np.convolve(wave, np.ones(4)/4, mode='same')
    wave *= env * amp
    return (wave * 127 + 128).astype(np.uint8)

def generate_intro():
    """80s synth arpeggio intro — 45 seconds of retro space vibes"""
    notes = []
    # Intro pad chord — Cmaj9#11 (space chord)
    chord_base = [261.63, 329.63, 392.0, 523.25, 659.25]  # C4, E4, G4, C5, E5
    # Pad drone
    for freq in chord_base:
        notes.append((freq, 5.0, 0.12))  # 5 second pad
    
    # Arpeggio pattern — classic 80s rising arp
    arp_notes = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99, 1046.5]  # C major arpeggio up
    arp_notes_down = [1046.5, 783.99, 659.25, 523.25, 392.0, 329.63, 261.63]
    
    for _ in range(3):
        for n in arp_notes:
            notes.append((n, 0.15, 0.08))
        for n in arp_notes_down:
            notes.append((n, 0.15, 0.08))
    
    # Bass line — 80s synth pulse
    bass_pattern = [130.81, 130.81, 146.98, 146.98, 164.81, 164.81, 146.98, 146.98]  # C2, D2, E2, D2
    for _ in range(2):
        for b in bass_pattern:
            notes.append((b, 0.3, 0.15))
    
    # Lead melody — space farmer theme
    melody = [
        392.0, 0.5,  # G4
        523.25, 0.5, # C5
        659.25, 0.5, # E5
        523.25, 0.5, # C5
        392.0, 1.0,  # G4
        261.63, 0.75, # C4
        329.63, 0.25, # E4
        392.0, 1.0,  # G4
        523.25, 0.75, # C5
        659.25, 0.25, # E5
        783.99, 1.5, # G5
        659.25, 0.5, # E5
        523.25, 1.0, # C5
        392.0, 2.0,  # G4
    ]
    mel_idx = 0
    for _ in range(3):
        for i in range(0, len(melody), 2):
            freq = melody[i]
            dur = melody[i+1]
            notes.append((freq, dur, 0.1))
    
    # Generate
    frames = []
    for freq, dur, amp in notes:
        n = int(dur * SAMPLE_RATE)
        frames.append(synth_note(freq, dur, amp=amp))
    
    data = b''.join(frames)
    # Trim to ~45 seconds max
    max_samples = int(45 * SAMPLE_RATE)
    data = data[:max_samples]
    return data

def generate_sfx():
    """Short sound effects"""
    sfx = {}
    # Select sound — rising chime
    sfx['select.wav'] = synth_note(800, 0.08, amp=0.2) + synth_note(1000, 0.08, amp=0.2)
    
    # Confirm — two-tone
    sfx['confirm.wav'] = synth_note(600, 0.1, amp=0.25) + synth_note(900, 0.15, amp=0.25)
    
    # Harvest — sparkly
    h = synth_note(400, 0.08, amp=0.2) + synth_note(500, 0.08, amp=0.2) + synth_note(600, 0.08, amp=0.2)
    sfx['harvest.wav'] = h
    
    # Water — splashy
    sfx['water.wav'] = synth_note(200, 0.15, amp=0.15) + synth_note(250, 0.15, amp=0.1)
    
    # Plant — thump
    sfx['plant.wav'] = synth_note(100, 0.1, amp=0.3)
    
    # Mine — metal hit
    sfx['mine.wav'] = synth_note(150, 0.05, amp=0.4) + synth_note(300, 0.1, amp=0.2)
    
    # Shop bell
    sfx['shop.wav'] = synth_note(800, 0.1, amp=0.2) + synth_note(1000, 0.1, amp=0.2) + synth_note(1200, 0.15, amp=0.2)
    
    # Romance jingle
    r = synth_note(523.25, 0.2, amp=0.2) + synth_note(659.25, 0.2, amp=0.2) + synth_note(783.99, 0.3, amp=0.2)
    sfx['romance.wav'] = r
    
    return sfx

# Generate all audio
print("🎵 Generating Space Farmer audio...")
print("\n--- Intro theme ---")
intro_data = generate_intro()
path = write_wav('intro.wav', intro_data)

print("\n--- Sound effects ---")
sfx = generate_sfx()
paths = {}
for name, data in sfx.items():
    p = write_wav(name, data)
    paths[name] = p

print(f"\n✅ All audio generated at: {OUTPUT_DIR}/")
print(f"   intro.wav: {len(intro_data)/SAMPLE_RATE:.1f}s")

# Output paths for embedding
print("\n--- File paths ---")
print(json.dumps({
    'intro': os.path.join(OUTPUT_DIR, 'intro.wav'),
    'sfx': {k: os.path.join(OUTPUT_DIR, k) for k in sfx.keys()}
}))
