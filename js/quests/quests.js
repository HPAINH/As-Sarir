import * as THREE from "three";
import { resolveLoc, fmt, homeId, nearbyVillages } from "./locs.js";
import { settlement, SETTLEMENTS, REGIONS, TURCHIDAG, PEOPLES, OUTPOSTS, HOMES, nodePos } from "../world/geo.js";
import { ROAD_LINES } from "../world/heightmap.js";

const ACT_SEASON = { 0: "summer", 1: "summer", 2: "summer", 3: "autumn", 4: "winter", 5: "spring" };
const RELIC_NAMES = { 1: "Подлокотник льва", 2: "Спинка с орнаментом", 3: "Ножка-барс", 4: "Венец трона" };
const DEFAULT_TEXT = {
  goto: "Доберитесь до отметки", fight: "Разбейте врага", escort: "Доведите людей до места", collect: "Найдите вещь",
  interact: "Выполните задуманное", ride: "Скачите к отметке", mount: "Поймайте коня", chase: "Догоните беглеца",
  talk: "Поговорите", unity: "Соберите народы в союз", wait: "Ждите",
};

function roadGraph() {
  const adj = new Map();
  for (const rl of ROAD_LINES) {
    if (!adj.has(rl.a)) adj.set(rl.a, []);
    if (!adj.has(rl.b)) adj.set(rl.b, []);
    adj.get(rl.a).push({ to: rl.b, pts: rl.pts });
    adj.get(rl.b).push({ to: rl.a, pts: rl.pts.slice().reverse() });
  }
  return adj;
}
const GRAPH = roadGraph();

function nearestNode(x, z) {
  let best = null, bd = Infinity;
  for (const id of GRAPH.keys()) {
    const p = nodePos(id);
    const d = Math.hypot(p[0] - x, p[1] - z);
    if (d < bd) { bd = d; best = id; }
  }
  return best;
}

export function roadPath(a, b) {
  const pa = resolveLocStatic(a), pb = resolveLocStatic(b);
  const na = nearestNode(pa[0], pa[1]), nb = nearestNode(pb[0], pb[1]);
  const prev = new Map([[na, null]]);
  const queue = [na];
  while (queue.length) {
    const id = queue.shift();
    if (id === nb) break;
    for (const e of GRAPH.get(id) || []) if (!prev.has(e.to)) { prev.set(e.to, { from: id, pts: e.pts }); queue.push(e.to); }
  }
  const segs = [];
  let cur = nb;
  while (cur && prev.get(cur)) { segs.unshift(prev.get(cur).pts); cur = prev.get(cur).from; }
  const pts = [pa];
  for (const s of segs) pts.push(...s.slice(1));
  pts.push(pb);
  return densify(pts, 22);
}

function resolveLocStatic(p) {
  return Array.isArray(p) ? p : [p.x, p.z];
}

function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
  }
  return out;
}

class Job {
  constructor(def, kind) {
    this.def = def;
    this.kind = kind;
    this.i = 0;
    this.actors = [];
    this.objs = [];
    this.st = null;
    this.ready = false;
    this.token = 0;
    this.failed = false;
  }
  tagged(tag) {
    return this.actors.filter(a => a.qtag === tag && !a.removed);
  }
}

export class Quests {
  constructor(game) {
    this.game = game;
    this.job = null;
    this.byId = {};
    this.main = [];
    this.sides = [];
    this.giver = null;
    this.giverObj = null;
    this.relicT = 0;
    this.fxT = 0;
  }

  async onStart() {
    const g = this.game, st = g.state;
    this.init();
    (g.playing || Promise.resolve()).then(() => this.resume());
  }

  init() {
    const g = this.game, st = g.state;
    this.main = g.data.missions.main;
    this.sides = g.data.missions.side;
    for (const m of [...this.main, ...this.sides]) this.byId[m.id] = m;
    st.villages = st.villages || {};
    st.side = st.side || {};
    g.ui.addMarkers(() => this.markers());
    g.events.on("playerDied", e => this.onPlayerDied(e));
    g.events.on("outpostCleared", op => this.onOutpost(op));
    g.events.on("villageFreed", s => this.onVillageFreed(s));
    g.events.on("spotted", e => this.onSpotted(e));
    g.events.on("mounted", h => { if (this.job && this.job.st) this.job.st.mounted = h; });
    g.events.on("kill", e => this.onKill(e));
    this.applyDifficulty();
  }

  resume() {
    const g = this.game, st = g.state;
    if (st.missions.active && st.missions.done.includes(st.missions.active)) st.missions.active = null;
    const active = st.missions.active;
    if (active && this.byId[active]) {
      const def = this.byId[active];
      const cp = this.checkpoint(def, st.missions.objective || 0);
      setTimeout(() => this.begin(def, cp, true), 600);
    } else setTimeout(() => this.autoNext(), 800);
  }

  checkpoint(def, i) {
    for (let k = Math.min(i, def.steps.length - 1); k > 0; k--) if (def.steps[k].checkpoint) return k;
    return 0;
  }

  nextMain() {
    const done = this.game.state.missions.done;
    return this.main.find(m => !done.includes(m.id)) || null;
  }

  available(def) {
    const st = this.game.state;
    if (st.missions.done.includes(def.id)) return false;
    for (const r of def.req || []) if (!st.missions.done.includes(r)) return false;
    if (def.cond && !this.cond(def.cond)) return false;
    return true;
  }

  autoNext() {
    const g = this.game;
    if (this.job || g.state.missions.active) return;
    const next = this.nextMain();
    this.clearGiver();
    if (!next) { g.ui.hud.setObjective(null); return; }
    if (!this.available(next)) {
      g.ui.hud.setObjective("Свободная игра", next.wait || "Помогайте народам и готовьтесь к следующему заданию");
      return;
    }
    if (next.auto) { this.begin(next, 0); return; }
    g.ui.hud.setObjective(next.title, fmt(g, next.hint || "Отправляйтесь к отметке, чтобы начать"));
    this.placeGiver(next);
  }

  async placeGiver(def) {
    const g = this.game;
    const at = resolveLoc(g, def.start || "home:square");
    if (!at) return;
    this.giverDef = def;
    this.giverAt = at;
    this.giverObj = g.interact.register({
      x: at.x, z: at.z, r: 4, tag: "quest-giver",
      label: () => `Начать: «${def.title}»`,
      act: () => this.begin(def, 0),
    });
  }

  clearGiver() {
    const g = this.game;
    if (this.giverObj) g.interact.unregister(this.giverObj);
    this.giverObj = null;
    this.giverDef = null;
  }

