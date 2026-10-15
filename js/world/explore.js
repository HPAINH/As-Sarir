import { POI, REGIONS, SETTLEMENTS, regionAt } from "./geo.js";

export class Explore {
  constructor(game) {
    this.game = game;
    this.t = 0;
    this.guards = new Map();
    this.hornCd = 0;
  }

  onStart() {
    const g = this.game, st = g.state;
    st.visited = st.visited || [];
    st.explored = st.explored || [];
    st.towers = st.towers || [];
    g.ui.addMarkers(() => {
      if (!st.items.includes("guide_staff") || g.world.sky.weather !== "fog") return null;
      const p = g.player.pos;
      let best = null, bd = Infinity;
      for (const s of SETTLEMENTS) {
        if ((st.villages[s.id] || "highlanders") !== "highlanders") continue;
        const d = Math.hypot(s.p[0] - p.x, s.p[1] - p.z);
        if (d < bd) { bd = d; best = s; }
      }
      return best ? { x: best.p[0], z: best.p[1], color: "#9fc4e0", shape: "dot" } : null;
    });
    for (const p of POI.filter(p => p.type === "tower")) {
      g.interact.register({
        x: p.p[0], z: p.p[1], r: 5, tag: "tower:" + p.id,
        label: () => `Подняться на башню: <i>${p.name}</i>`,
        enabled: () => !st.towers.includes(p.id) && !this.guarded(p),
        act: () => this.climb(p),
      });
    }
  }

  registerCannons() {
    const g = this.game, st = g.state;
    st.spiked = st.spiked || [];
    this.cannonsDone = this.cannonsDone || new Set();
    const camps = g.world.statics.camps || {};
    for (const [tag, c] of Object.entries(camps)) {
      if (this.cannonsDone.has(tag) || !g.world.statics.hasTag(tag)) continue;
      this.cannonsDone.add(tag);
      c.cannons.forEach(([x, z], i) => {
        const id = tag + ":" + i;
        g.interact.register({
          x, z, r: 3, tag: "cannon:" + id,
          label: "Заклепать пушку",
          enabled: () => g.world.statics.hasTag(tag) && !st.spiked.includes(id) && !g.actors.near(x, z, 9).some(a => a.team === "persian" && !a.dead && a.role === "crew"),
          act: () => {
            st.spiked.push(id);
            g.effects.sparks(new (g.player.pos.constructor)(x, g.world.ground(x, z) + 1.1, z), 16);
            g.audio.clang({ x, y: g.player.pos.y, z });
            g.progress.addXp(60);
            g.ui.toast("Пушка заклёпана · опыт +60", "good");
          },
        });
      });
    }
  }

  guarded(p) {
    const gr = this.guards.get(p.id);
    return gr ? gr.alive.some(a => Math.hypot(a.pos.x - p.p[0], a.pos.z - p.p[1]) < 35) : false;
  }

  climb(p) {
    const g = this.game, st = g.state;
    st.towers.push(p.id);
    const reg = REGIONS.find(r => r.id === p.region);
    g.progress.addXp(80);
    g.ui.toast(`Башня разведана: ${p.name}. На карте открыт регион «${reg ? reg.name : ""}» · опыт +80`, "good");
    g.audio.ui("reveal");
    g.save && g.save.auto("tower");
  }

  async guard(p) {
    const g = this.game, st = g.state;
    if (this.guards.has(p.id) || st.towers.includes(p.id)) return;
    if (st.regions[p.region] === "highlanders") { this.guards.set(p.id, { alive: [] }); return; }
    this.guards.set(p.id, { alive: [] });
    const gr = await g.actors.spawnGroup("persian", [["officer", 1], ["sarbaz", 2], ["jazayerchi", 1]], p.p[0] + 6, p.p[1] + 6, { state: "guard", spread: 7, torch: g.world.sky.isNight });
    for (const m of gr.members) m.brain.guardYaw = Math.random() * 6.28;
    this.guards.set(p.id, gr);
  }

  update(dt) {
    const g = this.game, st = g.state;
    this.hornCd = Math.max(0, this.hornCd - dt);
    if (!g.uiBlocking && g.input.hit("KeyB") && st.items.includes("alarm_horn")) this.horn();
    this.t -= dt;
    if (this.t > 0) return;
    this.t = 1;
    this.registerCannons();
    const p = g.player.pos;
    const reg = regionAt(p.x, p.z);
    if (!st.explored.includes(reg.id) && this.visitedIn(reg.id) >= 2) {
      st.explored.push(reg.id);
      g.ui.toast(`Вы изучили окрестности: ${reg.name}`, "lore");
    }
    for (const s of SETTLEMENTS) {
      if (st.visited.includes(s.id)) continue;
      if (Math.hypot(s.p[0] - p.x, s.p[1] - p.z) < 90) st.visited.push(s.id);
    }
    for (const t of POI) {
      if (t.type !== "tower") continue;
      if (Math.hypot(t.p[0] - p.x, t.p[1] - p.z) < 150) this.guard(t);
    }
  }

  visitedIn(region) {
    return this.game.state.visited.filter(id => (SETTLEMENTS.find(s => s.id === id) || {}).region === region).length;
  }

  async horn() {
    const g = this.game;
    if (this.hornCd > 0) { g.ui.toast(`Рог ещё не готов: ${Math.ceil(this.hornCd)} с`); return; }
    this.hornCd = 300;
    g.audio.play && g.audio.play("horn");
    g.ui.subtitle("Над ущельем летит голос рога тревоги…", 3);
    const p = g.player.pos;
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * 6.28;
      const n = await g.actors.spawnUnit(i ? "militia_rifle" : "militia_saber", p.x + Math.cos(a) * 25, p.z + Math.sin(a) * 25, { state: "follow", people: g.state.people });
      if (!n) continue;
      n.brain.followerOf = g.player;
      n.brain.state = "follow";
      n.brain.followIndex = 20 + i;
      setTimeout(() => { if (!n.removed && !n.dead) g.actors.remove(n); }, 90000);
    }
  }
}
