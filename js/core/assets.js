import * as THREE from "three";
import { GLTFLoader } from "../lib/addons/loaders/GLTFLoader.js";
import { clone as skeletonClone } from "../lib/addons/utils/SkeletonUtils.js";

const EXT = (typeof window !== "undefined" && window.AS_SARIR_MODEL_EXT) || ".glb";

export class Assets {
  constructor(base = "assets/") {
    this.base = base;
    this.loader = new GLTFLoader();
    this.texLoader = new THREE.TextureLoader();
    this.cache = new Map();
    this.ready = new Map();
    this.textures = new Map();
    this.loaded = 0;
    this.failed = [];
    this.active = 0;
    this.waiting = [];
  }

  url(path) {
    return this.base + "models/" + path + EXT;
  }

  slot() {
    if (this.active < 6) { this.active++; return Promise.resolve(); }
    return new Promise(r => this.waiting.push(r));
  }

  release() {
    const next = this.waiting.shift();
    if (next) next();
    else this.active--;
  }

  async fetchModel(url) {
    if (!url.endsWith(".json")) return new Promise((res, rej) => this.loader.load(url, res, undefined, rej));
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status + " " + url);
    const glb = packGLB(await r.json());
    return new Promise((res, rej) => this.loader.parse(glb, "", res, rej));
  }

  load(path) {
    if (!this.cache.has(path)) {
      const p = (async () => {
        const urls = [this.url(path), this.base + "models/" + path + (EXT === ".glb" ? ".gltf.json" : ".glb")];
        let last = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          await this.slot();
          try {
            const g = await this.fetchModel(urls[attempt < 3 ? 0 : 1]);
            g.scene.traverse(o => {
              if (o.isMesh) {
                o.castShadow = true;
                o.receiveShadow = true;
                const mats = Array.isArray(o.material) ? o.material : [o.material];
                for (const m of mats) if (m.map) m.map.anisotropy = 4;
              }
            });
            this.loaded++;
            this.ready.set(path, g);
            return g;
          } catch (err) {
            last = err;
          } finally {
            this.release();
          }
          await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        }
        console.warn("model failed", path, last && last.message);
        this.failed.push(path);
        return null;
      })();
      this.cache.set(path, p);
    }
    return this.cache.get(path);
  }

  async preload(paths, onProgress) {
    let done = 0;
    await Promise.all(paths.map(p => this.load(p).then(() => { done++; if (onProgress) onProgress(done / paths.length, p); })));
  }

  get(path) {
    return this.ready.get(path) || null;
  }

  async instance(path) {
    const g = await this.load(path);
    if (!g) return { scene: placeholder(), animations: [] };
    const skinned = g.animations && g.animations.length;
    return { scene: skinned ? skeletonClone(g.scene) : g.scene.clone(true), animations: g.animations || [] };
  }

  texture(name, repeat = true) {
    if (!this.textures.has(name)) {
      const t = this.texLoader.load(this.base + "textures/" + name);
      t.colorSpace = THREE.SRGBColorSpace;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      this.textures.set(name, t);
    }
    return this.textures.get(name);
  }
}

export function placeholder() {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3), new THREE.MeshStandardMaterial({ color: 0xff00ff }));
  m.position.y = 0.9;
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export function meshesOf(root) {
  const out = [];
  root.updateMatrixWorld(true);
  root.traverse(o => { if (o.isMesh) out.push(o); });
  return out;
}

function fromB64(uri) {
  const s = atob(uri.slice(uri.indexOf(",") + 1));
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
  return a;
}

export function packGLB(json) {
  const chunks = [];
  let off = 0;
  const push = bytes => {
    const pad = (4 - (off % 4)) % 4;
    if (pad) { chunks.push(new Uint8Array(pad)); off += pad; }
    const at = off;
    chunks.push(bytes);
    off += bytes.length;
    return at;
  };
  const buffers = [{ byteLength: 0 }];
  const map = (json.buffers || []).map(b => {
    if (b.uri && b.uri.startsWith("data:")) return { idx: 0, base: push(fromB64(b.uri)) };
    buffers.push(b);
    return { idx: buffers.length - 1, base: 0 };
  });
  for (const bv of json.bufferViews || []) {
    const m = map[bv.buffer];
    bv.buffer = m.idx;
    bv.byteOffset = (bv.byteOffset || 0) + m.base;
    const ext = bv.extensions && bv.extensions.EXT_meshopt_compression;
    if (ext) {
      const e = map[ext.buffer];
      ext.buffer = e.idx;
      ext.byteOffset = (ext.byteOffset || 0) + e.base;
    }
  }
  for (const img of json.images || []) {
    if (!img.uri || !img.uri.startsWith("data:")) continue;
    img.mimeType = img.uri.slice(5, img.uri.indexOf(";"));
    const bytes = fromB64(img.uri);
    const at = push(bytes);
    json.bufferViews.push({ buffer: 0, byteOffset: at, byteLength: bytes.length });
    img.bufferView = json.bufferViews.length - 1;
    delete img.uri;
  }
  const binLen = Math.ceil(off / 4) * 4;
  buffers[0].byteLength = binLen;
  json.buffers = buffers;
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(jsonBytes.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLen + 8 + binLen);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, out.length, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonLen;
  dv.setUint32(binStart, binLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true);
  let p = binStart + 8;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out.buffer;
}
