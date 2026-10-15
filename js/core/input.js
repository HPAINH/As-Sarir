export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouse = { dx: 0, dy: 0, buttons: new Set(), down: new Set(), up: new Set(), wheel: 0, x: 0, y: 0 };
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1;
    this.listeners = [];
    window.addEventListener("keydown", e => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (["Space", "Tab", "KeyM", "KeyJ", "KeyI", "F1"].includes(e.code)) e.preventDefault();
      for (const l of this.listeners) l(e.code, e);
    });
    window.addEventListener("keyup", e => {
      this.keys.delete(e.code);
      this.released.add(e.code);
    });
    window.addEventListener("blur", () => this.keys.clear());
    canvas.addEventListener("mousedown", e => {
      this.mouse.buttons.add(e.button);
      this.mouse.down.add(e.button);
    });
    window.addEventListener("mouseup", e => {
      this.mouse.buttons.delete(e.button);
      this.mouse.up.add(e.button);
    });
    canvas.addEventListener("contextmenu", e => e.preventDefault());
    window.addEventListener("mousemove", e => {
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      if (this.locked) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      } else if (this.dragLook && this.mouse.buttons.size) {
        this.mouse.dx += e.movementX || 0;
        this.mouse.dy += e.movementY || 0;
      }
    });
    window.addEventListener("wheel", e => { this.mouse.wheel += Math.sign(e.deltaY); }, { passive: true });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
    });
  }

  onKey(fn) {
    this.listeners.push(fn);
  }

  lock() {
    if (this.locked) return;
    try {
      const r = this.canvas.requestPointerLock && this.canvas.requestPointerLock();
      if (r && r.catch) r.catch(() => { this.dragLook = true; });
    } catch (e) {
      this.dragLook = true;
    }
  }

  unlock() {
    this.selfUnlockAt = performance.now();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.enabled && this.keys.has(code);
  }

  hit(code) {
    return this.enabled && this.pressed.has(code);
  }

  button(b) {
    return this.enabled && this.mouse.buttons.has(b);
  }

  click(b) {
    return this.enabled && this.mouse.down.has(b);
  }

  release(b) {
    return this.enabled && this.mouse.up.has(b);
  }

  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.mouse.down.clear();
    this.mouse.up.clear();
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.mouse.wheel = 0;
  }
}