  async begin(def, from = 0, resumed = false) {
    const g = this.game, st = g.state;
    if (this.job) return;
    this.clearGiver();
    const job = new Job(def, def.side ? "side" : "main");
    this.job = job;
    st.missions.active = def.id;
    job.i = from;
    if (from === 0 && def.set) await this.apply(def.set);
    if (resumed && def.set) await this.apply({ ...def.set, teleport: undefined });
    if (!resumed || from === 0) {
      g.ui.toast(`${def.side ? "Поручение" : "Задание " + (def.n || "")}: «${def.title}»`, "quest");
      g.audio.ui("quest");
    }
    if (def.followers) for (const f of def.followers) await this.spawn(job, { ...f, follow: true });
    if (resumed) while (job.i < def.steps.length && def.steps[job.i].type === "cutscene") {
      if (def.steps[job.i].do) await this.apply(def.steps[job.i].do);
      job.i++;
    }
    this.runStep();
  }

  async runStep() {
    const g = this.game, job = this.job;
    if (!job) return;
    const def = job.def;
    while (job.i < def.steps.length && def.steps[job.i].if && !this.cond(def.steps[job.i].if)) job.i++;
    if (job.i >= def.steps.length) return this.complete();
    const s = def.steps[job.i];
    g.state.missions.objective = job.i;
    job.st = { t: 0 };
    job.ready = false;
    const token = ++job.token;
    const text = s.text !== undefined ? s.text : DEFAULT_TEXT[s.type];
    if (text) g.ui.hud.setObjective(def.title, fmt(g, text));
    if (s.say) g.ui.subtitle(fmt(g, s.say), 6);
    try {
      if (s.do) await this.apply(s.do);
      const h = H[s.type];
      if (!h) { console.warn("step type", s.type); return this.next(token); }
      if (h.start) await h.start(this, job, s, job.st);
    } catch (e) {
      console.error("quest step", def.id, job.i, e);
    }
    if (this.job !== job || job.token !== token) return;
    job.ready = true;
    if (job.st.done) this.next(token);
  }

  next(token) {
    const job = this.job;
    if (!job || (token !== undefined && token !== job.token)) return;
    const s = job.def.steps[job.i];
    if (s && s.after) this.apply(s.after);
    this.cleanupStep(job);
    job.i++;
    job.token++;
    this.runStep();
  }

  cleanupStep(job) {
    const g = this.game;
    for (const o of job.objs) g.interact.unregister(o);
    job.objs = [];
    if (job.st && job.st.boss) g.ui.hud.boss(null);
    if (job.st && job.st.unsub) job.st.unsub.forEach(f => f());
    for (const a of job.actors) if (a.stepOnly && !a.removed) { g.actors.remove(a); }
    job.actors = job.actors.filter(a => !a.removed);
  }

  cleanupJob(job) {
    const g = this.game;
    this.cleanupStep(job);
    for (const a of job.actors) {
      if (a.removed || a.keep) continue;
      if (a.dead && a.pos.distanceTo(g.player.pos) < 60) continue;
      g.actors.remove(a);
    }
    job.actors = [];
    g.ui.hud.boss(null);
  }

  async complete() {
    const g = this.game, st = g.state, job = this.job;
    if (!job) return;
    const def = job.def;
    this.job = null;
    try { this.cleanupJob(job); } catch (e) { console.error(e); }
    st.missions.active = null;
    st.missions.objective = 0;
    if (!st.missions.done.includes(def.id)) st.missions.done.push(def.id);
    if (def.side) st.side[def.id] = "done";
    st.stats.missions++;
    if (def.done) await this.apply(def.done);
    if (def.reward) await this.apply(def.reward);
    const rw = def.reward || {};
    const parts = [];
    if (rw.xp) parts.push(`опыт +${rw.xp}`);
    if (rw.coins) parts.push(`монеты +${rw.coins}`);
    g.ui.toast(`Выполнено: «${def.title}»${parts.length ? " · " + parts.join(", ") : ""}`, "good");
    g.audio.ui("done");
    if (def.side) this.checkUnity(def);
    g.events.emit("missionDone", def);
    g.save && g.save.auto("mission");
    setTimeout(() => this.autoNext(), def.auto_next === false ? 4000 : 1500);
  }

  checkUnity(def) {
    const g = this.game, st = g.state;
    const p = def.people;
    if (!p) return;
    const chain = this.sides.filter(s => s.people === p);
    if (chain.every(s => st.missions.done.includes(s.id)) && !st.unity.includes(p)) {
      st.unity.push(p);
      const P = g.data.peoples[p];
      g.ui.toast(`${P.name} вступают в союз! Единство: ${st.unity.length}/9`, "good");
      g.ui.subtitle(`<b>${P.name}</b> присылают ополчение. Теперь можно нанимать: ${P.unit.name}.`, 7);
      g.chronicle && g.chronicle.unlock("people_" + p);
      g.events.emit("unity", p);
    }
  }

  async fail(reason) {
    const g = this.game, job = this.job;
    if (!job || job.failed) return;
    job.failed = true;
    const def = job.def;
    const s = def.steps[job.i] || {};
    if (s.onFail === "continue") {
      job.failed = false;
      if (s.failDo) await this.apply(s.failDo);
      g.ui.toast(fmt(g, s.failText || reason), "bad");
      return this.next();
    }
    g.ui.toast(`Задание провалено: ${reason}`, "bad");
    g.ui.subtitle(`<b>«${def.title}»</b> — ${reason}. Повтор с последней точки.`, 5);
    const cp = this.checkpoint(def, job.i);
    this.cleanupJob(job);
    this.job = null;
    g.state.missions.active = def.id;
    g.state.missions.objective = cp;
    if (!g.player.dead) setTimeout(() => this.retry(def, cp), 3500);
  }

  async retry(def, cp) {
    const g = this.game;
    if (this.job) return;
    const s = def.steps[cp];
    const at = s && s.at ? resolveLoc(g, s.at) : null;
    if (def.retryAt || at) {
      const p = resolveLoc(g, def.retryAt || s.at);
      if (p && g.player.pos.distanceTo(new THREE.Vector3(p.x, g.player.pos.y, p.z)) > 120) await this.teleport(def.retryAt || s.at, 30);
    }
    if (def.set) await this.apply({ ...def.set, teleport: undefined });
    this.begin(def, cp, true);
  }

  abandon() {
    const job = this.job;
    if (!job) return;
    if (!job.def.side && job.def.linear) { this.game.ui.toast("Это задание нельзя прервать"); return; }
    this.cleanupJob(job);
    this.job = null;
    this.game.state.missions.active = null;
    if (job.def.side) delete this.game.state.side[job.def.id];
    this.game.ui.toast(`Задание отложено: «${job.def.title}»`);
    setTimeout(() => this.autoNext(), 500);
  }

