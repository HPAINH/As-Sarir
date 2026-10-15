import { settlement, SETTLEMENTS, POI, OUTPOSTS, DERBENT, TURCHIDAG, AIMAKI, HOMES, nodePos, coastX } from "../world/geo.js";

export function homeId(game) {
  return game.state.home || HOMES[game.state.people];
}

export function nearbyVillages(game, from = homeId(game)) {
  const h = settlement(from);
  return SETTLEMENTS.filter(s => s.id !== from).sort((a, b) => Math.hypot(a.p[0] - h.p[0], a.p[1] - h.p[1]) - Math.hypot(b.p[0] - h.p[0], b.p[1] - h.p[1]));
}

export function resolveLoc(game, spec) {
  if (!spec) return null;
  if (Array.isArray(spec)) return { x: spec[0], z: spec[1] };
  if (typeof spec === "object") {
    const base = resolveLoc(game, spec.near || spec.at);
    if (!base) return null;
    const a = (spec.a || 0) * Math.PI / 180;
    const d = spec.d || 0;
    return { x: base.x + Math.sin(a) * d, z: base.z + Math.cos(a) * d };
  }
  const parts = String(spec).split(":");
  const kind = parts[0];
  const st = game.world.statics;
  if (kind === "nearby") {
    const v = nearbyVillages(game)[Math.max(0, (+parts[1] || 1) - 1)];
    return v ? resolveLoc(game, "village:" + v.id + (parts[2] ? ":" + parts.slice(2).join(":") : "")) : null;
  }
  if (kind === "cannon") {
    const c = st && st.camps && st.camps["camp:" + parts[1]];
    const k = c && c.cannons[+(parts[2] || 0) % c.cannons.length];
    return k ? { x: k[0], z: k[1] } : null;
  }
  if (kind === "actor") {
    const a = game.actors.find(parts[1]);
    return a ? { x: a.pos.x, z: a.pos.z } : null;
  }
  if (kind === "home") return resolveLoc(game, "village:" + homeId(game) + (parts[1] ? ":" + parts.slice(1).join(":") : ""));
  if (kind === "village") {
    const s = settlement(parts[1]);
    if (!s) return null;
    const V = st && st.villages[s.id];
    if (parts[2] && V) {
      if (parts[2] === "house") {
        const h = V.houses[+(parts[3] || 0) % Math.max(1, V.houses.length)];
        if (h) return { x: h.door[0], z: h.door[1] };
      }
      const sp = V.spots[parts[2]];
      if (sp) return { x: sp[0], z: sp[1] };
      if (parts[2] === "edge") {
        const a = (+(parts[3] || 0)) * Math.PI / 180;
        return { x: s.p[0] + Math.sin(a) * V.R * 1.25, z: s.p[1] + Math.cos(a) * V.R * 1.25 };
      }
    }
    return { x: s.p[0], z: s.p[1] };
  }
  if (kind === "poi") {
    const p = POI.find(q => q.id === parts[1]);
    return p ? { x: p.p[0], z: p.p[1] } : null;
  }
  if (kind === "outpost") {
    const o = OUTPOSTS.find(q => q.id === parts[1]);
    return o ? { x: o.p[0], z: o.p[1] } : null;
  }
  if (kind === "camp") {
    const c = st && st.camps && st.camps["camp:" + parts[1]];
    if (c) return { x: c.c[0], z: c.c[1] };
    if (parts[1] === "turchidag") return { x: TURCHIDAG.c[0], z: TURCHIDAG.c[1] };
    if (parts[1] === "derbent") return { x: DERBENT.camp[0], z: DERBENT.camp[1] };
    return null;
  }
  if (kind === "derbent") {
    const mid = (DERBENT.wallN + DERBENT.wallS) / 2;
    if (parts[1] === "gate") return { x: DERBENT.gateX[0], z: DERBENT.wallN - 12 };
    if (parts[1] === "citadel") return { x: DERBENT.citadel[0], z: DERBENT.citadel[1] };
    if (parts[1] === "street") return { x: (DERBENT.x0 + coastX(mid)) / 2, z: mid };
    if (parts[1] === "cannons") return { x: DERBENT.camp[0], z: DERBENT.camp[1] - 40 };
    return { x: DERBENT.x0 + 60, z: mid };
  }
  if (kind === "aimaki") {
    const i = Math.min(AIMAKI.length - 1, +(parts[1] || 1));
    return { x: AIMAKI[i][0], z: AIMAKI[i][1] };
  }
  if (kind === "turchidag") {
    const a = (+(parts[1] || 0)) * Math.PI / 180;
    const r = parts[2] ? +parts[2] : 0;
    return { x: TURCHIDAG.c[0] + Math.sin(a) * r, z: TURCHIDAG.c[1] + Math.cos(a) * r };
  }
  if (kind === "node") {
    const p = nodePos(parts[1]);
    return p ? { x: p[0], z: p[1] } : null;
  }
  if (kind === "player") return { x: game.player.pos.x, z: game.player.pos.z };
  return null;
}

export function fmt(game, text) {
  if (!text) return "";
  const st = game.state;
  const P = game.data.peoples[st.people];
  const home = settlement(homeId(game));
  return String(text)
    .replace(/\{hero\}/g, st.heroName)
    .replace(/\{people\}/g, P ? P.name : "")
    .replace(/\{adj\}/g, P ? P.adj : "")
    .replace(/\{home\}/g, home ? home.name : "")
    .replace(/\{horse\}/g, st.horse ? st.horse.name : "конь")
    .replace(/\{near(\d)\}/g, (m, n) => { const v = nearbyVillages(game)[+n - 1]; return v ? v.name : ""; })
    .replace(/\{unity\}/g, String(st.unity.length));
}
