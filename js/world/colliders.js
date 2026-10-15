const CELL = 24;

export class Colliders {
  constructor() {
    this.cells = new Map();
    this.all = [];
    this.stamp = 0;
  }

  key(i, j) {
    return i * 100003 + j;
  }

  insert(c) {
    this.all.push(c);
    const r = c.bound;
    const i0 = Math.floor((c.x - r) / CELL), i1 = Math.floor((c.x + r) / CELL);
    const j0 = Math.floor((c.z - r) / CELL), j1 = Math.floor((c.z + r) / CELL);
    c.cells = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(c);
        c.cells.push(k);
      }
    }
    return c;
  }

  remove(c) {
    if (!c || !c.cells) return;
    for (const k of c.cells) {
      const arr = this.cells.get(k);
      if (arr) {
        const i = arr.indexOf(c);
        if (i >= 0) arr.splice(i, 1);
      }
    }
    const i = this.all.indexOf(c);
    if (i >= 0) this.all.splice(i, 1);
    c.cells = null;
  }

  addBox(x, z, hx, hz, rot, y0, y1, opts = {}) {
    const c = { type: "box", x, z, hx, hz, rot, cos: Math.cos(rot), sin: Math.sin(rot), y0, y1,
      walk: opts.walk !== false, tag: opts.tag || null, bound: Math.hypot(hx, hz), solid: opts.solid !== false };
    return this.insert(c);
  }

  addGrid(spec, x, z, rot, baseY, opts = {}) {
    const c = { type: "grid", x, z, rot, cos: Math.cos(rot), sin: Math.sin(rot), y0: baseY, y1: baseY + spec.top, g: spec,
      baseY, walk: true, tag: opts.tag || null, bound: spec.radius, solid: true };
    return this.insert(c);
  }

  gridCell(c, x, z) {
    const [lx, lz] = this.local(c, x, z);
    const g = c.g;
    const i = Math.floor((lx - g.ox) / g.cell), j = Math.floor((lz - g.oz) / g.cell);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return -1;
    return g.h[j * g.nx + i] > -1e3 ? j * g.nx + i : -1;
  }

  gridH(c, x, z) {
    const k = this.gridCell(c, x, z);
    return k < 0 ? -Infinity : c.baseY + c.g.h[k];
  }

  addCircle(x, z, r, y0, y1, opts = {}) {
    const c = { type: "circle", x, z, r, y0, y1, walk: !!opts.walk, tag: opts.tag || null, bound: r, solid: true };
    return this.insert(c);
  }

  query(x, z, r) {
    this.stamp++;
    const out = [];
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const arr = this.cells.get(this.key(i, j));
        if (!arr) continue;
        for (const c of arr) {
          if (c._s === this.stamp) continue;
          c._s = this.stamp;
          out.push(c);
        }
      }
    }
    return out;
  }

  local(c, x, z) {
    const dx = x - c.x, dz = z - c.z;
    return [dx * c.cos - dz * c.sin, dx * c.sin + dz * c.cos];
  }

  inside(c, x, z, pad = 0) {
    if (c.type === "circle") return Math.hypot(x - c.x, z - c.z) < c.r + pad;
    if (c.type === "grid") return this.gridH(c, x, z) > -Infinity;
    const [lx, lz] = this.local(c, x, z);
    return Math.abs(lx) < c.hx + pad && Math.abs(lz) < c.hz + pad;
  }

  groundAt(x, z, yFeet, terrainH, step = 0.65) {
    let g = terrainH;
    let obj = null;
    for (const c of this.query(x, z, 0.5)) {
      if (!c.walk) continue;
      if (c.type === "grid") {
        const k = this.gridCell(c, x, z);
        if (k < 0) continue;
        const h = c.baseY + c.g.h[k];
        if (h > g && h <= yFeet + step) { g = h; obj = c; }
        continue;
      }
      if (c.y1 <= g) continue;
      if (c.y1 > yFeet + step) continue;
      if (this.inside(c, x, z, 0.05)) { g = c.y1; obj = c; }
    }
    return [g, obj];
  }

  resolve(pos, r, yFeet, height, step = 0.65) {
    let hit = null;
    for (const c of this.query(pos.x, pos.z, r + 1)) {
      if (!c.solid) continue;
      if (c.y1 <= yFeet + step || c.y0 >= yFeet + height) continue;
      if (c.type === "grid") {
        if (this.resolveGrid(c, pos, r, yFeet + step, yFeet + height)) hit = c;
        continue;
      }
      if (c.type === "circle") {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const d = Math.hypot(dx, dz), m = c.r + r;
        if (d < m && d > 1e-5) {
          pos.x = c.x + dx / d * m;
          pos.z = c.z + dz / d * m;
          hit = c;
        }
        continue;
      }
      const [lx, lz] = this.local(c, pos.x, pos.z);
      const ox = c.hx + r - Math.abs(lx), oz = c.hz + r - Math.abs(lz);
      if (ox > 0 && oz > 0) {
        let nx = lx, nz = lz;
        if (ox < oz) nx = Math.sign(lx || 1) * (c.hx + r);
        else nz = Math.sign(lz || 1) * (c.hz + r);
        pos.x = c.x + nx * c.cos + nz * c.sin;
        pos.z = c.z - nx * c.sin + nz * c.cos;
        hit = c;
      }
    }
    return hit;
  }

  resolveGrid(c, pos, r, limit, headY = limit + 1.2) {
    const g = c.g;
    let [lx, lz] = this.local(c, pos.x, pos.z);
    let moved = false;
    for (let it = 0; it < 3; it++) {
      const i0 = Math.floor((lx - r - g.ox) / g.cell), i1 = Math.floor((lx + r - g.ox) / g.cell);
      const j0 = Math.floor((lz - r - g.oz) / g.cell), j1 = Math.floor((lz + r - g.oz) / g.cell);
      let px = 0, pz = 0, n = 0;
      for (let j = Math.max(0, j0); j <= Math.min(g.nz - 1, j1); j++) {
        for (let i = Math.max(0, i0); i <= Math.min(g.nx - 1, i1); i++) {
          const k = j * g.nx + i;
          const h = g.h[k];
          if (h < -1e3 || c.baseY + h <= limit) continue;
          if (c.baseY + g.lo[k] >= headY) continue;
          const cx0 = g.ox + i * g.cell, cz0 = g.oz + j * g.cell;
          const qx = Math.max(cx0, Math.min(lx, cx0 + g.cell)), qz = Math.max(cz0, Math.min(lz, cz0 + g.cell));
          let dx = lx - qx, dz = lz - qz;
          let d = Math.hypot(dx, dz);
          if (d >= r) continue;
          if (d < 1e-4) {
            const ccx = cx0 + g.cell / 2, ccz = cz0 + g.cell / 2;
            dx = lx - ccx; dz = lz - ccz; d = Math.hypot(dx, dz) || 1;
            px += dx / d * r; pz += dz / d * r;
          } else {
            px += dx / d * (r - d); pz += dz / d * (r - d);
          }
          n++;
        }
      }
      if (!n) break;
      lx += px / Math.max(1, n * 0.5); lz += pz / Math.max(1, n * 0.5);
      moved = true;
    }
    if (moved) {
      pos.x = c.x + lx * c.cos + lz * c.sin;
      pos.z = c.z - lx * c.sin + lz * c.cos;
    }
    return moved;
  }

  climbable(x, z, yFeet, reach = 2.4) {
    let best = null;
    for (const c of this.query(x, z, 1.2)) {
      if (!c.walk) continue;
      if (c.type === "grid") {
        const h = this.gridH(c, x, z);
        if (h > yFeet + 0.5 && h <= yFeet + reach && (!best || h < best.y1)) best = { y1: h };
        continue;
      }
      if (c.y1 <= yFeet + 0.5 || c.y1 > yFeet + reach) continue;
      if (this.inside(c, x, z, 0.9)) {
        if (!best || c.y1 < best.y1) best = c;
      }
    }
    return best;
  }

  segmentBlocked(ax, ay, az, bx, by, bz, ignore = null) {
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(2, Math.ceil(len / 2));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      const x = ax + dx * t, z = az + dz * t, y = ay + (by - ay) * t;
      for (const c of this.query(x, z, 0.2)) {
        if (c === ignore || !c.solid) continue;
        if (c.type === "grid") {
          const k = this.gridCell(c, x, z);
          if (k >= 0 && y < c.baseY + c.g.h[k] && y > c.baseY + c.g.lo[k] - 0.3) return true;
          continue;
        }
        if (y < c.y0 || y > c.y1) continue;
        if (this.inside(c, x, z)) return true;
      }
    }
    return false;
  }
}

