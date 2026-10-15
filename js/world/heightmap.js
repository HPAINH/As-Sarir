import { makeNoise, smoothstep, lerp, polyDist, mulberry } from "./noise.js";
import { SETTLEMENTS, RIVERS, ROADS, nodePos, TURCHIDAG, KHUNZAKH_PLATEAU, AIMAKI, coastX, DERBENT, HALF } from "./geo.js";

const N = makeNoise(1741);

function buildRoads() {
  const out = [];
  ROADS.forEach(([a, b], idx) => {
    const pa = nodePos(a), pb = nodePos(b);
    if (!pa || !pb) return;
    const rnd = mulberry(idx * 977 + 13);
    const pts = [pa];
    const n = Math.max(2, Math.round(Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / 120));
    const nx = -(pb[1] - pa[1]), nz = pb[0] - pa[0];
    const nl = Math.hypot(nx, nz) || 1;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const off = (rnd() - 0.5) * 70 * Math.sin(Math.PI * t);
      pts.push([pa[0] + (pb[0] - pa[0]) * t + nx / nl * off, pa[1] + (pb[1] - pa[1]) * t + nz / nl * off]);
    }
    pts.push(pb);
    out.push({ id: a + "-" + b, a, b, pts });
  });
  return out;
}

export const ROAD_LINES = buildRoads();

function mountainMask(x, z) {
  const dz = z + 1050;
  const dc = coastX(z) - 300 - x;
  const d = Math.min(dz, dc);
  return smoothstep(-120, 820, d);
}

function rawHeight(x, z) {
  const M = mountainMask(x, z);
  const plain = 13 + 7 * N.fbm(x * 0.0018, z * 0.0018, 3) + 2.5 * N.fbm(x * 0.01, z * 0.01, 2);
  const r = N.ridge(x * 0.00105 + 3.1, z * 0.00105 - 1.7, 5);
  const f = N.fbm(x * 0.0026 - 7, z * 0.0026 + 2, 4);
  let mount = 70 + 210 * r + 60 * f + 14 * N.fbm(x * 0.012, z * 0.012, 2);
  mount += 130 * smoothstep(850, 1950, z) + 60 * smoothstep(-500, -1900, x);
  let h = lerp(plain, plain + mount, M);
  const cx = coastX(z);
  const sea = smoothstep(cx - 60, cx + 140, x);
  h = lerp(h, -10, sea);
  if (x > cx - 60 && x < cx + 10) h = Math.min(h, lerp(6, 2.5, (x - (cx - 60)) / 70));
  return h;
}

function plateau(x, z, P, h) {
  const d = Math.hypot(x - P.c[0], z - P.c[1]);
  const wob = 14 * N.simplex(x * 0.008, z * 0.008) + 4 * N.simplex(x * 0.03, z * 0.03);
  const t = smoothstep(P.r + 30 + wob, P.r - 12 + wob, d);
  return lerp(h, P.h + 2.5 * N.fbm(x * 0.03, z * 0.03, 2), t);
}

function baseHeight(x, z) {
  let h = rawHeight(x, z);
  h = plateau(x, z, TURCHIDAG, h);
  return plateau(x, z, KHUNZAKH_PLATEAU, h);
}

const CENTER_H = {};
for (const s of SETTLEMENTS) CENTER_H[s.id] = baseHeight(s.p[0], s.p[1]);

export function settlementRadius(s) {
  return 60 + s.size * 28;
}

function riverCarve(x, z, M) {
  let carve = 0, river = 0;
  for (const rv of RIVERS) {
    const { d } = polyDist(x, z, rv.pts);
    const depth = 5 + 36 * M;
    const half = rv.w * 0.5;
    const wall = half + 6 + depth * 1.4;
    if (d < wall + 2) {
      const c = depth * (1 - smoothstep(half, wall, d));
      if (c > carve) carve = c;
      river = Math.max(river, 1 - smoothstep(half * 0.8, half + 4, d));
    }
  }
  return [carve, river];
}

export function heightAt(x, z) {
  return sample(x, z).h;
}

export function sample(x, z) {
  const M = mountainMask(x, z);
  let h = baseHeight(x, z);
  let village = 0;
  for (const s of SETTLEMENTS) {
    const dx = x - s.p[0], dz = z - s.p[1];
    const R = settlementRadius(s);
    const d2 = dx * dx + dz * dz;
    if (d2 > R * R * 1.7) continue;
    const d = Math.sqrt(d2);
    const w = smoothstep(R * 1.3, R * 0.55, d);
    if (w <= 0) continue;
    const ch = CENTER_H[s.id];
    let target = ch + (h - ch) * 0.28;
    const step = 4;
    const q = Math.floor(target / step) * step;
    target = lerp(target, q, 0.93);
    h = lerp(h, target, w);
    village = Math.max(village, w);
  }
  const ag = polyDist(x, z, AIMAKI);
  if (ag.d < 70) {
    const gd = 46 * (1 - smoothstep(7, 60, ag.d));
    h -= gd;
    h += 26 * smoothstep(60, 30, ag.d) * smoothstep(20, 35, ag.d);
  }
  const [carve, river] = riverCarve(x, z, M);
  h -= carve;
  let road = 0;
  for (const rl of ROAD_LINES) {
    const { d } = polyDist(x, z, rl.pts);
    if (d < 6) road = Math.max(road, 1 - smoothstep(2.2, 5.5, d));
  }
  if (x > DERBENT.x0 - 20 && z > DERBENT.wallN - 30 && z < DERBENT.wallS + 30 && x < coastX(z)) {
    const t = smoothstep(DERBENT.x0 - 20, DERBENT.x0 + 40, x) * smoothstep(DERBENT.wallN - 30, DERBENT.wallN + 10, z) * smoothstep(DERBENT.wallS + 30, DERBENT.wallS - 10, z);
    const target = lerp(28, 6, smoothstep(DERBENT.x0, coastX(z), x));
    h = lerp(h, target, t);
    village = Math.max(village, t);
  }
  const cdx = x - DERBENT.citadel[0], cdz = z - DERBENT.citadel[1];
  const cd = Math.hypot(cdx, cdz);
  if (cd < 110) h = lerp(h, 42, smoothstep(110, 55, cd));
  return { h, M, river, road, village };
}

export function waterLevelAt(x, z) {
  if (x > coastX(z) - 70) return 2;
  return -Infinity;
}

export function riverWaterPoints(rv, step = 12) {
  const out = [];
  for (let i = 0; i < rv.pts.length - 1; i++) {
    const [ax, az] = rv.pts[i], [bx, bz] = rv.pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      out.push([ax + (bx - ax) * t, az + (bz - az) * t]);
    }
  }
  out.push(rv.pts[rv.pts.length - 1]);
  let prev = Infinity;
  return out.map(([x, z]) => {
    let lo = Infinity;
    for (let a = 0; a < 6; a++) {
      const ang = a * Math.PI / 3;
      lo = Math.min(lo, heightAt(x + Math.cos(ang) * rv.w * 0.3, z + Math.sin(ang) * rv.w * 0.3));
    }
    let y = lo + 0.9;
    if (y > prev + 0.6) y = prev + 0.6;
    prev = y;
    return [x, y, z];
  });
}

export function inWorld(x, z) {
  return Math.abs(x) < HALF && Math.abs(z) < HALF;
}
