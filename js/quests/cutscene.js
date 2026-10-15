import * as THREE from "three";
import { el } from "../ui/hud.js";
import { resolveLoc, fmt } from "./locs.js";

export class Cutscene {
  constructor(game) {
    this.game = game;
    this.root = el("div", "cutscene screen");
    this.root.hidden = true;
    this.root.innerHTML = `<div class="cs-bar top"></div><div class="cs-bar bot"></div><div class="cs-black"></div><div class="cs-title"></div><div class="cs-text"></div><div class="cs-skip"><kbd>Пробел</kbd> далее · <kbd>Esc</kbd> пропустить</div>`;
    game.ui.root.appendChild(this.root);
    this.active = false;
    this.temp = [];
    window.addEventListener("keydown", e => {
      if (!this.active) return;
      if (e.code === "Space" || e.code === "Enter") { e.preventDefault(); this.next = true; }
      if (e.code === "Escape") { e.preventDefault(); this.skip = true; this.next = true; }
    });
  }

  async play(def) {
    const g = this.game;
    if (typeof def === "string") def = g.data.cutscenes[def];
    if (!def) return;
    if (g.autoplay) return;
    this.active = true;
    this.skip = false;
    this.root.hidden = false;
    g.uiBlocking = true;
    g.input.unlock();
    const rig = g.rig;
    const black = this.root.querySelector(".cs-black");
    const title = this.root.querySelector(".cs-title");
    const text = this.root.querySelector(".cs-text");
    g.audio && g.audio.music && g.audio.setMood && g.audio.setMood(def.mood || "story");
    for (const shot of def.shots) {
      if (this.skip) break;
      this.next = false;
      title.innerHTML = shot.title ? fmt(g, shot.title) : "";
      const who = shot.who ? `<b>${g.dialog.speaker(shot.who)}:</b> ` : "";
      text.innerHTML = shot.text ? who + fmt(g, shot.text) : "";
      if (shot.screen) {
        black.classList.add("on");
        rig.cinematic = null;
      } else {
        black.classList.remove("on");
        const at = resolveLoc(g, shot.at || "player") || { x: g.player.pos.x, z: g.player.pos.z };
        if (shot.spawn) for (const sp of shot.spawn) await this.spawnTemp(sp, at);
        const ground = g.world.ground(at.x, at.z);
        const c0 = new THREE.Vector3(at.x + shot.cam[0], ground + shot.cam[1], at.z + shot.cam[2]);
        const c1 = shot.cam2 ? new THREE.Vector3(at.x + shot.cam2[0], ground + shot.cam2[1], at.z + shot.cam2[2]) : c0.clone();
        const look = new THREE.Vector3(at.x + (shot.look || [0, 0, 0])[0], ground + (shot.look || [0, 1.5, 0])[1], at.z + (shot.look || [0, 0, 0])[2]);
        let t = 0;
        const dur = shot.t || 5;
        rig.cinematic = {
          update: (dt, cam) => {
            t += dt;
            const f = Math.min(1, t / dur);
            cam.position.lerpVectors(c0, c1, f * f * (3 - 2 * f));
            const gh = g.world.terrain.height(cam.position.x, cam.position.z) + 1;
            if (cam.position.y < gh) cam.position.y = gh;
            cam.lookAt(look);
          },
        };
        g.world.terrain.update(at.x, at.z, true);
      }
      const dur = (shot.t || 5) * 1000;
      const t0 = performance.now();
      while (!this.next && performance.now() - t0 < dur * (shot.text ? 2.2 : 1)) await new Promise(r => setTimeout(r, 50));
    }
    for (const a of this.temp) g.actors.remove(a);
    this.temp = [];
    rig.cinematic = null;
    g.audio.setMood && g.audio.setMood("auto");
    this.root.hidden = true;
    black.classList.remove("on");
    this.active = false;
    if (!g.ui.open && !g.dialog.active) {
      g.uiBlocking = false;
      g.input.lock();
    }
  }

  async spawnTemp(sp, at) {
    const g = this.game;
    const x = at.x + (sp.off ? sp.off[0] : 0), z = at.z + (sp.off ? sp.off[1] : 0);
    const n = await g.actors.spawnUnit(sp.unit, x, z, { state: "script", yaw: sp.yaw ? sp.yaw * Math.PI / 180 : 0 });
    if (!n) return;
    n.brain.script = { anim: sp.anim || "Idle", fight: false };
    n.team = "neutral";
    if (sp.anim) n.idleClip = sp.anim;
    this.temp.push(n);
  }
}
