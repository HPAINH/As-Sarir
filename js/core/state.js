import { REGIONS, PEOPLES } from "../world/geo.js";

export const SAVE_VERSION = 1;

export function newState(peopleDef, heroName) {
  const regions = {};
  for (const r of REGIONS) regions[r.id] = r.control;
  const reputation = {};
  for (const p of PEOPLES) reputation[p] = p === peopleDef.id ? 50 : 0;
  return {
    version: SAVE_VERSION,
    people: peopleDef.id,
    heroName: heroName || "Герой",
    created: Date.now(),
    playTime: 0,
    act: 0,
    season: "summer",
    hours: 8.5,
    weather: "clear",
    pos: null,
    hp: 140,
    xp: 0,
    level: 1,
    skillPoints: 0,
    skills: {},
    res: { coins: 25, powder: 8, lead: 8, arrows: 20, iron: 0, food: 4 },
    weapons: [...peopleDef.weapons],
    slots: [...peopleDef.slots],
    armor: peopleDef.armor || "kaftan",
    items: [...(peopleDef.items || [])],
    relics: { 1: null, 2: null, 3: null, 4: null },
    unity: [peopleDef.id],
    reputation,
    regions,
    towers: [],
    villages: {},
    visited: [],
    explored: [],
    outposts: {},
    missions: { active: null, objective: 0, done: [], failed: [], available: [] },
    side: {},
    flags: {},
    choices: {},
    chronicle: ["intro"],
    squad: [],
    horse: null,
    killed: {},
    stats: { kills: 0, shots: 0, missions: 0 },
  };
}

export function levelXp(level) {
  return Math.round(120 * Math.pow(level, 1.35));
}

export function migrateState(s, peoples) {
  const base = newState(peoples[s.people], s.heroName);
  const out = { ...base, ...s };
  for (const k of ["res", "relics", "missions", "regions", "reputation", "stats"]) out[k] = { ...base[k], ...(s[k] || {}) };
  out.version = SAVE_VERSION;
  return out;
}
