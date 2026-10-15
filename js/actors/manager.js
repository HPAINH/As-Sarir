import * as THREE from "three";
import { NPC } from "./npc.js";
import { Horse, Animal } from "./horse.js";
import { Group, AnimalBrain } from "../ai/brain.js";
import { SETTLEMENTS, OUTPOSTS, TURCHIDAG, DERBENT, regionAt } from "../world/geo.js";
import { ROAD_LINES, heightAt, sample } from "../world/heightmap.js";
import { mulberry } from "../world/noise.js";

const MOUNT_BREED = { horse_bay: "mountain", horse_black_saddled: "karabakh", horse_grey_persian: "persian" };

export class ActorManager {
  constructor(game) {
    this.game = game;
    this.all = [];
    this.groups = [];
    this.spawned = new Map();
    this.popT = 0;
    this.patrolT = 40;
    this.wildT = 5;
    this.enabled = true;
  }

  onStart(game) {
    this.all.push(game.player);
  }

  add(a) {
    if (!this.all.includes(a)) this.all.push(a);
    this.game.engine.scene.add(a.root);
    a.syncRoot();
    return a;
  }

  remove(a) {
    const i = this.all.indexOf(a);
    if (i >= 0) this.all.splice(i, 1);
    if (a.root.parent) a.root.parent.remove(a.root);
    if (a.kind !== "horse" && a.mount && !a.mount.dead) this.remove(a.mount);
    if (a.camelActor) this.remove(a.camelActor);
    a.removed = true;
  }

  near(x, z, r) {
    const out = [];
    const r2 = r * r;
    for (const a of this.all) {
      const dx = a.pos.x - x, dz = a.pos.z - z;
      if (dx * dx + dz * dz <= r2) out.push(a);
    }
    return out;
  }

  byTag(tag) {
    return this.all.filter(a => a.tags && a.tags.has(tag));
  }

  find(tag) {
    return this.all.find(a => a.tags && a.tags.has(tag) && !a.dead);
  }

  ground(x, z) {
    return this.game.world.ground(x, z);
  }

  async spawnUnit(unitId, x, z, opts = {}) {
    const g = this.game;
    const def = g.data.units[unitId];
    if (!def) { console.warn("unknown unit", unitId); return null; }
    if (def.animal) return this.spawnAnimal(unitId, x, z, opts);
    const n = new NPC(g, unitId, def, opts);
    await n.init();
    n.pos.set(x, this.ground(x, z), z);
    n.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
    n.brain.setHome(n.pos);
    if (opts.state) n.brain.state = opts.state;
    n.brain.defaultState = opts.state || n.brain.state;
    if (opts.spots) n.brain.spots = opts.spots;
    if (opts.hideAt) n.brain.hideAt = opts.hideAt;
    if (opts.group) opts.group.add(n);
    this.add(n);
    if (def.mount && opts.mounted !== false) {
      const h = new Horse(g, { breed: MOUNT_BREED[def.mount] || "mountain", team: n.team });
      await h.init();
      h.pos.copy(n.pos);
      h.yaw = n.yaw;
      this.add(h);
      h.mount(n);
      n.horse = h;
    }
    if (def.camel) {
      const c = new Animal(g, "camel", { name: "Верблюд", animal: "animals/camel_zamburak", hp: 150, team: "persian", role: "mount", speed: 1 }, {});
      await c.init();
      c.team = "persian";
      c.pos.set(x + 1.6, this.ground(x + 1.6, z), z);
      c.yaw = n.yaw;
      this.add(c);
      n.camelActor = c;
      c.camelOf = n;
    }
    if (opts.torch) n.torch = true;
    return n;
  }

  async spawnAnimal(unitId, x, z, opts = {}) {
    const g = this.game;
    const def = g.data.units[unitId];
    const a = new Animal(g, unitId, def, opts);
    await a.init();
    a.pos.set(x, this.ground(x, z), z);
    a.yaw = Math.random() * Math.PI * 2;
    a.brain = new AnimalBrain(a);
    if (opts.tags) for (const t of opts.tags) a.tags.add(t);
    a.persistent = !!opts.persistent;
    this.add(a);
    return a;
  }

  async spawnHorse(breed, x, z, opts = {}) {
    const h = new Horse(this.game, { breed, ...opts });
    await h.init();
    h.pos.set(x, this.ground(x, z), z);
    h.yaw = opts.yaw || 0;
    h.persistent = !!opts.persistent;
    this.add(h);
    return h;
  }

