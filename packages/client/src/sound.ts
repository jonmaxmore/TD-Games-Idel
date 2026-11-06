// Synthesized sound effects (WebAudio, no files). One context for the app, started on the first user gesture.
// Each kind has a minimum gap, so thirty hits in one tick play as one.
import type { Settings } from './profile';

export type Sfx = 'shoot' | 'hit' | 'death' | 'silver' | 'wave' | 'boss';
// wave: an oscillator, or band-passed noise; the pitch (or filter) sweeps f0 to f1 over dur seconds.
interface Voice { wave: OscillatorType | 'noise'; f0: number; f1: number; dur: number; gain: number; gap: number }
const VOICES: Record<Sfx, Voice> = {
  shoot: { wave: 'square', f0: 880, f1: 440, dur: 0.05, gain: 0.04, gap: 0.07 },
  hit: { wave: 'noise', f0: 2400, f1: 700, dur: 0.06, gain: 0.25, gap: 0.06 },
  death: { wave: 'noise', f0: 1200, f1: 150, dur: 0.2, gain: 0.35, gap: 0.09 },
  silver: { wave: 'triangle', f0: 1320, f1: 1980, dur: 0.09, gain: 0.08, gap: 0.08 },
  wave: { wave: 'sawtooth', f0: 196, f1: 392, dur: 0.45, gain: 0.07, gap: 0.5 },
  boss: { wave: 'sawtooth', f0: 98, f1: 49, dur: 1.0, gain: 0.12, gap: 1.2 },
};

let ctx: AudioContext | null = null;
let out: GainNode | null = null;
let noise: AudioBuffer | null = null;
let settings: Settings = { volume: 70, muted: false, shake: true };
const next = new Map<Sfx, number>();

function unlock() {
  try {
    if (!ctx) {
      ctx = new AudioContext();
      out = ctx.createGain();
      out.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      applyVolume();
    }
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* no audio on this machine: the game stays silent */ }
}

export function initSound(s: Settings): void {
  settings = s;
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);
}

export function applyVolume(): void {
  if (out) out.gain.value = settings.muted ? 0 : settings.volume / 100;
}

// delay in seconds, e.g. the hit lands when the projectile arrives.
export function play(kind: Sfx, delay = 0): void {
  if (!ctx || !out || !noise || ctx.state !== 'running' || settings.muted || settings.volume === 0) return;
  const v = VOICES[kind], t = ctx.currentTime + delay;
  if (t < (next.get(kind) ?? 0)) return;
  next.set(kind, t + v.gap);
  const env = ctx.createGain();
  env.gain.setValueAtTime(v.gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + v.dur);
  env.connect(out);
  let src: AudioScheduledSourceNode;
  if (v.wave === 'noise') {
    const b = ctx.createBufferSource(), f = ctx.createBiquadFilter();
    b.buffer = noise;
    f.type = 'bandpass';
    f.frequency.setValueAtTime(v.f0, t);
    f.frequency.exponentialRampToValueAtTime(v.f1, t + v.dur);
    b.connect(f).connect(env);
    src = b;
  } else {
    const o = ctx.createOscillator();
    o.type = v.wave;
    o.frequency.setValueAtTime(v.f0, t);
    o.frequency.exponentialRampToValueAtTime(v.f1, t + v.dur);
    o.connect(env);
    src = o;
  }
  src.start(t);
  src.stop(t + v.dur + 0.02);
}
