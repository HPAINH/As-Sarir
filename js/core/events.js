export class Events {
  constructor() {
    this.map = new Map();
  }

  on(name, fn) {
    if (!this.map.has(name)) this.map.set(name, new Set());
    this.map.get(name).add(fn);
    return () => this.map.get(name).delete(fn);
  }

  emit(name, data) {
    const s = this.map.get(name);
    if (s) for (const fn of [...s]) fn(data);
  }
}