  async onPlayerDied() {
    const g = this.game;
    if (this.job) this.fail("герой пал");
    g.ui.show("death");
  }

  async respawn() {
    const g = this.game, p = g.player;
    const st = g.state;
    let at = null;
    const pend = st.missions.active && this.byId[st.missions.active];
    if (pend) {
      const s = pend.steps[st.missions.objective || 0];
      at = pend.retryAt || (s && s.at) || null;
    }
    p.dead = false;
    p.hp = p.maxHp;
    p.stamina = p.maxStamina;
    if (p.mixer) p.mixer.stopAllAction();
    p.current = null;
    p.oneShot = null;
    p.loop("Idle", 0);
    st.res.coins = Math.max(0, Math.round(st.res.coins * 0.9));
    await this.teleport(at || "home:square", at ? 35 : 6);
    for (const a of g.actors.near(p.pos.x, p.pos.z, 60)) if (a.brain && a.team === "persian" && !a.dead) { a.brain.state = a.brain.defaultState || "idle"; a.brain.target = null; a.brain.aw = 0; }
    if (pend && !this.job) this.retry(pend, st.missions.objective || 0);
  }

  async teleport(spec, off = 0) {
    const g = this.game, p = g.player;
    const at = resolveLoc(g, spec);
    if (!at) return;
    const a = Math.random() * Math.PI * 2;
    const x = at.x + Math.sin(a) * off, z = at.z + Math.cos(a) * off;
    if (p.mount) p.mount.dismount();
    await g.world.terrain.whenReady(x, z);
    p.pos.set(x, g.world.ground(x, z) + 0.2, z);
    p.vel.set(0, 0, 0);
    if (g.playerHorse && !g.playerHorse.dead) {
      g.playerHorse.pos.set(x + 3, g.world.ground(x + 3, z + 2), z + 2);
    }
    for (const m of g.squad.alive()) m.pos.set(x - 2 + Math.random() * 4, g.world.ground(x, z), z - 2 + Math.random() * 4);
    if (g.squad.dog) g.squad.dog.pos.set(x - 2, g.world.ground(x - 2, z), z);
  }

  cond(c) {
    const g = this.game, st = g.state;
    if (!c) return true;
    if (Array.isArray(c)) return c.every(x => this.cond(x));
    if (c.not) return !this.cond(c.not);
    if (c.any) return c.any.some(x => this.cond(x));
    if (c.choice) return Object.entries(c.choice).every(([k, v]) => Array.isArray(v) ? v.includes(st.choices[k]) : st.choices[k] === v);
    if (c.flag) return !!st.flags[c.flag] === (c.value !== false);
    if (c.unity !== undefined) return st.unity.length >= c.unity;
    if (c.unityLess !== undefined) return st.unity.length < c.unityLess;
    if (c.relic) return Object.entries(c.relic).every(([k, v]) => st.relics[k] === v);
    if (c.people) return [].concat(c.people).includes(st.people);
    if (c.done) return [].concat(c.done).every(id => st.missions.done.includes(id));
    if (c.mounted) return !!g.player.mount;
    if (c.inUnity) return st.unity.includes(c.inUnity);
    return true;
  }

  async apply(o) {
    const g = this.game, st = g.state;
    if (!o) return;
    if (o.act !== undefined) {
      st.act = o.act;
      if (o.season === undefined && ACT_SEASON[o.act] !== st.season) { st.season = ACT_SEASON[o.act]; g.world.setSeason(st.season); }
    }
    if (o.season) { st.season = o.season; g.world.setSeason(o.season); }
    if (o.weather) { st.weather = o.weather; g.world.sky.setWeather(o.weather); }
    if (o.hours !== undefined) { g.world.sky.hours = o.hours; st.hours = o.hours; }
    if (o.regions) for (const [k, v] of Object.entries(o.regions)) st.regions[k] = v;
    if (o.villages) for (const [k, v] of Object.entries(o.villages)) {
      const id = k === "home" ? homeId(g) : k.startsWith("nearby") ? (nearbyVillages(g)[(+k.slice(6) || 1) - 1] || {}).id : k;
      if (!id || (v === "persian" && id === homeId(g) && !o.forceHome)) continue;
      st.villages[id] = v;
      g.actors.despawnKey("village:" + id);
    }
    if (o.set) for (const [k, v] of Object.entries(o.set)) st.flags[k] = v;
    if (o.choice) for (const [k, v] of Object.entries(o.choice)) st.choices[k] = v;
    if (o.coins) st.res.coins = Math.max(0, st.res.coins + o.coins);
    if (o.give) for (const [k, v] of Object.entries(o.give)) st.res[k] = Math.max(0, (st.res[k] || 0) + v);
    if (o.rep) for (const [k, v] of Object.entries(o.rep)) {
      const id = k === "home" ? st.people : k;
      st.reputation[id] = Math.max(-100, Math.min(100, (st.reputation[id] || 0) + v));
    }
    if (o.items) for (const it of o.items) if (!st.items.includes(it)) {
      st.items.push(it);
      if (it === "shepherd_dog" && !g.squad.dog) await g.squad.spawnDog();
    }
    if (o.weapons) for (const w of o.weapons) if (!st.weapons.includes(w)) st.weapons.push(w);
    if (o.armor) st.armor = o.armor;
    if (o.relic) for (const [k, v] of Object.entries(o.relic)) this.setRelic(+k, v);
    if (o.unity) for (const p of [].concat(o.unity)) if (!st.unity.includes(p)) { st.unity.push(p); g.events.emit("unity", p); }
    if (o.xp) g.progress.addXp(o.xp);
    if (o.chronicle) for (const id of [].concat(o.chronicle)) g.chronicle && g.chronicle.unlock(id);
    if (o.home) st.home = o.home;
    if (o.horse) {
      st.horse = { ...o.horse };
      if (!g.playerHorse || g.playerHorse.dead) {
        const p = g.player.pos;
        g.playerHorse = await g.actors.spawnHorse(o.horse.breed, p.x + 3, p.z + 3, { owner: g.player, name: o.horse.name, persistent: true });
        g.playerHorse.persistentQuest = true;
      }
    }
    if (o.recruit) for (const [u, n] of o.recruit) for (let i = 0; i < n; i++) await g.squad.recruit(u, st.people, true);
    if (o.camp === "turchidag" && !g.world.statics.hasTag("camp:turchidag")) {
      st.flags.turchidag_camp = true;
      await this.buildRuntime(() => g.world.statics.buildShahCamp("camp:turchidag", TURCHIDAG.c[0], TURCHIDAG.c[1], 0.9, 1741));
    }
    if (o.breakCamp) {
      const tag = "camp:" + o.breakCamp;
      st.flags[o.breakCamp + "_broken"] = true;
      g.actors.despawnKey("garrison:" + tag);
      g.world.statics.removeTag(tag);
    }
    if (o.outposts) for (const [id, v] of Object.entries(o.outposts)) {
      st.outposts[id] = v;
      if (v === "destroyed") { g.actors.despawnKey("outpost:" + id); g.world.statics.removeTag("outpost:" + id); }
      if (v === "active") {
        st.flags["outpost_" + id] = true;
        const op = OUTPOSTS.find(q => q.id === id);
        if (op && !g.world.statics.hasTag("outpost:" + id)) await this.buildRuntime(() => g.world.statics.buildOutpost(op));
      }
    }
    if (o.teleport) await this.teleport(o.teleport, o.teleportOff || 0);
    if (o.heal) g.player.hp = g.player.maxHp;
    if (o.hp !== undefined) g.player.hp = Math.max(1, g.player.maxHp * o.hp);
    if (o.toast) g.ui.toast(fmt(g, o.toast), "quest");
    if (o.subtitle) g.ui.subtitle(fmt(g, o.subtitle), 7);
    if (o.cutscene) await g.cutscene.play(o.cutscene);
    if (o.epilogue) await this.epilogue();
    if (o.credits) g.ui.show("credits", { final: true });
    if (o.difficulty !== undefined) this.applyDifficulty();
    if (o.squadOrder) g.squad.command(o.squadOrder);
    this.applyDifficulty();
  }

