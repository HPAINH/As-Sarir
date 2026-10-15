import { SAVE_VERSION } from "./state.js";

const DB = "as-sarir";
const STORE = "saves";
export const SLOTS = ["auto", "slot1", "slot2", "slot3"];

function openDB() {
  return new Promise((res, rej) => {
    if (!window.indexedDB) return rej(new Error("no idb"));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  try {
    const db = await openDB();
    return await new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      const req = fn(st);
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  } catch (e) {
    return fallback(mode, fn);
  }
}

function fallback(mode, fn) {
  const key = k => "as-sarir-save-" + k;
  const st = {
    put: (v, k) => { try { localStorage.setItem(key(k), JSON.stringify(v)); } catch (e) { } return {}; },
    get: k => { try { return { result: JSON.parse(localStorage.getItem(key(k)) || "null") }; } catch (e) { return { result: null }; } },
    delete: k => { try { localStorage.removeItem(key(k)); } catch (e) { } return {}; },
  };
  const r = fn(st);
  return r && r.result;
}

export async function writeSave(slot, data) {
  return tx("readwrite", st => st.put(data, slot));
}

export async function readSave(slot) {
  return tx("readonly", st => st.get(slot));
}

export async function deleteSave(slot) {
  return tx("readwrite", st => st.delete(slot));
}

export async function listSaves() {
  const out = {};
  for (const s of SLOTS) {
    const d = await readSave(s).catch(() => null);
    out[s] = d ? d.meta : null;
  }
  return out;
}

export async function latestSave() {
  const all = await listSaves();
  let best = null;
  for (const [slot, m] of Object.entries(all)) if (m && (!best || m.time > best.meta.time)) best = { slot, meta: m };
  return best;
}

export function validState(s) {
  return s && typeof s === "object" && s.people && s.missions && s.res && Array.isArray(s.weapons) && (s.version || 0) <= SAVE_VERSION;
}

export class SaveSystem {
  constructor(game) {
    this.game = game;
    this.autoT = 180;
    this.lastAuto = 0;
  }

  snapshot() {
    const g = this.game, st = g.state, p = g.player;
    if (p && !p.dead) {
      const mp = p.mount ? p.mount.pos : p.pos;
      st.pos = { x: Math.round(mp.x * 10) / 10, z: Math.round(mp.z * 10) / 10 };
      st.hp = Math.round(p.hp);
    }
    st.hours = g.world.sky.hours;
    if (g.playerHorse && !g.playerHorse.dead) st.horse = { breed: (g.playerHorse.breed && g.playerHorse.breed.id) || (st.horse && st.horse.breed) || "mountain", name: g.playerHorse.name };
    if (g.squad) st.squad = g.squad.alive().map(m => ({ unit: m.unitId, people: m.people }));
    const data = JSON.parse(JSON.stringify(st));
    const m = g.quests && g.quests.job ? g.quests.job.def : null;
    const P = g.data.peoples[st.people];
    return {
      meta: {
        time: Date.now(), hero: st.heroName, people: P ? P.name : st.people, level: st.level, act: st.act,
        mission: m ? m.title : null, done: st.missions.done.length, playTime: Math.round(st.playTime),
      },
      state: data,
    };
  }

  async save(slot = "auto", silent = false) {
    const g = this.game;
    if (g.player && g.player.dead) return false;
    try {
      await writeSave(slot, this.snapshot());
      if (!silent) g.ui.toast(slot === "auto" ? "Автосохранение" : "Игра сохранена", "good");
      return true;
    } catch (e) {
      console.error(e);
      g.ui.toast("Не удалось сохранить игру", "bad");
      return false;
    }
  }

  auto(reason) {
    const now = performance.now();
    if (now - this.lastAuto < 15000) return;
    this.lastAuto = now;
    this.autoT = 180;
    this.save("auto", reason !== "mission");
  }

  exportJSON() {
    const snap = this.snapshot();
    const blob = new Blob([JSON.stringify(snap, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `as-sarir-${snap.state.heroName}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  update(dt) {
    const g = this.game;
    if (!g.running || g.uiBlocking) return;
    this.autoT -= dt;
    if (this.autoT <= 0) {
      const busy = g.actors.near(g.player.pos.x, g.player.pos.z, 40).some(a => a.brain && a.brain.state === "combat" && !a.dead);
      if (busy) { this.autoT = 20; return; }
      this.auto("timer");
    }
  }
}

export async function importJSON(file) {
  const text = await file.text();
  const d = JSON.parse(text);
  const state = d.state || d;
  if (!validState(state)) throw new Error("Файл не похож на сохранение «Ас-Сарира»");
  return state;
}
