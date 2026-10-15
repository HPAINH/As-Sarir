import * as THREE from "three";

const KEYS = [
  { h: 0, top: [0.02, 0.03, 0.08], hor: [0.05, 0.07, 0.13], sun: [0.45, 0.55, 0.85], sunI: 0.22, hemi: 0.25 },
  { h: 5, top: [0.05, 0.07, 0.16], hor: [0.35, 0.25, 0.25], sun: [0.9, 0.55, 0.35], sunI: 0.3, hemi: 0.35 },
  { h: 6.5, top: [0.25, 0.4, 0.65], hor: [0.95, 0.65, 0.42], sun: [1.0, 0.72, 0.5], sunI: 1.6, hemi: 0.7 },
  { h: 9, top: [0.27, 0.5, 0.85], hor: [0.72, 0.82, 0.92], sun: [1.0, 0.95, 0.86], sunI: 2.9, hemi: 1.05 },
  { h: 15, top: [0.25, 0.48, 0.84], hor: [0.74, 0.83, 0.93], sun: [1.0, 0.95, 0.86], sunI: 3.0, hemi: 1.05 },
  { h: 18, top: [0.25, 0.36, 0.62], hor: [0.98, 0.6, 0.38], sun: [1.0, 0.62, 0.38], sunI: 1.7, hemi: 0.7 },
  { h: 19.6, top: [0.08, 0.09, 0.2], hor: [0.4, 0.25, 0.3], sun: [0.8, 0.45, 0.4], sunI: 0.4, hemi: 0.38 },
  { h: 21, top: [0.02, 0.03, 0.08], hor: [0.05, 0.07, 0.13], sun: [0.45, 0.55, 0.85], sunI: 0.22, hemi: 0.25 },
  { h: 24, top: [0.02, 0.03, 0.08], hor: [0.05, 0.07, 0.13], sun: [0.45, 0.55, 0.85], sunI: 0.22, hemi: 0.25 },
];

function lerpArr(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function keyAt(h) {
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i], b = KEYS[i + 1];
    if (h >= a.h && h <= b.h) {
      const t = (h - a.h) / (b.h - a.h);
      return { top: lerpArr(a.top, b.top, t), hor: lerpArr(a.hor, b.hor, t), sun: lerpArr(a.sun, b.sun, t),
        sunI: a.sunI + (b.sunI - a.sunI) * t, hemi: a.hemi + (b.hemi - a.hemi) * t };
    }
  }
  return KEYS[0];
}

export const WEATHER = {
  clear: { name: "Ясно", fog: 1.0, cloud: 0.0, light: 1.0 },
  cloudy: { name: "Облачно", fog: 1.3, cloud: 0.6, light: 0.75 },
  fog: { name: "Туман", fog: 5.5, cloud: 0.5, light: 0.7 },
  rain: { name: "Дождь", fog: 2.4, cloud: 0.9, light: 0.55 },
  snow: { name: "Снег", fog: 2.8, cloud: 0.85, light: 0.7 },
};

