import * as THREE from "three";
import { CHUNK, CHUNKS, HALF } from "./geo.js";
import { heightAt } from "./heightmap.js";

const RES_BY_RING = [64, 64, 32, 32, 16, 16, 16, 16];

function terrainMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.tGrass = { value: tex.grass };
    sh.uniforms.tRock = { value: tex.rock };
    sh.uniforms.tSnow = { value: tex.snow };
    sh.uniforms.tDirt = { value: tex.dirt };
    sh.uniforms.uTint = { value: m.userData.tint };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec3 vWPos;")
      .replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\nvSplat = splat;\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform sampler2D tGrass, tRock, tSnow, tDirt;\nuniform vec3 uTint;\nvarying vec4 vSplat;\nvarying vec3 vWPos;")
      .replace("#include <map_fragment>", `
        vec2 uvA = vWPos.xz * 0.11;
        vec2 uvB = vWPos.xz * 0.013;
        vec3 g = texture2D(tGrass, uvA).rgb * mix(0.85, 1.15, texture2D(tGrass, uvB).g) * uTint;
        vec3 r = texture2D(tRock, vec2(vWPos.x + vWPos.z, vWPos.y) * 0.07).rgb;
        vec3 s = texture2D(tSnow, uvA).rgb;
        vec3 d = texture2D(tDirt, uvA).rgb;
        vec4 w = vSplat / max(0.001, vSplat.x + vSplat.y + vSplat.z + vSplat.w);
        diffuseColor.rgb *= g * w.x + r * w.y + s * w.z + d * w.w;
      `);
  };
  m.userData.tint = new THREE.Color(1, 1, 1);
  return m;
}

