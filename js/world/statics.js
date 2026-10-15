import * as THREE from "three";
import { SETTLEMENTS, POI, OUTPOSTS, DERBENT, TURCHIDAG, RIVERS, HALF, WORLD, coastX, SEA_LEVEL } from "./geo.js";
import { sample, heightAt, settlementRadius, ROAD_LINES } from "./heightmap.js";
import { makeNoise, mulberry, smoothstep } from "./noise.js";
import { buildHeightGrid } from "./colliders.js";

const N = makeNoise(4242);
const LODS = new Set([
  "weapons/composite_bow", "village/arba_cart", "village/copper_jug_kumgan", "village/firewood_pile", "village/grain_sacks",
  "village/house_saklya_2f", "village/house_saklya_large", "village/mosque_juma", "village/stone_fence_4m", "village/watch_tower",
  "derbent/derbent_city_gate", "persian_camp/cannonball_pile", "persian_camp/field_cannon", "persian_camp/palisade_4m",
  "persian_camp/powder_keg", "nature/cliff_section", "nature/cliff_tall", "nature/terrace_wheat_field",
]);

function lodPath(path, lvl) {
  if (lvl === 0 || !LODS.has(path)) return path;
  const [cat, name] = path.split("/");
  return `${cat}/lod/${name}_lod${lvl}`;
}

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Statics {
  constructor(game) {
    this.game = game;
    this.engine = game.engine;
    this.assets = game.assets;
    this.cols = game.world.colliders;
    this.group = new THREE.Group();
    this.group.name = "statics";
    this.engine.scene.add(this.group);
    this.models = new Map();
    this.clusters = [];
    this.byTag = new Map();
    this.villages = {};
    this.bridges = [];
    this.forestCache = new Map();
    this.season = "summer";
    this.leafMats = new Set();
    this.q = this.engine.q;
  }

  async model(path) {
    if (this.models.has(path)) return this.models.get(path);
    const p = (async () => {
      const g = await this.assets.load(path);
      if (!g) return null;
      const root = g.scene;
      root.updateMatrixWorld(true);
      const parts = [];
      root.traverse(o => {
        if (!o.isMesh) return;
        const geo = toFloatGeometry(o.geometry);
        geo.applyMatrix4(o.matrixWorld);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (/leaves/.test(m.name || "")) this.leafMats.add(m);
        parts.push({ geo, mat: o.material });
      });
      const box = new THREE.Box3().setFromObject(root);
      return { path, parts, box, root, grid: null };
    })();
    this.models.set(path, p);
    return p;
  }

  async grid(path) {
    const m = await this.model(path);
    if (!m) return null;
    if (!m.grid) m.grid = buildHeightGrid(m.root, 0.5);
    return m.grid;
  }

  addCluster(tag, items, opts = {}) {
    let cx = 0, cz = 0;
    for (const it of items) { cx += it.x; cz += it.z; }
    cx /= Math.max(1, items.length); cz /= Math.max(1, items.length);
    let r = 0;
    for (const it of items) r = Math.max(r, Math.hypot(it.x - cx, it.z - cz));
    const c = { tag, items, cx, cz, r: r + 15, level: -1, meshes: [], far: opts.far || 900, detail: !!opts.detail,
      lods: opts.lods !== false, colliders: [], shadow: opts.shadow !== false, building: false, removed: false };
    this.clusters.push(c);
    if (tag) {
      if (!this.byTag.has(tag)) this.byTag.set(tag, []);
      this.byTag.get(tag).push(c);
    }
    return c;
  }

  async addColliders(c) {
    for (const it of c.items) {
      if (it.collide === "grid") {
        const g = await this.grid(it.model);
        if (g) c.colliders.push(this.cols.addGrid(g, it.x, it.z, it.yaw, it.y, { tag: c.tag }));
      } else if (it.collide === "circle") {
        c.colliders.push(this.cols.addCircle(it.x, it.z, it.r || 0.4, it.y - 1, it.y + (it.h || 6), { tag: c.tag }));
      }
    }
  }

  removeTag(tag) {
    const list = this.byTag.get(tag) || [];
    for (const c of list) {
      c.removed = true;
      for (const m of c.meshes) this.group.remove(m);
      c.meshes = [];
      for (const col of c.colliders) this.cols.remove(col);
      c.colliders = [];
    }
    this.clusters = this.clusters.filter(c => !c.removed);
    this.byTag.delete(tag);
  }

  hasTag(tag) {
    return this.byTag.has(tag);
  }

  async buildLevel(c, level) {
    c.building = true;
    const byModel = new Map();
    for (const it of c.items) {
      const p = lodPath(it.model, c.lods ? level : 0);
      if (!byModel.has(p)) byModel.set(p, []);
      byModel.get(p).push(it);
    }
    const meshes = [];
    for (const [p, its] of byModel) {
      const m = await this.model(p);
      if (!m) continue;
      for (const part of m.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, its.length);
        its.forEach((it, i) => {
          tmpQ.setFromAxisAngle(UP, it.yaw);
          tmpS.setScalar(it.s || 1);
          tmpP.set(it.x, it.y, it.z);
          tmpM.compose(tmpP, tmpQ, tmpS);
          im.setMatrixAt(i, tmpM);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = c.shadow && level < 2;
        im.receiveShadow = true;
        meshes.push(im);
      }
    }
    c.building = false;
    if (c.removed) return;
    for (const m of c.meshes) this.group.remove(m);
    c.meshes = meshes;
    for (const m of meshes) this.group.add(m);
    c.level = level;
  }

  update(dt, focus) {
    this._t = (this._t || 0) + dt;
    const cam = this.engine.camera.position;
    for (const c of this.clusters) {
      if (c.building) continue;
      const d = Math.max(0, Math.hypot(cam.x - c.cx, cam.z - c.cz) - c.r);
      let want;
      if (d > c.far) want = -1;
      else if (c.detail) want = d < 140 ? 0 : -1;
      else if (d < 160) want = 0;
      else if (d < 380) want = 1;
      else want = 2;
      if (want === c.level) continue;
      if (want === -1) {
        for (const m of c.meshes) this.group.remove(m);
        c.meshes = [];
        c.level = -1;
        continue;
      }
      this.buildLevel(c, want);
    }
    if (this.grass) this.grass.update(focus);
  }

  setSeason(name) {
    this.season = name;
    const col = name === "autumn" ? new THREE.Color(1.6, 0.85, 0.35) : name === "winter" ? new THREE.Color(0.75, 0.72, 0.68) : new THREE.Color(1, 1, 1);
    for (const m of this.leafMats) {
      if (!m.userData.baseColor) m.userData.baseColor = m.color.clone();
      m.color.copy(m.userData.baseColor).multiply(col);
    }
  }

  isForest(x, z) {
    return this.forestDensity(x, z) > 0.45;
  }

  forestDensity(x, z) {
    const s = sample(x, z);
    if (s.h < 4 || s.village > 0.2 || s.road > 0.3 || s.river > 0.2) return 0;
    let f = 0.5 + 0.5 * N.fbm(x * 0.0035, z * 0.0035, 3);
    if (x > 600 && z > 400 && z < 1400) f += 0.35;
    if (z < -1050) f -= 0.45;
    f *= 1 - smoothstep(300, 360, s.h);
    return Math.max(0, f);
  }

  async populate(onProgress = () => {}) {
    const steps = [
      ["Сёла", () => this.buildSettlements()],
      ["Дербент", () => this.buildDerbent()],
      ["Мосты и башни", () => this.buildPOI()],
      ["Заставы", () => this.buildOutposts()],
      ["Леса и камни", () => this.buildVegetation()],
    ];
    let i = 0;
    for (const [name, fn] of steps) {
      onProgress(i / steps.length, name);
      await fn();
      i++;
    }
    this.grass = new GrassField(this);
    await this.grass.init();
    await Promise.all(this.clusters.map(c => this.addColliders(c)));
    this.setSeason(this.game.world.season);
  }

  baseY(x, z, radius) {
    let lo = heightAt(x, z);
    for (let a = 0; a < 6; a++) {
      const ang = a * Math.PI / 3;
      lo = Math.min(lo, heightAt(x + Math.cos(ang) * radius, z + Math.sin(ang) * radius));
    }
    return lo - 0.15;
  }

  downhillYaw(x, z) {
    const e = 4;
    const gx = heightAt(x + e, z) - heightAt(x - e, z);
    const gz = heightAt(x, z + e) - heightAt(x, z - e);
    if (Math.hypot(gx, gz) < 0.05) return null;
    return Math.atan2(-gx, -gz);
  }

  async buildSettlements() {
    for (const s of SETTLEMENTS) this.buildVillage(s);
  }

  buildVillage(s) {
    const rnd = mulberry(s.id.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
    const [cx, cz] = s.p;
    const R = settlementRadius(s);
    const items = [], props = [];
    const placed = [];
    const V = { s, houses: [], center: [cx, cz], R, spots: {} };
    const free = (x, z, r) => placed.every(p => Math.hypot(p[0] - x, p[1] - z) > p[2] + r);
    const add = (model, x, z, yaw, r, collide = "grid", list = items, extra = {}) => {
      const y = this.baseY(x, z, r * 0.7);
      const it = { model, x, y, z, yaw, collide, ...extra };
      list.push(it);
      placed.push([x, z, r]);
      return it;
    };
    if (s.size >= 2) {
      const yaw = this.downhillYaw(cx, cz) ?? rnd() * 6.28;
      const m = add("village/mosque_juma", cx + 3, cz - 4, yaw, 7.5);
      V.spots.mosque = [m.x + Math.sin(yaw) * 8, m.z + Math.cos(yaw) * 8];
    } else {
      placed.push([cx, cz, 6]);
    }
    V.spots.square = [cx - Math.sin(1) * 9, cz - Math.cos(1) * 9];
    const nHouses = { 1: 12, 2: 22, 3: 34 }[s.size];
    let tries = 0;
    while (V.houses.length < nHouses && tries++ < 900) {
      const a = rnd() * Math.PI * 2;
      const d = 9 + Math.pow(rnd(), 0.95) * R * 0.62;
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const sm = sample(x, z);
      if (sm.road > 0.35 || sm.river > 0.1 || sm.h < SEA_LEVEL + 1) continue;
      const t = rnd();
      const type = t < 0.45 ? "village/house_saklya_1f" : t < 0.85 ? "village/house_saklya_2f" : "village/house_saklya_large";
      const r = type.endsWith("1f") ? 3.8 : type.endsWith("2f") ? 4.6 : 5.8;
      if (!free(x, z, r)) continue;
      const dy = this.downhillYaw(x, z);
      const towardCenter = Math.atan2(cx - x, cz - z);
      let yaw = dy === null ? towardCenter : dy;
      yaw = Math.round(yaw / (Math.PI / 8)) * (Math.PI / 8) + (rnd() - 0.5) * 0.2;
      const it = add(type, x, z, yaw, r);
      const door = [x + Math.sin(yaw) * (r + 1.2), z + Math.cos(yaw) * (r + 1.2)];
      V.houses.push({ x, z, yaw, type, door, r });
      const nProps = Math.floor(rnd() * 3);
      for (let k = 0; k < nProps; k++) {
        const pm = ["village/haystack", "village/firewood_pile", "village/clay_jar", "village/arba_cart", "village/straw_beehive",
          "village/tandyr_oven", "village/grain_sacks", "village/copper_cauldron", "village/wooden_fence_4m"][Math.floor(rnd() * 9)];
        const pa = yaw + (rnd() < 0.5 ? 1 : -1) * (0.9 + rnd() * 0.8);
        const pd = r + 1.5 + rnd() * 2.5;
        const px = x + Math.sin(pa) * pd, pz = z + Math.cos(pa) * pd;
        if (!free(px, pz, 1.1)) continue;
        add(pm, px, pz, rnd() * 6.28, 1.1, pm === "village/arba_cart" || pm === "village/haystack" ? "grid" : null, props);
      }
    }
    let best = null, bh = -Infinity;
    for (let k = 0; k < 14; k++) {
      const a = k / 14 * Math.PI * 2;
      const x = cx + Math.cos(a) * R * 0.95, z = cz + Math.sin(a) * R * 0.95;
      const h = heightAt(x, z);
      if (h > bh && free(x, z, 3)) { bh = h; best = [x, z]; }
    }
    if (best && s.size >= 2) {
      const t = add("village/watch_tower", best[0], best[1], rnd() * 6.28, 3.2);
      V.spots.tower = [t.x, t.z];
    }
    for (let k = 0; k < 20; k++) {
      const a = rnd() * Math.PI * 2;
      const x = cx + Math.cos(a) * R * 1.05, z = cz + Math.sin(a) * R * 1.05;
      if (sample(x, z).road > 0.3 || !free(x, z, 8)) continue;
      const n = 6 + Math.floor(rnd() * 8);
      const yaw = rnd() * 6.28;
      for (let g = 0; g < n; g++) {
        const gx = x + (g % 4) * 1.6 - 2.4 + rnd() * 0.4, gz = z + Math.floor(g / 4) * 1.8 - 2 + rnd() * 0.4;
        add(rnd() < 0.5 ? "village/gravestone_a" : "village/gravestone_b", gx, gz, yaw + (rnd() - 0.5) * 0.3, 0.5, null, props);
      }
      V.spots.cemetery = [x, z];
      break;
    }
    for (let k = 0; k < 20; k++) {
      const a = rnd() * Math.PI * 2;
      const x = cx + Math.cos(a) * R * 0.35, z = cz + Math.sin(a) * R * 0.35;
      if (!free(x, z, 3)) continue;
      const sp = add("village/spring_rodnik", x, z, this.downhillYaw(x, z) ?? 0, 2.6);
      V.spots.spring = [sp.x, sp.z];
      break;
    }
    const nf = 3 + s.size * 2;
    for (let k = 0, made = 0; k < 40 && made < nf; k++) {
      const a = rnd() * Math.PI * 2;
      const d = R * (1.15 + rnd() * 0.4);
      const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
      const sm = sample(x, z);
      if (sm.road > 0.2 || sm.river > 0.1 || sm.h < 5 || !free(x, z, 6)) continue;
      add("nature/terrace_wheat_field", x, z, (this.downhillYaw(x, z) ?? 0) + Math.PI / 2, 5, null, props);
      made++;
    }
    if (s.fort) {
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2;
        const x = cx + Math.cos(a) * R * 0.75, z = cz + Math.sin(a) * R * 0.75;
        if (sample(x, z).road > 0.3) {
          add("village/village_gate", x, z, Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2, 3.2);
          continue;
        }
        if (free(x, z, 2)) add("village/stone_fence_4m", x, z, -a, 2.2);
      }
    }
    if (s.id === "kubachi") {
      for (let k = 0; k < 4; k++) {
        const h = V.houses[k];
        if (!h) break;
        const px = h.door[0] + 1.5, pz = h.door[1];
        add("village/copper_cauldron", px, pz, 0, 0.6, null, props);
        add("village/wooden_chest_sunduk", px - 1.2, pz + 0.8, 0.5, 0.6, null, props);
      }
    }
    V.spots.merchant = V.spots.square;
    V.spots.elder = V.spots.mosque || V.spots.square;
    this.villages[s.id] = V;
    this.addCluster("village:" + s.id, items, { far: 1500 });
    this.addCluster("vprops:" + s.id, props, { detail: true, lods: true, far: 160 });
  }

  wallLine(items, x0, x1, z, outerYaw, towerEvery = 5) {
    const seg = 12;
    const n = Math.floor((x1 - x0) / seg);
    for (let i = 0; i < n; i++) {
      const x = x0 + seg / 2 + i * seg;
      items.push({ model: "derbent/derbent_wall_12m", x, z, y: this.baseY(x, z, 5), yaw: outerYaw, collide: "grid" });
      if (i % towerEvery === 0) {
        const tz = z + (outerYaw === 0 ? 2.2 : -2.2);
        items.push({ model: "derbent/derbent_wall_tower", x: x - seg / 2, z: tz, y: this.baseY(x - seg / 2, tz, 4), yaw: outerYaw, collide: "grid" });
      }
    }
  }

  async buildDerbent() {
    const D = DERBENT;
    const items = [], houses = [];
    for (const [z, yaw] of [[D.wallN, Math.PI], [D.wallS, 0]]) {
      const cx = coastX(z) - 8;
      const gates = D.gateX;
      let x = D.x0;
      for (const gx of gates) {
        this.wallLine(items, x, gx - 7, z, yaw);
        items.push({ model: "derbent/derbent_city_gate", x: gx, z, y: this.baseY(gx, z, 6), yaw, collide: "grid" });
        x = gx + 7;
      }
      this.wallLine(items, x, cx, z, yaw);
    }
    const [kx, kz] = D.citadel;
    items.push({ model: "derbent/naryn_kala_tower", x: kx, z: kz, y: this.baseY(kx, kz, 4), yaw: 0, collide: "grid" });
    const cr = 34;
    for (let side = 0; side < 4; side++) {
      for (let k = -1; k <= 1; k++) {
        const ang = side * Math.PI / 2;
        const ox = Math.cos(ang) * cr, oz = Math.sin(ang) * cr;
        const tx = -Math.sin(ang) * k * 12, tz = Math.cos(ang) * k * 12;
        const x = kx + ox + tx, z = kz + oz + tz;
        if (side === 0 && k === 0) {
          items.push({ model: "derbent/derbent_city_gate", x, z, y: this.baseY(x, z, 6), yaw: -ang + Math.PI / 2, collide: "grid" });
          continue;
        }
        items.push({ model: "derbent/derbent_wall_12m", x, z, y: this.baseY(x, z, 5), yaw: -ang + Math.PI / 2, collide: "grid" });
      }
      const ca = side * Math.PI / 2 + Math.PI / 4;
      const x = kx + Math.cos(ca) * cr * 1.41, z = kz + Math.sin(ca) * cr * 1.41;
      items.push({ model: "derbent/derbent_wall_tower", x, z, y: this.baseY(x, z, 4), yaw: -ca + Math.PI / 2, collide: "grid" });
    }
    const rnd = mulberry(1735);
    for (let x = D.x0 + 50; x < coastX((D.wallN + D.wallS) / 2) - 25; x += 17) {
      for (let z = D.wallN + 22; z < D.wallS - 18; z += 16) {
        if (Math.abs(z - (D.wallN + D.wallS) / 2) < 7) continue;
        if (rnd() < 0.18) continue;
        const hx = x + (rnd() - 0.5) * 4, hz = z + (rnd() - 0.5) * 3;
        houses.push({ model: "derbent/derbent_house", x: hx, z: hz, y: this.baseY(hx, hz, 4), yaw: (z < (D.wallN + D.wallS) / 2 ? 0 : Math.PI) + (rnd() - 0.5) * 0.1, collide: "grid" });
      }
    }
    this.derbentStreet = [[D.x0 + 40, (D.wallN + D.wallS) / 2], [coastX(1300) - 30, (D.wallN + D.wallS) / 2]];
    this.addCluster("derbent:walls", items, { far: 2200 });
    this.addCluster("derbent:houses", houses, { far: 1200 });
    this.buildShahCamp("camp:derbent", D.camp[0], D.camp[1], 1.0, 77);
  }

  buildShahCamp(tag, cx, cz, scale, seed) {
    const rnd = mulberry(seed);
    const items = [], props = [];
    const put = (list, model, x, z, yaw, collide = "grid", extra = {}) => list.push({ model, x, z, y: this.baseY(x, z, 2), yaw, collide, ...extra });
    put(items, "persian_camp/shah_pavilion", cx, cz, 0);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      put(items, "persian_camp/tent_officer", cx + Math.cos(a) * 26, cz + Math.sin(a) * 26, Math.atan2(-Math.cos(a), -Math.sin(a)));
    }
    const rows = Math.round(5 * scale), cols = Math.round(7 * scale);
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const x = cx - 60 + j * 11 + (rnd() - 0.5) * 2, z = cz + 45 + i * 11 + (rnd() - 0.5) * 2;
        put(items, "persian_camp/tent_soldier", x, z, Math.PI + (rnd() - 0.5) * 0.3);
      }
    }
    for (let k = 0; k < 4; k++) {
      const x = cx - 30 + k * 20, z = cz - 40;
      put(items, "persian_camp/field_cannon", x, z, Math.PI / 2 + (rnd() - 0.5) * 0.2);
      put(props, "persian_camp/cannonball_pile", x + 3, z + 4, 0, null);
      put(props, "persian_camp/powder_keg", x - 3, z + 4, 0, null);
    }
    for (let k = 0; k < 6; k++) {
      const x = cx + 40 + (rnd() - 0.5) * 20, z = cz + (rnd() - 0.5) * 40;
      put(props, "persian_camp/supply_crate", x, z, rnd() * 6.28, "grid");
      put(props, "persian_camp/campfire", x + 6, z + 3, 0, null);
      put(props, "persian_camp/musket_rack", x - 5, z + 2, rnd() * 6.28, null);
    }
    put(items, "persian_camp/horse_hitching_line", cx - 45, cz - 10, 0);
    put(items, "persian_camp/horse_hitching_line", cx - 45, cz + 5, 0);
    for (let k = 0; k < 4; k++) put(props, "weapons/banner_persian", cx + (k - 1.5) * 12, cz - 14, 0, null, { s: 2.2 });
    const pr = 85 * scale;
    for (let k = 0; k < 40; k++) {
      const a = k / 40 * Math.PI * 2;
      if (k % 10 === 0) continue;
      const x = cx + Math.cos(a) * pr, z = cz + Math.sin(a) * pr;
      put(items, k % 3 ? "persian_camp/palisade_4m" : "persian_camp/gabion_tur", x, z, -a + Math.PI / 2);
    }
    this.camps = this.camps || {};
    this.camps[tag] = { c: [cx, cz], r: pr, cannons: items.filter(i => i.model.endsWith("field_cannon")).map(i => [i.x, i.z, i.yaw]) };
    this.addCluster(tag, items, { far: 1400 });
    this.addCluster(tag, props, { detail: true, far: 160 });
  }

  buildOutpost(op) {
    const tag = "outpost:" + op.id;
    if (this.hasTag(tag)) return;
    const [cx, cz] = op.p;
    const rnd = mulberry(op.id.length * 131 + Math.round(cx));
    const items = [], props = [];
    const put = (list, model, x, z, yaw, collide = "grid") => list.push({ model, x, z, y: this.baseY(x, z, 2), yaw, collide });
    put(items, "persian_camp/tent_officer", cx, cz, rnd() * 6.28);
    put(items, "persian_camp/tent_soldier", cx + 9, cz + 4, rnd() * 6.28);
    put(items, "persian_camp/tent_soldier", cx - 8, cz + 6, rnd() * 6.28);
    put(props, "persian_camp/campfire", cx + 1, cz + 9, 0, null);
    put(props, "persian_camp/musket_rack", cx + 5, cz - 6, rnd() * 6.28, null);
    put(props, "persian_camp/supply_crate", cx - 6, cz - 5, rnd() * 6.28);
    put(props, "persian_camp/powder_keg", cx - 4, cz - 7, 0, null);
    put(props, "weapons/banner_persian", cx + 2, cz - 2, 0, null);
    for (let k = 0; k < 10; k++) {
      const a = k / 10 * Math.PI * 2 + 0.3;
      if (k === 0) continue;
      put(items, k % 2 ? "persian_camp/palisade_4m" : "persian_camp/gabion_tur", cx + Math.cos(a) * 18, cz + Math.sin(a) * 18, -a + Math.PI / 2);
    }
    this.addCluster(tag, items, { far: 1000 });
    this.addCluster(tag, props, { detail: true, far: 160 });
  }

  async buildOutposts() {
    const st = this.game.state;
    for (const op of OUTPOSTS) {
      if (st.outposts[op.id] === "destroyed") continue;
      if (st.regions[op.region] === "highlanders" && !st.flags["outpost_" + op.id]) continue;
      this.buildOutpost(op);
    }
    if (st.flags.turchidag_camp && !st.flags.turchidag_broken) this.buildShahCamp("camp:turchidag", TURCHIDAG.c[0], TURCHIDAG.c[1], 0.9, 1741);
  }

  async buildPOI() {
    const items = [], props = [];
    for (const p of POI) {
      const [x, z] = p.p;
      const y = this.baseY(x, z, 3);
      if (p.type === "tower") items.push({ model: "village/watch_tower", x, z, y, yaw: 0.4, collide: "grid" });
      if (p.type === "shrine") {
        items.push({ model: "village/spring_rodnik", x, z, y, yaw: 0, collide: "grid" });
        for (let k = 0; k < 7; k++) props.push({ model: k % 2 ? "village/gravestone_a" : "village/gravestone_b", x: x - 5 + k * 1.6, z: z + 5, y: this.baseY(x - 5 + k * 1.6, z + 5, 0.5), yaw: 0 });
        props.push({ model: "weapons/banner_mountaineers", x: x + 4, z: z - 2, y, yaw: 0, s: 1.6 });
        props.push({ model: "weapons/banner_mountaineers", x: x - 4, z: z - 2, y, yaw: 0.5, s: 1.6 });
      }
      if (p.type === "cave") {
        items.push({ model: "nature/cliff_tall", x: x - 4, z: z + 3, y: y - 1, yaw: 0, collide: "grid" });
        items.push({ model: "nature/cliff_tall", x: x + 6, z: z + 3, y: y - 1, yaw: 0.2, collide: "grid" });
        items.push({ model: "nature/rock_large", x, z: z + 6, y: y + 6, yaw: 0, collide: "grid" });
      }
      if (p.type === "cliff") items.push({ model: "nature/cliff_tall", x, z, y: y - 2, yaw: 0.8, collide: "grid", s: 1.6 });
    }
    for (const rl of ROAD_LINES) {
      for (const rv of RIVERS) {
        for (let i = 0; i < rl.pts.length - 1; i++) {
          for (let j = 0; j < rv.pts.length - 1; j++) {
            const hit = segInter(rl.pts[i], rl.pts[i + 1], rv.pts[j], rv.pts[j + 1]);
            if (!hit) continue;
            const dx = rl.pts[i + 1][0] - rl.pts[i][0], dz = rl.pts[i + 1][1] - rl.pts[i][1];
            const l = Math.hypot(dx, dz);
            const ux = dx / l, uz = dz / l;
            const e1 = heightAt(hit[0] + ux * 9, hit[1] + uz * 9), e2 = heightAt(hit[0] - ux * 9, hit[1] - uz * 9);
            const deck = Math.max(e1, e2);
            const yaw = Math.atan2(-uz, ux);
            items.push({ model: "village/bridge_stone_arch", x: hit[0], z: hit[1], y: deck - 4.55, yaw, collide: "grid", s: 1.0 });
            this.bridges.push({ x: hit[0], z: hit[1], road: rl.id, river: rv.id });
          }
        }
      }
    }
    this.addCluster("poi", items, { far: 1500 });
    this.addCluster("poi:props", props, { detail: true, far: 160 });
  }

  async buildVegetation() {
    const q = this.q.trees;
    const S = 512;
    const n = WORLD / S;
    for (let si = 0; si < n; si++) {
      for (let sj = 0; sj < n; sj++) {
        const rnd = mulberry(si * 7919 + sj * 104729 + 3);
        const trees = [], rocks = [];
        const x0 = -HALF + si * S, z0 = -HALF + sj * S;
        const step = 13 / Math.sqrt(q);
        for (let z = z0; z < z0 + S; z += step) {
          for (let x = x0; x < x0 + S; x += step) {
            const px = x + rnd() * step, pz = z + rnd() * step;
            if (px > coastX(pz) - 40) continue;
            const f = this.forestDensity(px, pz);
            const r = rnd();
            if (f > 0.45 && r < (f - 0.35) * 1.1) {
              const s = sample(px, pz);
              const nx = heightAt(px + 2, pz) - heightAt(px - 2, pz), nz = heightAt(px, pz + 2) - heightAt(px, pz - 2);
              const slope = Math.hypot(nx, nz) / 4;
              if (slope > 0.9) continue;
              let model;
              const t = rnd();
              if (s.h > 230) model = t < 0.7 ? "nature/tree_pine" : t < 0.9 ? "nature/tree_pine_small" : "nature/tree_birch";
              else if (s.h > 150) model = t < 0.35 ? "nature/tree_pine" : t < 0.6 ? "nature/tree_birch" : t < 0.85 ? "nature/tree_beech" : "nature/bush_juniper";
              else model = t < 0.45 ? "nature/tree_beech" : t < 0.75 ? "nature/tree_oak" : t < 0.85 ? "nature/tree_walnut" : t < 0.95 ? "nature/bush_a" : "nature/bush_b";
              const tree = !model.includes("bush");
              trees.push({ model, x: px, z: pz, y: s.h - 0.3, yaw: rnd() * 6.28, s: 0.8 + rnd() * 0.5, collide: tree ? "circle" : null, r: 0.45, h: 8 });
            } else if (r > 0.985) {
              const s = sample(px, pz);
              if (s.village > 0.2 || s.road > 0.3) continue;
              const nx = heightAt(px + 2, pz) - heightAt(px - 2, pz), nz = heightAt(px, pz + 2) - heightAt(px, pz - 2);
              const slope = Math.hypot(nx, nz) / 4;
              let model = slope > 0.5 ? (rnd() < 0.5 ? "nature/rock_large" : "nature/boulder_pile") : ["nature/rock_a", "nature/rock_b", "nature/rock_flat", "nature/fallen_log", "nature/tree_stump", "nature/tree_dead"][Math.floor(rnd() * 6)];
              if (s.h > 300 && rnd() < 0.5) model = "nature/snow_patch";
              const big = model.includes("rock") || model.includes("boulder");
              rocks.push({ model, x: px, z: pz, y: s.h - 0.4, yaw: rnd() * 6.28, s: 0.7 + rnd() * 0.8, collide: big ? "grid" : null });
            }
          }
        }
        if (trees.length) this.addCluster("veg:" + si + ":" + sj, trees, { far: 750 * q, lods: false });
        if (rocks.length) this.addCluster("rock:" + si + ":" + sj, rocks, { far: 650, lods: true });
      }
    }
  }
}

