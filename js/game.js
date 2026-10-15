import * as THREE from "three";
import { Engine } from "./core/engine.js";
import { Input } from "./core/input.js";
import { Assets } from "./core/assets.js";
import { Events } from "./core/events.js";
import { CameraRig } from "./core/camera.js";
import { World } from "./world/world.js";
import { Statics } from "./world/statics.js";
import { Player } from "./actors/player.js";
import { settlement, HOMES } from "./world/geo.js";
import { WEAPONS } from "./combat/weapons.js";
import { ActorManager } from "./actors/manager.js";
import { Combat } from "./combat/combat.js";
import { Effects } from "./combat/effects.js";
import { Progress } from "./core/progress.js";
import { Interact } from "./core/interact.js";
import { UI } from "./ui/ui.js";
import { Squad } from "./actors/squad.js";
import { Dialog } from "./quests/dialog.js";
import { Cutscene } from "./quests/cutscene.js";
import { Quests } from "./quests/quests.js";
import { Chronicle } from "./quests/chronicle.js";
import { SaveSystem } from "./core/save.js";
import { Explore } from "./world/explore.js";
import { Book, Pause, Death, Credits, Trade, Radial } from "./ui/screens.js";
import { ORDERS } from "./actors/squad.js";
import { AudioSys } from "./core/audio.js";


export class Game {
  constructor(canvas, data, settings) {
    this.canvas = canvas;
    this.data = data;
    this.settings = settings;
    this.engine = new Engine(canvas, settings.quality);
    this.input = new Input(canvas);
    this.assets = new Assets("assets/");
    this.events = new Events();
    this.systems = {};
    this.uiBlocking = false;
    this.running = false;
    this.difficulty = 0.85;
    this.audio = new AudioSys(this);
  }

  peopleBonus(key) {
    const p = this.data.peoples[this.state.people];
    return (p && p.bonus && p.bonus[key]) || 0;
  }

  get people() {
    return this.data.peoples[this.state.people];
  }

  async start(state, onProgress = () => {}) {
    this.state = state;
    onProgress(0.05, "Рельеф и небо");
    this.world = new World(this);
    this.world.sky.hours = state.hours;
    this.world.sky.setWeather(state.weather);
    this.world.setSeason(state.season);
    this.rig = new CameraRig(this);
    this.effects = new Effects(this.engine);
    this.combat = new Combat(this);
    this.progress = new Progress(this);
    this.ui = new UI(this);
    this.dialog = new Dialog(this);
    this.cutscene = new Cutscene(this);
    this.chronicle = new Chronicle(this);
    this.save = new SaveSystem(this);
    for (const S of [Book, Pause, Death, Credits, Trade]) { const scr = new S(this); this.ui.register(scr.name, scr); }
    this.radial = new Radial(this, ORDERS);
    this.world.statics = new Statics(this);
    const t0 = performance.now();
    await this.world.statics.populate((f, name) => onProgress(0.05 + f * 0.1, name));
    this.loadTimes = { statics: Math.round(performance.now() - t0) };
    const home = settlement(state.home || HOMES[state.people]);
    const sp = state.pos ? state.pos : { x: home.p[0] + 12, z: home.p[1] + 14 };
    onProgress(0.15, "Герой");
    this.player = new Player(this, { model: this.people.model, name: state.heroName, slots: state.slots });
    await this.player.init();
    this.player.maxHp = 140 + 6 * (state.level - 1);
    this.player.hp = Math.max(30, Math.min(this.player.maxHp, state.hp || this.player.maxHp));
    this.player.maxStamina = 100 + 3 * (state.level - 1);
    this.player.stamina = this.player.maxStamina;
    this.player.pos.set(sp.x, 0, sp.z);
    this.player.pos.y = this.world.terrain.height(sp.x, sp.z) + 0.5;
    this.engine.scene.add(this.player.root);
    for (const w of state.weapons) if (WEAPONS[w] && WEAPONS[w].kind !== "melee") this.player.loaded[w] = true;
    const first = state.slots.findIndex(id => state.weapons.includes(id));
    await this.player.selectSlot(Math.max(0, first));
    this.rig.yaw = this.player.yaw = Math.atan2(home.p[0] - sp.x, home.p[1] - sp.z);
    onProgress(0.4, "Ландшафт");
    await this.world.terrain.whenReady(sp.x, sp.z);
    this.player.pos.y = this.world.ground(sp.x, sp.z);
    this.world.isForest = (x, z) => this.world.statics.isForest(x, z);
    this.addSystem("actors", new ActorManager(this));
    this.addSystem("combatSys", this.combat);
    this.addSystem("squad", new Squad(this));
    this.addSystem("interact", new Interact(this));
    this.addSystem("explore", new Explore(this));
    this.addSystem("quests", new Quests(this));
    this.addSystem("saveSys", this.save);
    this.addSystem("audioSys", this.audio);
    await this.combat.onStart();
    for (const sys of Object.values(this.systems)) if (sys.onStart && sys !== this.combat) await sys.onStart(this, onProgress);
    if (state.horse) {
      this.playerHorse = await this.actors.spawnHorse(state.horse.breed, sp.x + 3, sp.z + 2, { owner: this.player, name: state.horse.name, persistent: true });
      this.playerHorse.persistentQuest = true;
    }
    this.bindKeys();
    if (this.assets.failed.length) this.ui.toast(`Не загрузились модели (${this.assets.failed.length}). Обновите страницу (Ctrl+F5).`, "bad");
    if (this.assets.failed.length) this.ui.toast(`Не загрузились модели (${this.assets.failed.length}): ${this.assets.failed.slice(0, 3).join(", ")}…`, "bad");
    onProgress(1, "Готово");
    this.running = true;
    this.engine.start((dt, rdt) => this.frame(dt, rdt));
  }

