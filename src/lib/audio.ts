// Audio system — Web Audio API synthesis, zero dependencies
// Boot sequence sounds, alert beep, Halcyon On+On melody

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// Jawna inicjalizacja — wywołaj z user gesture żeby AudioContext był gotowy
export function initAudio(): Promise<void> {
  const ac = getCtx();
  return ac.state === 'suspended' ? ac.resume() : Promise.resolve();
}

// ── Alert beep ──────────────────────────────────────────────────────────────
export function playBeep(freq = 880, duration = 0.15, type: OscillatorType = 'square') {
  const ac = getCtx();
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.15, ac.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + duration);
  osc.connect(gain).connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + duration);
}

export function playAlertBeep() {
  playBeep(660, 0.1, 'square');
  setTimeout(() => playBeep(440, 0.2, 'square'), 120);
}

// ── Matrix-style keystroke — krótki click z lekkim tonem ─────────────────────
export function playKeystroke() {
  const ac = getCtx();
  const t = ac.currentTime;

  // Noise click — bardzo krótki burst szumu (klawiatura mechaniczna)
  const bufLen = Math.floor(ac.sampleRate * 0.015);
  const buf = ac.createBuffer(1, bufLen, ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) {
    // Szybki decay
    d[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
  }
  const src = ac.createBufferSource();
  src.buffer = buf;

  const hp = ac.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 800 + Math.random() * 2000; // lekka randomizacja tonu
  hp.Q.value = 1;

  const g = ac.createGain();
  g.gain.setValueAtTime(0.08 + Math.random() * 0.04, t); // losowa głośność
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);

  src.connect(hp).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.03);
}

