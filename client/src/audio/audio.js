// client/src/audio/audio.js — DISC MAYHEM! procedural audio.
//
// Zero asset files: every sound effect and the background music are synthesized
// live with the Web Audio API, matching the game's all-procedural philosophy.
//
//   import { createAudio } from '/client/src/audio/audio.js';
//   const audio = createAudio();
//   audio.unlock();                  // call on first user gesture (autoplay rule)
//   audio.playMusic('menu' | 'game');
//   audio.sfx.bonk();  audio.sfx.holed(3, 4);  ...
//
// If Web Audio is unavailable the factory returns a no-op stub so the game
// never breaks.

const STORE_KEY = 'discMayhem.audio';

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function createAudio() {
  let ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('no AudioContext');
    ctx = new AC();
  } catch {
    return stub();
  }

  // ---- master bus: compressor -> master gain -> destination -------------
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 24;
  comp.ratio.value = 5;
  comp.attack.value = 0.004;
  comp.release.value = 0.18;

  const master = ctx.createGain();
  const sfxBus = ctx.createGain();
  const musicBus = ctx.createGain();
  sfxBus.gain.value = 0.9;
  musicBus.gain.value = 0.55;
  sfxBus.connect(master);
  musicBus.connect(master);
  master.connect(comp);
  comp.connect(ctx.destination);

  // persisted prefs
  const prefs = loadPrefs();
  master.gain.value = prefs.muted ? 0 : prefs.volume;

  // shared noise buffer (1s of white noise) for percussive/whoosh sounds
  const noiseBuf = (() => {
    const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  })();

  const now = () => ctx.currentTime;

  // ---- low-level voices --------------------------------------------------

  function tone({ freq, type = 'sine', t = now(), dur = 0.2, gain = 0.3,
                  attack = 0.005, slideTo = null, slideDur = null, detune = 0,
                  dest = sfxBus }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (detune) o.detune.setValueAtTime(detune, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + (slideDur || dur));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function noise({ t = now(), dur = 0.2, gain = 0.3, type = 'bandpass',
                   freqStart = 1200, freqEnd = null, q = 1, dest = sfxBus }) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freqStart, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  // ---- sound effects -----------------------------------------------------

  const sfx = {
    click() {
      tone({ freq: 660, type: 'square', dur: 0.06, gain: 0.18, slideTo: 880, slideDur: 0.05 });
    },

    // whoosh of the disc leaving the hand; brighter/longer with power
    throw(power = 0.6) {
      const p = clamp(power, 0.2, 1);
      const t = now();
      noise({ t, dur: 0.26 + p * 0.12, gain: 0.16 + p * 0.16, type: 'bandpass',
              freqStart: 500 + p * 900, freqEnd: 2600 + p * 1600, q: 0.8 });
      tone({ t, freq: 220 + p * 120, type: 'sawtooth', dur: 0.18, gain: 0.05,
             slideTo: 90, slideDur: 0.18 });
    },

    // wooden BONK off a tree
    bonk() {
      const t = now();
      tone({ t, freq: 180, type: 'triangle', dur: 0.16, gain: 0.4, slideTo: 90, slideDur: 0.14 });
      tone({ t, freq: 320, type: 'square', dur: 0.08, gain: 0.12, slideTo: 200, slideDur: 0.08 });
      noise({ t, dur: 0.05, gain: 0.2, type: 'lowpass', freqStart: 1400, q: 0.7 });
    },

    // water splash
    splash() {
      const t = now();
      noise({ t, dur: 0.45, gain: 0.34, type: 'lowpass', freqStart: 3200, freqEnd: 500, q: 0.6 });
      noise({ t: t + 0.02, dur: 0.3, gain: 0.18, type: 'bandpass', freqStart: 1800, freqEnd: 600, q: 2 });
      tone({ t, freq: 600, type: 'sine', dur: 0.18, gain: 0.08, slideTo: 200, slideDur: 0.18 });
    },

    // metallic chains rattle (hit the basket but didn't drop in)
    chains() {
      const t = now();
      for (let i = 0; i < 7; i++) {
        const tt = t + Math.random() * 0.16;
        tone({ t: tt, freq: 1600 + Math.random() * 2200, type: 'square',
               dur: 0.05, gain: 0.06, dest: sfxBus });
      }
      noise({ t, dur: 0.2, gain: 0.08, type: 'highpass', freqStart: 4000, q: 0.5 });
    },

    // soft thud as a disc settles on the ground
    land() {
      const t = now();
      tone({ t, freq: 130, type: 'sine', dur: 0.12, gain: 0.16, slideTo: 70, slideDur: 0.12 });
      noise({ t, dur: 0.06, gain: 0.07, type: 'lowpass', freqStart: 700, q: 0.6 });
    },

    // selecting a power disc (blade/bomb) — a menacing charge-up
    power(type) {
      const t = now();
      if (type === 'blade') {
        tone({ t, freq: 300, type: 'sawtooth', dur: 0.22, gain: 0.16, slideTo: 900, slideDur: 0.2 });
        noise({ t: t + 0.04, dur: 0.18, gain: 0.1, type: 'bandpass', freqStart: 3000, freqEnd: 6000, q: 6 });
      } else {
        tone({ t, freq: 120, type: 'square', dur: 0.3, gain: 0.18, slideTo: 320, slideDur: 0.28 });
        tone({ t: t + 0.05, freq: 90, type: 'sawtooth', dur: 0.26, gain: 0.1, slideTo: 200, slideDur: 0.24 });
      }
    },

    // blade kill — comedic slice + poof
    bladeKill() {
      const t = now();
      noise({ t, dur: 0.12, gain: 0.3, type: 'bandpass', freqStart: 5000, freqEnd: 1500, q: 4 }); // slice
      tone({ t: t + 0.08, freq: 700, type: 'square', dur: 0.22, gain: 0.16, slideTo: 140, slideDur: 0.22 }); // poof drop
      noise({ t: t + 0.08, dur: 0.25, gain: 0.16, type: 'lowpass', freqStart: 1800, freqEnd: 300, q: 0.7 });
    },

    // you got killed — sad descending trombone-ish honk
    death() {
      const t = now();
      const seq = [330, 294, 262, 196];
      seq.forEach((f, i) => tone({ t: t + i * 0.13, freq: f, type: 'sawtooth',
                                   dur: 0.16, gain: 0.16, slideTo: f * 0.97 }));
    },

    // BOOM — big explosion
    bomb() {
      const t = now();
      noise({ t, dur: 0.7, gain: 0.5, type: 'lowpass', freqStart: 1400, freqEnd: 60, q: 0.8 }); // rumble
      noise({ t, dur: 0.12, gain: 0.45, type: 'highpass', freqStart: 2000, q: 0.5 });             // crack
      tone({ t, freq: 140, type: 'sawtooth', dur: 0.5, gain: 0.3, slideTo: 35, slideDur: 0.5 });  // body
      tone({ t, freq: 70, type: 'sine', dur: 0.6, gain: 0.4, slideTo: 28, slideDur: 0.6 });       // sub
    },

    knockback() {
      const t = now();
      noise({ t, dur: 0.3, gain: 0.2, type: 'bandpass', freqStart: 300, freqEnd: 1400, q: 1.2 });
      tone({ t, freq: 120, type: 'triangle', dur: 0.25, gain: 0.12, slideTo: 380, slideDur: 0.22 });
    },

    holeStart() {
      const t = now();
      [0, 4, 7].forEach((s, i) => tone({ t: t + i * 0.06, freq: midi(69 + s),
                                         type: 'triangle', dur: 0.16, gain: 0.12 }));
    },

    // holing out — jingle gets fancier the better the score (strokes vs par)
    holed(strokes, par) {
      const t = now();
      const delta = (strokes ?? par) - par;
      let scale;
      if (strokes === 1) scale = [0, 4, 7, 12, 16, 19, 24]; // ACE — big fanfare
      else if (delta <= -1) scale = [0, 4, 7, 12, 16];       // under par
      else if (delta === 0) scale = [0, 4, 7, 12];           // par
      else scale = [0, 3, 7];                                 // over par (minor-ish)
      const root = 60;
      scale.forEach((s, i) => {
        tone({ t: t + i * 0.085, freq: midi(root + s), type: 'triangle',
               dur: 0.3, gain: 0.16, dest: sfxBus });
        tone({ t: t + i * 0.085, freq: midi(root + s + 12), type: 'sine',
               dur: 0.22, gain: 0.06 });
      });
    },

    countdown() {
      tone({ freq: 880, type: 'square', dur: 0.1, gain: 0.2 });
    },
  };

  // ---- sustained disc-in-flight ambience --------------------------------
  // A looping band-passed noise (air rushing past) plus a faint sine that
  // whistles with the disc's spin. flightUpdate() modulates both by live
  // speed; the blade gets a sharper, meaner whistle.
  let flight = null;

  function flightStart(type = 'driver') {
    if (flight) { flight.type = type; return; }
    const t = now();
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(bp).connect(g).connect(sfxBus);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 500;
    const og = ctx.createGain();
    og.gain.value = 0.0001;
    osc.connect(og).connect(sfxBus);

    src.start(t);
    osc.start(t);
    flight = { src, bp, g, osc, og, type };
  }

  function flightUpdate(speed = 0, height = 0) {
    if (!flight) return;
    const s = clamp(speed / 40, 0, 1);    // ~40 m/s = full intensity
    const air = clamp(height / 6, 0.3, 1); // a touch quieter near the ground
    const t = now();
    flight.bp.frequency.setTargetAtTime(450 + s * 2800, t, 0.05);
    flight.g.gain.setTargetAtTime((0.03 + s * 0.17) * air, t, 0.05);
    flight.osc.frequency.setTargetAtTime(380 + s * 950, t, 0.05);
    const whistle = flight.type === 'blade' ? 0.03 + s * 0.06 : 0.006 + s * 0.018;
    flight.og.gain.setTargetAtTime(whistle * air, t, 0.05);
  }

  function flightStop() {
    if (!flight) return;
    const t = now();
    const f = flight;
    flight = null;
    f.g.gain.setTargetAtTime(0.0001, t, 0.05);
    f.og.gain.setTargetAtTime(0.0001, t, 0.05);
    f.src.stop(t + 0.3);
    f.osc.stop(t + 0.3);
  }

  // ---- procedural background music --------------------------------------
  // A lookahead step-sequencer (see "A Tale of Two Clocks"). Two moods share
  // an engine; each defines tempo, a chord progression, and drum feel.

  const MOODS = {
    menu: {
      bpm: 96,
      // chord roots (midi) per bar — I–V–vi–IV in A
      prog: [57, 64, 54, 50],
      chordType: 'maj',
      drums: false,
      bassType: 'triangle',
      leadType: 'triangle',
      swing: 0.12,
    },
    game: {
      bpm: 134,
      prog: [45, 52, 48, 50, 45, 52, 41, 43], // driving D-ish riff
      chordType: 'maj',
      drums: true,
      bassType: 'sawtooth',
      leadType: 'square',
      swing: 0.0,
    },
  };

  const CHORD = { maj: [0, 4, 7], min: [0, 3, 7] };

  let music = {
    mood: null,
    timer: null,
    step: 0,
    nextTime: 0,
  };

  function scheduleStep(stepAbs, time, mood) {
    const m = MOODS[mood];
    const stepInBar = stepAbs % 16;
    const bar = Math.floor(stepAbs / 16) % m.prog.length;
    const root = m.prog[bar];
    const chord = CHORD[m.chordType];

    // bass — root on the beat, fifth on the &
    if (stepInBar % 4 === 0) {
      tone({ t: time, freq: midi(root - 12), type: m.bassType, dur: 0.26,
             gain: 0.16, dest: musicBus });
    } else if (stepInBar % 4 === 2) {
      tone({ t: time, freq: midi(root - 12 + 7), type: m.bassType, dur: 0.18,
             gain: 0.1, dest: musicBus });
    }

    // arpeggiated lead — chord tones cycling, octave up
    if (stepInBar % 2 === 0) {
      const note = chord[(stepInBar / 2) % chord.length];
      tone({ t: time, freq: midi(root + 12 + note), type: m.leadType, dur: 0.16,
             gain: 0.07, dest: musicBus });
    }

    // soft pad swell at the top of each bar
    if (stepInBar === 0) {
      for (const n of chord) {
        tone({ t: time, freq: midi(root + n), type: 'sine', dur: 0.9,
               gain: 0.035, attack: 0.08, dest: musicBus });
      }
    }

    // drums (game mood only)
    if (m.drums) {
      if (stepInBar % 8 === 0) { // kick
        tone({ t: time, freq: 120, type: 'sine', dur: 0.16, gain: 0.3,
               slideTo: 45, slideDur: 0.16, dest: musicBus });
      }
      if (stepInBar % 8 === 4) { // snare
        noise({ t: time, dur: 0.14, gain: 0.18, type: 'highpass', freqStart: 1800, q: 0.6, dest: musicBus });
        tone({ t: time, freq: 220, type: 'triangle', dur: 0.08, gain: 0.06, dest: musicBus });
      }
      if (stepInBar % 2 === 0) { // hat
        noise({ t: time, dur: 0.03, gain: 0.05, type: 'highpass', freqStart: 7000, q: 0.5, dest: musicBus });
      }
    }
  }

  function pump() {
    const m = MOODS[music.mood];
    const spb = 60 / m.bpm;
    const stepDur = spb / 4; // 16th notes
    while (music.nextTime < now() + 0.12) {
      // light swing on odd 16ths
      const swing = music.step % 2 === 1 ? stepDur * m.swing : 0;
      scheduleStep(music.step, music.nextTime + swing, music.mood);
      music.step++;
      music.nextTime += stepDur;
    }
  }

  function playMusic(mood) {
    if (!MOODS[mood]) return;
    if (music.mood === mood && music.timer) return;
    stopMusic();
    music.mood = mood;
    music.step = 0;
    music.nextTime = now() + 0.06;
    music.timer = setInterval(pump, 25);
  }

  function stopMusic() {
    if (music.timer) clearInterval(music.timer);
    music.timer = null;
  }

  // ---- transport / prefs -------------------------------------------------

  function unlock() {
    if (ctx.state === 'suspended') ctx.resume();
  }

  function applyGain() {
    master.gain.setTargetAtTime(prefs.muted ? 0 : prefs.volume, now(), 0.02);
  }

  function setMuted(v) {
    prefs.muted = !!v;
    applyGain();
    savePrefs();
  }
  function toggleMute() {
    setMuted(!prefs.muted);
    return prefs.muted;
  }
  function setVolume(v) {
    prefs.volume = clamp(v, 0, 1);
    applyGain();
    savePrefs();
  }

  function loadPrefs() {
    const def = { muted: false, volume: 0.8 };
    try {
      return { ...def, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') };
    } catch {
      return def;
    }
  }
  function savePrefs() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
    } catch { /* private mode — ignore */ }
  }

  // Floating speaker button (top-right). Self-contained styling.
  function mountToggle(parent = document.body) {
    const btn = document.createElement('button');
    btn.className = 'audio-toggle';
    btn.title = 'Mute / unmute (M)';
    const paint = () => { btn.textContent = prefs.muted ? '🔇' : '🔊'; };
    paint();
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      unlock();
      toggleMute();
      paint();
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'm' || e.key === 'M') {
        const a = document.activeElement;
        if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
        unlock();
        toggleMute();
        paint();
      }
    });
    parent.append(btn);
    return btn;
  }

  return {
    unlock,
    sfx,
    flightStart,
    flightUpdate,
    flightStop,
    playMusic,
    stopMusic,
    setMuted,
    toggleMute,
    setVolume,
    mountToggle,
    get muted() { return prefs.muted; },
    get ctx() { return ctx; },
  };
}

// No-op fallback so callers never have to null-check.
function stub() {
  const noop = () => {};
  const sfx = new Proxy({}, { get: () => noop });
  return {
    unlock: noop, sfx, flightStart: noop, flightUpdate: noop, flightStop: noop,
    playMusic: noop, stopMusic: noop,
    setMuted: noop, toggleMute: noop, setVolume: noop, mountToggle: noop,
    muted: false, ctx: null,
  };
}
