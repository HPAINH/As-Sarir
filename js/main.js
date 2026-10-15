import { Game, debugSpawn } from "./game.js";
import { newState, migrateState } from "./core/state.js";
import { installDebug } from "./quests/debug.js";
import { MainMenu, Loading, clickToPlay } from "./ui/menu.js";
import { readSave, validState } from "./core/save.js";

const DATA_FILES = ["peoples", "units", "missions", "dialogs", "cutscenes", "chronicle"];

export async function loadData() {
  const out = {};
  await Promise.all(DATA_FILES.map(async f => {
    const r = await fetch("data/" + f + ".json");
    out[f] = await r.json();
  }));
  return out;
}

export function loadSettings() {
  const def = { quality: "medium", sensitivity: 1, invertY: false, volume: 0.8, music: 0.5 };
  try {
    return { ...def, ...JSON.parse(localStorage.getItem("as-sarir-settings") || "{}") };
  } catch (e) {
    return def;
  }
}

async function pendingLoad() {
  let slot = null;
  try { slot = sessionStorage.getItem("as-sarir-load"); sessionStorage.removeItem("as-sarir-load"); } catch (e) { }
  if (!slot) return null;
  const d = await readSave(slot).catch(() => null);
  return d && validState(d.state) ? d.state : null;
}

async function boot() {
  const data = await loadData();
  const settings = loadSettings();
  const params = new URLSearchParams(location.search);
  if (params.get("q")) settings.quality = params.get("q");
  const canvas = document.getElementById("game");
  const ui = document.getElementById("ui");
  const quick = params.get("quick");
  let state;
  if (quick && data.peoples[quick]) {
    state = newState(data.peoples[quick], "Тест");
    if (params.get("x")) state.pos = { x: +params.get("x"), z: +params.get("z") };
    if (params.get("h")) state.hours = +params.get("h");
    if (params.get("horse")) state.horse = { breed: params.get("horse"), name: "Тестовый" };
    if (params.get("w")) state.weather = params.get("w");
  } else {
    state = await pendingLoad();
    if (!state) state = await new MainMenu(ui, data, settings).run();
  }
  state = migrateState(state, data.peoples);
  const game = new Game(canvas, data, settings);
  window.G = game;
  window.debugSpawn = (u, n, d, o) => debugSpawn(game, u, n, d, o);
  if (params.get("debug")) installDebug(game);
  let startPlay;
  game.playing = new Promise(r => { startPlay = r; });
  const loading = quick ? null : new Loading(ui);
  await game.start(state, (f, t) => loading && loading.set(f, t));
  canvas.addEventListener("click", () => { if (!game.uiBlocking) game.input.lock(); });
  if (loading) {
    loading.done();
    await clickToPlay(ui, canvas, game.input);
  }
  startPlay();
  window.GAME_READY = true;
}

boot().catch(e => {
  console.error(e);
  document.body.insertAdjacentHTML("beforeend", `<pre style="color:#fff;position:fixed;top:0;left:0;z-index:99;white-space:pre-wrap">${e.stack || e}</pre>`);
});
