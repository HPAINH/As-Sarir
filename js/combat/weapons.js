export const GRIP = { blade: [-0.70711, 0, 0.70711, 0], along: [-0.70711, -0.70711, 0, 0] };

export const WEAPONS = {
  kinjal: { id: "kinjal", name: "Кинжал", kind: "melee", model: "weapons/kinjal", grip: "blade", dmg: 25, cd: 0.45, range: 1.7, arc: 75, stealth: true, price: 30 },
  kinjal_kubachi: { id: "kinjal_kubachi", name: "Кубачинский кинжал", kind: "melee", model: "weapons/kinjal", grip: "blade", dmg: 32, cd: 0.42, range: 1.7, arc: 75, stealth: true, price: 120 },
  saber: { id: "saber", name: "Сабля", kind: "melee", model: "weapons/saber", grip: "blade", dmg: 40, cd: 0.7, range: 2.3, arc: 110, mounted: true, price: 60 },
  shashka: { id: "shashka", name: "Шашка", kind: "melee", model: "weapons/shashka", grip: "blade", dmg: 42, cd: 0.68, range: 2.3, arc: 105, mounted: true, price: 80 },
  axe: { id: "axe", name: "Боевой топор", kind: "melee", model: "weapons/war_axe", grip: "blade", dmg: 50, cd: 0.95, range: 2.1, arc: 90, shieldBreak: true, price: 55 },
  spear: { id: "spear", name: "Копьё", kind: "melee", model: "weapons/spear", grip: "along", dmg: 45, cd: 0.85, range: 3.1, arc: 35, vsCavalry: 1.5, thrust: true, price: 40 },
  mace: { id: "mace", name: "Булава-гурз", kind: "melee", model: "weapons/persian_mace_gurz", grip: "blade", dmg: 48, cd: 0.9, range: 2.0, arc: 90, shieldBreak: true, price: 70 },
  rifle: { id: "rifle", name: "Кремнёвое ружьё", kind: "gun", model: "weapons/flintlock_rifle", grip: "along", dmg: 90, reload: 7, range: 150, spread: 0.008, ammo: 1, noise: 300, price: 150 },
  rifle_sogratl: { id: "rifle_sogratl", name: "Ружьё мастера из Согратля", kind: "gun", model: "weapons/flintlock_rifle", grip: "along", dmg: 100, reload: 6.3, range: 170, spread: 0.006, ammo: 1, noise: 300, price: 400 },
  jazayer: { id: "jazayer", name: "Джазаир", kind: "gun", model: "weapons/jazayer_musket", grip: "along", dmg: 110, reload: 9, range: 170, spread: 0.007, ammo: 1, noise: 320, price: 200 },
  pistol: { id: "pistol", name: "Кремнёвый пистолет", kind: "gun", model: "weapons/flintlock_pistol", grip: "along", dmg: 60, reload: 5, range: 25, spread: 0.03, ammo: 1, noise: 250, pistol: true, price: 90 },
  bow: { id: "bow", name: "Составной лук", kind: "bow", model: "weapons/composite_bow", grip: "along", dmg: 35, cd: 1.2, range: 90, speed: 58, noise: 0, price: 60 },
};

export const ARMORS = {
  none: { id: "none", name: "Без брони", def: 0, speed: 1, climb: 1 },
  kaftan: { id: "kaftan", name: "Стёганый кафтан", def: 0.12, speed: 1, climb: 1, price: 50 },
  mail: { id: "mail", name: "Кольчуга", def: 0.25, speed: 0.95, climb: 0.85, price: 180 },
  mail_full: { id: "mail_full", name: "Кольчуга, мисюрка и наручи", def: 0.38, speed: 0.9, climb: 0.7, price: 320 },
};

export const SLOT_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"];
