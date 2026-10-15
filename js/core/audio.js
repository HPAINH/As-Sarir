import * as THREE from "three";

const SCALE = [0, 1, 4, 5, 7, 8, 10, 12];
const MINOR = [0, 2, 3, 5, 7, 8, 10, 12];
const MOODS = {
  explore: { tempo: 0.62, drone: 0.5, pluck: 0.55, drums: 0, zurna: 0, root: 50, scale: MINOR },
  tension: { tempo: 0.5, drone: 0.6, pluck: 0.25, drums: 0.35, zurna: 0, root: 48, scale: SCALE },
  battle: { tempo: 0.2, drone: 0.45, pluck: 0, drums: 1, zurna: 0.75, root: 50, scale: SCALE },
  story: { tempo: 0.9, drone: 0.55, pluck: 0.45, drums: 0, zurna: 0, root: 45, scale: MINOR },
  loss: { tempo: 1.2, drone: 0.6, pluck: 0.3, drums: 0, zurna: 0, root: 43, scale: MINOR },
  victory: { tempo: 0.35, drone: 0.5, pluck: 0.6, drums: 0.6, zurna: 0.6, root: 52, scale: [0, 2, 4, 5, 7, 9, 11, 12] },
};
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export class AudioSys {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.mood = "explore";
    this.forced = null;
    this.vol = game.settings ? game.settings.volume : 0.8;
    this.musicVol = game.settings ? game.settings.music : 0.5;
    this.music = true;
    this.moodT = 0;
    this.drumT = 0;
    this.howlT = 30;
    const resume = () => this.ensure();
    window.addEventListener("pointerdown", resume);
    window.addEventListener("keydown", resume);
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const c = this.ctx = new AC();
    this.master = c.createGain();
    this.master.gain.value = this.vol;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain();
    this.sfx.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicVol * 0.55;
    this.musicBus.connect(this.master);
    this.amb = c.createGain();
    this.amb.gain.value = 0.5;
    this.amb.connect(this.master);
    this.verb = c.createConvolver();
    this.verb.buffer = this.impulse(2.8, 2.6);
    this.verbIn = c.createGain();
    this.verbIn.gain.value = 0.5;
    this.verbIn.connect(this.verb).connect(this.sfx);
    this.noiseBuf = this.makeNoise(2);
    this.startAmbient();
    this.layers = {};
    this.startMusic();
    return true;
  }

  impulse(sec, decay) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const echo = (Math.abs(t - 0.18) < 0.01 || Math.abs(t - 0.41) < 0.012) ? 2.2 : 1;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * echo;
      }
    }
    return b;
  }

  makeNoise(sec) {
    const c = this.ctx, n = c.sampleRate * sec;
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  setVolume(v, m) {
    this.vol = v;
    this.musicVol = m;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.1);
    this.musicBus.gain.setTargetAtTime(m * 0.55, this.ctx.currentTime, 0.3);
  }

  spatial(pos, range = 60) {
    const c = this.ctx;
    const out = c.createGain();
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    let gain = 1, cutoff = 18000, p = 0;
    const cam = this.game.engine && this.game.engine.camera;
    if (pos && cam) {
      const dx = pos.x - cam.position.x, dz = pos.z - cam.position.z;
      const d = Math.hypot(dx, dz, (pos.y || 0) - cam.position.y);
      gain = 1 / (1 + Math.pow(d / range, 1.6));
      cutoff = Math.max(900, 18000 / (1 + d / 40));
      const yaw = this.game.rig ? this.game.rig.yaw : 0;
      const ang = Math.atan2(dx, dz) - yaw;
      p = -Math.sin(ang) * Math.min(1, d / 6);
    }
    lp.frequency.value = cutoff;
    out.gain.value = gain;
    if (pan) { pan.pan.value = Math.max(-1, Math.min(1, p)); out.connect(lp).connect(pan).connect(this.sfx); }
    else out.connect(lp).connect(this.sfx);
    return { node: out, gain, lp };
  }

  noise(dest, t, dur, { type = "lowpass", f = 1200, f2 = null, q = 0.8, vol = 1, attack = 0.002, curve = 3 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = c.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    flt.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(g).connect(dest);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
    return g;
  }

  tone(dest, t, dur, { type = "sine", f = 220, f2 = null, vol = 0.5, attack = 0.005, release = null } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (release || dur));
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + (release || dur) + 0.05);
    return o;
  }

  go(pos, range, fn) {
    if (!this.ensure() || this.ctx.state !== "running") return;
    const s = this.spatial(pos, range);
    if (s.gain < 0.01) return;
    fn(this.ctx.currentTime, s.node, s);
  }

  echo(node, amount) {
    const g = this.ctx.createGain();
    g.gain.value = amount;
    node.connect(g).connect(this.verbIn);
  }

  mountainEcho(pos) {
    const t = this.game.world && pos ? this.game.world.terrain.height(pos.x, pos.z) : 0;
    return 0.25 + Math.min(0.6, t / 300);
  }

  gunshot(pos, pistol) {
    this.go(pos, pistol ? 70 : 110, (t, out) => {
      const g = this.noise(out, t, pistol ? 0.28 : 0.45, { f: pistol ? 2600 : 1900, f2: 300, vol: 1, q: 0.7 });
      this.tone(out, t, 0.25, { f: pistol ? 110 : 70, f2: 35, vol: 0.9 });
      this.noise(out, t, 0.04, { type: "highpass", f: 4000, vol: 0.6 });
      this.echo(g, this.mountainEcho(pos));
    });
  }

  cannon(pos, k = 1) {
    this.go(pos, 260, (t, out) => {
      const g = this.noise(out, t, 1.6 * k, { f: 700, f2: 60, vol: 1, q: 0.5, attack: 0.004 });
      this.tone(out, t, 1.2 * k, { f: 55, f2: 25, vol: 1 });
      this.echo(g, 0.8);
    });
  }

  explosion(pos) {
    this.go(pos, 220, (t, out) => {
      const g = this.noise(out, t, 2.2, { f: 900, f2: 50, vol: 1, q: 0.4 });
      this.tone(out, t, 1.5, { f: 48, f2: 22, vol: 1 });
      for (let i = 0; i < 6; i++) this.noise(out, t + 0.2 + Math.random() * 0.9, 0.08, { type: "bandpass", f: 2000 + Math.random() * 2000, vol: 0.3 });
      this.echo(g, 0.9);
    });
  }

  swing(pos) {
    this.go(pos, 18, (t, out) => this.noise(out, t, 0.2, { type: "bandpass", f: 500, f2: 2600, q: 1.6, vol: 0.45, attack: 0.04 }));
  }

  clang(pos) {
    this.go(pos, 40, (t, out) => {
      for (const f of [1870, 2640, 3510, 4730]) this.tone(out, t, 0.6 + Math.random() * 0.4, { type: "sine", f: f * (0.97 + Math.random() * 0.06), vol: 0.18 });
      this.noise(out, t, 0.05, { type: "highpass", f: 3000, vol: 0.5 });
    });
  }

  hit(pos) {
    this.go(pos, 25, (t, out) => {
      this.noise(out, t, 0.12, { f: 600, vol: 0.7 });
      this.tone(out, t, 0.12, { f: 130, f2: 60, vol: 0.6 });
    });
  }

  bow(pos) {
    this.go(pos, 30, (t, out) => {
      this.tone(out, t, 0.25, { type: "triangle", f: 190, f2: 150, vol: 0.4 });
      this.noise(out, t, 0.18, { type: "bandpass", f: 1400, f2: 700, q: 2, vol: 0.25, attack: 0.01 });
    });
  }

  click(pos) {
    this.go(pos, 15, (t, out) => this.noise(out, t, 0.04, { type: "highpass", f: 3500, vol: 0.5 }));
  }

  shout(pos, team, big) {
    this.go(pos, 70, (t, out) => {
      const n = big ? 4 : 1;
      for (let i = 0; i < n; i++) {
        const c = this.ctx, t0 = t + i * 0.07;
        const o = c.createOscillator();
        o.type = "sawtooth";
        const base = (team === "persian" ? 150 : 170) * (0.9 + Math.random() * 0.25);
        o.frequency.setValueAtTime(base, t0);
        o.frequency.linearRampToValueAtTime(base * 1.25, t0 + 0.15);
        o.frequency.linearRampToValueAtTime(base * 0.9, t0 + 0.7);
        const f1 = c.createBiquadFilter(); f1.type = "bandpass"; f1.frequency.value = 750; f1.Q.value = 6;
        const f2 = c.createBiquadFilter(); f2.type = "bandpass"; f2.frequency.value = 1250; f2.Q.value = 7;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.8);
        o.connect(f1).connect(g);
        o.connect(f2).connect(g);
        g.connect(out);
        o.start(t0); o.stop(t0 + 0.85);
      }
    });
  }

  whistle(pos) {
    this.go(pos, 60, (t, out) => {
      this.tone(out, t, 0.25, { f: 1900, f2: 2500, vol: 0.3 });
      this.tone(out, t + 0.32, 0.4, { f: 2100, f2: 2700, vol: 0.3 });
    });
  }

  levelUp() {
    this.go(null, 1, (t, out) => [0, 4, 7, 12].forEach((n, i) => this.pluck(out, t + i * 0.11, mtof(62 + n), 0.35, 0.9)));
  }

  ui(kind) {
    this.go(null, 1, (t, out) => {
      if (kind === "line") return this.tone(out, t, 0.05, { type: "triangle", f: 660, vol: 0.05 });
      if (kind === "quest") return [0, 7].forEach((n, i) => this.pluck(out, t + i * 0.12, mtof(57 + n), 0.3, 1.2));
      if (kind === "done") return [0, 3, 7, 12].forEach((n, i) => this.pluck(out, t + i * 0.09, mtof(57 + n), 0.3, 1.4));
      if (kind === "coin") return this.tone(out, t, 0.15, { type: "triangle", f: 1600, vol: 0.12 });
      if (kind === "reveal") return [0, 5, 10].forEach((n, i) => this.pluck(out, t + i * 0.14, mtof(52 + n), 0.3, 1.6));
      this.tone(out, t, 0.08, { type: "triangle", f: 880, vol: 0.08 });
    });
  }

  play(name, pos) {
    const p = pos || (this.game.player && this.game.player.pos);
    if (name === "horn") return this.go(p, 300, (t, out) => {
      const c = this.ctx;
      for (const m of [1, 1.5]) {
        const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(196 * m, t); o.frequency.linearRampToValueAtTime(220 * m, t + 0.4);
        const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 900;
        const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35 / m, t + 0.4); g.gain.setValueAtTime(0.35 / m, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
        o.connect(f).connect(g).connect(out); o.start(t); o.stop(t + 2.5);
        this.echo(g, 0.8);
      }
    });
    if (name === "rockfall") return this.go(p, 200, (t, out) => {
      const g = this.noise(out, t, 3.2, { f: 400, f2: 80, vol: 1, q: 0.3, attack: 0.3 });
      for (let i = 0; i < 14; i++) this.noise(out, t + Math.random() * 2.6, 0.15, { f: 900, vol: 0.5 });
      this.echo(g, 0.7);
    });
    if (name === "clang") return this.clang(p);
    if (name === "fire") return this.go(p, 50, (t, out) => { for (let i = 0; i < 20; i++) this.noise(out, t + Math.random() * 2, 0.03, { type: "highpass", f: 2500, vol: 0.25 }); this.noise(out, t, 2, { f: 500, vol: 0.3, attack: 0.3 }); });
  }

  pluck(dest, t, f, vol = 0.3, dur = 1.2) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    const o2 = c.createOscillator();
    o2.type = "triangle";
    o2.frequency.value = f * 2.003;
    const flt = c.createBiquadFilter();
    flt.type = "lowpass";
    flt.frequency.setValueAtTime(f * 9, t);
    flt.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur * 0.6);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt); o2.connect(flt);
    flt.connect(g).connect(dest);
    o.start(t); o2.start(t); o.stop(t + dur + 0.05); o2.stop(t + dur + 0.05);
  }

  startAmbient() {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 500;
    f.Q.value = 0.6;
    this.windGain = c.createGain();
    this.windGain.gain.value = 0.05;
    this.windFilter = f;
    src.connect(f).connect(this.windGain).connect(this.amb);
    src.start();
  }

  startMusic() {
    const c = this.ctx;
    const drone = c.createGain();
    drone.gain.value = 0;
    drone.connect(this.musicBus);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    lp.connect(drone);
    this.droneOsc = [];
    for (const [m, det] of [[0, -4], [7, 3], [12, 0]]) {
      const o = c.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = mtof(38 + m);
      o.detune.value = det;
      const g = c.createGain();
      g.gain.value = m === 12 ? 0.12 : 0.22;
      o.connect(g).connect(lp);
      o.start();
      this.droneOsc.push({ o, m });
    }
    this.droneGain = drone;
    this.melodyBus = c.createGain();
    this.melodyBus.gain.value = 0.8;
    this.melodyBus.connect(this.musicBus);
    const mv = c.createGain(); mv.gain.value = 0.25;
    this.melodyBus.connect(mv).connect(this.verbIn);
    this.nextNote = c.currentTime + 0.5;
    this.nextBeat = c.currentTime + 0.5;
    this.step = 0;
    this.deg = 0;
    this.beat = 0;
    setInterval(() => this.schedule(), 90);
  }

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== "running") return;
    const M = MOODS[this.forced || this.mood] || MOODS.explore;
    const now = c.currentTime;
    this.droneGain.gain.setTargetAtTime(M.drone * 0.5, now, 1.5);
    for (const d of this.droneOsc) d.o.frequency.setTargetAtTime(mtof(M.root - 12 + d.m), now, 2);
    while (this.nextNote < now + 0.25) {
      const t = this.nextNote;
      if (M.pluck > 0 && Math.random() < 0.82) {
        this.deg = Math.max(0, Math.min(M.scale.length - 1, this.deg + Math.round((Math.random() - 0.5) * 3.2)));
        const oct = this.step % 16 < 8 ? 12 : 0;
        this.pluck(this.melodyBus, t, mtof(M.root + oct + M.scale[this.deg]), 0.16 * M.pluck, 1.1);
        if (Math.random() < 0.25) this.pluck(this.melodyBus, t + M.tempo / 2, mtof(M.root + oct + M.scale[this.deg]), 0.1 * M.pluck, 0.8);
      }
      if (M.zurna > 0 && this.step % 2 === 0) this.zurna(t, mtof(M.root + 12 + M.scale[(this.step / 2 | 0) % 5 === 4 ? 4 : this.deg]), M.tempo * 1.9, 0.07 * M.zurna);
      this.step++;
      this.nextNote += M.tempo * (0.85 + Math.random() * 0.3);
    }
    while (this.nextBeat < now + 0.25) {
      const t = this.nextBeat;
      if (M.drums > 0) {
        const pat = [1, 0, 0.5, 1, 0, 0.6, 0, 0.4];
        const v = pat[this.beat % 8];
        if (v) this.drum(t, v * M.drums, this.beat % 4 === 0);
      }
      this.beat++;
      this.nextBeat += (this.forced || this.mood) === "battle" ? 0.16 : 0.24;
    }
  }

  drum(t, v, low) {
    const c = this.ctx;
    this.tone(this.musicBus, t, 0.25, { f: low ? 90 : 160, f2: low ? 45 : 90, vol: 0.5 * v });
    this.noise(this.musicBus, t, 0.08, { f: low ? 500 : 1500, vol: 0.18 * v });
  }

  zurna(t, f, dur, vol) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(f * 0.98, t);
    o.frequency.linearRampToValueAtTime(f, t + 0.06);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.5;
    const lg = c.createGain();
    lg.gain.value = f * 0.012;
    lfo.connect(lg).connect(o.frequency);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f * 2.2;
    bp.Q.value = 1.4;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.05);
    g.gain.setValueAtTime(vol, t + dur * 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(bp).connect(g).connect(this.melodyBus);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  setMood(m) {
    this.forced = m === "auto" ? null : m;
    this.forcedT = 0;
  }

  update(dt) {
    const g = this.game;
    if (!this.ctx || !g.player) return;
    this.moodT -= dt;
    if (this.moodT <= 0) {
      this.moodT = 1;
      const p = g.player.pos;
      let m = "explore";
      let fight = false, alert = false;
      for (const a of g.actors.near(p.x, p.z, 70)) {
        if (a.dead || !a.brain || a.team !== "persian") continue;
        if (a.brain.state === "combat") fight = true;
        else if (a.brain.state === "investigate" || a.brain.aw > 0.4) alert = true;
      }
      if (fight) m = "battle";
      else if (alert || (g.player.seenBy || 0) > 0.3) m = "tension";
      if (m !== this.mood) {
        if (m === "explore" && this.mood === "battle") { this.forced = "victory"; this.forcedT = 6; }
        this.mood = m;
      }
      if (this.forced && this.forcedT > 0) { this.forcedT -= 1; if (this.forcedT <= 0) this.forced = null; }
      if (g.cutscene && !g.cutscene.active && this.forced && this.forcedT === 0) this.forced = null;
      const h = g.world.terrain.height(p.x, p.z);
      const wx = g.world.sky.weather;
      const wind = 0.03 + Math.min(0.12, h / 2500) + (wx === "snow" ? 0.06 : wx === "rain" ? 0.05 : 0);
      this.windGain.gain.setTargetAtTime(wind, this.ctx.currentTime, 1.2);
      this.windFilter.frequency.setTargetAtTime(380 + Math.random() * 400, this.ctx.currentTime, 1.5);
      const camps = g.world.statics.camps || {};
      for (const [tag, c] of Object.entries(camps)) {
        if (!g.world.statics.hasTag(tag)) continue;
        const d = Math.hypot(c.c[0] - p.x, c.c[1] - p.z);
        if (d < 260 && Math.random() < 0.6) {
          const pos = new THREE.Vector3(c.c[0], h, c.c[1]);
          this.go(pos, 140, (t, out) => { for (let i = 0; i < 4; i++) { this.tone(out, t + i * 0.22, 0.2, { f: i % 2 ? 140 : 95, f2: 60, vol: 0.5 }); } });
        }
      }
      if (g.world.sky.isNight) {
        this.howlT -= 1;
        if (this.howlT <= 0) {
          this.howlT = 40 + Math.random() * 60;
          const a = Math.random() * 6.28;
          const pos = new THREE.Vector3(p.x + Math.cos(a) * 150, p.y + 30, p.z + Math.sin(a) * 150);
          this.go(pos, 260, (t, out) => { const o = this.tone(out, t, 2.6, { f: 420, vol: 0.25, attack: 0.5 }); o.frequency.linearRampToValueAtTime(620, t + 0.9); o.frequency.linearRampToValueAtTime(480, t + 2.5); });
        }
      }
    }
  }
}
