// Offline sanity test: renders stations, cues, sfx, engines and ambience into OfflineAudioContexts and
// reports RMS / peak / NaN counts, plus a structural check of generated songs. Used by dev/audio.html.
import { makeNoiseBuffers } from './util.js';
import { createInstruments } from './instruments.js';
import { makeFxSet, Session, SongPlayer } from './sequencer.js';
import { STATIONS, generateSong, barEvents } from './stations.js';
import { CUES } from './cues.js';
import { createSfx } from './sfx.js';
import { makeEngineSound, ENGINE_TYPES } from './engine.js';
import { Ambience } from './ambience.js';

function stats(buf) {
  let sum = 0, peak = 0, nan = 0, n = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) { nan++; continue; }
      sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); n++;
    }
  }
  return { rms: +Math.sqrt(sum / Math.max(1, n)).toFixed(4), peak: +peak.toFixed(3), nan };
}

async function render(seconds, sr, build) {
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  const sys = { ctx, bufs: makeNoiseBuffers(ctx) };
  sys.inst = createInstruments(ctx, sys.bufs);
  const out = ctx.createGain(); out.connect(ctx.destination);
  const extra = await build(sys, out, ctx);
  const t0 = performance.now();
  const buf = await ctx.startRendering();
  return { ...stats(buf), renderMs: Math.round(performance.now() - t0), ...(extra || {}) };
}

function checkSongs(songs = 12) {
  const issues = [];
  let events = 0, bars = 0, secs = 0;
  for (const def of STATIONS) {
    for (let k = 0; k < songs; k++) {
      const plan = generateSong(def, k, 777);
      secs += plan.duration;
      if (plan.duration < 60 || plan.duration > 330) issues.push(`${def.id}#${k} duration ${plan.duration.toFixed(0)}s`);
      for (let b = 0; b < plan.totalBars; b++) {
        const ev = barEvents(def, plan, b);
        bars++; events += ev.length;
        for (const e of ev) {
          const notes = Array.isArray(e.n) ? e.n : [e.n];
          if (!notes.every(Number.isFinite) || !(e.t >= 0 && e.t < 4.5) || !(e.d > 0) || !(e.v > 0 && e.v <= 1.5) || !plan.timbre[e.ch]) {
            issues.push(`${def.id}#${k} bar ${b} bad event ${JSON.stringify(e)}`);
            if (issues.length > 20) return { issues, events, bars };
          }
          if (e.ch === 'lead' || e.ch === 'solo') for (const n of notes) if (n < 48 || n > 96) issues.push(`${def.id} lead out of range ${n}`);
        }
      }
    }
  }
  return { issues: issues.slice(0, 20), events, bars, avgSongSec: Math.round(secs / (STATIONS.length * songs)) };
}

export async function selfTest({ seconds = 6, sr = 22050 } = {}) {
  const res = { songs: checkSongs(), stations: [], cues: [], sfx: [], engines: [], ambience: null };
  for (const def of STATIONS) {
    res.stations.push({ id: def.id, ...await render(seconds, sr, (sys, out) => {
      const fx = makeFxSet(sys.ctx, out);
      const plan = generateSong(def, 0, 4242);
      const ch = plan.sections.find(s => s.type === 'chorus') || plan.sections[0];
      const session = new Session(sys, out, def.g.channels, fx, def.g.insert);
      const src = { beatDur: plan.beatDur, barDur: plan.barDur, totalBars: plan.totalBars, swing: plan.swing, timbre: plan.timbre, barEvents: b => barEvents(def, plan, b) };
      new SongPlayer(sys.inst, session, src, { startBar: ch.start, startTime: 0.02 }).pump(0, seconds);
      return { title: plan.title, artist: plan.artist, bpm: plan.bpm, mode: plan.mode, bars: plan.totalBars, sec: Math.round(plan.duration) };
    }) });
  }
  for (const [name, cue] of Object.entries(CUES)) {
    const secs = Math.min(8, cue.barDur * cue.totalBars + 2);
    res.cues.push({ name, ...await render(secs, sr, (sys, out) => {
      const fx = makeFxSet(sys.ctx, out);
      const session = new Session(sys, out, cue.channels, fx, null);
      new SongPlayer(sys.inst, session, cue, { startBar: cue.loopTo || 0, startTime: 0.02, loop: cue.loop, loopTo: cue.loopTo || 0 }).pump(0, secs);
    }) });
  }
  const LONG = { splash_big: 3.5, stunt: 3, rotor_start: 3.6, kopi_pour: 2.5, flyer_chime: 3, explosion: 3.5, thunder: 5, wasted: 4.5, busted: 3.5, mission_failed: 3.5, mission_start: 2.5, phone_ring: 3, crowd_cheer: 3.5, applause: 3.5, crash_heavy: 2, splash: 2, engine_start: 2 };
  const probe = await render(0.1, sr, sys => ({ names: Object.keys(createSfx(sys)) }));
  for (const name of probe.names) {
    if (name === 'mission_passed') continue;
    res.sfx.push({ name, ...await render(LONG[name] || 1.5, sr, (sys, out) => { createSfx(sys)[name](out, 0.01, {}); }) });
  }
  for (const type of Object.keys(ENGINE_TYPES)) {
    res.engines.push({ type, ...await render(2, sr, (sys, out) => {
      const e = makeEngineSound(sys.ctx, sys.bufs, out, type, { water: true });
      e.update({ rpm: 0.6, throttle: 0.8, speed: 15, position: { x: 2, y: 0, z: -4 }, skid: 0.3, siren: type === 'police' });
    }) });
  }
  res.ambience = await render(3, sr, (sys, out) => {
    sys.ambIn = out;
    const a = new Ambience(sys);
    a.update(0.016, { rain: 0.8, night: 0.7, nearWater: 1, time: 22, listenerPos: { x: 0, y: 0, z: 0 } });
    a.frog(); a.koel(); a.myna(); a.sunbird();
  });
  return res;
}

/** Solo-renders each channel of a station's first chorus to inspect the mix balance. */
export async function channelBalance(stationId, { seconds = 6, sr = 22050 } = {}) {
  const def = STATIONS.find(s => s.id === stationId);
  const out = {};
  for (const solo of Object.keys(def.g.channels)) {
    const r = await render(seconds, sr, (sys, dest) => {
      const fx = makeFxSet(sys.ctx, dest);
      const plan = generateSong(def, 0, 4242);
      const ch = plan.sections.find(s => s.type === 'chorus') || plan.sections[0];
      const session = new Session(sys, dest, def.g.channels, fx, def.g.insert);
      for (const [name, g] of Object.entries(session.ch)) if (name !== solo) g.gain.value = 0;
      const src = { beatDur: plan.beatDur, barDur: plan.barDur, totalBars: plan.totalBars, swing: plan.swing, timbre: plan.timbre, barEvents: b => barEvents(def, plan, b) };
      new SongPlayer(sys.inst, session, src, { startBar: ch.start, startTime: 0.02 }).pump(0, seconds);
    });
    out[solo] = `${r.rms}/${r.peak}`;
  }
  return out;
}
