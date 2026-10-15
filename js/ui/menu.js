import * as THREE from "three";
import { el, esc } from "./hud.js";
import { Assets } from "../core/assets.js";
import { PEOPLES, SETTLEMENTS, REGIONS, RIVERS, HOMES, WORLD, HALF, settlement } from "../world/geo.js";
import { renderSaves, renderSettings, creditsHTML } from "./screens.js";
import { latestSave, readSave, validState } from "../core/save.js";
import { newState } from "../core/state.js";

const MOUNTAINS = `<svg class="mm-mountains" viewBox="0 0 1600 600" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
<path d="M0 420 L120 300 L210 360 L330 210 L430 320 L540 180 L650 300 L760 240 L880 330 L990 170 L1100 290 L1210 220 L1330 330 L1450 250 L1600 340 L1600 600 L0 600Z" fill="#2a2f37"/>
<path d="M0 480 L150 380 L260 430 L380 330 L470 400 L600 300 L720 420 L840 350 L960 440 L1080 320 L1200 410 L1320 360 L1460 430 L1600 380 L1600 600 L0 600Z" fill="#1f2329"/>
<path d="M0 540 L200 470 L320 500 L470 440 L610 510 L760 460 L900 520 L1040 470 L1200 520 L1350 470 L1600 530 L1600 600 L0 600Z" fill="#16191d"/>
<g fill="#16191d"><rect x="1120" y="420" width="16" height="70"/><rect x="1116" y="414" width="24" height="10"/><rect x="1150" y="470" width="34" height="30"/><rect x="1186" y="478" width="28" height="22"/><rect x="1086" y="476" width="30" height="24"/></g>
</svg>`;

const TIPS = [
  "Перезарядка кремнёвого ружья — 6–8 секунд. Каждый выстрел — решение.",
  "Пригнитесь (C), чтобы двигаться тише. Ночью и в тумане вас видно хуже.",
  "Убитый офицер — паника в отряде. Персы без юзбаши теряют строй.",
  "Конница сильна на равнине и слаба в ущельях и на террасах.",
  "В 1741 году Надир-шах поставил лагерь на плато Турчидаг между Мегебом и Чалда.",
  "Поднимитесь на сторожевую башню, чтобы открыть регион на карте.",
  "Старейшины других народов дают поручения. Выполните три — и народ вступит в союз.",
  "Q — команды отряду. H — свистнуть коня. V — вид от первого лица.",
];

export class Loading {
  constructor(root) {
    this.el = el("div", "loading");
    this.el.innerHTML = `${MOUNTAINS}<div class="ld-box"><h2>Ас-Сарир</h2><div class="ld-bar"><i></i></div><p class="ld-text"></p><p class="ld-tip"></p></div>`;
    root.appendChild(this.el);
    this.el.querySelector(".ld-tip").textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    this.set(0, "Подготовка");
  }
  set(f, text) {
    this.el.querySelector(".ld-bar i").style.width = Math.round(f * 100) + "%";
    if (text) this.el.querySelector(".ld-text").textContent = text + "…";
  }
  done() {
    this.el.classList.add("out");
    setTimeout(() => this.el.remove(), 700);
  }
}

class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
    this.camera.position.set(0, 1.35, 4.6);
    this.camera.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight(0xdfe6ef, 0x3a3226, 1.3));
    const sun = new THREE.DirectionalLight(0xffe2b8, 2.2);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x9fb4d8, 1.2);
    rim.position.set(-3, 2, -3);
    this.scene.add(rim);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), new THREE.MeshStandardMaterial({ color: 0x2a2620, roughness: 1 }));
    disc.rotation.x = -Math.PI / 2;
    this.scene.add(disc);
    this.assets = new Assets("assets/");
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.clock = new THREE.Clock();
    this.running = true;
    this.drag = 0;
    this.yaw = 0.4;
    canvas.addEventListener("pointerdown", e => { this.dragX = e.clientX; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener("pointermove", e => { if (this.dragX !== undefined) { this.yaw += (e.clientX - this.dragX) * 0.01; this.dragX = e.clientX; } });
    canvas.addEventListener("pointerup", () => { this.dragX = undefined; });
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, this.clock.getDelta());
      if (this.dragX === undefined) this.yaw += dt * 0.35;
      this.holder.rotation.y = this.yaw;
      if (this.mixer) this.mixer.update(dt);
      const w = canvas.clientWidth, h = canvas.clientHeight;
      if (w && h && (canvas.width !== Math.round(w * Math.min(2, devicePixelRatio)) || this.lastH !== h)) {
        this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.lastH = h;
      }
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }
  async show(model) {
    const token = (this.token = (this.token || 0) + 1);
    let inst;
    try { inst = await this.assets.instance(model); } catch (e) { return; }
    if (token !== this.token || !inst) return;
    this.holder.clear();
    this.holder.add(inst.scene);
    this.mixer = new THREE.AnimationMixer(inst.scene);
    const clip = (inst.animations || []).find(a => a.name === "Idle");
    if (clip) this.mixer.clipAction(clip).play();
  }
  dispose() {
    this.running = false;
    this.renderer.dispose();
  }
}

