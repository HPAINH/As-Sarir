import { HUD, el } from "./hud.js";

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById("ui");
    this.hud = new HUD(this);
    this.markerSources = [];
    this.screens = {};
    this.open = null;
  }

  toast(t, kind) {
    this.hud.toast(t, kind);
  }

  subtitle(t, s) {
    this.hud.subtitle(t, s);
  }

  addMarkers(fn) {
    this.markerSources.push(fn);
  }

  markers() {
    const out = [];
    for (const f of this.markerSources) {
      const r = f();
      if (Array.isArray(r)) out.push(...r);
      else if (r) out.push(r);
    }
    return out;
  }

  register(name, screen) {
    this.screens[name] = screen;
  }

  show(name, arg) {
    if (this.open && this.open !== name) this.hide();
    const s = this.screens[name];
    if (!s) return;
    this.open = name;
    s.show(arg);
    this.game.uiBlocking = true;
    this.game.input.unlock();
    if (s.pauses !== false) this.game.engine.paused = true;
  }

  hide() {
    if (!this.open) return;
    const s = this.screens[this.open];
    this.open = null;
    if (s) s.hide();
    this.game.uiBlocking = false;
    this.game.engine.paused = false;
    this.game.input.lock();
  }

  toggle(name, arg) {
    if (this.open === name) this.hide();
    else this.show(name, arg);
  }

  update(dt) {
    this.hud.update(dt);
    for (const s of Object.values(this.screens)) if (s.update && this.open === s.name) s.update(dt);
  }
}

export { el };
