import * as THREE from "three";
import { el, esc } from "../ui/hud.js";
import { fmt, homeId } from "./locs.js";
import { settlement } from "../world/geo.js";

export class Dialog {
  constructor(game) {
    this.game = game;
    this.box = el("div", "dialog screen");
    this.box.hidden = true;
    game.ui.root.appendChild(this.box);
    this.active = false;
    this.handlers = [];
    window.addEventListener("keydown", e => this.key(e));
  }

  speaker(id) {
    const g = this.game;
    if (!id || id === "narrator") return "";
    if (id === "hero") return g.state.heroName;
    if (id === "elder") return "Старейшина";
    const u = g.data.units[id];
    if (u) return u.name;
    const names = { ahmed: "Ахмед", murtazali: "Муртазали", patimat: "Патимат", hadji_ali: "Хаджи-Али", nader_shah: "Надир-шах", lutf_ali: "Лютф-Али-хан", haydar_bek: "Гайдар-бек", mirza_kazem: "Мирза Казем", kalushkin: "Иван Калушкин", surkhay: "Сурхай-хан", messenger: "Гонец", villager: "Сельчанин", woman: "Сельчанка", militia: "Ополченец", smith: "Кузнец", merchant: "Торговец", khasbulat: "Шамхал Хасбулат", shakhman: "Шахман", akhmed_utsmiy: "Ахмед-хан" };
    return names[id] || id;
  }

