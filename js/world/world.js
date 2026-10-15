import * as THREE from "three";
import { Terrain } from "./terrain.js";
import { Sky } from "./sky.js";
import { Water } from "./water.js";
import { Colliders } from "./colliders.js";
import { regionAt, REGIONS, SETTLEMENTS, settlement } from "./geo.js";

export const SEASONS = {
  summer: { name: "Лето", snowLine: 345, tint: new THREE.Color(1, 1, 1) },
  autumn: { name: "Осень", snowLine: 285, tint: new THREE.Color(1.18, 0.98, 0.66) },
  winter: { name: "Зима", snowLine: 120, tint: new THREE.Color(0.86, 0.88, 0.92) },
};

export class World {
  constructor(game) {
    this.game = game;
    const engine = game.engine;
    const A = game.assets;
    this.textures = {
      grass: A.texture("ground_grass.png"), rock: A.texture("ground_rock.png"),
      snow: A.texture("ground_snow.png"), dirt: A.texture("ground_dirt.png"),
    };
    this.terrain = new Terrain(engine, this.textures);
    this.terrain.viewRings = engine.q.rings;
    this.sky = new Sky(engine);
    this.water = new Water(engine);
    this.colliders = new Colliders();
    this.season = "summer";
    this.statics = null;
  }

  regionAt(x, z) {
    return regionAt(x, z);
  }

  settlement(id) {
    return settlement(id);
  }

  nearestSettlement(x, z) {
    let best = null, bd = Infinity;
    for (const s of SETTLEMENTS) {
      const d = Math.hypot(s.p[0] - x, s.p[1] - z);
      if (d < bd) { bd = d; best = s; }
    }
    return [best, bd];
  }

  setSeason(name) {
    const S = SEASONS[name];
    if (!S) return;
    this.season = name;
    this.terrain.setSeason(S.snowLine, S.tint);
    this.sky.setSeason(S.tint);
    if (this.statics) this.statics.setSeason(name);
  }

  ground(x, z, y = 1e9) {
    const th = this.terrain.height(x, z);
    return this.colliders.groundAt(x, z, y, th)[0];
  }

  update(dt, focus) {
    this.terrain.update(focus.x, focus.z);
    this.sky.update(dt, focus);
    this.water.update(dt);
    if (this.statics) this.statics.update(dt, focus);
  }
}

export { REGIONS };
