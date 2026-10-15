import { WEAPONS } from "../combat/weapons.js";
import { regionAt } from "../world/geo.js";

const RES_NAMES = { coins: "монеты", powder: "порох", lead: "свинец", arrows: "стрелы", iron: "железо", food: "провизия" };

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

export class HUD {
  constructor(ui) {
    this.ui = ui;
    this.game = ui.game;
    const root = el("div", "hud");
    root.innerHTML = `
      <div class="hud-obj" id="hudObj"></div>
      <div class="hud-compass"><canvas id="hudCompass" width="640" height="44"></canvas></div>
      <div class="hud-region" id="hudRegion"></div>
      <div class="hud-eye" id="hudEye" hidden><svg viewBox="0 0 40 24"><path d="M2 12 C10 1 30 1 38 12 C30 23 10 23 2 12Z" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="20" cy="12" r="5" fill="currentColor"/></svg></div>
      <div class="hud-cross" id="hudCross" hidden></div>
      <div class="hud-vitals">
        <div class="bar hp"><i id="hudHp"></i></div>
        <div class="bar st"><i id="hudSt"></i></div>
        <div class="bar hs" id="hudHorseWrap" hidden><i id="hudHorse"></i></div>
      </div>
      <div class="hud-weapon">
        <div class="w-name" id="hudWName"></div>
        <div class="w-state" id="hudWState"></div>
        <div class="w-reload" id="hudReloadWrap" hidden><i id="hudReload"></i></div>
        <div class="w-res" id="hudRes"></div>
      </div>
      <div class="hud-squad" id="hudSquad"></div>
      <div class="hud-prompt" id="hudPrompt" hidden></div>
      <div class="hud-sub" id="hudSub" hidden></div>
      <div class="hud-toasts" id="hudToasts"></div>
      <div class="hud-hurt" id="hudHurt"></div>
      <div class="hud-boss" id="hudBoss" hidden><span id="hudBossName"></span><div class="bar"><i id="hudBossHp"></i></div></div>
    `;
    ui.root.appendChild(root);
    this.root = root;
    this.$ = id => root.querySelector("#" + id);
    this.compass = this.$("hudCompass").getContext("2d");
    this.markers = [];
    this.lastRegion = null;
  }

  setObjective(title, text) {
    const o = this.$("hudObj");
    o.innerHTML = title ? `<b>${esc(title)}</b><span>${esc(text || "")}</span>` : "";
    o.hidden = !title;
  }

  prompt(text) {
    const p = this.$("hudPrompt");
    if (!text) { p.hidden = true; return; }
    p.innerHTML = text;
    p.hidden = false;
  }

  subtitle(text, t = 4) {
    const s = this.$("hudSub");
    s.innerHTML = text;
    s.hidden = false;
    clearTimeout(this.subT);
    this.subT = setTimeout(() => { s.hidden = true; }, t * 1000);
  }