function miniMap(home) {
  const s = v => ((v + HALF) / WORLD * 200).toFixed(1);
  const rivers = RIVERS.map(r => `<polyline points="${r.pts.map(([x, z]) => s(x) + "," + s(z)).join(" ")}" fill="none" stroke="#5b86b8" stroke-width="1.2"/>`).join("");
  const dots = SETTLEMENTS.map(v => `<circle cx="${s(v.p[0])}" cy="${s(v.p[1])}" r="${v.id === home ? 5 : 2}" fill="${v.id === home ? "#cfa24a" : "#ece3cf"}" opacity="${v.id === home ? 1 : 0.5}"/>`).join("");
  const sea = `<path d="M${s(1530)} 0 Q ${s(1450)} 100 ${s(1600)} 200 L200 200 L200 0Z" fill="#2c4258"/>`;
  return `<svg viewBox="0 0 200 200" class="mini-map" role="img" aria-label="Карта Дагестана"><rect width="200" height="200" fill="#3a3a30"/>${sea}${rivers}${dots}</svg>`;
}

export class MainMenu {
  constructor(root, data, settings) {
    this.root = root;
    this.data = data;
    this.settings = settings;
    this.el = el("div", "mainmenu screen");
    root.appendChild(this.el);
  }

  run() {
    return new Promise(res => { this.resolve = res; this.title(); });
  }

  finish(state) {
    if (this.preview) this.preview.dispose();
    this.el.remove();
    this.resolve(state);
  }

  async title() {
    if (this.preview) { this.preview.dispose(); this.preview = null; }
    const last = await latestSave().catch(() => null);
    this.el.innerHTML = `${MOUNTAINS}<div class="mm-title"><h1>Ас-Сарир</h1><p>Дагестан · 1741–1743</p></div>
      <nav class="mm-nav">${last ? `<button class="btn gold" data-a="continue">Продолжить<span>${esc(last.meta.hero)} · ${esc(last.meta.people)} · ${esc(last.meta.mission || "свободная игра")}</span></button>` : ""}
      <button class="btn ${last ? "" : "gold"}" data-a="new">Новая игра</button><button class="btn" data-a="load">Загрузить</button>
      <button class="btn" data-a="settings">Настройки</button><button class="btn" data-a="chronicle">Летопись</button><button class="btn ghost" data-a="credits">Об игре и авторы</button></nav>
      <p class="mm-foot">Историческая игра с открытым миром. Вымысел отмечен в «Летописи».</p>`;
    const on = (a, f) => { const b = this.el.querySelector(`[data-a=${a}]`); if (b) b.onclick = f; };
    on("continue", async () => { const d = await readSave(last.slot); if (d && validState(d.state)) this.finish(d.state); });
    on("new", () => this.choose());
    on("load", () => this.sub("saves"));
    on("settings", () => this.sub("settings"));
    on("chronicle", () => this.chronicle(last));
    on("credits", () => { this.el.innerHTML = `<div class="menu-screen">${creditsHTML(false)}<div class="menu-list row"><button class="btn gold">Назад</button></div></div></div>`; this.el.querySelector(".menu-list button").onclick = () => this.title(); });
  }

  sub(kind) {
    const host = el("div", "menu-screen");
    this.el.innerHTML = "";
    this.el.appendChild(host);
    const scr = { root: host, game: { settings: this.settings, ui: { toast() { } } } };
    const back = () => this.title();
    if (kind === "settings") renderSettings(scr, back);
    else renderSaves(scr, false, back, async slot => { const d = await readSave(slot); if (d && validState(d.state)) this.finish(d.state); });
  }