  addSystem(name, sys) {
    this.systems[name] = sys;
    this[name] = sys;
    return sys;
  }

  frame(dt, rdt) {
    if (!this.running) return;
    this.state.playTime += dt;
    this.player.update(dt);
    for (const sys of Object.values(this.systems)) if (sys.update) sys.update(dt, rdt);
    this.effects.update(dt);
    this.radial.update(rdt);
    this.rig.update(rdt);
    this.ui.update(rdt);
    this.world.update(dt, this.player.pos);
    this.state.hours = this.world.sky.hours;
    this.input.endFrame();
  }
}

Game.prototype.bindKeys = function () {
  const BOOK = { KeyM: "map", KeyJ: "journal", KeyI: "gear", KeyL: "chronicle" };
  window.addEventListener("keydown", e => {
    if (!this.running || (e.target && e.target.tagName === "INPUT")) return;
    if (this.dialog.active || this.cutscene.active) return;
    const ui = this.ui;
    if (e.code === "Escape") {
      e.preventDefault();
      if (ui.open === "death") return;
      if (ui.open && ui.open !== "pause") ui.hide();
      else if (ui.open === "pause") ui.hide();
      else ui.show("pause");
      this.escAt = performance.now();
      return;
    }
    if (BOOK[e.code] && ui.open !== "death" && ui.open !== "pause" && ui.open !== "trade") {
      e.preventDefault();
      if (ui.open === "book" && ui.screens.book.tab === BOOK[e.code]) ui.hide();
      else if (ui.open === "book") { ui.screens.book.tab = BOOK[e.code]; ui.screens.book.render(); }
      else ui.show("book", BOOK[e.code]);
    }
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement) { this.wasLocked = true; return; }
    if (!this.running || !this.wasLocked || this.autoplay) return;
    if (performance.now() - (this.input.selfUnlockAt || 0) < 400) return;
    setTimeout(() => {
      if (document.pointerLockElement || this.ui.open || this.dialog.active || this.cutscene.active || this.uiBlocking) return;
      if (performance.now() - (this.escAt || 0) < 300) return;
      this.ui.show("pause");
    }, 120);
  });
};

export async function debugSpawn(game, unit, count = 1, dist = 25, opts = {}) {
  const p = game.player;
  const f = p.forward(new THREE.Vector3());
  const x = p.pos.x + f.x * dist, z = p.pos.z + f.z * dist;
  const team = game.data.units[unit].team;
  return game.actors.spawnGroup(team, [[unit, count]], x, z, { state: opts.state || "idle", spread: 5, ...opts });
}
