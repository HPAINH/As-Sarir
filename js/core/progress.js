import { levelXp } from "./state.js";

export const SKILLS = {
  warrior: {
    name: "Воин",
    list: [
      { id: "combo", name: "Серия ударов", text: "Каждый попавший удар подряд добавляет 10% урона, до +30%", cost: 1 },
      { id: "riposte", name: "Контрудар после блока", text: "Удачный блок сразу снимает задержку перед ударом", cost: 1, req: "combo" },
      { id: "dual", name: "Бой с двух рук", text: "Кинжал в левой руке: +15% урона саблей", cost: 2, req: "riposte" },
    ],
  },
  marksman: {
    name: "Стрелок",
    list: [
      { id: "fastReload", name: "Быстрая перезарядка", text: "Перезарядка ружья и пистолета на 30% быстрее", cost: 1 },
      { id: "steady", name: "Стрельба с упора", text: "В приседе с прицелом разброс вдвое меньше", cost: 1, req: "fastReload" },
      { id: "breath", name: "Задержка дыхания", text: "Прицел дольше остаётся устойчивым, урон в голову +25%", cost: 2, req: "steady" },
    ],
  },
  mountaineer: {
    name: "Горец",
    list: [
      { id: "climb", name: "Карабканье", text: "Достаёте до уступов на 25% выше", cost: 1 },
      { id: "silent", name: "Бесшумный шаг", text: "Враги замечают вас на 30% позже", cost: 1, req: "climb" },
      { id: "traps", name: "Обвалы и засады", text: "Обвалы наносят двойной урон, тайники видны на карте", cost: 2, req: "silent" },
    ],
  },
  leader: {
    name: "Вожак",
    list: [
      { id: "squad4", name: "Размер отряда +4", text: "Можно вести на 4 бойца больше", cost: 1 },
      { id: "warcry", name: "Боевой клич", text: "Клавиша G: отряд получает +20% урона на 15 секунд", cost: 1, req: "squad4" },
      { id: "volley", name: "Залп по команде", text: "Залп отряда наносит +30% урона", cost: 2, req: "warcry" },
    ],
  },
};

export class Progress {
  constructor(game) {
    this.game = game;
  }

  addXp(n) {
    const st = this.game.state;
    if (!n) return;
    st.xp += n;
    while (st.level < 30 && st.xp >= levelXp(st.level)) {
      st.xp -= levelXp(st.level);
      st.level++;
      st.skillPoints++;
      const p = this.game.player;
      p.maxHp += 6;
      p.hp = p.maxHp;
      p.maxStamina += 3;
      this.game.ui.toast(`Новый уровень: ${st.level}. Очко навыка в инвентаре (I)`, "good");
      this.game.audio && this.game.audio.levelUp();
    }
  }

  canLearn(skill) {
    const st = this.game.state;
    if (st.skills[skill.id]) return false;
    if (skill.req && !st.skills[skill.req]) return false;
    return st.skillPoints >= skill.cost;
  }

  learn(skill) {
    if (!this.canLearn(skill)) return false;
    const st = this.game.state;
    st.skillPoints -= skill.cost;
    st.skills[skill.id] = true;
    return true;
  }

  squadMax() {
    const st = this.game.state;
    let n = 4;
    if (st.act >= 2) n = 8;
    if (st.act >= 3) n = 16;
    if (st.skills.squad4) n += 4;
    return Math.min(20, n);
  }
}
