import * as THREE from "three";

export const QUALITY = {
  low: { pixelRatio: 0.75, shadows: true, shadowSize: 1024, rings: 4, grass: 0.35, fog: 0.0016, trees: 0.6, antialias: false },
  medium: { pixelRatio: 1.0, shadows: true, shadowSize: 2048, rings: 5, grass: 0.7, fog: 0.0012, trees: 0.85, antialias: true },
  high: { pixelRatio: 1.5, shadows: true, shadowSize: 2048, rings: 6, grass: 1.0, fog: 0.0009, trees: 1.0, antialias: true },
};

export class Engine {
  constructor(canvas, quality = "medium") {
    this.canvas = canvas;
    this.q = QUALITY[quality] || QUALITY.medium;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.q.antialias, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 2600);
    this.scene.add(this.camera);
    this.clock = new THREE.Clock();
    this.systems = [];
    this.time = 0;
    this.paused = false;
    this.timeScale = 1;
    this.fps = 60;
    this._frames = 0;
    this._fpsT = 0;
    this.stats = { calls: 0, tris: 0 };
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  setQuality(name) {
    this.q = QUALITY[name] || QUALITY.medium;
    this.quality = name;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  add(sys) {
    this.systems.push(sys);
    return sys;
  }

  start(onFrame) {
    this.onFrame = onFrame;
    this.renderer.setAnimationLoop(() => this.frame());
  }

  simulate(seconds, dt = 1 / 30) {
    const n = Math.round(seconds / dt);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) {
      this.time += dt;
      if (this.onFrame) this.onFrame(dt, dt);
      for (const s of this.systems) if (s.update) s.update(dt, dt);
    }
    return (performance.now() - t0) / n;
  }

  frame() {
    const raw = this.clock.getDelta();
    let dt = Math.min(0.05, raw);
    this._frames++;
    this._fpsT += raw;
    if (this._fpsT >= 0.5) {
      this.fps = this._frames / this._fpsT;
      this._frames = 0;
      this._fpsT = 0;
    }
    const sdt = this.paused ? 0 : dt * this.timeScale;
    this.time += sdt;
    if (this.onFrame) this.onFrame(sdt, dt);
    for (const s of this.systems) if (s.update) s.update(sdt, dt);
    this.renderer.render(this.scene, this.camera);
    this.stats.calls = this.renderer.info.render.calls;
    this.stats.tris = this.renderer.info.render.triangles;
  }
}
