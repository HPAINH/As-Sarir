import { heightAt, sample } from "../js/world/heightmap.js";
import { SETTLEMENTS, HALF, coastX } from "../js/world/geo.js";
import fs from "fs";
const R = 512, S = (HALF * 2) / R;
const buf = Buffer.alloc(R * R * 3);
let mn = 1e9, mx = -1e9, t0 = Date.now();
const H = new Float32Array(R * R);
for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
  const x = -HALF + (i + 0.5) * S, z = -HALF + (j + 0.5) * S;
  const s = sample(x, z); H[j * R + i] = s.h; mn = Math.min(mn, s.h); mx = Math.max(mx, s.h);
  const o = (j * R + i) * 3;
  let c;
  if (s.h < 2) c = [40, 80, 120];
  else if (s.river > 0.5) c = [60, 110, 150];
  else if (s.road > 0.5) c = [150, 120, 80];
  else if (s.h > 330) c = [235, 235, 240];
  else if (s.h > 200) c = [130, 125, 110];
  else c = [90 + s.h * 0.2, 120 + s.h * 0.1, 60];
  buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
}
for (let j = 1; j < R; j++) for (let i = 1; i < R; i++) {
  const d = (H[j * R + i] - H[j * R + i - 1]) + (H[j * R + i] - H[(j - 1) * R + i]);
  const k = Math.max(0.4, Math.min(1.5, 1 + d * 0.04));
  const o = (j * R + i) * 3;
  for (let c = 0; c < 3; c++) buf[o + c] = Math.min(255, buf[o + c] * k);
}
fs.writeFileSync("/tmp/claude-0/-home-claude/3a5f96ed-5b59-5a61-875b-3a393cb56988/scratchpad/hm.ppm", Buffer.concat([Buffer.from(`P6 ${R} ${R} 255\n`), buf]));
console.log("min", mn.toFixed(1), "max", mx.toFixed(1), "ms", Date.now() - t0, "per sample us", ((Date.now() - t0) * 1000 / (R * R)).toFixed(2));
const marks = SETTLEMENTS.map(s => ({ n: s.id, x: (s.p[0] + HALF) / S, y: (s.p[1] + HALF) / S, h: heightAt(s.p[0], s.p[1]).toFixed(0) }));
fs.writeFileSync("/tmp/claude-0/-home-claude/3a5f96ed-5b59-5a61-875b-3a393cb56988/scratchpad/hm_marks.json", JSON.stringify(marks));
console.log(marks.map(m => m.n + ":" + m.h).join(" "));