export function buildHeightGrid(root, cell = 0.5) {
  root.updateMatrixWorld(true);
  const tris = [];
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity, maxY = -Infinity;
  const v = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  root.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry, pos = g.attributes.position, idx = g.index;
    const m = o.matrixWorld.elements;
    const n = idx ? idx.count : pos.count;
    for (let t = 0; t < n; t += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const vi = idx ? idx.getX(t + k) : t + k;
        const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const wy = m[1] * x + m[5] * y + m[9] * z + m[13];
        const wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        tri.push(wx, wy, wz);
        minX = Math.min(minX, wx); maxX = Math.max(maxX, wx);
        minZ = Math.min(minZ, wz); maxZ = Math.max(maxZ, wz);
        maxY = Math.max(maxY, wy);
      }
      tris.push(tri);
    }
  });
  const nx = Math.max(1, Math.ceil((maxX - minX) / cell)), nz = Math.max(1, Math.ceil((maxZ - minZ) / cell));
  const h = new Float32Array(nx * nz).fill(-1e9);
  const lo = new Float32Array(nx * nz).fill(1e9);
  for (const t of tris) {
    const ax = t[0], ay = t[1], az = t[2], bx = t[3], by = t[4], bz = t[5], cx = t[6], cy = t[7], cz = t[8];
    const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) * 0.5;
    const span = Math.max(Math.hypot(bx - ax, bz - az), Math.hypot(cx - ax, cz - az), Math.hypot(cx - bx, cz - bz));
    const steps = Math.min(60, Math.max(2, Math.ceil(span / (cell * 0.5))));
    if (area < 1e-6 && span < 1e-3) continue;
    for (let a = 0; a <= steps; a++) {
      for (let b = 0; b <= steps - a; b++) {
        const u = a / steps, w = b / steps, s = 1 - u - w;
        const x = ax * s + bx * u + cx * w, y = ay * s + by * u + cy * w, z = az * s + bz * u + cz * w;
        const i = Math.min(nx - 1, Math.floor((x - minX) / cell)), j = Math.min(nz - 1, Math.floor((z - minZ) / cell));
        const k = j * nx + i;
        if (y > h[k]) h[k] = y;
        if (y < lo[k]) lo[k] = y;
      }
    }
  }
  let filled = 0;
  for (let k = 0; k < h.length; k++) if (h[k] > -1e3) filled++;
  return { cell, nx, nz, ox: minX, oz: minZ, h, lo, top: maxY, radius: Math.hypot(Math.max(-minX, maxX), Math.max(-minZ, maxZ)) + 0.5, filled };
}