  async spawnGroup(team, spec, cx, cz, opts = {}) {
    const gr = new Group(team, { anchor: [cx, 0, cz], ...opts });
    this.groups.push(gr);
    const list = [];
    for (const [unit, count] of spec) for (let i = 0; i < count; i++) list.push(unit);
    let i = 0;
    const spread = opts.spread || 6;
    const ps = [];
    for (const unit of list) {
      const a = (i / Math.max(1, list.length)) * Math.PI * 2 + Math.random() * 0.4;
      const r = i === 0 ? 0 : spread * (0.5 + Math.random() * 0.6);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      ps.push(this.spawnUnit(unit, x, z, { ...opts.unitOpts, group: gr, state: opts.state || "idle", persistent: opts.persistent,
        origin: opts.origin, torch: opts.torch && i % 2 === 0, yaw: opts.yaw, tags: opts.tags, people: opts.people }));
      i++;
    }
    await Promise.all(ps);
    return gr;
  }

  async spawnGroupNear(n, spec, r) {
    const a = Math.random() * Math.PI * 2;
    const gr = await this.spawnGroup(n.team, spec, n.pos.x + Math.cos(a) * r, n.pos.z + Math.sin(a) * r, { state: "idle" });
    if (n.brain.target) gr.alert(n.brain.target, n);
    return gr;
  }

  despawnKey(key) {
    const rec = this.spawned.get(key);
    if (!rec) return;
    for (const a of rec.actors) if (!a.persistentQuest) this.remove(a);
    this.spawned.delete(key);
  }

  villageControl(s) {
    const st = this.game.state;
    if (st.villages && st.villages[s.id]) return st.villages[s.id];
    return "highlanders";
  }

  async spawnVillage(s) {
    const g = this.game;
    const key = "village:" + s.id;
    if (this.spawned.has(key)) return;
    const V = g.world.statics.villages[s.id];
    if (!V) return;
    const rec = { actors: [], key };
    this.spawned.set(key, rec);
    const ctrl = this.villageControl(s);
    const spots = [V.spots.square, V.spots.spring, V.spots.mosque, ...V.houses.slice(0, 6).map(h => h.door)].filter(Boolean);
    const rnd = mulberry(s.id.length * 999 + Math.floor(g.engine.time));
    const ps = [];
    const nCiv = ctrl === "burned" ? 0 : s.size * 2 + 2 - (ctrl === "persian" ? 2 : 0);
    for (let i = 0; i < nCiv; i++) {
      const h = V.houses[Math.floor(rnd() * V.houses.length)];
      if (!h) break;
      ps.push(this.spawnUnit(rnd() < 0.5 ? "villager_m" : "villager_f", h.door[0], h.door[1], {
        state: "wander", spots, hideAt: h.door, origin: key,
      }).then(n => { n.brain.wanderR = 25; rec.actors.push(n); }));
    }
    if (ctrl === "highlanders") {
      const gr = new Group("highlanders", { anchor: [V.center[0], 0, V.center[1]], tag: key });
      this.groups.push(gr);
      const nG = s.size + 1;
      for (let i = 0; i < nG; i++) {
        const h = V.houses[(i * 3) % Math.max(1, V.houses.length)];
        const p = h ? h.door : V.center;
        ps.push(this.spawnUnit(i % 2 ? "militia_rifle" : "militia_saber", p[0] + 1, p[1] + 1, {
          group: gr, state: "wander", spots, people: s.people, origin: key,
        }).then(n => { n.brain.wanderR = 30; rec.actors.push(n); }));
      }
      if (V.spots.elder) ps.push(this.spawnUnit("elder", V.spots.elder[0], V.spots.elder[1], { state: "idle", origin: key, tags: ["elder:" + s.id] })
        .then(n => { n.talkRole = "elder"; n.village = s.id; rec.actors.push(n); }));
      if (V.spots.merchant) ps.push(this.spawnUnit(s.id === "kubachi" ? "smith" : "merchant", V.spots.merchant[0] + 2, V.spots.merchant[1], { state: "idle", origin: key, tags: ["merchant:" + s.id] })
        .then(n => { n.talkRole = "merchant"; n.village = s.id; n.idleClip = "Talk"; rec.actors.push(n); }));
    } else if (ctrl === "persian") {
      const n = s.size * 3 + 1;
      const spec = [["officer", 1], ["sarbaz", Math.ceil(n * 0.6)], ["jazayerchi", Math.floor(n * 0.4)]];
      const killed = g.state.killed[key] || 0;
      if (killed < n + 1) {
        const gr = await this.spawnGroup("persian", spec, V.center[0], V.center[1], {
          state: "wander", persistent: true, origin: key, spread: V.R * 0.3, torch: true, tag: key, unitOpts: { spots },
        });
        for (const m of gr.members) { m.brain.wanderR = 35; m.brain.spots = spots; rec.actors.push(m); }
        gr.onWiped = () => g.events.emit("villageFreed", s);
      }
    }
    await Promise.all(ps);
  }