  key(e) {
    if (!this.active) return;
    if (this.choosing) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= this.choosing.length) { e.preventDefault(); this.pick(n - 1); }
      return;
    }
    if (e.code === "Space" || e.code === "Enter" || e.code === "KeyE") { e.preventDefault(); this.advance(); }
    if (e.code === "Escape") { e.preventDefault(); this.skipAll = true; this.advance(); }
  }

  async play(src, opts = {}) {
    const g = this.game;
    const d = typeof src === "string" ? g.data.dialogs[src] : src;
    if (!d) { console.warn("no dialog", src); return null; }
    this.open();
    let result = null;
    let cur = d;
    while (cur) {
      for (const [who, text] of cur.lines || []) {
        if (this.skipAll && !cur.choices) break;
        await this.line(who, fmt(g, text));
      }
      this.skipAll = false;
      if (cur.choices && cur.choices.length) {
        const avail = cur.choices.filter(c => !c.if || this.cond(c.if));
        const idx = await this.choose(avail.map(c => fmt(g, c.text)));
        const c = avail[idx];
        result = c;
        this.apply(c);
        if (c.reply) for (const [who, text] of c.reply) await this.line(who, fmt(g, text));
        cur = c.next ? g.data.dialogs[c.next] : null;
        if (c.action && opts.onAction) await opts.onAction(c.action, c);
      } else {
        if (cur.apply) this.apply(cur.apply);
        cur = cur.next ? g.data.dialogs[cur.next] : null;
      }
    }
    this.close();
    return result;
  }

  cond(c) {
    const st = this.game.state;
    if (c.flag) return !!st.flags[c.flag] === (c.value !== false);
    if (c.unity) return st.unity.length >= c.unity;
    if (c.coins) return st.res.coins >= c.coins;
    if (c.people) return st.people === c.people;
    return true;
  }

  apply(c) {
    const g = this.game, st = g.state;
    if (!c) return;
    if (g.quests) {
      const { text, key, next, reply, action, if: _if, ...ops } = c;
      return g.quests.apply(ops);
    }
    if (c.set) for (const [k, v] of Object.entries(c.set)) st.flags[k] = v;
    if (c.choice) for (const [k, v] of Object.entries(c.choice)) st.choices[k] = v;
    if (c.rep) for (const [k, v] of Object.entries(c.rep)) st.reputation[k] = (st.reputation[k] || 0) + v;
    if (c.coins) st.res.coins = Math.max(0, st.res.coins + c.coins);
    if (c.give) for (const [k, v] of Object.entries(c.give)) st.res[k] = (st.res[k] || 0) + v;
    if (c.chronicle) for (const id of [].concat(c.chronicle)) g.chronicle && g.chronicle.unlock(id);
    if (c.xp) g.progress.addXp(c.xp);
  }

  open() {
    const g = this.game;
    this.active = true;
    this.box.hidden = false;
    g.uiBlocking = true;
    g.input.unlock();
    g.player.vel.set(0, 0, 0);
  }

  frame(npc) {
    const g = this.game, p = g.player;
    if (!g.rig || g.rig.cinematic || p.mount) return;
    const dx = npc.pos.x - p.pos.x, dz = npc.pos.z - p.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const ux = dx / l, uz = dz / l;
    const cam = new THREE.Vector3(p.pos.x - ux * 1.9 + uz * 0.9, p.pos.y + 1.85, p.pos.z - uz * 1.9 - ux * 0.9);
    const look = new THREE.Vector3(npc.pos.x, npc.pos.y + 1.55, npc.pos.z);
    p.yaw = Math.atan2(dx, dz);
    this.framed = { update: (dt, c) => { c.position.lerp(cam, Math.min(1, dt * 6)); c.lookAt(look); } };
    g.rig.cinematic = this.framed;
  }

  close() {
    const g = this.game;
    if (this.framed && g.rig.cinematic === this.framed) g.rig.cinematic = null;
    this.framed = null;
    this.active = false;
    this.box.hidden = true;
    this.choosing = null;
    if (!g.ui.open && !(g.cutscene && g.cutscene.active)) {
      g.uiBlocking = false;
      g.input.lock();
    }
  }

  line(who, text) {
    if (this.game.autoplay) return Promise.resolve();
    return new Promise(res => {
      const name = this.speaker(who);
      this.box.innerHTML = `<div class="d-name">${esc(name)}</div><div class="d-text">${text}</div><div class="d-next"><kbd>Пробел</kbd> далее</div>`;
      this.box.onclick = () => this.advance();
      this.resolveLine = res;
      this.game.audio && this.game.audio.ui("line");
    });
  }

  advance() {
    if (this.resolveLine) {
      const r = this.resolveLine;
      this.resolveLine = null;
      r();
    }
  }

  choose(opts) {
    if (this.game.autoplay) return Promise.resolve(Math.min(opts.length - 1, this.game.autoChoice || 0));
    return new Promise(res => {
      this.choosing = opts;
      const list = opts.map((o, i) => `<button class="d-opt" data-i="${i}"><kbd>${i + 1}</kbd> ${o}</button>`).join("");
      const prev = this.box.querySelector(".d-text");
      const text = prev ? prev.outerHTML : "";
      const name = this.box.querySelector(".d-name");
      this.box.innerHTML = (name ? name.outerHTML : "") + text + `<div class="d-opts">${list}</div>`;
      this.box.onclick = null;
      this.box.querySelectorAll(".d-opt").forEach(b => b.addEventListener("click", () => this.pick(+b.dataset.i)));
      this.resolveChoice = res;
    });
  }

  pick(i) {
    if (!this.resolveChoice) return;
    const r = this.resolveChoice;
    this.resolveChoice = null;
    this.choosing = null;
    r(i);
  }

  async talkTo(npc) {
    const g = this.game;
    if (npc.brain) { npc.brain.prevTalk = npc.brain.state; }
    npc.face && npc.face(g.player.pos, 1, 1);
    this.frame(npc);
    if (typeof npc.talk === "function") return npc.talk(npc);
    if (typeof npc.talk === "string") return this.play(npc.talk);
    if (npc.talkRole === "merchant") return g.ui.show("trade", npc);
    if (npc.talkRole === "elder") return this.elderMenu(npc);
    return this.play({ lines: [[npc.unitId, "Да хранит тебя Всевышний, путник."]] });
  }

  async elderMenu(npc) {
    const g = this.game, st = g.state;
    const s = settlement(npc.village);
    const people = s.people;
    const P = g.data.peoples[people];
    const isHome = npc.village === homeId(g);
    const inUnity = st.unity.includes(people);
    const choices = [{ text: "Расскажи о вашем народе.", key: "history" }];
    const side = g.quests ? g.quests.sideFor(people) : null;
    if (side) choices.push({ text: side.offer ? `Чем я могу помочь? (${side.title})` : `Я по делу: ${side.title}`, key: "side" });
    if (inUnity) choices.push({ text: `Нужны бойцы. (${P.unit.name}, ${g.data.units[P.unit.id] ? g.data.units[P.unit.id].price || 40 : 40} монет)`, key: "recruit" });
    if (inUnity) choices.push({ text: "Нужны ополченцы. (20 монет)", key: "militia" });
    if (isHome && g.player.hp < g.player.maxHp) choices.push({ text: "Мне нужен лекарь.", key: "heal" });
    choices.push({ text: "Прощай.", key: "bye" });
    const r = await this.play({
      lines: [["elder", isHome ? "С возвращением, {hero}. Чем село может помочь?" : `Ассаламу алейкум. Ты в ${s.name}. ${inUnity ? "Наши люди с тобой." : "Чего ищешь у нас?"}`]],
      choices,
    });
    if (!r) return;
    if (r.key === "history") {
      await this.play({ lines: [["elder", P.history], ["elder", `Наш народ: ${P.polity}.`]] });
      g.chronicle && g.chronicle.unlock("people_" + people);
      return this.elderMenu(npc);
    }
    if (r.key === "side" && side) return g.quests.offerSide(side, npc);
    if (r.key === "recruit" || r.key === "militia") {
      const unit = r.key === "recruit" ? P.unit.id : "militia_rifle";
      const price = r.key === "recruit" ? (g.data.units[unit].price || 40) : 20;
      if (st.res.coins < price) { g.ui.toast("Не хватает монет"); return; }
      const n = await g.squad.recruit(unit, people);
      if (n) st.res.coins -= price;
      return;
    }
    if (r.key === "heal") {
      g.player.hp = g.player.maxHp;
      g.ui.toast("Раны перевязаны", "good");
    }
  }
}
