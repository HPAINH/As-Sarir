import * as THREE from "three";
import { WEAPONS, GRIP } from "../combat/weapons.js";

let NEXT_ID = 1;

export const LOOP_CLIPS = new Set(["Idle", "Walk", "Run", "Ride", "Talk", "Crouch", "Cheer", "Graze"]);

export class Actor {
  constructor(game, opts = {}) {
    this.game = game;
    this.id = NEXT_ID++;
    this.name = opts.name || "";
    this.team = opts.team || "neutral";
    this.kind = "actor";
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.hp = opts.hp || 100;
    this.maxHp = this.hp;
    this.radius = 0.4;
    this.height = 1.8;
    this.dead = false;
    this.grounded = true;
    this.tags = new Set(opts.tags || []);
    this.root = new THREE.Group();
    this.root.name = "actor" + this.id;
    this.model = null;
    this.mixer = null;
    this.actions = {};
    this.current = null;
    this.oneShot = null;
    this.animAccum = 0;
    this.visible = true;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  distTo(o) {
    const p = o.pos || o;
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  setModel(scene, animations) {
    this.model = scene;
    this.root.add(scene);
    if (animations && animations.length) {
      this.mixer = new THREE.AnimationMixer(scene);
      for (const clip of animations) {
        const a = this.mixer.clipAction(clip);
        if (!LOOP_CLIPS.has(clip.name)) {
          a.setLoop(THREE.LoopOnce, 1);
          a.clampWhenFinished = true;
        }
        this.actions[clip.name] = a;
      }
      this.mixer.addEventListener("finished", e => {
        if (this.oneShot && e.action === this.oneShot.action) {
          const cb = this.oneShot.done;
          const prev = e.action;
          this.oneShot = null;
          if (!this.dead) {
            const name = this.current ? this.current.name : "Idle";
            this.current = null;
            this.loop(name, 0.18, 1, prev);
          }
          if (cb) cb();
        }
      });
    }
  }

  has(name) {
    return !!this.actions[name];
  }

  loop(name, fade = 0.22, speed = 1, from = null) {
    const a = this.actions[name];
    if (!a) return;
    if (from) {
      a.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play();
      a.crossFadeFrom(from, fade, false);
      this.current = { name, action: a };
      return;
    }
    if (this.current && this.current.name === name) {
      a.setEffectiveTimeScale(speed);
      return;
    }
    if (this.oneShot && !this.oneShot.interruptible) {
      this.current = { name, action: a };
      return;
    }
    a.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play();
    if (this.current && this.current.action !== a) a.crossFadeFrom(this.current.action, fade, false);
    if (this.oneShot) { a.crossFadeFrom(this.oneShot.action, fade, false); this.oneShot = null; }
    this.current = { name, action: a };
  }

  play(name, { fade = 0.12, speed = 1, done = null, interruptible = false } = {}) {
    const a = this.actions[name];
    if (!a) { if (done) done(); return false; }
    a.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play();
    const from = this.oneShot ? this.oneShot.action : this.current && this.current.action;
    if (from && from !== a) a.crossFadeFrom(from, fade, false);
    this.oneShot = { name, action: a, done, interruptible };
    return true;
  }

  clipDuration(name) {
    const a = this.actions[name];
    return a ? a.getClip().duration : 0;
  }

  updateAnim(dt, camDist) {
    if (!this.mixer) return;
    let step = 1;
    if (camDist > 90) step = 4;
    else if (camDist > 45) step = 2;
    this.animAccum += dt;
    this._f = (this._f || 0) + 1;
    if (this._f % step === 0) {
      this.mixer.update(this.animAccum);
      this.animAccum = 0;
    }
  }

  syncRoot() {
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
  }
}

export class Humanoid extends Actor {
  constructor(game, opts = {}) {
    super(game, opts);
    this.kind = "human";
    this.modelPath = opts.model || "characters/villager_man";
    this.weapons = {};
    this.held = null;
    this.heldId = null;
    this.armor = opts.armor || "none";
    this.loaded = {};
    this.reloading = 0;
    this.blocking = false;
    this.attackCd = 0;
    this.crouch = false;
    this.mount = null;
  }

  async init() {
    const { scene, animations } = await this.game.assets.instance(this.modelPath);
    this.setModel(scene, animations);
    scene.traverse(o => {
      if (o.isMesh || o.isSkinnedMesh) { o.castShadow = true; o.receiveShadow = false; o.frustumCulled = false; }
    });
    this.hand = scene.getObjectByName("RightHand");
    this.headBone = scene.getObjectByName("Head");
    this.loop("Idle", 0);
    return this;
  }

  async equip(id) {
    if (this.heldId === id) return;
    this.heldId = id;
    if (this.held && this.held.parent) this.held.parent.remove(this.held);
    this.held = null;
    if (!id) return;
    const w = WEAPONS[id];
    if (!w || !this.hand) return;
    const { scene } = await this.game.assets.instance(w.model);
    if (this.heldId !== id) return;
    scene.quaternion.fromArray(GRIP[w.grip]);
    scene.position.set(0, 0.055, 0);
    scene.traverse(o => { if (o.isMesh) o.castShadow = true; });
    this.held = scene;
    this.hand.add(scene);
  }

  get weapon() {
    return WEAPONS[this.heldId] || null;
  }

  headPos(out = new THREE.Vector3()) {
    if (this.headBone) return this.headBone.getWorldPosition(out);
    return out.copy(this.pos).setY(this.pos.y + 1.65);
  }

  chestPos(out = new THREE.Vector3()) {
    return out.copy(this.pos).setY(this.pos.y + (this.crouch ? 0.9 : 1.3));
  }
}
