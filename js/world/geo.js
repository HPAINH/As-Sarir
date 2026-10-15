export const WORLD = 4096;
export const HALF = WORLD / 2;
export const CHUNK = 256;
export const CHUNKS = WORLD / CHUNK;
export const SEA_LEVEL = 2;

export const REGIONS = [
  { id: "derbent", name: "Дербент и Приморье", c: [1450, 1250], control: "persian", color: "#c9b48a" },
  { id: "tabasaran", name: "Табасаран", c: [950, 850], control: "neutral", color: "#7f9a5a" },
  { id: "samur", name: "Южный Дагестан (Самур)", c: [-300, 1450], control: "highlanders", color: "#8fa07a" },
  { id: "lakia", name: "Лакия", c: [250, 380], control: "highlanders", color: "#a39279" },
  { id: "andalal", name: "Андалал", c: [-480, 120], control: "highlanders", color: "#9aa77e" },
  { id: "avaria", name: "Аварское ханство", c: [-1350, -600], control: "highlanders", color: "#8c9a78" },
  { id: "dargin", name: "Даргинские земли", c: [800, -150], control: "highlanders", color: "#97a383" },
  { id: "kumyk", name: "Кумыкская равнина", c: [300, -1500], control: "persian", color: "#b9b27a" },
];

export const PEOPLES = ["avar", "dargin", "lak", "lezgin", "tabasaran", "agul", "rutul", "tsakhur", "kumyk"];

export const SETTLEMENTS = [
  { id: "sogratl", name: "Согратль", region: "andalal", p: [-520, 140], size: 3, people: "avar" },
  { id: "chokh", name: "Чох", region: "andalal", p: [-310, 340], size: 2, people: "avar" },
  { id: "obokh", name: "Обох", region: "andalal", p: [-720, 330], size: 1, people: "avar" },
  { id: "megeb", name: "Мегеб", region: "andalal", p: [-780, -60], size: 2, people: "avar" },
  { id: "khunzakh", name: "Хунзах", region: "avaria", p: [-1380, -700], size: 3, people: "avar" },
  { id: "uri", name: "Ури", region: "lakia", p: [-60, 250], size: 1, people: "lak" },
  { id: "kumukh", name: "Кумух", region: "lakia", p: [230, 380], size: 3, people: "lak", fort: true },
  { id: "akusha", name: "Акуша", region: "dargin", p: [640, -290], size: 3, people: "dargin" },
  { id: "kubachi", name: "Кубачи", region: "dargin", p: [1020, 210], size: 2, people: "dargin" },
  { id: "kala_koreish", name: "Кала-Корейш", region: "dargin", p: [1180, -60], size: 1, people: "dargin" },
  { id: "dzhengutay", name: "Дженгутай", region: "kumyk", p: [330, -760], size: 2, people: "kumyk" },
  { id: "endirey", name: "Эндирей", region: "kumyk", p: [100, -1640], size: 3, people: "kumyk" },
  { id: "tarki", name: "Тарки", region: "kumyk", p: [1180, -1330], size: 3, people: "kumyk" },
  { id: "khuchni", name: "Хучни", region: "tabasaran", p: [960, 900], size: 2, people: "tabasaran" },
  { id: "akhty", name: "Ахты", region: "samur", p: [160, 1500], size: 3, people: "lezgin" },
  { id: "rutul", name: "Рутул", region: "samur", p: [-540, 1330], size: 2, people: "rutul" },
  { id: "tsakhur", name: "Цахур", region: "samur", p: [-1320, 1620], size: 2, people: "tsakhur" },
  { id: "tpig", name: "Тпиг", region: "samur", p: [560, 1180], size: 2, people: "agul" },
];

export const HOMES = {
  avar: "sogratl", dargin: "akusha", lak: "kumukh", lezgin: "akhty", tabasaran: "khuchni",
  agul: "tpig", rutul: "rutul", tsakhur: "tsakhur", kumyk: "endirey",
};

export const DERBENT = {
  citadel: [1310, 1300], wallN: 1215, wallS: 1385, x0: 1330, gateX: [1400, 1480], camp: [1240, 1060],
};

export const TURCHIDAG = { c: [-470, -230], r: 190, h: 275 };
export const KHUNZAKH_PLATEAU = { c: [-1380, -700], r: 280, h: 215 };

export const AIMAKI = [[330, -700], [180, -560], [40, -440], [-120, -320]];

export const RIVERS = [
  { id: "samur", name: "Самур", w: 14, pts: [[-2040, 1760], [-1500, 1690], [-900, 1560], [-300, 1640], [200, 1700], [700, 1640], [1150, 1700], [1600, 1760], [2040, 1800]] },
  { id: "kara", name: "Кара-Койсу", w: 9, pts: [[-120, 980], [-260, 640], [-420, 470], [-610, 160], [-640, -120], [-700, -520], [-760, -900], [-720, -1020]] },
  { id: "avar", name: "Аварское Койсу", w: 11, pts: [[-2040, 640], [-1640, 260], [-1180, -260], [-980, -760], [-720, -1020]] },
  { id: "kazikumukh", name: "Казикумухское Койсу", w: 10, pts: [[160, 980], [260, 640], [120, 160], [-20, -260], [-260, -640], [-720, -1020]] },
  { id: "sulak", name: "Сулак", w: 16, pts: [[-720, -1020], [-420, -1180], [80, -1220], [520, -1480], [1000, -1700], [1600, -1880], [2040, -1960]] },
];