  toast(text, kind = "") {
    const box = this.$("hudToasts");
    const t = el("div", "toast " + kind, text);
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.classList.add("out"), 3400);
    setTimeout(() => t.remove(), 4000);
  }

  boss(actor) {
    this.bossActor = actor;
    this.$("hudBoss").hidden = !actor;
    if (actor) this.$("hudBossName").textContent = actor.name;
  }

  update(dt) {
    const g = this.game, p = g.player, st = g.state;
    if (!p) return;
    this.$("hudHp").style.width = Math.max(0, p.hp / p.maxHp * 100) + "%";
    this.$("hudSt").style.width = Math.max(0, p.stamina / p.maxStamina * 100) + "%";
    const hw = this.$("hudHorseWrap");
    if (p.mount) {
      hw.hidden = false;
      this.$("hudHorse").style.width = Math.max(0, p.mount.stamina / p.mount.breed.stamina * 100) + "%";
    } else hw.hidden = true;
    const w = p.weapon;
    this.$("hudWName").textContent = w ? w.name : "";
    let stateTxt = "";
    if (w && w.kind === "gun") stateTxt = p.reloading > 0 ? "перезарядка" : p.loaded[w.id] ? "заряжено" : "не заряжено — R";
    if (w && w.kind === "bow") stateTxt = `стрел: ${st.res.arrows || 0}`;
    if (w && w.kind === "melee") stateTxt = p.blocking ? "блок" : "";
    this.$("hudWState").textContent = stateTxt;
    const rw = this.$("hudReloadWrap");
    if (w && w.kind === "gun" && p.reloading > 0) {
      rw.hidden = false;
      const total = w.reload * (st.skills.fastReload ? 0.7 : 1);
      this.$("hudReload").style.width = (1 - p.reloading / total) * 100 + "%";
    } else rw.hidden = true;
    this.$("hudRes").textContent = `порох ${st.res.powder} · свинец ${st.res.lead} · ${st.res.coins} монет`;
    this.$("hudCross").hidden = !(p.aiming && g.rig.mode !== "first" || p.aiming);
    this.$("hudCross").classList.toggle("bow", !!(w && w.kind === "bow"));
    const seen = p.seenBy || 0;
    const eye = this.$("hudEye");
    eye.hidden = seen < 0.05;
    eye.style.opacity = 0.35 + seen * 0.65;
    eye.classList.toggle("alert", seen >= 1);
    p.seenBy = Math.max(0, seen - dt * 0.6);
    this.$("hudHurt").style.opacity = Math.min(0.8, p.hurtT * 1.6 + (p.hp < p.maxHp * 0.25 ? 0.25 : 0));
    if (this.bossActor) {
      this.$("hudBossHp").style.width = Math.max(0, this.bossActor.hp / this.bossActor.maxHp * 100) + "%";
      if (this.bossActor.dead) this.boss(null);
    }
    const reg = regionAt(p.pos.x, p.pos.z);
    if (reg.id !== this.lastRegion) {
      this.lastRegion = reg.id;
      const ctrl = st.regions[reg.id];
      const r = this.$("hudRegion");
      r.innerHTML = `<b>${reg.name}</b><span>${ctrl === "persian" ? "под властью шаха" : ctrl === "neutral" ? "колеблется" : "свободен"}</span>`;
      r.classList.remove("show");
      void r.offsetWidth;
      r.classList.add("show");
    }
    this.drawCompass();
    this.drawSquad();
  }

  drawCompass() {
    const g = this.game, c = this.compass;
    const W = 640, H = 44;
    c.clearRect(0, 0, W, H);
    const yaw = g.rig.yaw;
    const fov = Math.PI * 0.9;
    const toX = ang => {
      let d = ang - yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return W / 2 - d / fov * W;
    };
    c.font = "600 13px 'PT Sans', 'Segoe UI', sans-serif";
    c.textAlign = "center";
    const dirs = [["С", Math.PI], ["В", -Math.PI / 2], ["Ю", 0], ["З", Math.PI / 2], ["СВ", -Math.PI * 0.75], ["ЮВ", -Math.PI / 4], ["ЮЗ", Math.PI / 4], ["СЗ", Math.PI * 0.75]];
    for (const [t, a] of dirs) {
      const x = toX(a);
      if (x < 10 || x > W - 10) continue;
      c.fillStyle = t.length === 1 ? "rgba(236,227,207,0.95)" : "rgba(236,227,207,0.45)";
      c.fillText(t, x, 18);
    }
    for (let a = -Math.PI; a < Math.PI; a += Math.PI / 12) {
      const x = toX(a);
      if (x < 4 || x > W - 4) continue;
      c.fillStyle = "rgba(236,227,207,0.3)";
      c.fillRect(x - 0.5, 26, 1, 5);
    }
    const p = g.player.pos;
    for (const m of this.ui.markers()) {
      const ang = Math.atan2(m.x - p.x, m.z - p.z);
      const x = toX(ang);
      if (x < 8 || x > W - 8) continue;
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      c.fillStyle = m.color || "#d4a640";
      c.beginPath();
      if (m.shape === "dot") c.arc(x, 34, 3.5, 0, Math.PI * 2);
      else { c.moveTo(x, 40); c.lineTo(x - 6, 30); c.lineTo(x + 6, 30); c.closePath(); }
      c.fill();
      if (m.label && d > 15) {
        c.font = "600 11px 'PT Sans', sans-serif";
        c.fillStyle = "rgba(236,227,207,0.85)";
        c.textAlign = "left";
        c.fillText(d > 1000 ? (d / 1000).toFixed(1) + " км" : Math.round(d) + " м", x + 9, 40);
        c.textAlign = "center";
      }
    }
    c.fillStyle = "rgba(236,227,207,0.9)";
    c.fillRect(W / 2 - 1, 22, 2, 14);
  }

  drawSquad() {
    const g = this.game;
    const sq = g.squad ? g.squad.members.filter(m => !m.dead) : [];
    const box = this.$("hudSquad");
    const key = sq.length + ":" + (g.squad ? g.squad.order : "");
    if (key === this._sqKey) return;
    this._sqKey = key;
    if (!sq.length) { box.innerHTML = ""; return; }
    const ORD = { follow: "за мной", hold: "держать позицию", volley: "ждать залпа", attack: "в атаку", retreat: "отступать" };
    box.innerHTML = `<b>Отряд · ${sq.length}</b><span>${ORD[g.squad.order] || ""}</span>`;
  }
}

export { RES_NAMES };
