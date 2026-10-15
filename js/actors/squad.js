import * as THREE from "three";

export const ORDERS = [
  { id: "follow", name: "За мной", key: "1" },
  { id: "hold", name: "Держать позицию", key: "2" },
  { id: "volley", name: "Залп", key: "3" },
  { id: "attack", name: "В атаку", key: "4" },
  { id: "retreat", name: "Отступать", key: "5" },
];

export class Squad {
  constructor(game) {
    this.game = game;
    this.members = [];
    this.order = "follow";
    this.warcryT = 0;
    this.warcryCd = 0;
  }

  async onStart() {
    const st = this.game.state;
    const saved = st.squad || [];
    st.squad = [];
    for (const m of saved) await this.recruit(m.unit, m.people, true);
    if (st.items.includes("shepherd_dog") && !this.dog) await this.spawnDog();
  }

  async spawnDog() {
    const g = this.game, p = g.player;
    this.dog = await g.actors.spawnAnimal("dog", p.pos.x - 2, p.pos.z - 2, { persistent: true });
    this.dog.persistentQuest = true;
    this.dog.name = "Волкодав";
  }

  alive() {
    return this.members.filter(m => !m.dead && !m.removed);
  }

  async recruit(unit, people, silent = false) {
    const g = this.game;
    if (this.alive().length >= g.progress.squadMax()) {
      if (!silent) g.ui.toast("Отряд полон: прокачайте ветку «Вожак» или дождитесь следующего акта");
      return null;
    }
    const p = g.player;
    const a = Math.random() * Math.PI * 2;
    const n = await g.actors.spawnUnit(unit, p.pos.x + Math.cos(a) * 3, p.pos.z + Math.sin(a) * 3, { people, persistent: true, state: "follow" });
    if (!n) return null;
    n.persistentQuest = true;
    n.brain.followerOf = p;
    n.brain.state = "follow";
    n.brain.defaultState = "follow";
    n.brain.order = this.order;
    n.team = "highlanders";
    this.members.push(n);
    this.reindex();
    g.state.squad.push({ unit, people });
    if (!silent) g.ui.toast(`${n.name} присоединился к отряду`, "good");
    return n;
  }

  dismissDead() {
    const before = this.members.length;
    this.members = this.members.filter(m => !m.dead && !m.removed);
    if (this.members.length !== before) {
      this.game.state.squad = this.members.map(m => ({ unit: m.unitId, people: m.people }));
      this.reindex();
    }
  }

  reindex() {
    this.members.forEach((m, i) => { m.brain.followIndex = i; });
  }

  command(id) {
    const g = this.game;
    this.order = id;
    const p = g.player;
    for (const m of this.alive()) {
      const b = m.brain;
      b.order = id;
      if (id === "hold") b.holdPos = m.pos.clone();
      if (id === "follow" || id === "retreat") {
        if (b.state === "combat" && id === "retreat") b.state = "follow";
        if (b.state !== "combat") b.state = "follow";
      }
      if (id === "attack" && b.state !== "combat") b.lookForFight(1, 90);
      if (id === "volley") this.volley();
    }
    const o = ORDERS.find(o => o.id === id);
    g.ui.toast(`Приказ: ${o ? o.name : id}`);
    g.audio && g.audio.shout(p.pos, "highlanders");
  }

  volley() {
    const g = this.game;
    const shooters = this.alive().filter(m => m.canShoot());
    let target = null;
    const dir = g.rig.aimDir(new THREE.Vector3());
    let best = 0.9;
    for (const a of g.actors.near(g.player.pos.x, g.player.pos.z, 120)) {
      if (a.dead || !g.combat.hostile(g.player, a)) continue;
      const v = a.pos.clone().sub(g.player.pos);
      const d = v.length();
      const c = v.normalize().dot(dir);
      if (c > best && d > 5) { best = c; target = a; }
    }
    if (!target) { g.ui.toast("Для залпа наведите прицел на врага"); return; }
    for (const m of shooters) {
      if (!m.loaded[m.canShoot()]) continue;
      m.brain.engage(target);
      m.aimT = 5;
      if (g.state.skills.volley) m.volleyBonus = 1.3;
    }
  }

  warcry() {
    const g = this.game;
    if (!g.state.skills.warcry || this.warcryCd > 0) return;
    this.warcryT = 15;
    this.warcryCd = 60;
    for (const m of this.alive()) m.npcScale = 1.2;
    g.ui.subtitle(`<b>${g.state.heroName}:</b> «Вперёд, джамаат!»`, 2.5);
    g.audio && g.audio.shout(g.player.pos, "highlanders", true);
  }

  update(dt) {
    const g = this.game;
    this.dismissDead();
    if (this.warcryT > 0) {
      this.warcryT -= dt;
      if (this.warcryT <= 0) for (const m of this.alive()) m.npcScale = 1;
    }
    this.warcryCd = Math.max(0, this.warcryCd - dt);
    if (g.uiBlocking) return;
    if (g.input.hit("KeyG")) this.warcry();
    if (g.input.hit("KeyH") && g.playerHorse && !g.player.mount) {
      g.playerHorse.called = true;
      g.ui.toast(`Вы свистнули — ${g.playerHorse.name} идёт к вам`);
      g.audio && g.audio.whistle(g.player.pos);
    }
  }
}