// ── Boot sequence — subtelne potwierdzenie po auth ──────────────────────────
export function playBootSound() {
  const ac = getCtx();
  const t = ac.currentTime;

  // Dwa krótkie tony — "access granted" ping
  const freqs = [523, 784]; // C5, G5
  freqs.forEach((freq, i) => {
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const start = t + i * 0.12;
    g.gain.setValueAtTime(0.1, start);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
    osc.connect(g).connect(ac.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

// ── Halcyon On+On — Orbital (Web Audio synthesis) ───────────────────────────
// Kultowy arpeggio w E-minor + pad synth + bass

let halcyonPlaying = false;
let halcyonStop: (() => void) | null = null;

export function isHalcyonPlaying() { return halcyonPlaying; }

export function stopHalcyon() {
  if (halcyonStop) { halcyonStop(); halcyonStop = null; }
  halcyonPlaying = false;
}

export function playHalcyon() {
  if (halcyonPlaying) return;
  halcyonPlaying = true;

  const ac = getCtx();
  const master = ac.createGain();
  master.gain.value = 0.25;
  master.connect(ac.destination);

  // Reverb (convolver simulation via delay feedback)
  const delay = ac.createDelay();
  delay.delayTime.value = 0.25;
  const feedback = ac.createGain();
  feedback.gain.value = 0.3;
  const delayGain = ac.createGain();
  delayGain.gain.value = 0.2;
  master.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(delayGain);
  delayGain.connect(ac.destination);

  const allNodes: (OscillatorNode | AudioScheduledSourceNode)[] = [];
  let cancelled = false;

  // Note frequencies (MIDI note → Hz)
  const noteHz = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

  // ── Halcyon arpeggio pattern ──
  // E-minor: E3-G3-B3-E4-G4-B4 pattern z charakterystycznym rhythm
  const arpNotes = [
    // Bar 1-2: Em arpeggio
    52, 55, 59, 64, 67, 71, 67, 64,  // E3 G3 B3 E4 G4 B4 G4 E4
    59, 55, 52, 55, 59, 64, 67, 71,  // B3 G3 E3 G3 B3 E4 G4 B4
    // Bar 3-4: Cmaj7
    48, 52, 55, 60, 64, 67, 64, 60,  // C3 E3 G3 C4 E4 G4 E4 C4
    55, 52, 48, 52, 55, 60, 64, 67,  // G3 E3 C3 E3 G3 C4 E4 G4
    // Bar 5-6: Am
    45, 48, 52, 57, 60, 64, 60, 57,  // A2 C3 E3 A3 C4 E4 C4 A3
    52, 48, 45, 48, 52, 57, 60, 64,  // E3 C3 A2 C3 E3 A3 C4 E4
    // Bar 7-8: B (resolve)
    47, 51, 54, 59, 63, 66, 63, 59,  // B2 Eb3 Gb3 B3 Eb4 Gb4 Eb4 B3
    54, 51, 47, 51, 54, 59, 63, 66,  // Gb3 Eb3 B2 Eb3 Gb3 B3 Eb4 Gb4
  ];

  // Pad chord progression: Em → Cmaj7 → Am → B
  const padChords = [
    [52, 55, 59, 64],   // Em: E3 G3 B3 E4
    [48, 52, 55, 59],   // Cmaj7: C3 E3 G3 B3
    [45, 48, 52, 57],   // Am: A2 C3 E3 A3
    [47, 51, 54, 59],   // B: B2 Eb3 Gb3 B3
  ];

  // Bass notes
  const bassNotes = [40, 36, 33, 35]; // E2, C2, A1, B1

  const BPM = 132;
  const sixteenth = 60 / BPM / 4; // ~0.1136s
  const bar = sixteenth * 16;

  function scheduleLoop(startTime: number) {
    if (cancelled) return;

    // Arpeggio — 8 bars (128 sixteenths), repeating 2x for ~30s
    for (let rep = 0; rep < 2; rep++) {
      for (let i = 0; i < arpNotes.length; i++) {
        const t = startTime + rep * (arpNotes.length * sixteenth) + i * sixteenth;
        if (cancelled) return;

        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = noteHz(arpNotes[i]);
        // Soft attack + release
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t + sixteenth * 0.9);

        // Low-pass filter for warmth
        const filter = ac.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 3000;
        filter.Q.value = 2;

        osc.connect(filter).connect(g).connect(master);
        osc.start(t);
        osc.stop(t + sixteenth);
        allNodes.push(osc);
      }
    }

    // Pad — sustained chords, one per 2 bars
    for (let rep = 0; rep < 2; rep++) {
      for (let ci = 0; ci < padChords.length; ci++) {
        const chordStart = startTime + rep * 4 * bar + ci * bar;
        for (const note of padChords[ci]) {
          const osc = ac.createOscillator();
          const g = ac.createGain();
          osc.type = 'sine';
          osc.frequency.value = noteHz(note);
          // Slow swell
          g.gain.setValueAtTime(0, chordStart);
          g.gain.linearRampToValueAtTime(0.06, chordStart + bar * 0.3);
          g.gain.setValueAtTime(0.06, chordStart + bar * 0.7);
          g.gain.exponentialRampToValueAtTime(0.001, chordStart + bar * 0.95);

          osc.connect(g).connect(master);
          osc.start(chordStart);
          osc.stop(chordStart + bar);
          allNodes.push(osc);
        }
      }
    }

    // Bass — sub bass, one per 2 bars
    for (let rep = 0; rep < 2; rep++) {
      for (let bi = 0; bi < bassNotes.length; bi++) {
        const bStart = startTime + rep * 4 * bar + bi * bar;
        const osc = ac.createOscillator();
        const g = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = noteHz(bassNotes[bi]);
        g.gain.setValueAtTime(0, bStart);
        g.gain.linearRampToValueAtTime(0.15, bStart + 0.05);
        g.gain.setValueAtTime(0.15, bStart + bar * 0.8);
        g.gain.exponentialRampToValueAtTime(0.001, bStart + bar * 0.95);

        osc.connect(g).connect(master);
        osc.start(bStart);
        osc.stop(bStart + bar);
        allNodes.push(osc);
      }
    }

    // Loop: schedule next iteration
    const loopDuration = 2 * arpNotes.length * sixteenth;
    const nextLoop = setTimeout(() => scheduleLoop(startTime + loopDuration), (loopDuration - 2) * 1000);

    // Register cleanup
    const origStop = halcyonStop;
    halcyonStop = () => {
      cancelled = true;
      clearTimeout(nextLoop);
      // Fade out
      master.gain.linearRampToValueAtTime(0, ac.currentTime + 1);
      setTimeout(() => {
        allNodes.forEach(n => { try { n.stop(); } catch { /* already stopped */ } });
        master.disconnect();
        delayGain.disconnect();
      }, 1200);
    };
  }

  scheduleLoop(ac.currentTime + 0.1);
}
