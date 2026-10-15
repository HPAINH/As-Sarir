export class Chronicle {
  constructor(game) {
    this.game = game;
  }

  get entries() {
    return this.game.data.chronicle || {};
  }

  has(id) {
    return this.game.state.chronicle.includes(id);
  }

  unlock(id) {
    const g = this.game, st = g.state;
    const e = this.entries[id];
    if (!e || st.chronicle.includes(id)) return false;
    st.chronicle.push(id);
    g.ui.toast(`Летопись пополнилась: «${e.title}»`, "lore");
    g.progress.addXp(15);
    return true;
  }

  list() {
    const st = this.game.state;
    return st.chronicle.filter(id => this.entries[id]).map(id => ({ id, ...this.entries[id] }));
  }
}