export const ROADS = [
  ["derbent_gate", "khuchni"], ["khuchni", "tpig"], ["tpig", "akhty"], ["akhty", "rutul"], ["rutul", "tsakhur"],
  ["khuchni", "kubachi"], ["kubachi", "akusha"], ["kubachi", "kala_koreish"], ["akusha", "dzhengutay"],
  ["dzhengutay", "endirey"], ["dzhengutay", "tarki"], ["tarki", "derbent_coast"], ["akusha", "kumukh"],
  ["kumukh", "uri"], ["uri", "sogratl"], ["sogratl", "chokh"], ["sogratl", "obokh"], ["sogratl", "megeb"],
  ["megeb", "khunzakh"], ["kumukh", "tpig"], ["chokh", "rutul"], ["dzhengutay", "aimaki_n"], ["aimaki_s", "megeb"],
];

export const ROAD_NODES = {
  derbent_gate: [1440, 1210], derbent_coast: [1500, 1180], aimaki_n: [330, -700], aimaki_s: [-120, -320],
};

export const POI = [
  { id: "tower_andalal", type: "tower", name: "Башня над Мегебом", p: [-640, -10], region: "andalal" },
  { id: "tower_avaria", type: "tower", name: "Хунзахская башня", p: [-1160, -520], region: "avaria" },
  { id: "tower_lakia", type: "tower", name: "Башня Кумуха", p: [380, 520], region: "lakia" },
  { id: "tower_dargin", type: "tower", name: "Акушинская башня", p: [820, -420], region: "dargin" },
  { id: "tower_kumyk", type: "tower", name: "Сторожевая башня у Сулака", p: [-120, -1300], region: "kumyk" },
  { id: "tower_tabasaran", type: "tower", name: "Табасаранская башня", p: [1150, 720], region: "tabasaran" },
  { id: "tower_samur", type: "tower", name: "Башня над Самуром", p: [-200, 1330], region: "samur" },
  { id: "tower_derbent", type: "tower", name: "Дозорная башня у Дербента", p: [1180, 1180], region: "derbent" },
  { id: "shrine_hadji", type: "shrine", name: "Святилище-зиярат", p: [-980, 760], region: "samur" },
  { id: "cave_relic1", type: "cave", name: "Пещера Подлокотника льва", p: [-60, 1180], region: "samur" },
  { id: "tower_kubachi", type: "tower", name: "Башня орнаментов", p: [1080, 300], region: "dargin" },
  { id: "megeb_cliff", type: "cliff", name: "Скалы над Мегебом", p: [-700, -160], region: "andalal" },
  { id: "pass_samur", type: "pass", name: "Перевал", p: [300, 1300], region: "samur" },
  { id: "river_ford", type: "ford", name: "Брод на Самуре", p: [-300, 1640], region: "samur" },
  { id: "shah_camp_derbent", type: "camp", name: "Ставка шаха у Дербента", p: [1240, 1060], region: "derbent" },
  { id: "shah_camp_turchidag", type: "camp", name: "Лагерь на Турчидаге", p: [-470, -230], region: "andalal" },
  { id: "kumukh_tunnel", type: "tunnel", name: "Подземный ход", p: [300, 450], region: "lakia" },
];

export const OUTPOSTS = [
  { id: "op_tabasaran_road", p: [1220, 1000], region: "tabasaran" },
  { id: "op_khuchni_forest", p: [820, 1000], region: "tabasaran" },
  { id: "op_tarki_road", p: [950, -1250], region: "kumyk" },
  { id: "op_endirey_ford", p: [-150, -1500], region: "kumyk" },
  { id: "op_sulak_bridge", p: [500, -1450], region: "kumyk" },
  { id: "op_kubachi_pass", p: [1250, 450], region: "dargin" },
  { id: "op_samur_mouth", p: [1100, 1580], region: "samur" },
  { id: "op_lakia_road", p: [480, 120], region: "lakia" },
  { id: "op_dzhengutay", p: [420, -900], region: "kumyk" },
  { id: "op_derbent_north", p: [1350, 900], region: "derbent" },
];

export function settlement(id) {
  return SETTLEMENTS.find(s => s.id === id);
}

export function nodePos(id) {
  if (ROAD_NODES[id]) return ROAD_NODES[id];
  const s = settlement(id);
  return s ? s.p : null;
}

export function regionAt(x, z) {
  let best = REGIONS[0], bd = Infinity;
  for (const r of REGIONS) {
    const d = (x - r.c[0]) ** 2 + (z - r.c[1]) ** 2;
    if (d < bd) { bd = d; best = r; }
  }
  return best;
}

export function coastX(z) {
  return 1530 + 90 * Math.sin(z * 0.0023 + 0.6) + 38 * Math.sin(z * 0.0071);
}
