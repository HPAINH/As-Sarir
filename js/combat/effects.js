import * as THREE from "three";

const MAX = 5000;

export class Effects {
  constructor(engine) {
    this.engine = engine;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX);
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 400 } }]),
      vertexShader: `
        attribute float size; attribute vec4 color; varying vec4 vColor; uniform float scale;
        #include <fog_pars_vertex>
        void main(){ vColor = color; vec4 mvPosition = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / max(0.1, -mvPosition.z); gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        varying vec4 vColor;
        #include <fog_pars_fragment>
        void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c); if (d > 0.5) discard;
          float a = vColor.a * smoothstep(0.5, 0.15, d); gl_FragColor = vec4(vColor.rgb, a);
          #include <fog_fragment>
        }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    engine.scene.add(this.points);
    this.p = [];
    this.free = [];
    for (let i = MAX - 1; i >= 0; i--) this.free.push(i);
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 18, 2);
      l.visible = false;
      engine.scene.add(l);
      this.lights.push({ l, t: 0 });
    }
    this.projectiles = [];
    this.flashI = 0;
  }

  spawn(x, y, z, vx, vy, vz, life, size, r, g, b, a, opts = {}) {
    const i = this.free.pop();
    if (i === undefined) return;
    this.p.push({ i, x, y, z, vx, vy, vz, life, max: life, size, grow: opts.grow || 0, r, g, b, a, grav: opts.grav || 0, drag: opts.drag ?? 0.98, fade: opts.fade ?? 1 });
  }

  smoke(pos, dir, amount = 14, scale = 1) {
    for (let k = 0; k < amount; k++) {
      const s = 0.2 + Math.random() * 0.6;
      const vx = (dir ? dir.x * 3 : 0) + (Math.random() - 0.5) * 1.2;
      const vy = 0.4 + Math.random() * 0.8;
      const vz = (dir ? dir.z * 3 : 0) + (Math.random() - 0.5) * 1.2;
      const c = 0.75 + Math.random() * 0.15;
      this.spawn(pos.x, pos.y, pos.z, vx * s, vy, vz * s, 2.5 + Math.random() * 2.5, 0.5 * scale, c, c, c * 0.98, 0.45, { grow: 1.1 * scale, drag: 0.94 });
    }
  }

  flash(pos) {
    for (let k = 0; k < 8; k++) {
      this.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0.08, 0.35, 1, 0.8, 0.4, 1, { drag: 0.8 });
    }
    const L = this.lights[this.flashI++ % this.lights.length];
    L.l.position.copy(pos);
    L.l.intensity = 30;
    L.l.visible = true;
    L.t = 0.08;
  }

  sparks(pos, n = 10) {
    for (let k = 0; k < n; k++) {
      this.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 7, Math.random() * 5, (Math.random() - 0.5) * 7, 0.3 + Math.random() * 0.3, 0.06, 1, 0.85, 0.4, 1, { grav: 9, drag: 0.97 });
    }
  }

  dust(pos, n = 10, color = [0.55, 0.48, 0.38]) {
    for (let k = 0; k < n; k++) {
      this.spawn(pos.x, pos.y, pos.z, (Math.random() - 0.5) * 2.5, Math.random() * 1.6, (Math.random() - 0.5) * 2.5, 0.8 + Math.random() * 0.8, 0.25, color[0], color[1], color[2], 0.55, { grow: 0.8, drag: 0.92 });
    }
  }

  blood(pos, dir, n = 8) {
    for (let k = 0; k < n; k++) {
      this.spawn(pos.x, pos.y, pos.z, dir.x * 2 + (Math.random() - 0.5) * 2, 1 + Math.random() * 2, dir.z * 2 + (Math.random() - 0.5) * 2, 0.5 + Math.random() * 0.3, 0.07, 0.42, 0.04, 0.03, 0.9, { grav: 9 });
    }
  }

  explosion(pos, scale = 1) {
    for (let k = 0; k < 30 * scale; k++) {
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2;
      const sp = 4 + Math.random() * 8;
      this.spawn(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp, Math.sin(a) * Math.cos(e) * sp, 0.35 + Math.random() * 0.35, 0.9 * scale, 1, 0.55 + Math.random() * 0.3, 0.15, 1, { drag: 0.88 });
    }
    for (let k = 0; k < 25 * scale; k++) {
      this.spawn(pos.x + (Math.random() - 0.5) * 2, pos.y + Math.random(), pos.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 1 + Math.random() * 3, (Math.random() - 0.5) * 3, 3 + Math.random() * 3, 1.2 * scale, 0.3, 0.28, 0.26, 0.6, { grow: 1.6 * scale, drag: 0.95 });
    }
    for (let k = 0; k < 18 * scale; k++) {
      this.spawn(pos.x, pos.y + 0.3, pos.z, (Math.random() - 0.5) * 12, 3 + Math.random() * 9, (Math.random() - 0.5) * 12, 1.2, 0.12, 0.25, 0.2, 0.15, 1, { grav: 14, drag: 0.99 });
    }
    const L = this.lights[this.flashI++ % this.lights.length];
    L.l.position.copy(pos).setY(pos.y + 2);
    L.l.intensity = 160;
    L.l.distance = 40;
    L.l.visible = true;
    L.t = 0.25;
  }

  torch(pos) {
    if (Math.random() < 0.5) this.spawn(pos.x + (Math.random() - 0.5) * 0.1, pos.y, pos.z + (Math.random() - 0.5) * 0.1, 0, 1.5, 0, 0.35, 0.18, 1, 0.55, 0.15, 0.9, { drag: 0.95 });
  }

  update(dt) {
    const pos = this.pos, col = this.col, size = this.size;
    for (let k = this.p.length - 1; k >= 0; k--) {
      const p = this.p[k];
      p.life -= dt;
      if (p.life <= 0) {
        size[p.i] = 0;
        col[p.i * 4 + 3] = 0;
        this.free.push(p.i);
        this.p[k] = this.p[this.p.length - 1];
        this.p.pop();
        continue;
      }
      p.vy -= p.grav * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d; p.vy *= d; p.vz *= d;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.size += p.grow * dt;
      const i = p.i;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 4] = p.r; col[i * 4 + 1] = p.g; col[i * 4 + 2] = p.b;
      col[i * 4 + 3] = p.a * Math.min(1, p.life / (p.max * 0.5));
      size[i] = p.size;
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    this.points.material.uniforms.scale.value = this.engine.renderer.domElement.height * 0.6;
    for (const L of this.lights) {
      if (L.t > 0) {
        L.t -= dt;
        if (L.t <= 0) { L.l.visible = false; L.l.intensity = 0; L.l.distance = 18; }
      }
    }
  }
}
