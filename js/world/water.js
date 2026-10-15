import * as THREE from "three";
import { RIVERS, SEA_LEVEL } from "./geo.js";
import { riverWaterPoints } from "./heightmap.js";

function waterNormalTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const x = c.getContext("2d");
  const img = x.createImageData(128, 128);
  for (let j = 0; j < 128; j++) {
    for (let i = 0; i < 128; i++) {
      const a = Math.sin(i / 128 * Math.PI * 6) * 0.5 + Math.sin((i + j) / 128 * Math.PI * 10) * 0.3 + Math.cos(j / 128 * Math.PI * 8) * 0.4;
      const b = Math.cos(j / 128 * Math.PI * 6) * 0.5 + Math.sin((i - j) / 128 * Math.PI * 8) * 0.3;
      const k = (j * 128 + i) * 4;
      img.data[k] = 128 + a * 40;
      img.data[k + 1] = 128 + b * 40;
      img.data[k + 2] = 255;
      img.data[k + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export class Water {
  constructor(engine) {
    this.engine = engine;
    this.normal = waterNormalTexture();
    this.normal.repeat.set(220, 220);
    this.seaMat = new THREE.MeshStandardMaterial({
      color: 0x2d5f78, roughness: 0.18, metalness: 0.15, transparent: true, opacity: 0.86, normalMap: this.normal,
      normalScale: new THREE.Vector2(0.35, 0.35),
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000, 1, 1), this.seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, SEA_LEVEL - 0.3, 0);
    sea.receiveShadow = true;
    sea.renderOrder = 1;
    engine.scene.add(sea);
    this.sea = sea;
    this.riverNormal = this.normal.clone();
    this.riverNormal.repeat.set(1, 1);
    this.riverMat = new THREE.MeshStandardMaterial({
      color: 0x4a7f8f, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.85, normalMap: this.riverNormal, side: THREE.DoubleSide,
      normalScale: new THREE.Vector2(0.5, 0.5),
    });
    this.rivers = [];
    for (const rv of RIVERS) this.rivers.push(this.buildRiver(rv));
  }

  buildRiver(rv) {
    const pts = riverWaterPoints(rv, 10);
    const pos = [], uv = [], idx = [];
    let acc = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[2] - a[2];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const w = rv.w * 0.65;
      if (i > 0) acc += Math.hypot(p[0] - pts[i - 1][0], p[2] - pts[i - 1][2]);
      pos.push(p[0] - dz * w, p[1], p[2] + dx * w, p[0] + dz * w, p[1], p[2] - dx * w);
      uv.push(0, acc / 12, 1, acc / 12);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.riverMat);
    m.receiveShadow = true;
    m.renderOrder = 1;
    this.engine.scene.add(m);
    return { def: rv, mesh: m, pts };
  }

  update(dt) {
    this.normal.offset.x += dt * 0.004;
    this.normal.offset.y += dt * 0.002;
    this.riverNormal.offset.y -= dt * 0.35;
  }
}