function buildIndex(res, skirt) {
  const n = res + 1;
  const idx = [];
  for (let j = 0; j < res; j++) {
    for (let i = 0; i < res; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  if (skirt) {
    const base = n * n;
    const edge = [];
    for (let i = 0; i < res; i++) edge.push(i);
    for (let j = 0; j < res; j++) edge.push(j * n + res);
    for (let i = res; i > 0; i--) edge.push(res * n + i);
    for (let j = res; j > 0; j--) edge.push(j * n);
    const L = edge.length;
    for (let k = 0; k < L; k++) {
      const e0 = edge[k], e1 = edge[(k + 1) % L];
      const s0 = base + k, s1 = base + (k + 1) % L;
      idx.push(e0, s0, e1, e1, s0, s1, e0, e1, s0, e1, s1, s0);
    }
  }
  return idx;
}

export class Terrain {
  constructor(engine, textures) {
    this.engine = engine;
    this.group = new THREE.Group();
    this.group.name = "terrain";
    engine.scene.add(this.group);
    this.material = terrainMaterial(textures);
    this.chunks = new Map();
    this.pending = new Map();
    this.indexCache = {};
    this.viewRings = 6;
    this.snowLine = 340;
    this.version = 0;
    this.workers = [];
    this.nextWorker = 0;
    this.reqId = 0;
    const n = Math.max(1, Math.min(3, (navigator.hardwareConcurrency || 4) - 1));
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL("./terrainWorker.js", import.meta.url), { type: "module" });
      w.onmessage = e => this.onChunk(e.data);
      w.onerror = e => console.error("terrain worker", e.message || e);
      this.workers.push(w);
    }
    this.queue = [];
    this.inflight = 0;
    this.onReady = null;
  }

  key(cx, cz) {
    return cx + "," + cz;
  }

  index(res) {
    if (!this.indexCache[res]) this.indexCache[res] = buildIndex(res, true);
    return this.indexCache[res];
  }

  setSeason(snowLine, tint) {
    this.snowLine = snowLine;
    this.material.userData.tint.copy(tint);
    this.version++;
    for (const c of this.chunks.values()) c.stale = true;
  }

  update(px, pz, force = false) {
    const pcx = Math.floor((px + HALF) / CHUNK), pcz = Math.floor((pz + HALF) / CHUNK);
    if (!force && pcx === this.pcx && pcz === this.pcz && !this.dirty) {
      this.pump();
      return;
    }
    this.pcx = pcx; this.pcz = pcz; this.dirty = false;
    const want = new Map();
    const R = this.viewRings;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        if (cx < 0 || cz < 0 || cx >= CHUNKS || cz >= CHUNKS) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        if (ring > R) continue;
        want.set(this.key(cx, cz), { cx, cz, res: RES_BY_RING[Math.min(ring, RES_BY_RING.length - 1)], ring });
      }
    }
    for (const [k, c] of this.chunks) {
      if (!want.has(k)) {
        this.group.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.chunks.delete(k);
      }
    }
    this.queue = [];
    for (const [k, w] of want) {
      const c = this.chunks.get(k);
      if (!c || c.res !== w.res || c.stale) {
        if (this.pending.has(k) && this.pending.get(k).res === w.res && this.pending.get(k).version === this.version) continue;
        this.queue.push(w);
      }
    }
    this.queue.sort((a, b) => a.ring - b.ring);
    this.pump();
  }

  pump() {
    const limit = this.workers.length * 2;
    while (this.queue.length && this.inflight < limit) {
      const w = this.queue.shift();
      const k = this.key(w.cx, w.cz);
      const id = ++this.reqId;
      this.pending.set(k, { res: w.res, id, version: this.version });
      this.inflight++;
      this.workers[this.nextWorker++ % this.workers.length].postMessage({
        type: "chunk", id, cx: w.cx, cz: w.cz, res: w.res, snowLine: this.snowLine, skirt: true,
      });
    }
  }

  onChunk(d) {
    this.inflight--;
    const k = this.key(d.cx, d.cz);
    const p = this.pending.get(k);
    if (p && p.id === d.id) this.pending.delete(k);
    const pcx = this.pcx, pcz = this.pcz;
    const ring = Math.max(Math.abs(d.cx - pcx), Math.abs(d.cz - pcz));
    if (ring > this.viewRings) { this.pump(); return; }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(d.pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(d.nor, 3));
    g.setAttribute("splat", new THREE.BufferAttribute(d.spl, 4));
    g.setIndex(this.index(d.res));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const old = this.chunks.get(k);
    if (old) {
      this.group.remove(old.mesh);
      old.mesh.geometry.dispose();
    }
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    mesh.castShadow = d.res >= 32;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);
    const prevH = old && old.res > d.res ? old : null;
    this.chunks.set(k, {
      cx: d.cx, cz: d.cz, res: d.res, mesh,
      heights: prevH ? prevH.heights : d.heights, hres: prevH ? prevH.hres : d.res, stale: false,
    });
    if (this.onReady && this.readyCount() >= 9) this.flushReady();
    this.pump();
  }

  readyCount() {
    let n = 0;
    for (const c of this.chunks.values()) if (Math.max(Math.abs(c.cx - this.pcx), Math.abs(c.cz - this.pcz)) <= 1) n++;
    return n;
  }

  flushReady() {
    const list = this.onReady || [];
    this.onReady = null;
    for (const f of list) f();
  }

  whenReady(px, pz, timeout = 6000) {
    return new Promise(res => {
      (this.onReady = this.onReady || []).push(res);
      this.update(px, pz, true);
      if (this.readyCount() >= 9) this.flushReady();
      setTimeout(() => { if (this.onReady && this.onReady.includes(res)) { this.onReady.splice(this.onReady.indexOf(res), 1); res(); } }, timeout);
    });
  }

  height(x, z) {
    const gx = (x + HALF) / CHUNK, gz = (z + HALF) / CHUNK;
    const cx = Math.floor(gx), cz = Math.floor(gz);
    const c = this.chunks.get(this.key(cx, cz));
    if (!c) return heightAt(x, z);
    const res = c.hres, n = res + 1;
    const fx = (gx - cx) * res, fz = (gz - cz) * res;
    const i = Math.min(res - 1, Math.floor(fx)), j = Math.min(res - 1, Math.floor(fz));
    const u = fx - i, v = fz - j;
    const H = c.heights;
    const h00 = H[j * n + i], h10 = H[j * n + i + 1], h01 = H[(j + 1) * n + i], h11 = H[(j + 1) * n + i + 1];
    if (u + v < 1) return h00 + (h10 - h00) * u + (h01 - h00) * v;
    return h11 + (h01 - h11) * (1 - u) + (h10 - h11) * (1 - v);
  }

  normal(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    const hl = this.height(x - e, z), hr = this.height(x + e, z);
    const hd = this.height(x, z - e), hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  raycast(origin, dir, maxDist, step = 2) {
    const p = origin.clone();
    let prevAbove = p.y - this.height(p.x, p.z);
    for (let t = step; t <= maxDist; t += step) {
      p.copy(origin).addScaledVector(dir, t);
      const above = p.y - this.height(p.x, p.z);
      if (above < 0) {
        const f = prevAbove / (prevAbove - above);
        return t - step + step * f;
      }
      prevAbove = above;
    }
    return Infinity;
  }
}
