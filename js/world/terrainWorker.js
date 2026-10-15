import { sample } from "./heightmap.js";
import { CHUNK, HALF } from "./geo.js";
import { makeNoise, smoothstep } from "./noise.js";

const N = makeNoise(77);

function build({ cx, cz, res, snowLine, skirt }) {
  const n = res + 1;
  const x0 = -HALF + cx * CHUNK, z0 = -HALF + cz * CHUNK;
  const step = CHUNK / res;
  const pad = n + 2;
  const H = new Float32Array(pad * pad);
  const info = new Array(n * n);
  for (let j = -1; j <= n; j++) {
    for (let i = -1; i <= n; i++) {
      const x = x0 + i * step, z = z0 + j * step;
      if (i >= 0 && i < n && j >= 0 && j < n) {
        const s = sample(x, z);
        H[(j + 1) * pad + (i + 1)] = s.h;
        info[j * n + i] = s;
      } else {
        H[(j + 1) * pad + (i + 1)] = sample(x, z).h;
      }
    }
  }
  const ring = skirt ? 4 * res : 0;
  const total = n * n + ring;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const spl = new Float32Array(total * 4);
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const h = H[(j + 1) * pad + (i + 1)];
      heights[k] = h;
      pos[k * 3] = x0 + i * step; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z0 + j * step;
      const hl = H[(j + 1) * pad + i], hr = H[(j + 1) * pad + i + 2];
      const hd = H[j * pad + i + 1], hu = H[(j + 2) * pad + i + 1];
      let nx = hl - hr, ny = 2 * step, nz = hd - hu;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
      const s = info[k];
      const slope = 1 - ny;
      const x = pos[k * 3], z = pos[k * 3 + 2];
      const nn = N.fbm(x * 0.02, z * 0.02, 3);
      let rock = smoothstep(0.22 + nn * 0.05, 0.4, slope);
      rock = Math.max(rock, smoothstep(250, 330, h + nn * 30) * 0.55 * s.M);
      let snow = smoothstep(snowLine, snowLine + 45, h + nn * 25) * (1 - smoothstep(0.35, 0.6, slope));
      let dirt = Math.max(s.road * 0.95, s.village * 0.55, s.river * 0.8);
      if (h < 5.5 && s.M < 0.2) dirt = Math.max(dirt, smoothstep(5.5, 3, h));
      rock *= 1 - snow;
      dirt *= (1 - rock) * (1 - snow);
      let grass = Math.max(0, 1 - rock - snow - dirt);
      const sum = grass + rock + snow + dirt || 1;
      spl[k * 4] = grass / sum; spl[k * 4 + 1] = rock / sum; spl[k * 4 + 2] = snow / sum; spl[k * 4 + 3] = dirt / sum;
    }
  }
  if (skirt) {
    let k = n * n;
    const edge = [];
    for (let i = 0; i < res; i++) edge.push(i);
    for (let j = 0; j < res; j++) edge.push(j * n + res);
    for (let i = res; i > 0; i--) edge.push(res * n + i);
    for (let j = res; j > 0; j--) edge.push(j * n);
    for (const e of edge) {
      pos[k * 3] = pos[e * 3]; pos[k * 3 + 1] = pos[e * 3 + 1] - 12 - step * 0.5; pos[k * 3 + 2] = pos[e * 3 + 2];
      nor[k * 3] = nor[e * 3]; nor[k * 3 + 1] = nor[e * 3 + 1]; nor[k * 3 + 2] = nor[e * 3 + 2];
      for (let c = 0; c < 4; c++) spl[k * 4 + c] = spl[e * 4 + c];
      k++;
    }
  }
  return { cx, cz, res, pos, nor, spl, heights };
}

self.onmessage = e => {
  const msg = e.data;
  if (msg.type === "chunk") {
    const r = build(msg);
    r.id = msg.id;
    self.postMessage(r, [r.pos.buffer, r.nor.buffer, r.spl.buffer, r.heights.buffer]);
  }
};
