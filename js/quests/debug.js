import { resolveLoc } from "./locs.js";
import { PEOPLES } from "../world/geo.js";

export async function solveStep(g) {
  const q = g.quests, job = q.job;
  if (!job || !job.st) return "no job";
  const s = job.def.steps[job.i], st = job.st;
  const p = g.player;
  const tp = async loc => { await q.teleport(loc, 0); };
  const killTag = tag => { for (const a of job.tagged(tag)) if (!a.dead) g.combat.kill(a, p); };
  switch (s.type) {
    case "goto":
    case "ride":
      if (st.at) await tp([st.at.x, st.at.z]);
      if (s.type === "ride" || s.mounted) await ensureMount(g);
      break;
    case "mount":
      if (st.horse) st.horse.mount(p);
      break;
    case "talk":
      if (st.npc && typeof st.npc.talk === "function") await st.npc.talk(st.npc);
      break;
    case "fight":
      if (st.pts) for (const pt of st.pts) if (!pt.used) { pt.used = true; st.used = (st.used || 0) + 1; }
      for (const w of st.waves || []) if (!w.spawned) w.spawned = true;
      killTag(s.target || "enemy");
      if (s.count) st.kills[s.target || "enemy"] = s.count;
      if (s.time) st.t = s.time + 1;
      break;
    case "escort":
      for (const n of job.tagged("escort")) if (!n.dead) n.pos.set(st.end.x, g.world.ground(st.end.x, st.end.z), st.end.z);
      for (const a of st.ambush || []) a.done = true;
      break;
    case "collect":
      st.got = true;
      break;
    case "interact":
      for (const pt of st.pts) if (!pt.used) { pt.used = true; st.used++; }
      break;
    case "chase":
      if (st.runner && s.catchable === false) st.runner.arrived = true;
      else if (st.runner) await tp([st.runner.pos.x + 1, st.runner.pos.z]);
      break;
    case "unity":
      for (const k of PEOPLES) if (!g.state.unity.includes(k) && g.state.unity.length < s.n) g.state.unity.push(k);
      break;
    case "wait":
      st.t = 999;
      break;
  }
  return `${job.def.id}#${job.i}:${s.type}`;
}

async function ensureMount(g) {
  const p = g.player;
  if (p.mount) return;
  if (!g.playerHorse || g.playerHorse.dead) g.playerHorse = await g.actors.spawnHorse("mountain", p.pos.x + 2, p.pos.z, { owner: p, name: "Тест", persistent: true });
  g.playerHorse.mount(p);
}


export function installDebug(g) {
  g.autoplay = true;
  window.QA = {
    solve: () => solveStep(g),
    state: () => {
      const j = g.quests.job;
      return { active: g.state.missions.active, step: j ? j.i : null, type: j && j.def.steps[j.i] ? j.def.steps[j.i].type : null, ready: j ? j.ready : null, done: g.state.missions.done.length, act: g.state.act, unity: g.state.unity.length, relics: g.state.relics };
    },
    start: id => g.quests.begin(g.quests.byId[id], 0),
    loc: spec => resolveLoc(g, spec),
  };
}
