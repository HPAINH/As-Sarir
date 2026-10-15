import * as THREE from "three";

export class Interact {
  constructor(game) {
    this.game = game;
    this.objects = [];
    this.current = null;
  }

  register(obj) {
    this.objects.push(obj);
    return obj;
  }

  unregister(obj) {
    const i = this.objects.indexOf(obj);
    if (i >= 0) this.objects.splice(i, 1);
  }

  removeTag(tag) {
    this.objects = this.objects.filter(o => o.tag !== tag);
  }

  candidates() {
    const g = this.game, p = g.player;
    const out = [];
    if (p.mount) return out;
    for (const a of g.actors.near(p.pos.x, p.pos.z, 3.2)) {
      if (a === p || a.removed) continue;
      const d = p.distTo(a);
      if (a.kind === "horse" && !a.dead && !a.rider && d < 2.8 && (a.owner === p || a.team !== "persian" || a.free)) {
        out.push({ d, label: `Сесть на коня <i>${a.name}</i>`, act: () => a.mount(p) });
      } else if (a.kind === "npc" && !a.dead && d < 2.6 && (a.talk || a.talkRole) && !g.combat.hostile(p, a) && a.brain.state !== "combat") {
        out.push({ d: a.qtag === "talk" ? d - 2 : d, label: `${a.qtag === "talk" ? "◆ " : ""}Говорить: <i>${a.name}</i>`, act: () => g.dialog.talkTo(a) });
      }
    }
    for (const c of g.combat.corpses) {
      if (c.looted || c.a.removed) continue;
      const d = p.distTo(c.a);
      if (d < 2.0 && c.a.def && c.a.def.loot) out.push({ d, label: "Обыскать", act: () => {
        const got = g.combat.lootCorpse(c);
        const parts = Object.entries(got || {}).map(([k, v]) => k === "weapon" ? "джазаир" : `${k === "coins" ? "монеты" : k === "powder" ? "порох" : k === "lead" ? "свинец" : k === "arrows" ? "стрелы" : k === "food" ? "провизия" : "железо"} +${v}`);
        g.ui.toast(parts.length ? parts.join(", ") : "Ничего ценного");
      } });
    }
    for (const o of this.objects) {
      if (o.enabled && !o.enabled()) continue;
      const d = Math.hypot(o.x - p.pos.x, o.z - p.pos.z);
      const dy = o.y !== undefined ? Math.abs(o.y - p.pos.y) : 0;
      if (d < (o.r || 2.5) && dy < 4) out.push({ d, label: typeof o.label === "function" ? o.label() : o.label, act: () => o.act(o) });
    }
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  update(dt) {
    const g = this.game;
    if (g.uiBlocking || g.player.dead) { g.ui.hud.prompt(null); return; }
    if (g.player.dismountedAt && g.engine.time - g.player.dismountedAt < 0.4) return;
    const c = this.candidates()[0] || null;
    this.current = c;
    g.ui.hud.prompt(c ? `<kbd>E</kbd> ${c.label}` : null);
    if (c && g.input.hit("KeyE")) c.act();
  }
}