  async spawnOutpost(op) {
    const g = this.game;
    const key = "outpost:" + op.id;
    if (this.spawned.has(key) || g.state.outposts[op.id] === "destroyed") return;
    if (!g.world.statics.hasTag(key)) return;
    const rec = { actors: [], key };
    this.spawned.set(key, rec);
    const total = 6;
    const left = total - (g.state.killed[key] || 0);
    if (left <= 0) return;
    const spec = [["officer", 1], ["sarbaz", 3], ["jazayerchi", 2]];
    let n = left;
    const trimmed = spec.map(([u, c]) => { const k = Math.min(c, n); n -= k; return [u, k]; }).filter(([, c]) => c > 0);
    const gr = await this.spawnGroup("persian", trimmed, op.p[0], op.p[1], {
      state: "idle", persistent: true, origin: key, spread: 9, torch: true, tag: key,
    });
    for (const m of gr.members) {
      rec.actors.push(m);
      m.brain.state = Math.random() < 0.5 ? "guard" : "idle";
      m.brain.guardYaw = Math.random() * 6.28;
    }
    gr.onWiped = () => this.game.events.emit("outpostCleared", op);
  }

  async spawnCamp(tag, scale = 1) {
    const g = this.game;
    const key = "garrison:" + tag;
    if (this.spawned.has(key)) return;
    const camp = g.world.statics.camps && g.world.statics.camps[tag];
    if (!camp) return;
    const rec = { actors: [], key };
    this.spawned.set(key, rec);
    const [cx, cz] = camp.c;
    const killed = g.state.killed[key] || 0;
    const base = Math.round(14 * scale);
    if (killed >= base + 8) return;
    const gr = await this.spawnGroup("persian", [["officer", 1], ["sarbaz", Math.round(6 * scale)], ["jazayerchi", Math.round(4 * scale)], ["guard_foot", 2]], cx, cz + 30, {
      state: "wander", persistent: true, origin: key, spread: 30, torch: true, tag: key,
    });
    for (const m of gr.members) { m.brain.wanderR = 50; rec.actors.push(m); }
    for (const [ci, [x, z, yaw]] of camp.cannons.slice(0, 3).entries()) {
      const crew = await this.spawnUnit("artillerist", x - 2.5 * Math.sin(yaw + Math.PI / 2), z - 2.5 * Math.cos(yaw + Math.PI / 2), {
        state: "guard", persistent: true, origin: key, group: gr, tags: ["crew:" + tag],
      });
      crew.cannon = { x, z, yaw, tag, i: ci };
      rec.actors.push(crew);
    }
    for (let k = 0; k < Math.round(2 * scale); k++) {
      const z = await this.spawnUnit("zamburakchi", cx - 50 + k * 25, cz - 55, { state: "guard", persistent: true, origin: key, group: gr });
      rec.actors.push(z);
    }
  }