export class Sky {
  constructor(engine) {
    this.engine = engine;
    const scene = engine.scene;
    this.hours = 8.5;
    this.dayLength = 24 * 60;
    this.weather = "clear";
    this.weatherT = 0;
    this.wBlend = { fog: 1, cloud: 0, light: 1 };
    this.baseFog = engine.q.fog;
    this.seasonTint = new THREE.Color(1, 1, 1);
    this.fogBoost = 1;

    this.uniforms = {
      top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
      night: { value: 0 }, cloud: { value: 0 }, time: { value: 0 },
    };
    const geo = new THREE.SphereGeometry(2300, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 top, hor, sunDir; uniform float night, cloud, time; varying vec3 vDir;
        float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
          float a=hash(vec3(i,1.)), b=hash(vec3(i+vec2(1,0),1.)), c=hash(vec3(i+vec2(0,1),1.)), d=hash(vec3(i+vec2(1,1),1.));
          return mix(mix(a,b,f.x),mix(c,d,f.x),f.y); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 col = mix(hor, top, pow(max(h,0.0), 0.55));
          if (d.y < 0.0) col = mix(hor, hor*0.6, clamp(-d.y*4.0,0.0,1.0));
          float sd = max(dot(d, sunDir), 0.0);
          col += vec3(1.0,0.85,0.6) * pow(sd, 600.0) * 6.0 * (1.0-night);
          col += vec3(1.0,0.7,0.45) * pow(sd, 8.0) * 0.25 * (1.0-night);
          vec3 md = -sunDir;
          float mdot = max(dot(d, md), 0.0);
          col += vec3(0.8,0.85,1.0) * pow(mdot, 900.0) * 3.0 * night;
          if (night > 0.0 && d.y > 0.0) {
            vec3 sp = floor(d * 380.0);
            float s = hash(sp);
            col += vec3(step(0.9975, s)) * night * (0.6 + 0.4*sin(time*3.0 + s*90.0)) * (1.0-cloud);
          }
          if (d.y > 0.02) {
            vec2 uv = d.xz / (d.y + 0.15) * 1.6 + vec2(time*0.004, time*0.002);
            float c = n2(uv*2.0)*0.6 + n2(uv*4.3)*0.3 + n2(uv*9.0)*0.1;
            float cov = smoothstep(0.75 - cloud*0.5, 1.0 - cloud*0.25, c);
            vec3 cc = mix(vec3(1.0), hor, 0.4) * (1.0 - night*0.85) * (1.0 - cloud*0.35);
            col = mix(col, cc, cov * smoothstep(0.02, 0.25, d.y) * 0.9);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.dome = new THREE.Mesh(geo, mat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = engine.q.shadows;
    const ss = engine.q.shadowSize;
    this.sun.shadow.mapSize.set(ss, ss);
    const sc = this.sun.shadow.camera;
    this.shadowExtent = 70;
    sc.left = -this.shadowExtent; sc.right = this.shadowExtent; sc.top = this.shadowExtent; sc.bottom = -this.shadowExtent;
    sc.near = 1; sc.far = 600;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b5b45, 1);
    scene.add(this.hemi);
    scene.fog = new THREE.FogExp2(0xaabbcc, this.baseFog);

    this.rain = this.makeRain();
    this.snow = this.makeSnow();
    scene.add(this.rain, this.snow);
  }

  makeRain() {
    const n = 1800;
    const pos = new Float32Array(n * 6);
    this.rainSeeds = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      this.rainSeeds[i * 3] = (Math.random() - 0.5) * 60;
      this.rainSeeds[i * 3 + 1] = Math.random() * 30;
      this.rainSeeds[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const m = new THREE.LineBasicMaterial({ color: 0x9ab0c8, transparent: true, opacity: 0.45 });
    const l = new THREE.LineSegments(g, m);
    l.frustumCulled = false;
    l.visible = false;
    return l;
  }

  makeSnow() {
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 70;
      pos[i * 3 + 1] = Math.random() * 35;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 70;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const x = c.getContext("2d");
    const gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, "rgba(255,255,255,1)");
    gr.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = gr;
    x.fillRect(0, 0, 32, 32);
    const m = new THREE.PointsMaterial({ size: 0.16, map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, color: 0xffffff });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    p.visible = false;
    return p;
  }

  setWeather(w) {
    if (WEATHER[w]) this.weather = w;
  }

  setSeason(tint) {
    this.seasonTint.copy(tint);
  }

  get isNight() {
    return this.hours < 5.5 || this.hours > 20;
  }

  get visibilityFactor() {
    let f = this.isNight ? 25 / 60 : 1;
    if (this.weather === "fog") f = Math.min(f, 0.5);
    if (this.weather === "rain" || this.weather === "snow") f *= 0.8;
    return f;
  }

  update(dt, focus) {
    this.hours = (this.hours + dt * 24 / this.dayLength) % 24;
    const k = keyAt(this.hours);
    const W = WEATHER[this.weather];
    const b = this.wBlend;
    const r = Math.min(1, dt * 0.3);
    b.fog += (W.fog - b.fog) * r;
    b.cloud += (W.cloud - b.cloud) * r;
    b.light += (W.light - b.light) * r;
    const ang = (this.hours - 6) / 24 * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(ang) * 0.75, Math.sin(ang), 0.45).normalize();
    const night = THREE.MathUtils.clamp((-sunDir.y + 0.08) * 4, 0, 1);
    const grey = new THREE.Color(0.55, 0.58, 0.62);
    const top = new THREE.Color(...k.top).lerp(grey.clone().multiplyScalar(1 - night * 0.85), b.cloud * 0.6);
    const hor = new THREE.Color(...k.hor).lerp(grey.clone().multiplyScalar(1 - night * 0.85), b.cloud * 0.5);
    this.uniforms.top.value.copy(top);
    this.uniforms.hor.value.copy(hor);
    this.uniforms.sunDir.value.copy(sunDir);
    this.uniforms.night.value = night;
    this.uniforms.cloud.value = b.cloud;
    this.uniforms.time.value += dt;
    const lightDir = sunDir.y > -0.05 ? sunDir : sunDir.clone().negate();
    this.sun.color.setRGB(...k.sun);
    this.sun.intensity = k.sunI * b.light;
    this.hemi.intensity = k.hemi * (0.75 + 0.25 * b.light);
    this.hemi.color.copy(top).lerp(new THREE.Color(1, 1, 1), 0.5);
    this.hemi.groundColor.setRGB(0.42, 0.36, 0.28).multiplyScalar(0.4 + 0.6 * (1 - night));
    const scene = this.engine.scene;
    scene.fog.color.copy(hor);
    scene.fog.density = this.engine.q.fog * b.fog * this.fogBoost;
    if (focus) {
      const step = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
      const fx = Math.round(focus.x / step) * step, fz = Math.round(focus.z / step) * step;
      this.sun.target.position.set(fx, focus.y, fz);
      this.sun.position.set(fx + lightDir.x * 250, focus.y + lightDir.y * 250, fz + lightDir.z * 250);
      this.dome.position.copy(this.engine.camera.position);
      this.updateParticles(dt, this.engine.camera.position);
    }
  }

  updateParticles(dt, cam) {
    const raining = this.weather === "rain";
    const snowing = this.weather === "snow";
    this.rain.visible = raining;
    this.snow.visible = snowing;
    if (raining) {
      const p = this.rain.geometry.attributes.position.array;
      const s = this.rainSeeds;
      for (let i = 0; i < s.length / 3; i++) {
        s[i * 3 + 1] -= dt * 28;
        if (s[i * 3 + 1] < -2) s[i * 3 + 1] += 32;
        const x = cam.x + s[i * 3], y = cam.y + s[i * 3 + 1] - 6, z = cam.z + s[i * 3 + 2];
        p[i * 6] = x; p[i * 6 + 1] = y; p[i * 6 + 2] = z;
        p[i * 6 + 3] = x + 0.05; p[i * 6 + 4] = y - 0.7; p[i * 6 + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (snowing) {
      this.snow.position.set(cam.x, cam.y - 8, cam.z);
      const p = this.snow.geometry.attributes.position.array;
      const t = this.uniforms.time.value;
      for (let i = 0; i < p.length / 3; i++) {
        p[i * 3 + 1] -= dt * 1.4;
        p[i * 3] += Math.sin(t + i) * dt * 0.3;
        if (p[i * 3 + 1] < 0) p[i * 3 + 1] += 35;
      }
      this.snow.geometry.attributes.position.needsUpdate = true;
    }
  }
}