  async buildRuntime(fn) {
    const S = this.game.world.statics;
    const before = new Set(S.clusters);
    fn();
    const added = S.clusters.filter(c => !before.has(c));
    await Promise.all(added.map(c => S.addColliders(c)));
  }

  setRelic(n, owner) {
    const g = this.game, st = g.state;
    const prev = st.relics[n];
    st.relics[n] = owner;
    if (owner === prev) return;
    if (owner === "player") {
      if (!st.items.includes("relic" + n)) st.items.push("relic" + n);
      g.ui.toast(`Реликвия найдена: ${RELIC_NAMES[n]}`, "good");
      g.chronicle && g.chronicle.unlock("relic" + n);
    } else if (owner === "persian") {
      st.items = st.items.filter(i => i !== "relic" + n);
      g.ui.toast(`Персы завладели реликвией «${RELIC_NAMES[n]}». Их отряды в регионе усилятся.`, "bad");
    }
    this.applyDifficulty();
  }

  applyDifficulty() {
    const g = this.game, st = g.state;
    const persianRelics = Object.values(st.relics).filter(v => v === "persian").length;
    const base = st.flags.difficulty_base || 0.85;
    g.difficulty = base + persianRelics * 0.05 - Math.min(0.1, (st.unity.length - 1) * 0.012);
  }

  async epilogue() {
    const g = this.game, st = g.state, c = st.choices;
    let id = "epilogue_peace";
    if (st.unity.length >= 9 && c.ahmed === "forgive") id = "epilogue_throne";
    else if (c.ahmed === "fight") id = "epilogue_revenge";
    else if (st.unity.length < 7) id = "epilogue_divided";
    st.flags.epilogue = id;
    g.chronicle && g.chronicle.unlock(id);
    await g.cutscene.play(id);
    const tail = [];
    tail.push(c.shakhman === "exile" ? "shakhman_exile" : c.shakhman === "duel" ? "shakhman_duel" : "shakhman_trial");
    tail.push(c.shamkhal === "talks" ? "shamkhal_talks" : "shamkhal_raid");
    for (const t of tail) if (g.data.cutscenes[t]) await g.cutscene.play(t);
  }

  async spawn(job, spec) {
    const g = this.game, st = g.state;
    if (spec.if && !this.cond(spec.if)) return [];
    let at = resolveLoc(g, spec.at || "player");
    if (!at) { console.warn("bad loc", spec.at); return []; }
    if (spec.off) at = { x: at.x + spec.off[0], z: at.z + spec.off[1] };
    if (spec.find) {
      const a = g.actors.find(spec.find);
      if (a) { a.qtag = spec.tag || "npc"; return [a]; }
    }
    let list = spec.g || [[spec.u, spec.n || 1]];
    if (spec.u === "unity") {
      list = [];
      for (const p of st.unity) list.push([g.data.peoples[p].unit.id, spec.n || 2]);
    }
    if (spec.scaleByUnity) list = list.map(([u, n]) => [u, Math.max(1, Math.round(n * (0.6 + 0.08 * st.unity.length)))]);
    if (spec.scaleByRelics) {
      const r = Object.values(st.relics).filter(v => v === "persian").length;
      list = list.map(([u, n]) => [u, n + r]);
    }
    const team = spec.team || (g.data.units[list[0][0]] || {}).team || "persian";
    const gr = await g.actors.spawnGroup(team, list, at.x, at.z, {
      state: spec.follow ? "follow" : spec.to || spec.path ? "script" : spec.state || "idle",
      spread: spec.spread || 5, torch: g.world.sky.isNight, people: spec.people || st.people, persistent: false,
      tags: spec.name ? ["q:" + spec.name] : undefined, reinforce: spec.horn !== false && team === "persian",
    });
    const pathPts = spec.path ? this.resolvePath(spec.path) : spec.to ? [resolveLoc(g, spec.to)].filter(Boolean).map(p => [p.x, p.z]) : null;
    gr.members.forEach((n, i) => {
      n.qtag = spec.tag || (team === "persian" ? "enemy" : "ally");
      n.stepOnly = !!spec.stepOnly;
      n.keep = !!spec.keep;
      if (spec.title) n.name = fmt(g, spec.title);
      if (spec.essential) n.essential = true;
      if (spec.yaw !== undefined) n.yaw = spec.yaw * Math.PI / 180;
      if (spec.hp) { n.hp = n.maxHp = spec.hp; }
      if (spec.talk) n.talk = spec.talk;
      if (spec.anim) n.idleClip = spec.anim;
      if (spec.team) n.team = spec.team;
      if (spec.guard) { n.brain.state = "guard"; n.brain.defaultState = "guard"; n.brain.guardYaw = Math.random() * 6.28; }
      if (spec.follow) {
        n.brain.followerOf = g.player;
        n.brain.state = "follow";
        n.brain.defaultState = "follow";
        n.brain.followIndex = 10 + job.actors.length;
      } else if (pathPts && pathPts.length) {
        const pts = pathPts.map(p => [p[0] + (i % 3 - 1) * 1.6, p[1] + (Math.floor(i / 3) - 1) * 1.6]);
        n.brain.state = "script";
        n.brain.defaultState = "script";
        n.brain.script = {
          to: pts[0], path: pts.slice(1), mode: spec.mode || "run", stop: 1.5,
          fight: spec.fight !== false, engageNear: spec.fight === false ? 0 : spec.engage || 35, fightR: spec.engage || 35,
          waitFor: spec.wait ? g.player : null, waitR: spec.wait || 28,
          onArrive: () => { n.arrived = true; },
        };
      }
      if (spec.attack) setTimeout(() => { if (!n.dead && n.brain) n.brain.engage(g.player, 0.3 + Math.random()); }, 200);
      job.actors.push(n);
    });
    if (spec.boss) {
      const b = gr.members[0];
      if (b) { g.ui.hud.boss(b); if (job.st) job.st.boss = b; }
    }
    if (spec.alert) gr.alert(g.player, gr.members[0]);
    return gr.members;
  }

