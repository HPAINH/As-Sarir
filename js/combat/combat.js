import * as THREE from "three";
import { WEAPONS, ARMORS } from "./weapons.js";

const tA = new THREE.Vector3(), tB = new THREE.Vector3(), tC = new THREE.Vector3();

function rayCapsule(o, d, a, b, r) {
  const u = d, v = tC.copy(b).sub(a), w = tA.copy(o).sub(a);
  const A = u.dot(u), B = u.dot(v), C = v.dot(v), D = u.dot(w), E = v.dot(w);
  const den = A * C - B * B;
  let sc, tc;
  if (den < 1e-8) { sc = 0; tc = B > C ? D / B : E / C; }
  else { sc = (B * E - C * D) / den; tc = (A * E - B * D) / den; }
  tc = Math.max(0, Math.min(1, tc));
  sc = Math.max(0, (B * tc - D) / A);
  const px = o.x + u.x * sc - (a.x + v.x * tc), py = o.y + u.y * sc - (a.y + v.y * tc), pz = o.z + u.z * sc - (a.z + v.z * tc);
  const dist = Math.sqrt(px * px + py * py + pz * pz);
  return dist <= r ? sc : Infinity;
}

export class Combat {
  constructor(game) {
    this.game = game;
    this.noises = [];
    this.noiseId = 0;
    this.projectiles = [];
    this.corpses = [];
    this.arrowProto = null;
    this.ballGeo = new THREE.SphereGeometry(0.12, 8, 6);
    this.ballMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.6, roughness: 0.4 });
  }

  async onStart() {
    const g = await this.game.assets.load("weapons/arrow");
    if (g) this.arrowProto = g.scene;
  }

  hostile(a, b) {
    if (!a || !b || a === b || a.dead || b.dead) return false;
    if (a.kind === "horse" || b.kind === "horse") return false;
    const ta = a.team, tb = b.team;
    if (ta === tb) return false;
    if (ta === "neutral" || tb === "neutral") return false;
    if (ta === "wild" || tb === "wild") return a.isPlayer || b.isPlayer || (a.role === "companion" || b.role === "companion");
    if (ta === "beasts" || tb === "beasts") return true;
    if (a.forceHostile || b.forceHostile) return true;
    return (ta === "highlanders" && tb === "persian") || (ta === "persian" && tb === "highlanders");
  }

  noise(pos, radius, src, loud = false) {
    this.noises.push({ id: ++this.noiseId, pos: pos.clone(), radius, src, loud, t: this.game.engine.time });
  }

  hearNoise(n) {
    const now = this.game.engine.time;
    let best = null;
    for (const z of this.noises) {
      if (now - z.t > 0.6 || z.src === n || (n._noiseSeen || 0) >= z.id) continue;
      if (z.src && !this.hostile(n, z.src) && z.src.team === n.team) continue;
      if (n.pos.distanceTo(z.pos) > z.radius) continue;
      best = z;
    }
    if (best) n._noiseSeen = best.id;
    return best;
  }

  armorOf(t) {
    if (t.isPlayer) return (ARMORS[this.game.state.armor] || ARMORS.none).def;
    return t.armorDef || 0;
  }

  damage(t, src, amount, info = {}) {
    const g = this.game;
    if (!t || t.dead) return 0;
    if (t.invulnerable) return 0;
    let dmg = amount;
    const type = info.type || "melee";
    if (type !== "fall") {
      const arm = this.armorOf(t);
      dmg *= 1 - arm * (type === "bullet" ? 0.5 : 1);
    }
    if (t.isPlayer && type === "arrow") dmg *= 1 - g.peopleBonus("arrow_resist");
    if (t.isPlayer) dmg *= g.difficulty || 0.85;
    if (t.isPlayer && src && !src.isPlayer) dmg *= type === "bullet" ? 0.5 : type === "melee" ? 0.8 : type === "grape" ? 0.6 : 1;
    if (src && src.brain && src.brain.followerOf && g.state.items.includes("banner_kazikumukh")) dmg *= 1.1;
    if (src && src.isPlayer && t.team === "highlanders" && t.kind === "npc") dmg *= 0.25;
    if (src && !src.isPlayer && t.isPlayer && src.team === "highlanders") dmg = 0;
    if (src && src.team === t.team && !src.isPlayer && !t.isPlayer && type !== "explosion") dmg *= 0.2;
    dmg = Math.max(0, dmg);
    t.hp -= dmg;
    if (info.dir && t.kind === "npc" && !t.mount && type !== "fall") {
      t.vel.x += info.dir.x * (type === "trample" ? 7 : 1.5);
      t.vel.z += info.dir.z * (type === "trample" ? 7 : 1.5);
    }
    if (t.isPlayer) {
      t.hurtT = 0.5;
      g.rig.shake = Math.max(g.rig.shake, Math.min(1, dmg / 40));
      g.events.emit("hurt", { dmg, src });
    }
    if (t.brain && src && t.brain.state !== "combat" && this.hostile(t, src)) {
      t.brain.engage(src);
      if (t.group) t.group.alert(src, t);
    }
    if (t.brain && t.role === "civilian" && t.brain.state !== "flee") t.brain.flee(15, src);
    if (t.kind === "animal" && t.brain && src) {
      if (t.role === "herbivore") { t.brain.state = "flee"; t.brain.target = src; t.brain.fleeT = 8; }
      else if (t.role === "predator") { t.brain.state = "hunt"; t.brain.target = src; }
    }
    if (t.camelOf && t.camelOf.brain) t.camelOf.brain.spookT = 4;
    if (t.hp <= 0) this.kill(t, src, info);
    else if (dmg > 12 && t.has && t.has("Hit") && !(t.oneShot && /Attack/.test(t.oneShot.name)) && !t.mount) t.play("Hit", { fade: 0.06 });
    if (dmg > 0 && t.kind !== "horse" && info.point) {
      g.effects.blood(info.point, info.dir || new THREE.Vector3(0, 0, 1), Math.min(14, 3 + dmg / 8));
    }
    if (src && src.isPlayer && dmg > 0) g.events.emit("hit", { target: t, dmg });
    return dmg;
  }

  kill(t, src, info = {}) {
    const g = this.game;
    t.dead = true;
    t.hp = 0;
    t.blocking = false;
    if (t.kind !== "horse" && t.mount) t.mount.dismount();
    if (t.kind === "horse" && t.rider) t.dismount();
    t.oneShot = null;
    if (t.actions && t.actions.Death) {
      for (const a of Object.values(t.actions)) a.fadeOut(0.15);
      const a = t.actions.Death;
      a.reset().setEffectiveWeight(1).fadeIn(0.1).play();
    }
    if (t.group) t.group.onDeath(t, g);
    if (t.isPlayer) { g.events.emit("playerDied", { src }); return; }
    this.corpses.push({ a: t, t: g.engine.time, looted: false });
    g.events.emit("kill", { target: t, src, info });
    if (src && (src.isPlayer || (src.brain && src.brain.followerOf))) {
      const xp = (t.def && t.def.xp) || 0;
      if (src.isPlayer && xp) g.progress && g.progress.addXp(xp);
      if (t.team === "persian") g.state.stats.kills++;
    }
    if (t.persistent && t.origin) {
      g.state.killed[t.origin] = (g.state.killed[t.origin] || 0) + 1;
    }
  }

  meleeTargets(att, w) {
    const out = [];
    const f = att.mount ? att.mount.forward(new THREE.Vector3()) : att.forward(new THREE.Vector3());
    const range = w.range + (att.mount ? 0.9 : 0);
    const cosArc = Math.cos((w.arc + (att.mount ? 60 : 0)) * Math.PI / 360);
    for (const t of this.game.actors.near(att.pos.x, att.pos.z, range + 1.2)) {
      if (t === att || t.dead || t === att.mount || !this.hostile(att, t)) continue;
      const dx = t.pos.x - att.pos.x, dz = t.pos.z - att.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > range + (t.radius || 0.4)) continue;
      const dy = Math.abs((t.pos.y + 1) - (att.pos.y + 1));
      if (dy > 2.2 && !att.mount && !t.mount) continue;
      const c = d > 0.01 ? (dx * f.x + dz * f.z) / d : 1;
      if (c < cosArc && !(att.mount && d < 2.6 && Math.abs(c) < 0.6)) continue;
      out.push([t, d]);
    }
    out.sort((a, b) => a[1] - b[1]);
    return out;
  }

  melee(att, w, kind = "slash") {
    const g = this.game;
    if (att.dead) return;
    const targets = this.meleeTargets(att, w);
    const n = kind === "slash" ? 2 : 1;
    let hitAny = false;
    for (const [t] of targets.slice(0, n)) {
      let dmg = w.dmg * (kind === "thrust" ? 1.1 : 1) * (0.9 + Math.random() * 0.2);
      if (att.isPlayer && g.state.skills.combo && att.comboN) dmg *= 1 + Math.min(0.3, att.comboN * 0.1);
      const tf = t.forward(new THREE.Vector3());
      const dir = tB.copy(t.pos).sub(att.pos).setY(0).normalize();
      const facing = -(tf.x * dir.x + tf.z * dir.z);
      const unaware = t.brain && t.brain.state !== "combat";
      if (facing < -0.3) dmg *= unaware ? 2.5 : 1.5;
      if (att.isPlayer && unaware) dmg *= 1 + g.peopleBonus("ambush_damage");
      if (t.mount && w.vsCavalry) dmg *= w.vsCavalry;
      if (t.mount && att.isPlayer && g.peopleBonus("cav_damage_gorge")) dmg *= 1 + g.peopleBonus("cav_damage_gorge");
      if (att.mount && att.mount.speed > 6) dmg *= 1.25;
      if (att.npcScale) dmg *= att.npcScale;
      if (t.kind === "animal" && !t.def) dmg *= 1;
      const point = (t.chestPos ? t.chestPos(new THREE.Vector3()) : t.pos.clone().setY(t.pos.y + 1));
      if (t.blocking && facing > 0.3) {
        const k = w.shieldBreak ? 0.45 : 0.12;
        dmg *= k;
        g.effects.sparks(point, 14);
        g.audio && g.audio.clang(point);
        if (t.isPlayer) {
          t.stamina -= 14;
          if (t.stamina <= 0) t.blocking = false;
          if (g.state.skills.riposte) t.attackCd = 0;
        } else if (t.brain) t.brain.blockT = Math.max(t.brain.blockT, 0.2);
        if (att.has && att.has("Hit") && Math.random() < 0.3) att.play("Hit", { fade: 0.05 });
      } else {
        g.audio && g.audio.hit(point);
      }
      this.damage(t, att, dmg, { type: "melee", dir, point });
      hitAny = true;
    }
    if (att.isPlayer) att.comboN = hitAny ? Math.min(3, (att.comboN || 0) + 1) : 0;
    this.noise(att.pos, 25, att, false);
    return hitAny;
  }

  rayHit(origin, dir, maxDist, ignore) {
    const g = this.game;
    let best = null, bt = maxDist;
    for (const t of g.actors.all) {
      if (t === ignore || t.dead || (ignore && t === ignore.mount) || !t.root.visible) continue;
      const d = t.pos.distanceTo(origin);
      if (d > maxDist + 3) continue;
      let a, b, r;
      if (t.kind === "horse" || (t.kind === "animal" && (t.role === "herbivore" || t.unitId === "bear" || t.camel))) {
        const f = t.forward(new THREE.Vector3());
        const hh = t.kind === "horse" ? 1.25 : t.camel ? 1.6 : 0.6;
        a = tA.copy(t.pos).addScaledVector(f, -0.7).setY(t.pos.y + hh);
        b = tB.copy(t.pos).addScaledVector(f, 0.8).setY(t.pos.y + hh);
        r = t.kind === "horse" ? 0.5 : 0.45;
      } else if (t.kind === "animal") {
        a = tA.copy(t.pos).setY(t.pos.y + 0.4);
        b = tB.copy(t.pos).setY(t.pos.y + 0.7);
        r = 0.35;
      } else {
        a = tA.copy(t.pos).setY(t.pos.y + 0.35);
        b = tB.copy(t.pos).setY(t.pos.y + (t.crouch ? 1.1 : 1.6));
        r = 0.33;
      }
      const ta = a.clone(), tb = b.clone();
      const hit = rayCapsule(origin, dir, ta, tb, r);
      if (hit < bt) { bt = hit; best = t; }
    }
    return [best, bt];
  }

  obstacleDist(origin, dir, maxDist) {
    const g = this.game;
    const terrT = g.world.terrain.raycast(origin, dir, maxDist, 1.0);
    let limit = Math.min(maxDist, terrT);
    const cols = g.world.colliders;
    for (let s = 0.8; s < limit; s += 0.5) {
      const x = origin.x + dir.x * s, y = origin.y + dir.y * s, z = origin.z + dir.z * s;
      let hit = false;
      for (const c of cols.query(x, z, 0.1)) {
        if (c.type === "grid") {
          const k = cols.gridCell(c, x, z);
          if (k >= 0 && y < c.baseY + c.g.h[k] && y > c.baseY + c.g.lo[k] - 0.2) { hit = true; break; }
        } else if (c.type === "circle" && y < c.y1 && cols.inside(c, x, z)) { hit = true; break; }
      }
      if (hit) return s;
    }
    return limit;
  }

  fire(att, w, origin, dir, spread = 0.01) {
    const g = this.game;
    const d = dir.clone();
    d.x += (Math.random() + Math.random() - 1) * spread;
    d.y += (Math.random() + Math.random() - 1) * spread;
    d.z += (Math.random() + Math.random() - 1) * spread;
    d.normalize();
    const maxD = w.range * 1.6;
    const [t, tt] = this.rayHit(origin, d, maxD, att);
    const od = this.obstacleDist(origin, d, t ? tt : maxD);
    const muzzle = origin.clone();
    if (att.isPlayer) muzzle.copy(att.chestPos(new THREE.Vector3())).addScaledVector(d, 0.9).setY(att.pos.y + 1.45);
    g.effects.flash(muzzle);
    g.effects.smoke(muzzle, d, 18, w.pistol ? 0.7 : 1.1);
    g.audio && g.audio.gunshot(muzzle, w.pistol);
    this.noise(muzzle, w.noise || 300, att, true);
    if (att.isPlayer) g.state.stats.shots++;
    if (t && tt <= od) {
      const p = origin.clone().addScaledVector(d, tt);
      let dmg = w.dmg;
      if (tt > w.range) dmg *= Math.max(0.25, 1 - (tt - w.range) / w.range);
      if (p.y > t.pos.y + 1.45 && t.kind !== "horse" && t.kind !== "animal") dmg *= 1.6;
      if (att.isPlayer && t.brain && t.brain.state !== "combat") dmg *= 1 + g.peopleBonus("ambush_damage");
      this.damage(t, att, dmg, { type: "bullet", dir: d, point: p });
      return t;
    }
    const p = origin.clone().addScaledVector(d, od);
    if (od < maxD - 1) g.effects.dust(p, 8);
    return null;
  }

  grapeshot(att, origin, dir, pellets = 10, dmg = 30) {
    const g = this.game;
    g.effects.flash(origin);
    g.effects.smoke(origin, dir, 30, 1.6);
    g.audio && g.audio.cannon(origin, 0.6);
    this.noise(origin, 350, att, true);
    for (let i = 0; i < pellets; i++) {
      const d = dir.clone();
      d.x += (Math.random() - 0.5) * 0.12; d.y += (Math.random() - 0.5) * 0.06; d.z += (Math.random() - 0.5) * 0.12;
      d.normalize();
      const [t, tt] = this.rayHit(origin, d, 200, att);
      const od = this.obstacleDist(origin, d, t ? tt : 200);
      if (t && tt <= od) this.damage(t, att, dmg * (tt > 120 ? 0.5 : 1), { type: "bullet", dir: d, point: origin.clone().addScaledVector(d, tt) });
      else if (od < 199) g.effects.dust(origin.clone().addScaledVector(d, od), 5);
    }
  }

  arrow(att, w, origin, dir, power = 1, spread = 0.01) {
    const g = this.game;
    const d = dir.clone();
    d.x += (Math.random() - 0.5) * spread; d.y += (Math.random() - 0.5) * spread; d.z += (Math.random() - 0.5) * spread;
    d.normalize();
    let mesh;
    if (this.arrowProto) {
      mesh = this.arrowProto.clone(true);
    } else {
      mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.8), new THREE.MeshBasicMaterial({ color: 0x553311 }));
    }
    g.engine.scene.add(mesh);
    const speed = (w.speed || 55) * (0.55 + 0.45 * power);
    this.projectiles.push({ kind: "arrow", mesh, pos: origin.clone(), vel: d.multiplyScalar(speed), att, dmg: w.dmg * (0.6 + 0.4 * power), life: 6, stuck: 0 });
    g.audio && g.audio.bow(origin);
    this.noise(origin, 12, att, false);
  }

  cannonball(att, origin, target, flight = 2.2) {
    const g = this.game;
    const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
    g.engine.scene.add(mesh);
    const v = new THREE.Vector3((target.x - origin.x) / flight, 0, (target.z - origin.z) / flight);
    v.y = (target.y - origin.y + 0.5 * 9.8 * flight * flight) / flight;
    this.projectiles.push({ kind: "ball", mesh, pos: origin.clone(), vel: v, att, life: flight + 1 });
    g.effects.flash(origin);
    g.effects.smoke(origin, v.clone().normalize(), 40, 2.2);
    g.audio && g.audio.cannon(origin, 1);
    this.noise(origin, 600, att, true);
  }

  explosion(pos, radius = 6, dmg = 120, src = null) {
    const g = this.game;
    g.effects.explosion(pos, radius / 6);
    g.audio && g.audio.explosion(pos);
    this.noise(pos, 500, src, true);
    const cd = g.rig.cam.position.distanceTo(pos);
    if (cd < 60) g.rig.shake = Math.max(g.rig.shake, (1 - cd / 60) * 1.5);
    for (const t of g.actors.near(pos.x, pos.z, radius + 1)) {
      if (t.dead) continue;
      const d = t.pos.distanceTo(pos);
      if (d > radius) continue;
      const dir = t.pos.clone().sub(pos).setY(0).normalize();
      this.damage(t, src, dmg * (1 - d / radius) + 10, { type: "explosion", dir, point: t.pos.clone().setY(t.pos.y + 1) });
    }
    g.events.emit("explosion", { pos, radius });
  }

  stealthTarget(p) {
    if (p.mount) return null;
    const f = p.forward(new THREE.Vector3());
    for (const t of this.game.actors.near(p.pos.x, p.pos.z, 2.2)) {
      if (t.dead || t.kind !== "npc" || !this.hostile(p, t) || !t.brain) continue;
      if (t.brain.state === "combat" || (t.def && t.def.boss)) continue;
      const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.0 || (dx * f.x + dz * f.z) / d < 0.6) continue;
      const tf = t.forward(new THREE.Vector3());
      if ((dx * tf.x + dz * tf.z) / d < 0.2) continue;
      return t;
    }
    return null;
  }

  stealthKill(p, t) {
    const g = this.game;
    p.play("Attack_Thrust", { fade: 0.06 });
    setTimeout(() => {
      if (t.dead) return;
      const point = t.chestPos(new THREE.Vector3());
      this.damage(t, p, 9999, { type: "stealth", dir: p.forward(new THREE.Vector3()), point });
      g.events.emit("stealthKill", t);
      g.progress && g.progress.addXp(10);
    }, 350);
  }

  update(dt) {
    const g = this.game;
    const now = g.engine.time;
    this.noises = this.noises.filter(n => now - n.t < 1.0);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      if (p.stuck > 0) {
        p.stuck -= dt;
        if (p.stuck <= 0 || p.life <= 0) { g.engine.scene.remove(p.mesh); this.projectiles.splice(i, 1); }
        continue;
      }
      const prev = p.pos.clone();
      p.vel.y -= 9.8 * dt;
      p.pos.addScaledVector(p.vel, dt);
      p.mesh.position.copy(p.pos);
      if (p.kind === "arrow") {
        const look = p.pos.clone().add(p.vel);
        p.mesh.lookAt(look);
        p.mesh.rotateY(-Math.PI / 2);
        const seg = p.pos.clone().sub(prev);
        const len = seg.length();
        const [t, tt] = this.rayHit(prev, seg.normalize(), len, p.att);
        if (t) {
          this.damage(t, p.att, p.dmg, { type: "arrow", dir: seg, point: prev.clone().addScaledVector(seg, tt) });
          g.engine.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
          continue;
        }
        const gh = g.world.ground(p.pos.x, p.pos.z, p.pos.y + 0.5);
        if (p.pos.y <= gh) {
          p.pos.y = gh + 0.05;
          p.mesh.position.copy(p.pos);
          p.stuck = 12;
          g.effects.dust(p.pos, 3);
          continue;
        }
      } else if (p.kind === "ball") {
        const gh = g.world.ground(p.pos.x, p.pos.z, p.pos.y + 1);
        if (p.pos.y <= gh || p.life <= 0) {
          this.explosion(p.pos.clone().setY(Math.max(gh, p.pos.y)), 5.5, 90, p.att);
          g.engine.scene.remove(p.mesh);
          this.projectiles.splice(i, 1);
          continue;
        }
      }
      if (p.life <= 0) { g.engine.scene.remove(p.mesh); this.projectiles.splice(i, 1); }
    }
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i];
      if (now - c.t > 150 && c.a.pos.distanceTo(g.player.pos) > 30) {
        g.actors.remove(c.a);
        this.corpses.splice(i, 1);
      }
    }
  }

  lootCorpse(c) {
    const g = this.game;
    if (c.looted) return null;
    c.looted = true;
    const def = c.a.def || {};
    const got = {};
    const mul = 1 + g.peopleBonus("raid_loot");
    for (const [k, [lo, hi]] of Object.entries(def.loot || {})) {
      const v = Math.round((lo + Math.random() * (hi - lo)) * mul);
      if (v > 0) { g.state.res[k] = (g.state.res[k] || 0) + v; got[k] = v; }
    }
    if (c.a.primary === "jazayer" && !g.state.weapons.includes("jazayer") && Math.random() < 0.25) {
      g.state.weapons.push("jazayer");
      got.weapon = "jazayer";
    }
    return got;
  }
}
