import { el, esc } from "./hud.js";
import { WEAPONS, ARMORS } from "../combat/weapons.js";
import { SKILLS } from "../core/progress.js";
import { levelXp } from "../core/state.js";
import { REGIONS, SETTLEMENTS, POI, OUTPOSTS, RIVERS, PEOPLES, HOMES, WORLD, HALF, settlement, regionAt, DERBENT, TURCHIDAG } from "../world/geo.js";
import { ROAD_LINES, heightAt } from "../world/heightmap.js";
import { SLOTS, listSaves, readSave, deleteSave, importJSON } from "../core/save.js";
import { homeId, fmt } from "../quests/locs.js";

export const ITEM_INFO = {
  rifle_sogratl: { name: "Наследное ружьё мастера из Согратля", text: "Бьёт дальше и точнее обычного ружья, заряжается быстрее." },
  kinjal_kubachi: { name: "Кинжал с чернью кубачинской работы", text: "Острее и легче простого кинжала." },
  banner_kazikumukh: { name: "Знамя Казикумуха", text: "Пока знамя с вами, бойцы отряда бьют на 10% сильнее и реже бегут." },
  burka: { name: "Плащ-бурка", text: "Защищает от холода и стрел." },
  carpet_map: { name: "Ковёр-карта", text: "Показывает на карте заставы и персидские разъезды." },
  guide_staff: { name: "Посох проводника", text: "В тумане компас указывает ближайшее союзное село." },
  alarm_horn: { name: "Рог тревоги", text: "Клавиша B: раз в пять минут на зов приходят трое ополченцев." },
  shepherd_dog: { name: "Пёс-волкодав", text: "Верный компаньон: бросается на врагов и волков." },
  shamkhal_saddle: { name: "Седло шамхальской работы", text: "Конь скачет на 8% быстрее и меньше устаёт." },
  persian_saddle: { name: "Трофейное персидское седло", text: "Конь скачет на 5% быстрее." },
  relic1: { name: "Подлокотник льва", text: "Часть трона Сарира. Бронзовая лапа льва из пещеры над Самуром.", relic: true },
  relic2: { name: "Спинка с орнаментом", text: "Часть трона Сарира. Кубачинская чеканка: древо, солнце, барс.", relic: true },
  relic3: { name: "Ножка-барс", text: "Часть трона Сарира. Найдена на скалах над Мегебом.", relic: true },
  relic4: { name: "Венец трона", text: "Часть трона Сарира. Хранилась в цитадели Нарын-кала.", relic: true },
};
const RES = [["coins", "Монеты"], ["powder", "Порох"], ["lead", "Свинец"], ["arrows", "Стрелы"], ["iron", "Железо"], ["food", "Провизия"]];
const CTRL = { highlanders: "свободен", persian: "под шахом", neutral: "колеблется" };
const CTRL_COLOR = { highlanders: "#6f9a5c", persian: "#a3352a", neutral: "#cfa24a", burned: "#555" };

class Screen {
  constructor(game, name, cls) {
    this.game = game;
    this.name = name;
    this.root = el("div", "screen " + cls);
    this.root.hidden = true;
    game.ui.root.appendChild(this.root);
  }
  show() { this.root.hidden = false; this.render(); }
  hide() { this.root.hidden = true; }
  render() { }
}

function btn(label, cls = "") {
  return `<button class="btn ${cls}">${label}</button>`;
}

export class Book extends Screen {
  constructor(game) {
    super(game, "book", "book");
    this.tab = "map";
    this.view = { cx: 0, cz: 0, zoom: 1 };
    this.sel = null;
    this.chron = null;
    this.slotSel = null;
  }

  show(tab) {
    if (tab) this.tab = tab;
    this.root.hidden = false;
    const p = this.game.player.pos;
    if (this.tab === "map") this.view = { cx: p.x, cz: p.z, zoom: this.view.zoom || 1 };
    this.render();
  }