  resolvePath(p) {
    const g = this.game;
    if (p.road) {
      const a = resolveLoc(g, p.road[0]), b = resolveLoc(g, p.road[1]);
      let pts = roadPath([a.x, a.z], [b.x, b.z]);
      if (p.max) pts = pts.slice(0, Math.max(2, Math.round(pts.length * p.max)));
      return pts;
    }
    return densify(p.map(l => { const q = resolveLoc(g, l); return [q.x, q.z]; }), 22);
  }

  async spawnAll(job, list) {
    const out = [];
    for (const sp of list || []) out.push(...await this.spawn(job, sp));
    return out;
  }

  addObj(job, o) {
    const obj = this.game.interact.register(o);
    job.objs.push(obj);
    return obj;
  }

  onSpotted(e) {
    const job = this.job;
    if (!job || !job.ready) return;
    const s = job.def.steps[job.i];
    if (!s || !s.stealth || e.target !== this.game.player || !e.by || e.by.team !== "persian") return;
    job.st.spottedT = (job.st.spottedT || 0) + 1;
    if (job.st.spottedT >= (s.lives || 1)) this.fail(s.stealthFail || "вас заметили");
    else this.game.ui.toast("Осторожно — вас почти заметили!", "bad");
  }

  onKill(e) {
    const job = this.job;
    if (!job || !job.st) return;
    if (e.target && e.target.qtag && job.st.kills) job.st.kills[e.target.qtag] = (job.st.kills[e.target.qtag] || 0) + 1;
    if (e.target && e.target.essential) this.fail(`погиб ${e.target.name}`);
  }

  onOutpost(op) {
    const g = this.game, st = g.state;
    st.outposts[op.id] = "destroyed";
    g.world.statics.removeTag("outpost:" + op.id);
    g.progress.addXp(120);
    st.res.coins += 25;
    g.ui.toast("Застава разбита: дорога стала безопаснее · опыт +120, монеты +25", "good");
    const reg = REGIONS.find(r => r.id === op.region);
    const left = OUTPOSTS.filter(o => o.region === op.region && st.outposts[o.id] !== "destroyed" && g.world.statics.hasTag("outpost:" + o.id)).length;
    if (reg && left === 0 && st.regions[reg.id] !== "highlanders" && st.act >= 4) {
      st.regions[reg.id] = "highlanders";
      g.ui.subtitle(`<b>${reg.name}</b> освобождён от застав шаха.`, 6);
    }
    g.save && g.save.auto("outpost");
  }

  onVillageFreed(s) {
    const g = this.game, st = g.state;
    st.villages[s.id] = "highlanders";
    st.killed["village:" + s.id] = 0;
    g.progress.addXp(200);
    st.reputation[s.people] = Math.min(100, (st.reputation[s.people] || 0) + 15);
    g.ui.toast(`${s.name} освобождено! Репутация у народа +15`, "good");
    setTimeout(() => { g.actors.despawnKey("village:" + s.id); }, 8000);
  }

  sideFor(people) {
    const g = this.game, st = g.state;
    if (st.act < 1) return null;
    if (this.job && this.job.def.side && this.job.def.people === people) return { ...this.job.def, offer: false };
    const chain = this.sides.filter(s => s.people === people);
    const next = chain.find(s => !st.missions.done.includes(s.id));
    if (!next) return null;
    if (next.cond && !this.cond(next.cond)) return null;
    return { ...next, offer: true };
  }

  async offerSide(side, npc) {
    const g = this.game;
    if (!side.offer) { g.ui.toast(`Текущее задание: «${side.title}»`); return; }
    if (this.job) { await g.dialog.play({ lines: [["elder", "Сначала заверши то, что начал. Потом приходи."]] }); return; }
    const r = await g.dialog.play({
      lines: side.offer_lines || [["elder", side.desc]],
      choices: [{ text: "Я помогу.", key: "yes" }, { text: "Не сейчас.", key: "no" }],
    });
    if (r && r.key === "yes") {
      this.clearGiver();
      g.state.side[side.id] = "active";
      this.begin(this.byId[side.id], 0);
    }
  }

  markers() {
    const g = this.game, out = [];
    const job = this.job;
    if (!job) {
      if (this.giverDef && this.giverAt) out.push({ x: this.giverAt.x, z: this.giverAt.z, color: "#e0b040", label: this.giverDef.title });
      return out;
    }
    const s = job.def.steps[job.i];
    if (!s || !job.st) return out;
    const h = H[s.type];
    if (h && h.markers) {
      try {
        const r = h.markers(this, job, s, job.st);
        if (r) out.push(...r.filter(m => m && Number.isFinite(m.x)));
      } catch (e) { }
    } else if (job.st.at) out.push({ x: job.st.at.x, z: job.st.at.z, color: "#e0b040", label: true });
    return out;
  }

  update(dt) {
    const g = this.game, job = this.job;
    if (!job || !job.ready || !job.st || job.failed) return;
    if (g.uiBlocking && !(g.cutscene && g.cutscene.active)) return;
    const s = job.def.steps[job.i];
    const st = job.st;
    if (!s) return;
    st.t += dt;
    if (s.limit && st.t > s.limit) return this.fail(s.limitFail || "время вышло");
    if (s.leash) {
      const c = resolveLoc(g, s.leash.at || s.at);
      const d = c ? Math.hypot(g.player.pos.x - c.x, g.player.pos.z - c.z) : 0;
      if (d > s.leash.r) {
        st.leashT = (st.leashT || 0) + dt;
        if (st.leashT > 1 && Math.floor(st.leashT) !== Math.floor(st.leashT - dt)) g.ui.toast(`Вернитесь! ${Math.max(0, Math.ceil(15 - st.leashT))} с`, "bad");
        if (st.leashT > 15) return this.fail("вы покинули место задания");
      } else st.leashT = 0;
    }
    this.fxT -= dt;
    if (this.fxT <= 0) {
      this.fxT = 0.35;
      for (const o of job.objs) if (o.smoke && !o.used && Math.hypot(o.x - g.player.pos.x, o.z - g.player.pos.z) < 160) {
        const y = g.world.ground(o.x, o.z);
        g.effects.smoke(new THREE.Vector3(o.x, y + 1.5, o.z), new THREE.Vector3(0, 1.5, 0), 3, 1.6);
      }
    }
    const handler = H[s.type];
    if (!handler || !handler.tick) return;
    const r = handler.tick(this, job, s, st, dt);
    if (r === "done") this.next(job.token);
    else if (typeof r === "string" && r.startsWith("fail:")) this.fail(r.slice(5));
  }
}