export function toFloatGeometry(src) {
  const geo = new THREE.BufferGeometry();
  for (const name of Object.keys(src.attributes)) {
    const a = src.attributes[name];
    const n = a.count, sz = a.itemSize;
    const arr = new Float32Array(n * sz);
    for (let i = 0; i < n; i++) {
      arr[i * sz] = a.getX(i);
      if (sz > 1) arr[i * sz + 1] = a.getY(i);
      if (sz > 2) arr[i * sz + 2] = a.getZ(i);
      if (sz > 3) arr[i * sz + 3] = a.getW(i);
    }
    geo.setAttribute(name, new THREE.BufferAttribute(arr, sz));
  }
  if (src.index) geo.setIndex(src.index.clone());
  for (const g of src.groups) geo.addGroup(g.start, g.count, g.materialIndex);
  return geo;
}

function segInter(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

class GrassField {
  constructor(statics) {
    this.st = statics;
    this.count = Math.round(2600 * statics.q.grass);
    this.last = new THREE.Vector3(1e9, 0, 1e9);
    this.radius = 48;
  }

  async init() {
    const models = ["nature/grass_tuft", "nature/grass_dry", "nature/grass_alpine", "nature/flowers_alpine"];
    this.meshes = [];
    for (const p of models) {
      const m = await this.st.model(p);
      if (!m) continue;
      const parts = m.parts.map(part => {
        const im = new THREE.InstancedMesh(part.geo, part.mat, Math.ceil(this.count / 2));
        im.count = 0;
        im.frustumCulled = false;
        im.receiveShadow = true;
        this.st.group.add(im);
        return im;
      });
      this.meshes.push(parts);
    }
  }

  update(focus) {
    if (!this.meshes || !this.meshes.length) return;
    if (Math.hypot(focus.x - this.last.x, focus.z - this.last.z) < 10) return;
    this.last.copy(focus);
    const step = this.radius * 2 / Math.sqrt(this.count);
    const counts = this.meshes.map(() => 0);
    const terr = this.st.game.world.terrain;
    const gx0 = Math.floor((focus.x - this.radius) / step), gz0 = Math.floor((focus.z - this.radius) / step);
    const gn = Math.ceil(this.radius * 2 / step);
    const snow = terr.snowLine;
    for (let j = 0; j < gn; j++) {
      for (let i = 0; i < gn; i++) {
        const gi = gx0 + i, gj = gz0 + j;
        const hsh = Math.sin(gi * 127.1 + gj * 311.7) * 43758.5453;
        const r1 = hsh - Math.floor(hsh);
        const hsh2 = Math.sin(gi * 269.5 + gj * 183.3) * 12543.123;
        const r2 = hsh2 - Math.floor(hsh2);
        const x = (gi + r1) * step, z = (gj + r2) * step;
        if (Math.hypot(x - focus.x, z - focus.z) > this.radius) continue;
        const h = terr.height(x, z);
        if (h < SEA_LEVEL + 0.6 || h > snow - 20) continue;
        const nrm = terr.normal(x, z);
        if (nrm.y < 0.82) continue;
        const k = r1 < 0.08 ? 3 : h > 220 ? 2 : (this.st.season !== "summer" || r2 < 0.25) ? 1 : 0;
        const parts = this.meshes[k];
        if (!parts) continue;
        const idx = counts[k];
        if (idx >= parts[0].instanceMatrix.count) continue;
        tmpQ.setFromAxisAngle(UP, r1 * 6.28);
        tmpS.setScalar(0.7 + r2 * 0.8);
        tmpP.set(x, h - 0.05, z);
        tmpM.compose(tmpP, tmpQ, tmpS);
        for (const im of parts) im.setMatrixAt(idx, tmpM);
        counts[k]++;
      }
    }
    const winter = this.st.season === "winter";
    this.meshes.forEach((parts, k) => {
      for (const im of parts) {
        im.count = winter && k !== 1 ? 0 : counts[k];
        im.instanceMatrix.needsUpdate = true;
      }
    });
  }
}