  async chronicle(last) {
    const all = this.data.chronicle;
    let open = ["intro"];
    if (last) { const d = await readSave(last.slot).catch(() => null); if (d) open = d.state.chronicle; }
    const list = open.filter(id => all[id]);
    this.el.innerHTML = `<div class="menu-screen"><div class="menu-card wide mm-chron"><h2>Летопись</h2><p class="hint">Открыто ${list.length} из ${Object.keys(all).length}. Записи открываются по ходу игры.</p>
      ${list.map(id => `<details><summary>${esc(all[id].title)}${all[id].fiction ? " <i>вымысел</i>" : ""}</summary><p>${esc(all[id].text)}</p>${all[id].versions ? all[id].versions.map(v => `<p class="hint">• ${esc(v)}</p>`).join("") : ""}</details>`).join("")}
      <div class="menu-list row"><button class="btn gold">Назад</button></div></div></div>`;
    this.el.querySelector(".menu-list button").onclick = () => this.title();
  }

  choose() {
    const D = this.data.peoples;
    this.pick = this.pick || "avar";
    this.el.innerHTML = `<div class="pick">
      <header><button class="btn ghost" data-back>← Назад</button><h2>Выберите народ</h2><span class="hint">Народ определяет родное село, оружие и бонус. Остальных придётся убедить вступить в союз.</span></header>
      <ul class="pick-list">${PEOPLES.map(id => `<li><button data-p="${id}"><b>${D[id].name}</b><span>${esc(settlement(HOMES[id]).name)}</span></button></li>`).join("")}</ul>
      <div class="pick-stage"><canvas class="pick-cv"></canvas><p class="hint">Перетащите, чтобы повернуть</p></div>
      <aside class="pick-info"></aside>
      <footer><label>Имя героя <input type="text" maxlength="20" value="${esc(this.name || "")}" placeholder="Например, Магомед"></label><button class="btn gold" data-go>Начать путь</button></footer></div>`;
    this.preview = new Preview(this.el.querySelector(".pick-cv"));
    this.el.querySelector("[data-back]").onclick = () => this.title();
    this.el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => this.select(b.dataset.p));
    const input = this.el.querySelector("input");
    input.oninput = () => { this.name = input.value; };
    this.el.querySelector("[data-go]").onclick = () => {
      const name = (input.value || "").trim() || DEFAULT_NAMES[this.pick];
      this.finish(newState(D[this.pick], name));
    };
    this.select(this.pick);
  }

  select(id) {
    const P = this.data.peoples[id];
    this.pick = id;
    this.el.querySelectorAll("[data-p]").forEach(b => b.classList.toggle("on", b.dataset.p === id));
    const home = settlement(HOMES[id]);
    const reg = REGIONS.find(r => r.id === home.region);
    const U = this.data.units[P.unit.id];
    this.el.querySelector(".pick-info").innerHTML = `<h3>${P.name}</h3><p class="hint">${esc(P.polity)}</p>
      ${miniMap(home.id)}<p><b>Родное село:</b> ${esc(home.name)}, ${esc(reg ? reg.name : "")}</p>
      <p><b>Бонус:</b> ${esc(P.bonusText)}</p><p><b>Уникальный отряд:</b> ${esc(P.unit.name)}${U ? "" : ""}</p><p><b>Предмет:</b> ${esc(P.uniqueItem)}</p>
      <p class="pick-hist">${esc(P.history)}</p>`;
    if (this.preview) this.preview.show(P.model);
  }
}

const DEFAULT_NAMES = { avar: "Магомед", dargin: "Гаджи", lak: "Будай", lezgin: "Шах-Али", tabasaran: "Рамазан", agul: "Алибек", rutul: "Ширин", tsakhur: "Исмаил", kumyk: "Айдемир" };

export function clickToPlay(root, canvas, input) {
  return new Promise(res => {
    const o = el("div", "click-play screen", `<div><b>Нажмите, чтобы начать</b><span>WASD — движение · мышь — обзор · ЛКМ/ПКМ — удар/блок · E — действие · M/J/I — карта, журнал, снаряжение · Esc — пауза</span></div>`);
    root.appendChild(o);
    o.onclick = () => { input.lock(); o.remove(); res(); };
  });
}