const alive = list => list.filter(a => !a.dead && !a.removed);
const dist2 = (a, p) => Math.hypot(a.pos.x - p.x, a.pos.z - p.z);

const H = {
  wait: {
    tick: (q, job, s, st) => (st.t >= (s.t || 3) ? "done" : null),
  },

  do: {
    start: (q, job, s, st) => { st.done = true; },
  },

  dialog: {
    async start(q, job, s, st) {
      await q.game.dialog.play(s.id || { lines: s.lines, choices: s.choices });
      st.done = true;
    },
  },

  cutscene: {
    async start(q, job, s, st) {
      await q.game.cutscene.play(s.id || { shots: s.shots, mood: s.mood });
      st.done = true;
    },
  },

  goto: {
    async start(q, job, s, st) {
      st.at = resolveLoc(q.game, s.at);
      if (s.spawn) await q.spawnAll(job, s.spawn);
    },
    tick(q, job, s, st) {
      const g = q.game;
      if (!st.at) return "done";
      if (s.mounted && !g.player.mount) return null;
      if (s.night && !g.world.sky.isNight) return null;
      return Math.hypot(g.player.pos.x - st.at.x, g.player.pos.z - st.at.z) < (s.r || 10) ? "done" : null;
    },
    markers: (q, job, s, st) => st.at ? [{ x: st.at.x, z: st.at.z, color: "#e0b040", label: true }] : [],
  },

  ride: {
    async start(q, job, s, st) {
      st.at = resolveLoc(q.game, s.at);
      if (s.spawn) await q.spawnAll(job, s.spawn);
      if (s.limit) q.game.ui.toast(`У вас ${s.limit} с`, "quest");
    },
    tick(q, job, s, st) {
      const g = q.game;
      if (s.limit) g.ui.hud.setObjective(job.def.title, `${fmt(g, s.text || DEFAULT_TEXT.ride)} · ${Math.max(0, Math.ceil(s.limit - st.t))} с`);
      if (!g.player.mount) return null;
      return Math.hypot(g.player.pos.x - st.at.x, g.player.pos.z - st.at.z) < (s.r || 12) ? "done" : null;
    },
    markers: (q, job, s, st) => [{ x: st.at.x, z: st.at.z, color: "#e0b040", label: true }],
  },

  mount: {
    async start(q, job, s, st) {
      const g = q.game;
      const at = resolveLoc(g, s.at);
      const h = await g.actors.spawnHorse(s.breed || "mountain", at.x, at.z, { name: fmt(g, s.name || "Конь"), free: true });
      h.free = true;
      h.wild = s.wild !== false;
      h.qtag = "horse";
      st.horse = h;
      job.actors.push(h);
      st.bolt = 0;
    },
    tick(q, job, s, st, dt) {
      const g = q.game, h = st.horse;
      if (!h || h.dead) return "fail:конь погиб";
      if (h.rider === g.player) {
        h.keep = true;
        h.owner = g.player;
        h.persistent = true;
        h.persistentQuest = true;
        g.playerHorse = h;
        g.state.horse = { breed: s.breed || "mountain", name: h.name };
        return "done";
      }
      const d = dist2(h, g.player.pos);
      if (h.wild && d < 9 && !h.rider) {
        st.bolt -= dt;
        if (st.bolt <= 0) {
          st.bolt = 2.5;
          const a = Math.atan2(h.pos.x - g.player.pos.x, h.pos.z - g.player.pos.z) + (Math.random() - 0.5) * 1.2;
          h.wanderTo = [h.pos.x + Math.sin(a) * 14, h.pos.z + Math.cos(a) * 14];
        }
      }
      if (h.wanderTo && !h.rider) {
        const [x, z] = h.wanderTo;
        const dx = x - h.pos.x, dz = z - h.pos.z, l = Math.hypot(dx, dz);
        if (l < 1 || g.player.crouch) h.wanderTo = null;
        else {
          h.yaw = Math.atan2(dx, dz);
          const sp = 7 * dt;
          h.pos.x += dx / l * sp;
          h.pos.z += dz / l * sp;
          h.pos.y = g.world.ground(h.pos.x, h.pos.z);
          if (h.loop) h.loop("Run");
        }
      } else if (h.loop && !h.rider) h.loop("Idle");
      return null;
    },
    markers: (q, job, s, st) => st.horse ? [{ x: st.horse.pos.x, z: st.horse.pos.z, color: "#e0b040", label: true }] : [],
  },

  talk: {
    async start(q, job, s, st) {
      const g = q.game;
      const off = typeof s.at === "string" && /:(square|mosque|spring)$/.test(s.at) ? [3.5, -2.5] : undefined;
      const [n] = await q.spawn(job, { u: s.who, at: s.at, off, tag: "talk", find: s.find, team: "highlanders", title: s.name, anim: s.anim || "Idle", yaw: s.yaw, ...(s.spec || {}) });
      if (!n) { st.done = true; return; }
      st.npc = n;
      n.brain.state = "idle";
      if (n.talkWas === undefined) n.talkWas = n.talk || null;
      n.talk = async () => {
        n.talk = n.talkWas;
        await g.dialog.play(s.id || { lines: s.lines, choices: s.choices });
        st.talked = true;
      };
    },
    tick(q, job, s, st) {
      if (!st.npc || st.npc.dead) return "fail:собеседник погиб";
      return st.talked ? "done" : null;
    },
    markers: (q, job, s, st) => st.npc ? [{ x: st.npc.pos.x, z: st.npc.pos.z, color: "#e0b040", label: true }] : [],
  },

  fight: {
    async start(q, job, s, st) {
      const g = q.game;
      st.at = s.at ? resolveLoc(g, s.at) : null;
      st.kills = {};
      st.waves = (s.waves || []).map(w => ({ ...w, spawned: false }));
      if (s.allies) await q.spawnAll(job, s.allies.map(a => ({ team: "highlanders", tag: "ally", ...a })));
      if (s.spawn) await q.spawnAll(job, s.spawn);
      if (s.protect) st.protectN = job.tagged(s.protect).length;
      if (s.points) await H.interact.start(q, job, { points: s.points }, st);
    },
    tick(q, job, s, st) {
      const g = q.game;
      for (const w of st.waves) {
        if (w.spawned || st.t < (w.t || 0)) continue;
        w.spawned = true;
        if (w.say) g.ui.subtitle(fmt(g, w.say), 5);
        st.pending = (st.pending || 0) + 1;
        q.spawnAll(job, w.spawn).then(() => { st.pending--; });
      }
      if (st.pending) return null;
      if (s.protect) {
        const p = alive(job.tagged(s.protect));
        if (p.length < (s.protectMin || 1)) return `fail:${s.protectFail || "защитники пали"}`;
      }
      const tag = s.target || "enemy";
      const foes = alive(job.tagged(tag)).filter(a => !(a.brain && a.brain.state === "flee" && dist2(a, g.player.pos) > 70));
      const wavesDone = st.waves.every(w => w.spawned);
      if (s.time) {
        const left = Math.max(0, Math.ceil(s.time - st.t));
        g.ui.hud.setObjective(job.def.title, `${fmt(g, s.text || DEFAULT_TEXT.fight)} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
        if (st.t >= s.time && wavesDone) {
          for (const a of alive(job.tagged("enemy"))) if (a.brain) a.brain.flee(40);
          return "done";
        }
        return null;
      }
      if (s.count) {
        const k = st.kills[tag] || 0;
        g.ui.hud.setObjective(job.def.title, `${fmt(g, s.text || DEFAULT_TEXT.fight)} · ${Math.min(k, s.count)}/${s.count}`);
        if (k >= s.count) { for (const a of alive(job.tagged("enemy"))) if (a.brain) a.brain.flee(40); return "done"; }
        if (!foes.length && wavesDone) return "done";
        return null;
      }
      if (wavesDone && foes.length <= (s.left || 0)) {
        for (const a of foes) if (a.brain) a.brain.flee(40);
        return "done";
      }
      return null;
    },
    markers(q, job, s, st) {
      const tag = s.target || "enemy";
      const foes = alive(job.tagged(tag));
      const out = [];
      if (st.pts) for (const p of st.pts) if (!p.used) out.push({ x: p.at.x, z: p.at.z, color: "#e0b040", shape: "dot" });
      if (s.target || foes.length <= 6) for (const a of foes.slice(0, 10)) out.push({ x: a.pos.x, z: a.pos.z, color: "#c4402f", shape: "dot" });
      if (st.at && (!foes.length || s.time)) out.push({ x: st.at.x, z: st.at.z, color: "#e0b040", label: true });
      if (s.protect) for (const a of alive(job.tagged(s.protect)).slice(0, 4)) out.push({ x: a.pos.x, z: a.pos.z, color: "#6fae5a", shape: "dot" });
      return out;
    },
  },

  escort: {
    async start(q, job, s, st) {
      const g = q.game;
      const pts = q.resolvePath(s.path);
      st.end = { x: pts[pts.length - 1][0], z: pts[pts.length - 1][1] };
      st.pts = pts;
      st.ambush = (s.ambush || []).map(a => ({ ...a, done: false }));
      const who = s.who.map(w => ({ team: "highlanders", tag: "escort", wait: s.wait || 30, mode: s.mode || "walk", fight: w.fight ?? false, ...w, path: pts }));
      await q.spawnAll(job, who);
      st.n0 = job.tagged("escort").length;
      for (const n of job.tagged("escort")) { n.brain.defaultState = "script"; n._script = n.brain.script; }
    },
    tick(q, job, s, st) {
      const g = q.game;
      const es = alive(job.tagged("escort"));
      const need = s.min || Math.max(1, Math.ceil(st.n0 * 0.5));
      if (es.length < need) return `fail:${s.failText || "люди погибли"}`;
      for (const n of es) {
        if (n.brain.state !== "script" && n.brain.state !== "flee" && n.brain.state !== "combat") { n.brain.state = "script"; n.brain.script = n._script; }
      }
      const lead = es.reduce((a, b) => (a && a.brain.script && a.brain.script.path && b.brain.script && b.brain.script.path && a.brain.script.path.length <= b.brain.script.path.length ? a : b), es[0]);
      const left = lead && lead.brain.script && lead.brain.script.path ? lead.brain.script.path.length : 0;
      const frac = 1 - left / Math.max(1, st.pts.length);
      for (const a of st.ambush) {
        if (a.done || frac < a.at) continue;
        a.done = true;
        if (a.say) g.ui.subtitle(fmt(g, a.say), 5);
        const p = lead.pos;
        const fw = st.pts[Math.min(st.pts.length - 1, st.pts.length - left + 4)] || [p.x, p.z];
        const ang = Math.atan2(fw[0] - p.x, fw[1] - p.z) + (a.side || 0.6);
        const dist = a.dist || 45;
        const ax = p.x + Math.sin(ang) * dist, az = p.z + Math.cos(ang) * dist;
        q.spawnAll(job, a.spawn.map(sp => ({ ...sp, at: [ax, az], attack: true })));
      }
      const arrived = es.filter(n => Math.hypot(n.pos.x - st.end.x, n.pos.z - st.end.z) < 16).length;
      g.ui.hud.setObjective(job.def.title, `${fmt(g, s.text || DEFAULT_TEXT.escort)} · ${es.length}/${st.n0} живы`);
      if (arrived >= Math.min(es.length, need)) return "done";
      return null;
    },
    markers(q, job, s, st) {
      const out = [{ x: st.end.x, z: st.end.z, color: "#e0b040", label: true }];
      for (const a of alive(job.tagged("escort")).slice(0, 3)) out.push({ x: a.pos.x, z: a.pos.z, color: "#6fae5a", shape: "dot" });
      for (const a of alive(job.tagged("enemy")).slice(0, 6)) out.push({ x: a.pos.x, z: a.pos.z, color: "#c4402f", shape: "dot" });
      return out;
    },
  },

  collect: {
    async start(q, job, s, st) {
      const g = q.game;
      const at = resolveLoc(g, s.at);
      st.at = at;
      if (s.spawn) await q.spawnAll(job, s.spawn);
      if (s.rival) {
        await q.spawnAll(job, s.rival.map(r => ({ tag: "rival", ...r, to: [at.x, at.z], mode: r.mode || "walk", engage: 25 })));
      }
      q.addObj(job, {
        x: at.x, z: at.z, r: 3,
        label: fmt(g, s.label || "Взять"),
        act: o => { o.used = true; st.got = true; },
        enabled: () => !st.got,
      });
    },
    tick(q, job, s, st) {
      const g = q.game;
      if (s.race) {
        const left = Math.max(0, Math.ceil(s.race - st.t));
        g.ui.hud.setObjective(job.def.title, `${fmt(g, s.text || DEFAULT_TEXT.collect)} · персы будут там через ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`);
      }
      if (st.got) {
        if (s.relic) q.setRelic(s.relic, "player");
        if (s.give) q.apply({ give: s.give });
        if (s.items) q.apply({ items: s.items });
        return "done";
      }
      const rivals = alive(job.tagged("rival"));
      const rivalAt = rivals.some(a => Math.hypot(a.pos.x - st.at.x, a.pos.z - st.at.z) < 3.5);
      if ((s.race && st.t > s.race) || rivalAt) {
        if (s.relic) {
          q.setRelic(s.relic, "persian");
          return q.fail(s.raceFail || "персы забрали реликвию"), null;
        }
        return "fail:вас опередили";
      }
      return null;
    },
    markers(q, job, s, st) {
      const out = [{ x: st.at.x, z: st.at.z, color: "#e0b040", label: true }];
      for (const a of alive(job.tagged("rival")).slice(0, 3)) out.push({ x: a.pos.x, z: a.pos.z, color: "#c4402f", shape: "dot" });
      return out;
    },
  },

  interact: {
    async start(q, job, s, st) {
      const g = q.game;
      st.used = st.used || 0;
      st.pts = st.pts || [];
      if (s.spawn) await q.spawnAll(job, s.spawn);
      for (const p of s.points) {
        const at = resolveLoc(g, p.at);
        if (!at) continue;
        const pt = { at, p };
        st.pts.push(pt);
        const o = q.addObj(job, {
          x: at.x, z: at.z, r: p.r || 3, smoke: !!p.smoke,
          label: fmt(g, p.label || s.label || "Действовать"),
          enabled: () => !pt.used && (!p.needDead || !alive(job.tagged(p.needDead)).some(a => Math.hypot(a.pos.x - at.x, a.pos.z - at.z) < 14)),
          act: () => {
            pt.used = true;
            o.used = true;
            st.used++;
            fx(q, job, p, at);
          },
        });
      }
    },
    tick(q, job, s, st) {
      const g = q.game;
      const need = s.need || st.pts.length;
      if (st.pts.length > 1) g.ui.hud.setObjective(job.def.title, `${fmt(g, s.text || DEFAULT_TEXT.interact)} · ${st.used}/${need}`);
      return st.used >= need ? "done" : null;
    },
    markers: (q, job, s, st) => (st.pts || []).filter(p => !p.used).map(p => ({ x: p.at.x, z: p.at.z, color: "#e0b040", label: true })),
  },

  chase: {
    async start(q, job, s, st) {
      const g = q.game;
      await q.spawnAll(job, [{ tag: "runner", fight: false, mode: "sprint", ...s.who, path: s.path }]);
      st.runner = job.tagged("runner")[0];
      if (st.runner) { st.runner.brain.script.waitFor = null; st.runner.invulnerable = !!s.invulnerable; }
      if (s.spawn) await q.spawnAll(job, s.spawn);
    },
    tick(q, job, s, st) {
      const g = q.game, r = st.runner;
      if (!r || r.removed) return "done";
      if (r.dead) { if (s.onKill) q.apply(s.onKill); return "done"; }
      const d = dist2(r, g.player.pos);
      if (d < (s.catchR || 4) && s.catchable !== false) { if (s.onCatch) q.apply(s.onCatch); st.caught = true; return "done"; }
      if (r.arrived || (s.limit && st.t > s.limit - 0.1)) {
        if (s.onEscape) q.apply(s.onEscape);
        return s.escapeFails ? `fail:${s.escapeText || "беглец ушёл"}` : "done";
      }
      return null;
    },
    markers: (q, job, s, st) => st.runner && !st.runner.dead ? [{ x: st.runner.pos.x, z: st.runner.pos.z, color: "#c4402f", label: true }] : [],
  },

  unity: {
    tick(q, job, s, st) {
      const g = q.game, U = g.state.unity;
      g.ui.hud.setObjective(job.def.title, `${fmt(g, s.text || DEFAULT_TEXT.unity)} · ${U.length}/${s.n}`);
      return U.length >= s.n ? "done" : null;
    },
    markers(q, job, s, st) {
      const g = q.game, out = [];
      for (const p of PEOPLES) {
        if (g.state.unity.includes(p)) continue;
        const sv = settlement(HOMES[p]);
        out.push({ x: sv.p[0], z: sv.p[1], color: "#9fc4e0", label: true });
      }
      return out;
    },
  },
};

function fx(q, job, p, at) {
  const g = q.game;
  const y = g.world.ground(at.x, at.z);
  const pos = new THREE.Vector3(at.x, y + 0.5, at.z);
  if (p.say) g.ui.subtitle(fmt(g, p.say), 5);
  if (p.give) q.apply({ give: p.give });
  if (p.items) q.apply({ items: p.items });
  if (p.do) q.apply(p.do);
  switch (p.fx) {
    case "explode": {
      const delay = p.delay ?? 3;
      g.ui.toast(delay ? `Фитиль подожжён — отходите! (${delay} с)` : "Взрыв!", "bad");
      setTimeout(() => g.combat.explosion(pos, p.radius || 8, p.dmg || 160, g.player), delay * 1000);
      break;
    }
    case "rockfall": {
      const t = resolveLoc(g, p.target) || at;
      const ty = g.world.ground(t.x, t.z);
      g.audio.play && g.audio.play("rockfall");
      for (let k = 0; k < 5; k++) setTimeout(() => {
        const v = new THREE.Vector3(t.x + (Math.random() - 0.5) * 16, ty + 0.5, t.z + (Math.random() - 0.5) * 16);
        g.effects.dust(v, 30, [0.5, 0.45, 0.38]);
        g.combat.explosion(v, 7, 140, g.player);
      }, 600 + k * 350);
      break;
    }
    case "spike":
      g.effects.sparks(pos.setY(y + 1.1), 16);
      g.audio.play && g.audio.play("clang");
      g.ui.toast("Пушка заклёпана", "good");
      break;
    case "alarm":
      g.audio.play && g.audio.play("horn");
      g.ui.toast("Тревога поднята!", "good");
      break;
    case "fire":
      g.effects.explosion(pos, 0.6);
      g.audio.play && g.audio.play("fire");
      break;
    case "douse":
      g.effects.smoke(pos.setY(y + 1), new THREE.Vector3(0, 2, 0), 18, 2);
      break;
    default:
      g.effects.dust(pos, 8);
  }
}