  render() {
    const tabs = [["map", "Карта", "M"], ["journal", "Журнал", "J"], ["gear", "Снаряжение", "I"], ["chronicle", "Летопись", "L"]];
    this.root.innerHTML = `<div class="book-frame">
      <nav class="book-tabs">${tabs.map(([id, n, k]) => `<button data-tab="${id}" class="${this.tab === id ? "on" : ""}">${n} <kbd>${k}</kbd></button>`).join("")}
      <button class="book-close" data-close="1">Закрыть <kbd>Esc</kbd></button></nav>
      <div class="book-body"></div></div>`;
    this.root.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.render(); });
    this.root.querySelector("[data-close]").onclick = () => this.game.ui.hide();
    const body = this.root.querySelector(".book-body");
    if (this.tab === "map") this.renderMap(body);
    if (this.tab === "journal") this.renderJournal(body);
    if (this.tab === "gear") this.renderGear(body);
    if (this.tab === "chronicle") this.renderChronicle(body);
  }

  revealed(regionId) {
    const st = this.game.state;
    if (st.flags.reveal_all) return true;
    const P = this.game.data.peoples[st.people];
    if (P && P.region === regionId) return true;
    return POI.some(p => p.type === "tower" && p.region === regionId && st.towers.includes(p.id)) || (st.explored || []).includes(regionId);
  }

  buildRelief() {
    if (Book.relief) return Book.relief;
    const N = 256;
    const H = new Float32Array(N * N);
    const R = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N * WORLD - HALF, z = (j + 0.5) / N * WORLD - HALF;
      H[j * N + i] = heightAt(x, z);
      R[j * N + i] = REGIONS.indexOf(regionAt(x, z));
    }
    const c = document.createElement("canvas");
    c.width = c.height = N;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(N, N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = j * N + i, h = H[k];
      const hx = H[j * N + Math.min(N - 1, i + 1)] - H[j * N + Math.max(0, i - 1)];
      const hz = H[Math.min(N - 1, j + 1) * N + i] - H[Math.max(0, j - 1) * N + i];
      const shade = Math.max(0.35, Math.min(1.25, 0.9 - (hx * 0.6 + hz * 0.8) / 18));
      let r, g, b;
      if (h < 1.5) { r = 54; g = 82; b = 104; }
      else if (h < 40) { r = 150; g = 152; b = 104; }
      else if (h < 140) { r = 128; g = 136; b = 96; }
      else if (h < 260) { r = 132; g = 124; b = 108; }
      else { r = 196; g = 192; b = 186; }
      img.data[k * 4] = Math.min(255, r * shade);
      img.data[k * 4 + 1] = Math.min(255, g * shade);
      img.data[k * 4 + 2] = Math.min(255, b * shade);
      img.data[k * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    Book.relief = { canvas: c, R, N };
    return Book.relief;
  }

  renderMap(body) {
    const g = this.game, st = g.state;
    body.innerHTML = `<div class="map-wrap"><canvas class="map-cv"></canvas><div class="map-tip" hidden></div></div>
      <aside class="map-side"><h3>Регионы</h3><ul class="map-regions">${REGIONS.map(r => `<li><i style="background:${CTRL_COLOR[st.regions[r.id]] || "#777"}"></i>${esc(r.name)}<span>${this.revealed(r.id) ? CTRL[st.regions[r.id]] || "" : "не разведан"}</span></li>`).join("")}</ul>
      <h3>Реликвии</h3><ul class="map-relics">${[1, 2, 3, 4].map(n => `<li class="${st.relics[n] || "none"}">${ITEM_INFO["relic" + n].name}<span>${st.relics[n] === "player" ? "у вас" : st.relics[n] === "persian" ? "у персов" : "не найдена"}</span></li>`).join("")}</ul>
      <div class="map-travel"></div>
      <p class="hint">Колесо — масштаб, перетаскивание — сдвиг. Щелчок по свободному селу, где вы бывали, — быстрый переход.</p></aside>`;
    const cv = body.querySelector(".map-cv");
    const wrap = body.querySelector(".map-wrap");
    const tip = body.querySelector(".map-tip");
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = Math.max(200, r.width * dpr);
      cv.height = Math.max(200, r.height * dpr);
      cv.style.width = r.width + "px";
      cv.style.height = r.height + "px";
      this.drawMap(cv);
    };
    requestAnimationFrame(resize);
    let drag = null;
    cv.onmousedown = e => { drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false }; };
    window.onmouseup = e => {
      if (drag && !drag.moved) this.mapClick(cv, e);
      drag = null;
    };
    cv.onmousemove = e => {
      if (drag) {
        const s = this.mapScale(cv);
        const dx = (e.clientX - drag.x), dy = (e.clientY - drag.y);
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        this.view.cx = drag.cx - dx * (window.devicePixelRatio || 1) / s;
        this.view.cz = drag.cz - dy * (window.devicePixelRatio || 1) / s;
        this.drawMap(cv);
        return;
      }
      const hit = this.mapHit(cv, e);
      if (hit) {
        tip.hidden = false;
        tip.innerHTML = hit.html;
        const r = wrap.getBoundingClientRect();
        tip.style.left = Math.min(r.width - 220, e.clientX - r.left + 14) + "px";
        tip.style.top = (e.clientY - r.top + 10) + "px";
      } else tip.hidden = true;
    };
    cv.onwheel = e => {
      e.preventDefault();
      this.view.zoom = Math.max(1, Math.min(5, this.view.zoom * (e.deltaY < 0 ? 1.25 : 0.8)));
      this.drawMap(cv);
    };
  }

  mapScale(cv) {
    return Math.min(cv.width, cv.height) / WORLD * this.view.zoom;
  }

  toScreen(cv, x, z) {
    const s = this.mapScale(cv);
    const cx = this.view.zoom === 1 ? 0 : this.view.cx, cz = this.view.zoom === 1 ? 0 : this.view.cz;
    return [cv.width / 2 + (x - cx) * s, cv.height / 2 + (z - cz) * s];
  }

  fromScreen(cv, px, py) {
    const s = this.mapScale(cv);
    const cx = this.view.zoom === 1 ? 0 : this.view.cx, cz = this.view.zoom === 1 ? 0 : this.view.cz;
    return [(px - cv.width / 2) / s + cx, (py - cv.height / 2) / s + cz];
  }

  canTravel(s) {
    const g = this.game, st = g.state;
    const ctrl = st.villages[s.id] || "highlanders";
    return (st.visited || []).includes(s.id) && ctrl === "highlanders";
  }

  mapHit(cv, e) {
    const g = this.game, st = g.state;
    const r = cv.getBoundingClientRect();
    const dpr = cv.width / r.width;
    const px = (e.clientX - r.left) * dpr, py = (e.clientY - r.top) * dpr;
    let best = null, bd = 14 * dpr;
    for (const s of SETTLEMENTS) {
      if (!this.revealed(s.region) && !(st.visited || []).includes(s.id)) continue;
      const [x, y] = this.toScreen(cv, s.p[0], s.p[1]);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) {
        bd = d;
        const ctrl = st.villages[s.id] || "highlanders";
        const P = g.data.peoples[s.people];
        best = { s, html: `<b>${esc(s.name)}</b><span>${P ? P.name : ""} · ${ctrl === "persian" ? "занято персами" : ctrl === "burned" ? "сожжено" : "свободно"}</span>${this.canTravel(s) ? "<em>Щелчок — быстрый переход</em>" : ""}` };
      }
    }
    for (const p of POI) {
      if (!this.revealed(p.region)) continue;
      const [x, y] = this.toScreen(cv, p.p[0], p.p[1]);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) { bd = d; best = { html: `<b>${esc(p.name)}</b>${p.type === "tower" ? `<span>${st.towers.includes(p.id) ? "разведана" : "поднимитесь, чтобы открыть регион"}</span>` : ""}` }; }
    }
    return best;
  }

  mapClick(cv, e) {
    const hit = this.mapHit(cv, e);
    const box = this.root.querySelector(".map-travel");
    if (!box) return;
    if (hit && hit.s && this.canTravel(hit.s)) {
      const g = this.game;
      const job = g.quests.job;
      const blocked = job && job.def.linear;
      box.innerHTML = `<p><b>${esc(hit.s.name)}</b></p>${blocked ? "<p class='hint'>Во время этого задания переход недоступен.</p>" : btn("Быстрый переход", "gold")}`;
      const b = box.querySelector("button");
      if (b) b.onclick = () => this.travel(hit.s);
    } else if (hit && hit.s) box.innerHTML = `<p class="hint">В «${esc(hit.s.name)}» можно перейти, только если село свободно и вы там уже бывали.</p>`;
  }

  async travel(s) {
    const g = this.game;
    const fighting = g.actors.near(g.player.pos.x, g.player.pos.z, 60).some(a => a.brain && a.brain.state === "combat" && a.team === "persian" && !a.dead);
    if (fighting) { g.ui.toast("Нельзя уйти в разгар боя", "bad"); return; }
    g.ui.hide();
    const V = g.world.statics.villages[s.id];
    const spot = V && V.spots.square ? V.spots.square : s.p;
    await g.quests.teleport([spot[0] + 3, spot[1] + 3], 2);
    const h = g.world.sky.hours;
    g.world.sky.hours = (h + 2) % 24;
    g.ui.toast(`Вы прибыли в ${s.name}. Прошло два часа.`);
  }

  drawMap(cv) {
    const g = this.game, st = g.state;
    const ctx = cv.getContext("2d");
    const { canvas: relief, R, N } = this.buildRelief();
    ctx.fillStyle = "#101215";
    ctx.fillRect(0, 0, cv.width, cv.height);
    const [x0, y0] = this.toScreen(cv, -HALF, -HALF);
    const [x1, y1] = this.toScreen(cv, HALF, HALF);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(relief, x0, y0, x1 - x0, y1 - y0);
    if (!this.fog || this.fogKey !== JSON.stringify([st.regions, st.towers, st.explored])) {
      this.fogKey = JSON.stringify([st.regions, st.towers, st.explored]);
      const f = document.createElement("canvas");
      f.width = f.height = N;
      const fc = f.getContext("2d");
      const img = fc.createImageData(N, N);
      const rev = REGIONS.map(r => this.revealed(r.id));
      const col = REGIONS.map(r => st.regions[r.id]);
      for (let k = 0; k < N * N; k++) {
        const ri = R[k];
        if (!rev[ri]) { img.data[k * 4] = 16; img.data[k * 4 + 1] = 18; img.data[k * 4 + 2] = 22; img.data[k * 4 + 3] = 175; continue; }
        const c = col[ri];
        if (c === "persian") { img.data[k * 4] = 163; img.data[k * 4 + 1] = 53; img.data[k * 4 + 2] = 42; img.data[k * 4 + 3] = 70; }
        else if (c === "neutral") { img.data[k * 4] = 207; img.data[k * 4 + 1] = 162; img.data[k * 4 + 2] = 74; img.data[k * 4 + 3] = 45; }
        const i = k % N, j = (k / N) | 0;
        const edge = (i < N - 1 && R[k + 1] !== ri) || (j < N - 1 && R[k + N] !== ri);
        if (edge) { img.data[k * 4] = 236; img.data[k * 4 + 1] = 227; img.data[k * 4 + 2] = 207; img.data[k * 4 + 3] = 120; }
      }
      fc.putImageData(img, 0, 0);
      this.fog = f;
    }
    ctx.drawImage(this.fog, x0, y0, x1 - x0, y1 - y0);
    const s = this.mapScale(cv);
    const dpr = cv.width / (cv.getBoundingClientRect().width || cv.width);
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(91,134,184,0.9)";
    for (const rv of RIVERS) {
      ctx.lineWidth = Math.max(1, rv.w * s * 0.6);
      ctx.beginPath();
      rv.pts.forEach(([x, z], i) => { const [a, b] = this.toScreen(cv, x, z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(236,227,207,0.55)";
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.lineWidth = 1.2 * dpr;
    for (const rl of ROAD_LINES) {
      ctx.beginPath();
      rl.pts.forEach(([x, z], i) => { const [a, b] = this.toScreen(cv, x, z); i ? ctx.lineTo(a, b) : ctx.moveTo(a, b); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.textAlign = "center";
    ctx.font = `700 ${13 * dpr}px "PT Serif", Georgia, serif`;
    for (const r of REGIONS) {
      const [a, b] = this.toScreen(cv, r.c[0], r.c[1] - 90);
      ctx.fillStyle = "rgba(236,227,207,0.55)";
      ctx.fillText(r.name.toUpperCase(), a, b);
    }
    const [dx, dy] = this.toScreen(cv, (DERBENT.x0 + DERBENT.citadel[0]) / 2 + 40, (DERBENT.wallN + DERBENT.wallS) / 2);
    ctx.fillStyle = "#c9b48a";
    ctx.fillRect(dx - 5 * dpr, dy - 8 * dpr, 10 * dpr, 16 * dpr);
    const showPatrols = st.items.includes("carpet_map") || g.peopleBonus("patrol_marks");
    for (const op of OUTPOSTS) {
      if (st.outposts[op.id] === "destroyed" || !g.world.statics.hasTag("outpost:" + op.id)) continue;
      if (!this.revealed(op.region) && !showPatrols) continue;
      const [a, b] = this.toScreen(cv, op.p[0], op.p[1]);
      ctx.fillStyle = "#a3352a";
      ctx.beginPath(); ctx.moveTo(a, b - 6 * dpr); ctx.lineTo(a + 5 * dpr, b + 4 * dpr); ctx.lineTo(a - 5 * dpr, b + 4 * dpr); ctx.fill();
    }
    if (g.world.statics.hasTag("camp:turchidag")) {
      const [a, b] = this.toScreen(cv, TURCHIDAG.c[0], TURCHIDAG.c[1]);
      ctx.strokeStyle = "#a3352a"; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(a, b, 10 * dpr, 0, 7); ctx.stroke();
    }
    if (showPatrols) for (const gr of g.actors.groups) {
      if (gr.kind !== "patrol" || !gr.alive.length) continue;
      const m = gr.alive[0];
      const [a, b] = this.toScreen(cv, m.pos.x, m.pos.z);
      ctx.fillStyle = "#e0533f"; ctx.beginPath(); ctx.arc(a, b, 3 * dpr, 0, 7); ctx.fill();
    }
    for (const p of POI) {
      if (p.type !== "tower" || !this.revealed(p.region) && !st.towers.includes(p.id)) continue;
      const [a, b] = this.toScreen(cv, p.p[0], p.p[1]);
      ctx.fillStyle = st.towers.includes(p.id) ? "#ece3cf" : "rgba(236,227,207,0.4)";
      ctx.fillRect(a - 2.5 * dpr, b - 7 * dpr, 5 * dpr, 10 * dpr);
    }
    ctx.font = `600 ${11.5 * dpr}px "PT Sans", sans-serif`;
    for (const sv of SETTLEMENTS) {
      if (!this.revealed(sv.region) && !(st.visited || []).includes(sv.id)) continue;
      const [a, b] = this.toScreen(cv, sv.p[0], sv.p[1]);
      const ctrl = st.villages[sv.id] || "highlanders";
      ctx.fillStyle = CTRL_COLOR[ctrl];
      ctx.strokeStyle = "#14161a";
      ctx.lineWidth = 1.5 * dpr;
      const rr = (2.5 + sv.size) * dpr;
      ctx.beginPath(); ctx.arc(a, b, rr, 0, 7); ctx.fill(); ctx.stroke();
      if (st.unity.includes(sv.people) && HOMES[sv.people] === sv.id) { ctx.strokeStyle = "#cfa24a"; ctx.beginPath(); ctx.arc(a, b, rr + 3 * dpr, 0, 7); ctx.stroke(); }
      ctx.fillStyle = "#ece3cf";
      ctx.fillText(sv.name, a, b - rr - 4 * dpr);
    }
    for (const m of g.ui.markers()) {
      if (m.shape === "dot") continue;
      const [a, b] = this.toScreen(cv, m.x, m.z);
      ctx.fillStyle = m.color || "#e0b040";
      ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(a - 6 * dpr, b - 12 * dpr); ctx.lineTo(a + 6 * dpr, b - 12 * dpr); ctx.fill();
    }
    const p = g.player.pos;
    const [pa, pb] = this.toScreen(cv, p.x, p.z);
    const yaw = g.rig.yaw;
    ctx.save();
    ctx.translate(pa, pb);
    ctx.rotate(-yaw + Math.PI);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = "#14161a";
    ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(0, -9 * dpr); ctx.lineTo(6 * dpr, 7 * dpr); ctx.lineTo(0, 3 * dpr); ctx.lineTo(-6 * dpr, 7 * dpr); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  renderJournal(body) {
    const g = this.game, st = g.state, q = g.quests;
    const job = q.job;
    const cur = job ? job.def : q.nextMain();
    const curStep = job && job.def.steps[job.i];
    const objective = job ? (g.ui.hud.$("hudObj").querySelector("span") || {}).textContent || "" : cur ? fmt(g, cur.hint || "") : "";
    const doneMain = q.main.filter(m => st.missions.done.includes(m.id));
    const ACTS = ["Пролог", "Акт I. Гроза пришла", "Акт II. Пал Кумух", "Акт III. Андалал", "Акт IV. Зима шаха", "Эпилог"];
    const peoples = PEOPLES.map(id => {
      const P = g.data.peoples[id];
      const chain = q.sides.filter(s => s.people === id);
      const n = chain.filter(s => st.missions.done.includes(s.id)).length;
      const rep = st.reputation[id] || 0;
      return `<li class="${st.unity.includes(id) ? "in" : ""}"><b>${P.name}</b><span class="rep"><i style="width:${Math.max(0, Math.min(100, (rep + 100) / 2))}%"></i></span><em>${st.unity.includes(id) ? "в союзе" : `поручения ${n}/${chain.length}`}</em></li>`;
    }).join("");
    body.innerHTML = `<div class="journal">
      <section class="j-cur"><h2>${cur ? esc(cur.title) : "Свободная игра"}</h2>
        <p class="j-act">${ACTS[st.act] || ""}${cur && cur.n ? ` · задание ${cur.n} из 40` : ""}</p>
        ${cur ? `<p>${esc(cur.desc || "")}</p>` : ""}
        ${objective ? `<p class="j-obj">${esc(objective)}</p>` : ""}
        ${job && !job.def.linear ? btn("Отложить задание", "ghost j-abandon") : ""}</section>
      <section class="j-unity"><h3>Единство народов <b>${st.unity.length}/9</b></h3>
        <p class="hint">Помогайте старейшинам других народов. Для Андалальской битвы нужно не меньше пяти, для лучшего финала — все девять.</p>
        <ul class="j-peoples">${peoples}</ul></section>
      <section class="j-done"><h3>Пройдено</h3><ol>${doneMain.map(m => `<li>${esc(m.title)}</li>`).join("") || "<li class='hint'>Пока ничего</li>"}</ol></section>
    </div>`;
    const ab = body.querySelector(".j-abandon");
    if (ab) ab.onclick = () => { g.quests.abandon(); this.render(); };
  }

  renderGear(body) {
    const g = this.game, st = g.state, p = g.player;
    const P = g.data.peoples[st.people];
    const need = levelXp(st.level);
    const weapons = st.weapons.filter(w => WEAPONS[w]);
    const slotHtml = st.slots.map((w, i) => `<button class="slot ${this.slotSel === i ? "sel" : ""}" data-slot="${i}"><kbd>${i + 1}</kbd>${WEAPONS[w] ? esc(WEAPONS[w].name) : "—"}</button>`).join("");
    const wHtml = weapons.map(id => {
      const w = WEAPONS[id];
      const stat = w.kind === "melee" ? `урон ${w.dmg} · ${w.cd < 0.6 ? "быстрое" : w.cd < 0.8 ? "среднее" : "тяжёлое"}` : w.kind === "gun" ? `урон ${w.dmg} · перезарядка ${w.reload} с · ${w.range} м` : `урон ${w.dmg} · бесшумный`;
      return `<button class="witem" data-w="${id}"><b>${esc(w.name)}</b><span>${stat}</span></button>`;
    }).join("");
    const items = st.items.filter(i => ITEM_INFO[i] && !WEAPONS[i]).map(i => `<li class="${ITEM_INFO[i].relic ? "relic" : ""}"><b>${ITEM_INFO[i].name}</b><span>${ITEM_INFO[i].text}</span></li>`).join("");
    const skills = Object.entries(SKILLS).map(([k, br]) => `<div class="branch"><h4>${br.name}</h4>${br.list.map(sk => {
      const has = st.skills[sk.id], can = g.progress.canLearn(sk);
      return `<button class="skill ${has ? "has" : can ? "can" : ""}" data-sk="${sk.id}" ${has || !can ? "disabled" : ""}><b>${sk.name}</b><span>${sk.text}</span><em>${has ? "изучено" : `${sk.cost} оч.`}</em></button>`;
    }).join("")}</div>`).join("");
    body.innerHTML = `<div class="gear">
      <section class="g-hero"><h2>${esc(st.heroName)}</h2><p class="hint">${P.name} · уровень ${st.level}</p>
        <div class="bar xp"><i style="width:${Math.min(100, st.xp / need * 100)}%"></i></div><p class="hint">опыт ${st.xp} / ${need} · очков навыков: <b>${st.skillPoints}</b></p>
        <p>Здоровье ${Math.round(p.hp)} / ${p.maxHp} · броня: <b>${(ARMORS[st.armor] || ARMORS.none).name}</b></p>
        <p class="hint">Бонус народа: ${esc(P.bonusText)}</p>
        <h3>Припасы</h3><ul class="res">${RES.map(([k, n]) => `<li>${n}<b>${st.res[k] || 0}</b></li>`).join("")}</ul>
        <h3>Конь</h3><p>${st.horse ? esc(st.horse.name) : "нет"}${g.playerHorse && !g.playerHorse.dead ? ` · ${Math.round(g.playerHorse.hp)} / ${g.playerHorse.maxHp}` : ""}</p>
        <h3>Отряд</h3><p>${g.squad.alive().length} / ${g.progress.squadMax()} ${g.squad.alive().map(m => esc(m.name)).slice(0, 8).join(", ")}</p></section>
      <section class="g-weapons"><h3>Слоты оружия</h3><div class="slots">${slotHtml}</div><p class="hint">Выберите слот, затем оружие.</p>
        <div class="wlist">${wHtml}</div><h3>Предметы</h3><ul class="items">${items || "<li class='hint'>Пусто</li>"}</ul></section>
      <section class="g-skills"><h3>Навыки</h3><div class="branches">${skills}</div></section></div>`;
    body.querySelectorAll("[data-slot]").forEach(b => b.onclick = () => { this.slotSel = +b.dataset.slot; this.render(); });
    body.querySelectorAll("[data-w]").forEach(b => b.onclick = async () => {
      if (this.slotSel === null) return;
      const id = b.dataset.w;
      const other = st.slots.indexOf(id);
      if (other >= 0) st.slots[other] = st.slots[this.slotSel];
      st.slots[this.slotSel] = id;
      p.slots = st.slots;
      if (p.slot === this.slotSel || p.slot === other) await p.selectSlot(p.slot);
      this.slotSel = null;
      this.render();
    });
    body.querySelectorAll("[data-sk]").forEach(b => b.onclick = () => {
      const sk = Object.values(SKILLS).flatMap(x => x.list).find(s => s.id === b.dataset.sk);
      if (sk && g.progress.learn(sk)) { g.audio.ui("learn"); this.render(); }
    });
  }

  renderChronicle(body) {
    const g = this.game;
    const all = g.data.chronicle;
    const open = g.chronicle.list();
    if (!this.chron || !all[this.chron]) this.chron = open.length ? open[open.length - 1].id : null;
    const cats = {};
    for (const e of open) (cats[e.cat] = cats[e.cat] || []).push(e);
    const e = this.chron ? { id: this.chron, ...all[this.chron] } : null;
    body.innerHTML = `<div class="chron">
      <aside><p class="hint">Открыто ${open.length} из ${Object.keys(all).length}</p>${Object.entries(cats).map(([c, list]) => `<h4>${esc(c)}</h4><ul>${list.map(x => `<li><button data-c="${x.id}" class="${x.id === this.chron ? "on" : ""}">${esc(x.title)}${x.fiction ? " <i>вымысел</i>" : ""}</button></li>`).join("")}</ul>`).join("")}</aside>
      <article>${e ? `<h2>${esc(e.title)}</h2>${e.fiction ? `<p class="badge">Художественный вымысел</p>` : ""}<p>${esc(fmt(g, e.text))}</p>
        ${e.versions ? `<div class="versions">${e.versions.map((v, i) => `<div><b>Версия ${i + 1}</b><p>${esc(v)}</p></div>`).join("")}</div>` : ""}
        ${e.sources && e.sources.length ? `<h4>Источники</h4><ul class="src">${e.sources.map(s => `<li>${esc(s)}</li>`).join("")}</ul>` : ""}` : "<p class='hint'>Записи появятся по ходу игры.</p>"}</article></div>`;
    body.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { this.chron = b.dataset.c; this.render(); });
  }
}
Book.relief = null;

export class Pause extends Screen {
  constructor(game) { super(game, "pause", "menu-screen pause"); this.sub = null; }
  show() { this.sub = null; super.show(); }
  render() {
    const g = this.game;
    if (this.sub === "settings") return renderSettings(this, () => { this.sub = null; this.render(); });
    if (this.sub === "saves") return renderSaves(this, true, () => { this.sub = null; this.render(); });
    this.root.innerHTML = `<div class="menu-card"><h1>Ас-Сарир</h1><p class="hint">${esc(g.state.heroName)} · ${esc(g.data.peoples[g.state.people].name)} · ${fmtTime(g.state.playTime)}</p>
      <div class="menu-list">${btn("Продолжить", "gold") }${btn("Сохранить и загрузить")}${btn("Карта и журнал")}${btn("Настройки")}${btn("Об игре и авторы")}${btn("Выйти в главное меню", "ghost")}</div></div>`;
    const [cont, saves, book, settings, credits, quit] = this.root.querySelectorAll("button");
    cont.onclick = () => g.ui.hide();
    saves.onclick = () => { this.sub = "saves"; this.render(); };
    book.onclick = () => g.ui.show("book", "map");
    settings.onclick = () => { this.sub = "settings"; this.render(); };
    credits.onclick = () => g.ui.show("credits");
    quit.onclick = async () => { await g.save.save("auto", true); location.href = location.pathname; };
  }
}

export function fmtTime(sec) {
  const m = Math.floor(sec / 60), h = Math.floor(m / 60);
  return h ? `${h} ч ${m % 60} мин` : `${m} мин`;
}

export function renderSettings(scr, back) {
  const g = scr.game;
  const s = g.settings;
  scr.root.innerHTML = `<div class="menu-card wide"><h2>Настройки</h2>
    <label>Графика <select data-k="quality"><option value="low">Низкая</option><option value="medium">Средняя</option><option value="high">Высокая</option></select></label>
    <label>Чувствительность мыши <input type="range" min="0.3" max="2.5" step="0.05" data-k="sensitivity"></label>
    <label class="check"><input type="checkbox" data-k="invertY"> Инвертировать ось Y</label>
    <label>Громкость <input type="range" min="0" max="1" step="0.05" data-k="volume"></label>
    <label>Музыка <input type="range" min="0" max="1" step="0.05" data-k="music"></label>
    <p class="hint">Качество графики полностью применяется после перезапуска игры.</p>
    <div class="menu-list row">${btn("Назад", "gold")}</div></div>`;
  scr.root.querySelectorAll("[data-k]").forEach(inp => {
    const k = inp.dataset.k;
    if (inp.type === "checkbox") inp.checked = !!s[k];
    else inp.value = s[k];
    inp.oninput = inp.onchange = () => {
      s[k] = inp.type === "checkbox" ? inp.checked : inp.type === "range" ? +inp.value : inp.value;
      try { localStorage.setItem("as-sarir-settings", JSON.stringify(s)); } catch (e) { }
      if (k === "quality" && g.engine) g.engine.setQuality(s.quality);
      if (g.audio && g.audio.setVolume) g.audio.setVolume(s.volume, s.music);
    };
  });
  scr.root.querySelector(".menu-list button").onclick = back;
}

export async function renderSaves(scr, inGame, back, onLoad) {
  const g = scr.game;
  const list = await listSaves();
  const names = { auto: "Автосохранение", slot1: "Слот 1", slot2: "Слот 2", slot3: "Слот 3" };
  const row = slot => {
    const m = list[slot];
    const info = m ? `<b>${esc(m.hero)}</b> · ${esc(m.people)} · ур. ${m.level} · ${esc(m.mission || "свободная игра")}<span>${new Date(m.time).toLocaleString("ru-RU")} · ${fmtTime(m.playTime || 0)}</span>` : `<span>пусто</span>`;
    return `<li><div class="s-name">${names[slot]}</div><div class="s-info">${info}</div><div class="s-act">
      ${inGame && slot !== "auto" ? `<button class="btn" data-save="${slot}">Сохранить</button>` : ""}
      ${m ? `<button class="btn gold" data-load="${slot}">Загрузить</button><button class="btn ghost" data-del="${slot}">Удалить</button>` : ""}</div></li>`;
  };
  scr.root.innerHTML = `<div class="menu-card wide"><h2>Сохранения</h2><ul class="saves">${SLOTS.map(row).join("")}</ul>
    <div class="menu-list row">${inGame ? btn("Экспорт в файл") : ""}<label class="btn file">Импорт из файла<input type="file" accept=".json,application/json" hidden></label>${btn("Назад", "gold back")}</div>
    <p class="msg hint"></p></div>`;
  const msg = scr.root.querySelector(".msg");
  scr.root.querySelectorAll("[data-save]").forEach(b => b.onclick = async () => { await g.save.save(b.dataset.save); renderSaves(scr, inGame, back, onLoad); });
  scr.root.querySelectorAll("[data-load]").forEach(b => b.onclick = async () => {
    if (onLoad) return onLoad(b.dataset.load);
    try { sessionStorage.setItem("as-sarir-load", b.dataset.load); } catch (e) { }
    location.href = location.pathname;
  });
  scr.root.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (b.dataset.confirm) { await deleteSave(b.dataset.del); renderSaves(scr, inGame, back, onLoad); }
    else { b.dataset.confirm = "1"; b.textContent = "Точно удалить?"; }
  });
  const exp = [...scr.root.querySelectorAll(".menu-list button")].find(b => b.textContent === "Экспорт в файл");
  if (exp) exp.onclick = () => g.save.exportJSON();
  const fi = scr.root.querySelector("input[type=file]");
  fi.onchange = async () => {
    const f = fi.files[0];
    if (!f) return;
    try {
      const state = await importJSON(f);
      const { writeSave } = await import("../core/save.js");
      await writeSave("slot3", { meta: { time: Date.now(), hero: state.heroName, people: state.people, level: state.level, act: state.act, mission: "импорт", playTime: state.playTime }, state });
      msg.textContent = "Файл загружен в слот 3.";
      renderSaves(scr, inGame, back, onLoad);
    } catch (e) {
      msg.textContent = e.message;
    }
  };
  scr.root.querySelector(".back").onclick = back;
}

export class Death extends Screen {
  constructor(game) { super(game, "death", "menu-screen death"); }
  render() {
    const g = this.game;
    const job = g.state.missions.active && g.quests.byId[g.state.missions.active];
    this.root.innerHTML = `<div class="menu-card"><h1>Вы пали</h1><p>${job ? `Задание «${esc(job.title)}» начнётся с последней точки.` : "Односельчане нашли вас и отнесли домой. Часть монет пропала."}</p>
      <div class="menu-list">${btn("Подняться", "gold")}</div></div>`;
    this.root.querySelector("button").onclick = async () => { g.ui.hide(); await g.quests.respawn(); };
  }
}

export class Credits extends Screen {
  constructor(game) { super(game, "credits", "menu-screen credits"); }
  show(arg) { this.final = arg && arg.final; super.show(); }
  render() {
    const g = this.game;
    this.root.innerHTML = creditsHTML(this.final) + `<div class="menu-list row">${btn(this.final ? "Продолжить свободную игру" : "Назад", "gold")}</div></div>`;
    this.root.querySelector(".menu-list button").onclick = () => g.ui.hide();
  }
}

export function creditsHTML(final) {
  return `<div class="menu-card wide credits-card"><h1>${final ? "Конец кампании" : "Ас-Сарир"}</h1>
    ${final ? "<p>Шах ушёл из Дагестана. Мир остаётся открытым: заставы, башни, охота и поручения старейшин ждут вас.</p>" : ""}
    <h3>Об игре</h3><p>Историческая игра с открытым миром о войне народов Дагестана с армией Надир-шаха (1741–1743). Даты, места и исторические лица соответствуют источникам; вымышленные герои и события отмечены в «Летописи».</p>
    <h3>3D-модели и анимации</h3><p>Все 128 моделей, скелеты, 373 анимационных клипа и 18 текстур созданы для проекта процедурно (Blender, Pillow). Сторонние модели не использовались. Пропорции кинжала сверены с карточкой музейного предмета Metropolitan Museum of Art «Dagger (Kindjal) with Scabbard», Кубачи, 1818–1819.</p>
    <h3>Технологии</h3><p>Three.js (MIT), glTF-Transform (MIT), meshoptimizer (MIT), Khronos glTF Validator (Apache 2.0). Шрифты PT Serif и PT Sans — ParaType (SIL Open Font License). Звук синтезируется в браузере через Web Audio.</p>
    <h3>Источники</h3><p>Донесения резидента И. Калушкина; История Дагестана (Наука, 2004); L. Lockhart, «Nadir Shah» (1938); M. Axworthy, «The Sword of Persia» (2006); дагестанские исторические песни и предания.</p>`;
}

export class Trade extends Screen {
  constructor(game) { super(game, "trade", "menu-screen trade"); }
  show(npc) { this.npc = npc; super.show(); }
  price(base) {
    const g = this.game;
    const smith = this.npc && this.npc.unitId === "smith";
    let k = 1 - g.peopleBonus("trade");
    if (smith) k -= g.peopleBonus("forge_discount");
    const rep = g.state.reputation[(settlement(this.npc && this.npc.village) || {}).people] || 0;
    k -= Math.max(0, rep) / 1000;
    return Math.max(1, Math.round(base * k));
  }
  render() {
    const g = this.game, st = g.state;
    const smith = this.npc && this.npc.unitId === "smith";
    const goods = [["powder", 5, 10, "Порох ×5"], ["lead", 5, 8, "Свинец ×5"], ["arrows", 10, 8, "Стрелы ×10"], ["food", 2, 6, "Провизия ×2"]];
    const weapons = Object.values(WEAPONS).filter(w => w.price && !st.weapons.includes(w.id) && w.id !== "rifle_sogratl" && (smith || w.price <= 150));
    const armors = Object.values(ARMORS).filter(a => a.price && a.def > (ARMORS[st.armor] || ARMORS.none).def && (smith || a.id === "kaftan"));
    const v = settlement(this.npc && this.npc.village);
    this.root.innerHTML = `<div class="menu-card wide trade-card"><h2>${smith ? "Кузня" : "Лавка"}${v ? " · " + esc(v.name) : ""}</h2><p class="hint">У вас ${st.res.coins} монет · железо ${st.res.iron || 0}</p>
      <h3>Припасы</h3><ul class="goods">${goods.map(([k, n, p, name]) => `<li>${name}<span>${this.price(p)} мон.</span><button class="btn" data-buy="${k}" data-n="${n}" data-p="${this.price(p)}">Купить</button></li>`).join("")}
        <li>Продать железо ×1<span>+5 мон.</span><button class="btn ghost" data-sell="iron" ${st.res.iron ? "" : "disabled"}>Продать</button></li></ul>
      ${weapons.length ? `<h3>Оружие</h3><ul class="goods">${weapons.map(w => `<li>${esc(w.name)}<span>${this.price(w.price)} мон.</span><button class="btn" data-w="${w.id}" data-p="${this.price(w.price)}">Купить</button></li>`).join("")}</ul>` : ""}
      ${armors.length ? `<h3>Броня</h3><ul class="goods">${armors.map(a => `<li>${esc(a.name)}<span>${this.price(a.price)} мон.</span><button class="btn" data-a="${a.id}" data-p="${this.price(a.price)}">Купить</button></li>`).join("")}</ul>` : ""}
      ${smith && g.playerHorse ? "" : ""}
      <div class="menu-list row">${btn("Уйти", "gold")}</div><p class="msg hint"></p></div>`;
    const msg = this.root.querySelector(".msg");
    const pay = p => { if (st.res.coins < p) { msg.textContent = "Не хватает монет."; return false; } st.res.coins -= p; g.audio.ui("coin"); return true; };
    this.root.querySelectorAll("[data-buy]").forEach(b => b.onclick = () => { if (pay(+b.dataset.p)) { st.res[b.dataset.buy] = (st.res[b.dataset.buy] || 0) + +b.dataset.n; this.render(); } });
    this.root.querySelectorAll("[data-sell]").forEach(b => b.onclick = () => { if (st.res.iron > 0) { st.res.iron--; st.res.coins += 5; this.render(); } });
    this.root.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { if (pay(+b.dataset.p)) { st.weapons.push(b.dataset.w); g.ui.toast(`Куплено: ${WEAPONS[b.dataset.w].name}. Назначьте слот в снаряжении (I)`, "good"); this.render(); } });
    this.root.querySelectorAll("[data-a]").forEach(b => b.onclick = () => { if (pay(+b.dataset.p)) { st.armor = b.dataset.a; this.render(); } });
    this.root.querySelector(".menu-list button").onclick = () => g.ui.hide();
  }
}

export class Radial {
  constructor(game, orders) {
    this.game = game;
    this.orders = orders;
    this.root = el("div", "radial");
    this.root.hidden = true;
    this.root.innerHTML = orders.map((o, i) => {
      const a = (i / orders.length) * Math.PI * 2 - Math.PI / 2;
      return `<div class="r-opt" style="left:${50 + Math.cos(a) * 38}%;top:${50 + Math.sin(a) * 38}%"><kbd>${i + 1}</kbd>${o.name}</div>`;
    }).join("") + `<div class="r-center">Отряд</div>`;
    game.ui.root.appendChild(this.root);
    this.open = false;
    this.sel = -1;
    this.ax = 0; this.ay = 0;
  }
  update() {
    const g = this.game, inp = g.input;
    if (g.uiBlocking && !this.open) return;
    if (!this.open && inp.hit("KeyQ")) {
      this.open = true; this.sel = -1; this.ax = 0; this.ay = 0;
      this.root.hidden = false;
      g.radialOpen = true;
    }
    if (!this.open) return;
    this.ax += inp.mouse.dx; this.ay += inp.mouse.dy;
    if (Math.hypot(this.ax, this.ay) > 30) {
      let a = Math.atan2(this.ay, this.ax) + Math.PI / 2;
      if (a < 0) a += Math.PI * 2;
      this.sel = Math.round(a / (Math.PI * 2) * this.orders.length) % this.orders.length;
    }
    for (let i = 0; i < this.orders.length; i++) if (inp.hit("Digit" + (i + 1))) { this.sel = i; this.close(true); return; }
    this.root.querySelectorAll(".r-opt").forEach((o, i) => o.classList.toggle("on", i === this.sel));
    if (!inp.down("KeyQ")) this.close(true);
  }
  close(apply) {
    this.open = false;
    this.root.hidden = true;
    this.game.radialOpen = false;
    if (apply && this.sel >= 0) this.game.squad.command(this.orders[this.sel].id);
  }
}