  async spawnPatrol(near) {
    const g = this.game;
    const p = g.player.pos;
    let best = null;
    for (const rl of ROAD_LINES) {
      for (let i = 0; i < rl.pts.length; i++) {
        const [x, z] = rl.pts[i];
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < 150 || d > 260) continue;
        const reg = regionAt(x, z);
        const ctrl = g.state.regions[reg.id];
        if (ctrl === "highlanders" && !g.state.flags.war_everywhere) continue;
        if (!best || Math.random() < 0.3) best = { rl, i, x, z };
      }
    }
    if (!best) return;
    const night = g.world.sky.isNight;
    const cav = Math.random() < 0.35 && sample(best.x, best.z).M < 0.5;
    const spec = cav ? [["light_cav", 3 + Math.floor(Math.random() * 2)]] : [["officer", 1], ["sarbaz", 2 + Math.floor(Math.random() * 2)], ["jazayerchi", 1]];
    const pts = best.rl.pts;
    const toward = Math.hypot(pts[0][0] - p.x, pts[0][1] - p.z) < Math.hypot(pts[pts.length - 1][0] - p.x, pts[pts.length - 1][1] - p.z);
    const path = toward ? pts.slice(0, best.i + 1).reverse() : pts.slice(best.i);
    const gr = await this.spawnGroup("persian", spec, best.x, best.z, { state: "patrol", torch: night, kind: "patrol", spread: 4 });
    gr.patrol = path.length > 1 ? path : [[p.x, p.z]];
    gr.loop = false;
    const key = "patrol:" + gr.id;
    this.spawned.set(key, { actors: gr.members.slice(), key, patrol: true });
    g.events.emit("patrolSpawned", gr);
  }

  async spawnWildlife() {
    const g = this.game;
    const p = g.player.pos;
    const wild = this.all.filter(a => a.kind === "animal" && !a.dead && a.role !== "companion" && !a.camelOf);
    if (wild.length >= 7) return;
    const a = Math.random() * Math.PI * 2, r = 120 + Math.random() * 90;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (Math.abs(x) > 1980 || Math.abs(z) > 1980) return;
    const s = sample(x, z);
    if (s.village > 0.1 || s.h < 4) return;
    const night = g.world.sky.isNight;
    const forest = g.world.statics.isForest(x, z);
    let unit = null, n = 1;
    if (night && s.M > 0.3 && Math.random() < 0.6) { unit = "wolf"; n = 3; }
    else if (forest && Math.random() < 0.12) unit = "bear";
    else if (s.h > 150 && Math.random() < 0.7) { unit = "tur"; n = 3 + Math.floor(Math.random() * 3); }
    else if (s.h < 150 && Math.random() < 0.5) { unit = "sheep"; n = 5; }
    if (!unit) return;
    const key = "wild:" + Math.round(x) + ":" + Math.round(z);
    const rec = { actors: [], key, wild: true };
    this.spawned.set(key, rec);
    for (let i = 0; i < n; i++) {
      const an = await this.spawnAnimal(unit, x + (Math.random() - 0.5) * 10, z + (Math.random() - 0.5) * 10);
      rec.actors.push(an);
    }
  }

  async population(dt) {
    const g = this.game;
    if (!this.enabled || this.busy) return;
    this.busy = true;
    try {
      const p = g.player.pos;
      for (const s of SETTLEMENTS) {
        const d = Math.hypot(s.p[0] - p.x, s.p[1] - p.z);
        const key = "village:" + s.id;
        if (d < 260) await this.spawnVillage(s);
        else if (d > 380 && this.spawned.has(key)) this.despawnKey(key);
      }
      for (const op of OUTPOSTS) {
        const d = Math.hypot(op.p[0] - p.x, op.p[1] - p.z);
        const key = "outpost:" + op.id;
        if (d < 270) await this.spawnOutpost(op);
        else if (d > 400 && this.spawned.has(key)) this.despawnKey(key);
      }
      const camps = g.world.statics.camps || {};
      for (const tag of Object.keys(camps)) {
        if (!g.world.statics.hasTag(tag)) continue;
        const [cx, cz] = camps[tag].c;
        const d = Math.hypot(cx - p.x, cz - p.z);
        const key = "garrison:" + tag;
        if (d < 300) await this.spawnCamp(tag, tag === "camp:turchidag" ? 1.3 : 1);
        else if (d > 450 && this.spawned.has(key)) this.despawnKey(key);
      }
      for (const [key, rec] of this.spawned) {
        if (!rec.patrol && !rec.wild) continue;
        const alive = rec.actors.filter(a => !a.dead && !a.removed);
        const far = alive.every(a => a.pos.distanceTo(p) > 340);
        if (!alive.length || far) {
          for (const a of rec.actors) if (!a.removed && (a.dead ? a.pos.distanceTo(p) > 120 : true)) this.remove(a);
          this.spawned.delete(key);
        }
      }
      this.patrolT -= dt;
      const patrols = [...this.spawned.values()].filter(r => r.patrol).length;
      if (this.patrolT <= 0 && patrols < 2 && !g.state.flags.no_patrols) {
        this.patrolT = 70 + Math.random() * 60;
        await this.spawnPatrol();
      }
      this.wildT -= dt;
      if (this.wildT <= 0) {
        this.wildT = 12;
        await this.spawnWildlife();
      }
    } finally {
      this.busy = false;
    }
  }

  update(dt) {
    const g = this.game;
    const cam = g.engine.camera.position;
    for (let i = this.all.length - 1; i >= 0; i--) {
      const a = this.all[i];
      if (a.isPlayer) continue;
      if (a.removed) continue;
      const d = a.pos.distanceTo(g.player.pos);
      if (d > 250 && !(a.brain && a.brain.followerOf) && !(a.brain && a.brain.state === "script")) {
        a._skip = ((a._skip || 0) + 1) % 6;
        if (a._skip) continue;
        a.update(dt * 6);
        continue;
      }
      a.update(dt);
    }
    this.popT -= dt;
    if (this.popT <= 0) {
      this.popT = 1.5;
      this.population(1.5);
    }
  }
}
