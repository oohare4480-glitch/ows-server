// このファイルは自動生成です。直接編集せず、クライアント(ows_app.html)側を直してから
// build_server_game.js で作り直してください。ネット対戦とAI対戦のルールを完全に一致させるためです。
// 生成元: ows_app.html  生成日時: 2026-09-23T00:12:26.038Z

const MAP_W = 480, MAP_H = 480;
const ZONE_R_BASE = 4;
const MOVE_COOLDOWN = 5e3;
const MARCH_INTERVAL = 15e3;
const MARCH_TICK_UNIT = MARCH_INTERVAL / 16; // \u6700\u5C0F\u5237\u65B0\u5358\u4F4D(0.9375\u79D2)\u3002\u901A\u5E38\u306F16\u30E6\u30CB\u30C3\u30C8\u306716\u500D\u901F\u306F1\u30E6\u30CB\u30C3\u30C8\u3054\u3068\u306B\u9032\u8ECD\u3002
function marchCountdown(army, t, anchor) {
  const interval = MARCH_INTERVAL / (army && army.speedMult ? army.speedMult : 1);
  return Math.max(0, interval - (t - anchor) % interval) / 1e3;
}
const AI_PER_FRAME = 4;
const SPAWN_CHECK_INTERVAL = 8e3;
const LOOT_RESPAWN_MS = 15e3;    // 残骸を補充する間隔
const LOOT_RESPAWN_BATCH = 90;   // 1回に湧く上限(=最大 約360枚/分。まばらに増える)
const SPAWN_CLEAR_MARGIN = 7;
const CAP = 200;
const NAME_MAX_LEN = 10;
const F = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const RV = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const rotV = (dx, dy, f) => {
  for (let i = 0; i < f; i++) {
    const t = dx;
    dx = -dy;
    dy = t;
  }
  return [dx, dy];
};
const K = (x, y) => x + "," + y;
// シミュレーション用の仮想時計。倍率を変えても、それまでに進んだ仮想時間は
// そのまま引き継ぐ(rebase する)ので、時間が飛んだり巻き戻ったりしない。
// now() を使っている処理(進軍間隔・一手クールダウン・残骸の補充など)は
// すべて自動的に同じ倍率で動く。
let owsTimeScale = 1;
let owsVirtBase = Date.now();
let owsRealBase = Date.now();
const now = () => owsVirtBase + (Date.now() - owsRealBase) * owsTimeScale;
function owsSetTimeScale(s) {
  owsVirtBase = now();
  owsRealBase = Date.now();
  owsTimeScale = s;
}
function zoneRadiusFor(army) {
  return ZONE_R_BASE + Math.floor(army.growth != null ? army.growth : (army.kills || 0));
}
// \u81EA\u5206\u3088\u308A\u683C\u4E0A\u3092\u5012\u3059\u3068\u591A\u3081\u306B\u3001\u683C\u4E0B\u3092\u72E9\u3046\u3068\u4E0B\u9650(0.15)\u307E\u3067\u8584\u304F\u306A\u308B\u4F38\u3073\u4FC2\u6570\u3002
// \u3053\u308C\u306B\u3088\u308A\u300C\u30D3\u30AE\u30CA\u30FC\u3092\u5927\u91CF\u306B\u98DF\u3079\u3066\u98A8\u8239\u306B\u306A\u308B\u300D\u3060\u3051\u3067\u306F\u7E04\u5F35\u308A\u304C\u4F38\u3073\u306A\u304F\u306A\u308A\u3001\u5927\u7269\u540C\u58EB\u304C\u3076\u3064\u304B\u308A\u5408\u308F\u306A\u3044\u3068\u5927\u304D\u304F\u306A\u308C\u306A\u3044\u3002
function killGain(myKills, victimKills) {
  const diff = (victimKills || 0) - (myKills || 0);
  if (diff >= 0) return 1 + Math.min(1, diff * 0.05);
  return Math.max(0.15, 1 + diff * 0.03);
}
// \u8A0E\u738B\u6570(\u8868\u793A\u7528\u30C8\u30ED\u30D5\u30A3\u30FC)\u306F\u5F93\u6765\u901A\u308A+1\u3059\u308B\u304C\u3001\u7E04\u5F35\u308A\u62E1\u5927(growth)\u306F\u76F8\u624B\u306E\u5F37\u3055\u306B\u5FDC\u3058\u3066\u5225\u679A\u3067\u52A0\u7B97\u3059\u308B\u3002
function addKillGrowth(army, victimKills) {
  const myKills = army.kills || 0;
  if (army.growth == null) army.growth = myKills;
  army.kills = myKills + 1;
  army.growth += killGain(myKills, victimKills);
}
const STEPS = {
  P: [[0, -1]],
  N: [[-1, -2], [1, -2]],
  S: [[0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]],
  G: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]],
  K: [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]]
};
const SLIDES = { L: [[0, -1]], B: [[1, 1], [1, -1], [-1, 1], [-1, -1]], R: [[0, -1], [0, 1], [1, 0], [-1, 0]] };
const GOLDLIKE = { P: 1, L: 1, N: 1, S: 1 };
const PROMOTABLE = { P: 1, L: 1, N: 1, S: 1, B: 1, R: 1 };
const VAL = { P: 1, L: 3, N: 3, S: 5, G: 6, B: 8, R: 10, K: 1e3 };
const KANJI = { P: "\u6B69", L: "\u9999", N: "\u6842", S: "\u9280", G: "\u91D1", B: "\u89D2", R: "\u98DB" };
const PKANJI = { P: "\u3068", L: "\u674F", N: "\u572D", S: "\u5168", B: "\u99AC", R: "\u7ADC" };
const kanjiOf = (p, playerId) => p.t === "K" ? p.owner === playerId ? "\u7389" : "\u738B" : (p.promoted && PKANJI[p.t]) || KANJI[p.t] || "?";
const NAME_POOLS = [
  { cjk: true, pre: ["\u30EC\u30C3\u30C9", "\u30D6\u30EB\u30FC", "\u30B4\u30FC\u30EB\u30C7\u30F3", "\u30B7\u30EB\u30D0\u30FC", "\u30D6\u30E9\u30C3\u30AF", "\u30AF\u30EA\u30E0\u30BE\u30F3", "\u30A2\u30BA\u30FC\u30EB", "\u30B7\u30E3\u30C9\u30A6", "\u30B5\u30F3\u30C0\u30FC", "\u30AA\u30FC\u30ED\u30E9"], suf: ["\u30A6\u30A3\u30F3\u30B0", "\u30D5\u30A1\u30F3\u30B0", "\u30D6\u30EC\u30FC\u30C9", "\u30AF\u30ED\u30FC", "\u30DB\u30FC\u30AF", "\u30A6\u30EB\u30D5", "\u30E9\u30A4\u30AA\u30F3", "\u30BF\u30A4\u30AC\u30FC", "\u30AC\u30FC\u30C9", "\u30D5\u30EA\u30FC\u30C8"] },
  { cjk: false, pre: ["Red", "Blue", "Golden", "Silver", "Black", "Crimson", "Azure", "Shadow", "Thunder", "Storm"], suf: ["Wing", "Fang", "Blade", "Claw", "Hawk", "Wolf", "Lion", "Tiger", "Guard", "Fleet"] },
  { cjk: false, pre: ["Rouge", "Bleu", "Dor\xE9", "Argent", "Noir", "Cramoisi", "Azur", "Ombre", "Tonnerre", "Orage"], suf: ["Aile", "Croc", "Lame", "Griffe", "Faucon", "Loup", "Lion", "Tigre", "Garde", "Flotte"] },
  { cjk: false, pre: ["Rojo", "Azul", "Dorado", "Plata", "Negro", "Carmes\xED", "Celeste", "Sombra", "Trueno", "Tormenta"], suf: ["Ala", "Colmillo", "Espada", "Garra", "Halc\xF3n", "Lobo", "Le\xF3n", "Tigre", "Guardia", "Flota"] },
  { cjk: false, pre: ["Rot", "Blau", "Gold", "Silber", "Schwarz", "Karmesin", "Azur", "Schatten", "Donner", "Sturm"], suf: ["Schwinge", "Fang", "Klinge", "Kralle", "Falke", "Wolf", "L\xF6we", "Tiger", "Wache", "Flotte"] },
  { cjk: true, pre: ["\u8D64", "\u84BC", "\u91D1", "\u9280", "\u9ED2", "\u7D05", "\u78A7", "\u5F71", "\u96F7", "\u5D50"], suf: ["\u7FFC", "\u7259", "\u5203", "\u722A", "\u9DF9", "\u72FC", "\u7345", "\u864E", "\u885B", "\u968A"] },
  { cjk: false, pre: ["\u041A\u0440\u0430\u0441\u043D\u044B\u0439", "\u0421\u0438\u043D\u0438\u0439", "\u0417\u043E\u043B\u043E\u0442\u043E\u0439", "\u0421\u0435\u0440\u0435\u0431\u0440\u044F\u043D\u044B\u0439", "\u0427\u0451\u0440\u043D\u044B\u0439", "\u0411\u0430\u0433\u0440\u043E\u0432\u044B\u0439", "\u041B\u0430\u0437\u0443\u0440\u043D\u044B\u0439", "\u0422\u0451\u043C\u043D\u044B\u0439", "\u0413\u0440\u043E\u043C\u043E\u0432\u043E\u0439", "\u0428\u0442\u043E\u0440\u043C\u043E\u0432\u043E\u0439"], suf: ["\u041A\u0440\u044B\u043B\u043E", "\u041A\u043B\u044B\u043A", "\u041A\u043B\u0438\u043D\u043E\u043A", "\u041A\u043E\u0433\u043E\u0442\u044C", "\u042F\u0441\u0442\u0440\u0435\u0431", "\u0412\u043E\u043B\u043A", "\u041B\u0435\u0432", "\u0422\u0438\u0433\u0440", "\u0421\u0442\u0440\u0430\u0436", "\u0424\u043B\u043E\u0442"] },
  { cjk: false, pre: ["\u0623\u062D\u0645\u0631", "\u0623\u0632\u0631\u0642", "\u0630\u0647\u0628\u064A", "\u0641\u0636\u064A", "\u0623\u0633\u0648\u062F", "\u0642\u0631\u0645\u0632\u064A", "\u0633\u0645\u0627\u0648\u064A", "\u0638\u0644", "\u0631\u0639\u062F", "\u0639\u0627\u0635\u0641\u0629"], suf: ["\u062C\u0646\u0627\u062D", "\u0646\u0627\u0628", "\u0646\u0635\u0644", "\u0645\u062E\u0644\u0628", "\u0635\u0642\u0631", "\u0630\u0626\u0628", "\u0623\u0633\u062F", "\u0646\u0645\u0631", "\u062D\u0627\u0631\u0633", "\u0623\u0633\u0637\u0648\u0644"] }
];
function pickName() {
  const pool = NAME_POOLS[Math.floor(Math.random() * NAME_POOLS.length)];
  const pre = pool.pre[Math.floor(Math.random() * pool.pre.length)];
  const suf = pool.suf[Math.floor(Math.random() * pool.suf.length)];
  const raw = pool.cjk ? pre + suf : pre + " " + suf;
  return raw.length > NAME_MAX_LEN ? raw.slice(0, NAME_MAX_LEN) : raw;
}
function generateNames(n) {
  const used = /* @__PURE__ */ new Set(), out = [];
  while (out.length < n) {
    const name = generateOneName(used);
    used.add(name);
    out.push(name);
  }
  return out;
}
function generateOneName(existingNames) {
  // 作れる名前は有限(800通り)なので、「未使用が出るまで引き直す」だと
  // 使い切った瞬間に無限ループしてページごと固まる。必ず有限回で返す。
  for (let i = 0; i < 200; i++) {
    const name = pickName();
    if (!existingNames.has(name)) return name;
  }
  const base = pickName();
  for (let n = 2; n < 10000; n++) {
    const suffix = String(n);
    const cand = base.slice(0, Math.max(1, NAME_MAX_LEN - suffix.length)) + suffix;
    if (!existingNames.has(cand)) return cand;
  }
  return base.slice(0, Math.max(1, NAME_MAX_LEN - 4)) + Math.random().toString(36).slice(2, 6);
}
const BAD_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "nigger",
  "faggot",
  "\u99AC\u9E7F",
  "\u3070\u304B",
  "\u30D0\u30AB",
  "\u963F\u5446",
  "\u30A2\u30DB",
  "\u3042\u307B",
  "\u30AF\u30BD",
  "\u304F\u305D",
  "\u7CDE",
  "\u6B7B\u306D",
  "\u3057\u306D",
  "\u6BBA\u3059",
  "\u3053\u308D\u3059",
  "\u304D\u3082\u3044",
  "\u30AD\u30E2\u3044",
  "\u6C17\u6301\u3061\u60AA\u3044",
  "\u3046\u3056\u3044",
  "\u30A6\u30B6\u3044",
  "\u3076\u3059",
  "\u30D6\u30B9",
  "\u30C7\u30D6",
  "\u3067\u3076",
  "\u3084\u308D\u3046",
  "\u91CE\u90CE",
  "\u3066\u3081\u3048",
  "\u30C6\u30E1\u30A8",
  "\u3054\u307F",
  "\u30B4\u30DF",
  "\u30AB\u30B9",
  "\u304B\u3059"
];
function filterProfanity(text) {
  let out = text;
  for (const w of BAD_WORDS) out = out.replace(new RegExp(w, "gi"), "*".repeat(w.length));
  return out;
}
const PLAYER_COLOR = { fill: "#DEC48A", edge: "#4a3417", text: "#241a0e", prom: "#B3392B", zone: "rgba(233,208,150,0.13)", zoneEdge: "rgba(201,169,106,0.6)", chip: "#C9A96A" };
// 腕前の分布。大半は平凡で、一握りだけ飛び抜けて上手い。
// これが無いと全員横並びで、誰も大きくなれない。
function makeSkill() {
  const u = Math.random();
  if (u < 0.55) return 0.25 + Math.random() * 0.25;  // 平凡  0.25〜0.50
  if (u < 0.85) return 0.50 + Math.random() * 0.20;  // 中堅  0.50〜0.70
  if (u < 0.97) return 0.70 + Math.random() * 0.18;  // 手練  0.70〜0.88
  return 0.88 + Math.random() * 0.12;                // 名手  0.88〜1.00
}
function makeColor(i) {
  const h = Math.round(i * 137.508 % 360);
  return {
    fill: `hsl(${h},34%,26%)`,
    edge: `hsl(${h},55%,9%)`,
    text: `hsl(${h},28%,88%)`,
    prom: `hsl(${(h + 45) % 360},95%,72%)`,
    zone: `hsla(${h},60%,55%,0.14)`,
    zoneEdge: `hsla(${h},55%,42%,0.65)`,
    chip: `hsl(${h},60%,38%)`
  };
}
if (typeof document !== "undefined" && !window.__owsGuardInstalled) {
  window.__owsGuardInstalled = true;
  const style = (el) => {
    if (el) {
      el.style.touchAction = "none";
      el.style.overscrollBehavior = "none";
    }
  };
  style(document.documentElement);
  if (document.body) style(document.body);
  else document.addEventListener("DOMContentLoaded", () => style(document.body), { once: true });
  const guard = (e) => {
    const t = e.target;
    if (t && t.closest && t.closest("button, input, .ows-scroll")) return;
    e.preventDefault();
  };
  document.addEventListener("touchstart", guard, { passive: false });
  document.addEventListener("touchmove", guard, { passive: false });
}
function pieceMoveVectors(p) {
  const t = p.t, pr = p.promoted;
  if (t === "K") return { steps: STEPS.K, slides: [] };
  if (t === "G") return { steps: STEPS.G, slides: [] };
  if (pr) {
    if (GOLDLIKE[t]) return { steps: STEPS.G, slides: [] };
    if (t === "B") return { steps: [[0, -1], [0, 1], [1, 0], [-1, 0]], slides: SLIDES.B };
    if (t === "R") return { steps: [[1, 1], [1, -1], [-1, 1], [-1, -1]], slides: SLIDES.R };
  }
  if (t === "P") return { steps: STEPS.P, slides: [] };
  if (t === "N") return { steps: STEPS.N, slides: [] };
  if (t === "S") return { steps: STEPS.S, slides: [] };
  return { steps: [], slides: SLIDES[t] || [] };
}
function makeGrid(owner) {
  const back = ["L", "N", "S", "G", "K", "G", "S", "N", "L"];
  const g = [[], [], []];
  for (let x = 0; x < 9; x++) {
    g[0][x] = { t: back[x], promoted: false, owner };
    g[1][x] = null;
    g[2][x] = { t: "P", promoted: false, owner };
  }
  g[1][1] = { t: "B", promoted: false, owner };
  g[1][7] = { t: "R", promoted: false, owner };
  return g;
}
function armyFootprint(center, facing) {
  const f = F[facing], r = RV[facing];
  const anchor = [center[0] - r[0] * 4, center[1] - r[1] * 4];
  const out = [];
  const grid = makeGrid(0);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 9; x++) {
    if (!grid[y][x]) continue;
    out.push(K(anchor[0] + r[0] * x + f[0] * y, anchor[1] + r[1] * x + f[1] * y));
  }
  return out;
}
function footprintBlocked(W, center, facing) {
  for (const k of armyFootprint(center, facing)) {
    const p = W.cells.get(k);
    if (!p) continue;
    const oa = W.armies[p.owner];
    if (oa && oa.alive) return true;
  }
  return false;
}
function placeArmyCentered(cells, armyId, center, facing) {
  const f = F[facing], r = RV[facing];
  const anchor = [center[0] - r[0] * 4, center[1] - r[1] * 4];
  const grid = makeGrid(armyId);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 9; x++) {
    const p = grid[y][x];
    if (!p) continue;
    cells.set(K(anchor[0] + r[0] * x + f[0] * y, anchor[1] + r[1] * x + f[1] * y), p);
  }
}
function relocateArmy(W, a, center, facing) {
  const doomed = [];
  for (const [k, p] of W.cells) if (p.owner === a.id) doomed.push(k);
  for (const k of doomed) W.cells.delete(k);
  a.facing = facing;
  a.center = [center[0], center[1]];
  placeArmyCentered(W.cells, a.id, a.center, facing);
  a.kingKey = K(center[0], center[1]);
  a.zone = null;
  refreshZone(a);
}
// \u5404\u8ECD\u304C\u8997\u3048\u3066\u3044\u308B\u7389\u306E\u4F4D\u7F6E(kingKey)\u3092\u78BA\u304B\u3081\u308B\u3060\u3051\u3067\u6E08\u3081\u3070\u3001\u76E4\u9762\u5168\u4F53\u3092\u8D70\u67FB\u3057\u306A\u3044\u3002
// \u6BCE\u30D5\u30EC\u30FC\u30E0\u547C\u3070\u308C\u308B\u306E\u3067\u3001\u6570\u4E07\u30DE\u30B9\u306E\u8D70\u67FB\u3092\u8EE2\u306E\u6570(\u6570\u767E)\u3060\u3051\u306E\u78BA\u8A8D\u306B\u6E1B\u3089\u3059\u3002
// \u98DF\u3044\u9055\u3044\u304C\u4E00\u3064\u3067\u3082\u3042\u308C\u3070\u5F93\u6765\u901A\u308A\u5168\u8D70\u67FB\u3057\u3066\u3001\u8997\u3048\u3066\u3044\u308B\u4F4D\u7F6E\u3082\u4F5C\u308A\u76F4\u3059\u3002
function buildKingIndex(cells, armies) {
  if (armies) {
    const fast = /* @__PURE__ */ new Map();
    let ok = true;
    for (const a of armies) {
      if (!a.alive || a.neutral) continue;
      const kk = a.kingKey;
      const p = kk ? cells.get(kk) : null;
      if (!p || p.t !== "K" || p.owner !== a.id) { ok = false; break; }
      const ci = kk.indexOf(",");
      fast.set(a.id, [+kk.slice(0, ci), +kk.slice(ci + 1)]);
    }
    if (ok) return fast;
  }
  const kings = /* @__PURE__ */ new Map();
  for (const [k, p] of cells) {
    if (p.t !== "K") continue;
    kings.set(p.owner, k.split(",").map(Number));
    const oa = armies ? armies[p.owner] : null;
    if (oa && oa.id === p.owner) oa.kingKey = k;
  }
  return kings;
}
const LOOT_GRID = 16;
function buildLootGrid(W) {
  const gw = Math.ceil(MAP_W / LOOT_GRID);
  const buckets = new Map();
  for (const [k, p] of W.cells) {
    const oa = W.armies[p.owner];
    if (oa && oa.alive) continue;
    const ci = k.indexOf(",");
    const x = +k.slice(0, ci), y = +k.slice(ci + 1);
    const b = (y / LOOT_GRID | 0) * gw + (x / LOOT_GRID | 0);
    let list = buckets.get(b);
    if (!list) { list = []; buckets.set(b, list); }
    list.push(x, y, p.owner);
  }
  return { gw, gh: Math.ceil(MAP_H / LOOT_GRID), buckets };
}
function nearestLoot(W, a, grid, minDist) {
  if (!grid) return null;
  const R = a.zone.r + 24;
  const lo = minDist || 0;
  const cx = a.center[0], cy = a.center[1];
  const { gw, gh, buckets } = grid;
  const gcx = cx / LOOT_GRID | 0, gcy = cy / LOOT_GRID | 0;
  const maxRing = Math.ceil(R / LOOT_GRID);
  let best = null, bd = Infinity;
  for (let ring = 0; ring <= maxRing; ring++) {
    if (best && (ring - 1) * LOOT_GRID > bd) break;
    for (let gy = gcy - ring; gy <= gcy + ring; gy++) {
      if (gy < 0 || gy >= gh) continue;
      const edge = (gy === gcy - ring || gy === gcy + ring);
      for (let gx = gcx - ring; gx <= gcx + ring; gx++) {
        if (gx < 0 || gx >= gw) continue;
        if (!edge && gx !== gcx - ring && gx !== gcx + ring) continue;
        const list = buckets.get(gy * gw + gx);
        if (!list) continue;
        for (let i = 0; i < list.length; i += 3) {
          if (list[i + 2] === a.id) continue;
          const dx = list[i] - cx, dy = list[i + 1] - cy;
          const ax = dx < 0 ? -dx : dx, ay = dy < 0 ? -dy : dy;
          if (ax > R || ay > R) continue;
          const d = ax > ay ? ax : ay;
          if (d < lo) continue;
          if (d < bd) { bd = d; best = [list[i], list[i + 1]]; }
        }
      }
    }
  }
  return best ? { pos: best, dist: bd } : null;
}
function zoneAt(center, r) {
  const [cx, cy] = center;
  const x0 = cx - r, x1 = cx + r;
  const y0 = cy - r, y1 = cy + r;
  const set = {
    x0, y0, x1, y1,
    get size() { return (x1 - x0 + 1) * (y1 - y0 + 1); },
    has(k) {
      const ci = k.indexOf(",");
      if (ci < 0) return false;
      const x = +k.slice(0, ci), y = +k.slice(ci + 1);
      return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    },
    *[Symbol.iterator]() {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) yield K(x, y);
    }
  };
  return { cx, cy, r, set };
}
const ZONE_R_MAX = Math.floor((Math.min(MAP_W, MAP_H) - 1) / 2);
function isCommanding(W) {
  const pa = W.playerId !== null ? W.armies[W.playerId] : null;
  return !!(pa && pa.alive && !W.myDefeated);
}
function focusOwnerOf(W) {
  return isCommanding(W) ? W.playerId : W.focusId;
}
function zoneFits(cx, cy, r) {
  return cx - r >= 0 && cy - r >= 0 && cx + r <= MAP_W - 1 && cy + r <= MAP_H - 1;
}
function refreshZone(a) {
  const zr = Math.min(zoneRadiusFor(a), ZONE_R_MAX);
  const cx = Math.max(zr, Math.min(MAP_W - 1 - zr, a.center[0]));
  const cy = Math.max(zr, Math.min(MAP_H - 1 - zr, a.center[1]));
  if (cx !== a.center[0] || cy !== a.center[1]) a.center = [cx, cy];
  if (!a.zone || a.zone.cx !== cx || a.zone.cy !== cy || a.zone.r !== zr) {
    a.zone = zoneAt([cx, cy], zr);
  }
}
function findSpawnSpot(W, facing) {
  const margins = [22, 16, 12];
  const live = [];
  for (const a of W.armies) if (a.alive && a.zone) live.push(a);
  for (const clear of margins) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const cx = 10 + Math.floor(Math.random() * (MAP_W - 20));
      const cy = 10 + Math.floor(Math.random() * (MAP_H - 20));
      let clash = false;
      for (const a of live) {
        // \u56FA\u5B9A\u8DDD\u96E2\u3067\u306F\u306A\u304F\u3001\u305D\u306E\u8ECD\u306E\u5B9F\u969B\u306E\u7E04\u5F35\u308A\u534A\u5F84\u3092\u57FA\u6E96\u306B\u3059\u308B\u3002
        // \u3053\u308C\u304C\u306A\u3044\u3068\u3001\u5927\u7269\u306E\u7E04\u5F35\u308A\u304C\u56FA\u5B9A\u8DDD\u96E2(\u6700\u592742)\u3092\u8D85\u3048\u305F\u77AC\u9593\u3001\u65B0\u4EBA\u304C\u305D\u306E\u4E2D\u306B\u751F\u307E\u308C\u3066\u3059\u3050\u306B\u8E0F\u307F\u6F70\u3055\u308C\u308B\u3002
        const need = Math.max(clear, (a.zone ? a.zone.r : 0) + 6);
        if (Math.abs(cx - a.center[0]) <= need && Math.abs(cy - a.center[1]) <= need) {
          clash = true;
          break;
        }
      }
      if (clash) continue;
      if (footprintBlocked(W, [cx, cy], facing)) continue;
      return [cx, cy];
    }
  }
  return null;
}
function armyHasBoardPieces(W, id) {
  for (const p of W.cells.values()) if (p.owner === id) return true;
  return false;
}
function spawnNewArmy(W, onBoardCache) {
  const facing = Math.floor(Math.random() * 4);
  const center = findSpawnSpot(W, facing);
  if (!center) return null;
  const existingNames = /* @__PURE__ */ new Set();
  for (const x of W.armies) if (x.alive) existingNames.add(x.name);
  const t = now();
  const flankBias = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.floor(Math.random() * 5));
  const name = generateOneName(existingNames);
  // 盤上に駒を残している軍の一覧。まとめて複数軍を湧かせるときは呼び出し側が1回だけ作って渡す
  // (湧いたばかりの軍は生きているので再利用の対象にはならず、使い回しても結果は同じ)。
  let onBoard = onBoardCache;
  if (!onBoard) {
    onBoard = /* @__PURE__ */ new Set();
    for (const p of W.cells.values()) onBoard.add(p.owner);
  }
  const reuse = W.armies.find((a2) => !a2.alive && !a2.neutral && !onBoard.has(a2.id) && !(W.myDefeated && a2.id === W.playerId));
  const id = reuse ? reuse.id : W.armies.length;
  placeArmyCentered(W.cells, id, center, facing);
  const fresh = {
    id,
    facing,
    alive: true,
    hand: {},
    target: null,
    marchRel: null,
    lastMove: t,
    lastAction: t,
    center,
    zone: null,
    kills: 0,
    skill: makeSkill(),
    name,
    color: makeColor(id),
    flankBias,
    speedMult: 1,
    decayNext: 0,
    decayMult: 1,
    kingKey: K(center[0], center[1])
  };
  if (reuse) Object.assign(reuse, fresh);
  else W.armies.push(fresh);
  const a = reuse || fresh;
  refreshZone(a);
  return a;
}
function legalMovesFrom(cells, x, y, facing, zoneSet, maxSlide) {
  const p = cells.get(K(x, y));
  if (!p) return [];
  const { steps, slides } = pieceMoveVectors(p), out = [];
  for (const [dx, dy] of steps) {
    const [rx, ry] = rotV(dx, dy, facing), nk = K(x + rx, y + ry);
    if (!zoneSet.has(nk)) continue;
    const q = cells.get(nk);
    if (!q || q.owner !== p.owner) out.push([x + rx, y + ry]);
  }
  for (const [dx, dy] of slides) {
    const [rx, ry] = rotV(dx, dy, facing);
    let nx = x + rx, ny = y + ry, n = 0;
    while (zoneSet.has(K(nx, ny))) {
      const q = cells.get(K(nx, ny));
      if (!q) out.push([nx, ny]);
      else {
        if (q.owner !== p.owner) out.push([nx, ny]);
        break;
      }
      if (maxSlide && ++n >= maxSlide) break;
      nx += rx;
      ny += ry;
    }
  }
  return out;
}
function dropTargets(cells, zoneSet, limit) {
  const out = [];
  if (!zoneSet || zoneSet.x1 === void 0) {
    for (const k of zoneSet || []) if (!cells.has(k)) {
      const ci = k.indexOf(",");
      out.push([+k.slice(0, ci), +k.slice(ci + 1)]);
    }
    return out;
  }
  const { x0, y0, x1, y1 } = zoneSet;
  const w = x1 - x0 + 1, h = y1 - y0 + 1, area = w * h;
  const cap = limit || 600;
  if (area <= 1200) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (!cells.has(K(x, y))) out.push([x, y]);
    }
    if (out.length > cap) {
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = out[i]; out[i] = out[j]; out[j] = t;
      }
      out.length = cap;
    }
    return out;
  }
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < cap * 8 && out.length < cap; i++) {
    const x = x0 + Math.floor(Math.random() * w);
    const y = y0 + Math.floor(Math.random() * h);
    const k = K(x, y);
    if (seen.has(k) || cells.has(k)) continue;
    seen.add(k);
    out.push([x, y]);
  }
  return out;
}
const AI_SLIDE_CAP = 12;
const AI_DROP_SPOTS = 40;
function allActions(cells, armyId, facing, hand, zoneSet, ownPieces, dropSpots) {
  const acts = [];
  for (const [x, y] of ownPieces) {
    for (const [tx, ty] of legalMovesFrom(cells, x, y, facing, zoneSet, AI_SLIDE_CAP)) acts.push({ kind: "move", fx: x, fy: y, tx, ty });
  }
  const keys = Object.keys(hand);
  if (keys.length) {
    const dts = dropSpots || dropTargets(cells, zoneSet, AI_DROP_SPOTS);
    for (const t of keys) for (const [x, y] of dts) acts.push({ kind: "drop", type: t, tx: x, ty: y });
  }
  return acts;
}
// AI\u304C\u6301\u3061\u99D2\u3092\u6253\u3064\u5834\u6240\u306E\u5019\u88DC\u3002\u53EF\u52D5\u57DF\u5168\u4F53\u304B\u3089\u7121\u4F5C\u70BA\u306B\u9078\u3076\u3060\u3051\u3060\u3068\u3001\u53EF\u52D5\u57DF\u304C\u5E83\u3044\u5927\u8ECD\u3067\u306F
// \u81EA\u7389\u306E\u5468\u308A\u3084\u6575\u306E\u3044\u308B\u65B9\u5411\u304C\u307B\u3068\u3093\u3069\u5019\u88DC\u306B\u5165\u3089\u305A\u3001\u6301\u3061\u99D2\u3092\u62B1\u3048\u305F\u307E\u307E\u306B\u306A\u3063\u3066\u3044\u305F\u3002
// \u81EA\u7389\u306E\u5468\u308A(3\u30DE\u30B9\u4EE5\u5185)\u3068\u3001\u81EA\u7389\u304B\u3089\u6575\u7389\u3078\u5411\u304B\u3046\u524D\u7DDA\u3092\u5FC5\u305A\u5019\u88DC\u306B\u5165\u308C\u308B\u3002
function aiDropSpots(cells, zoneSet, myKing, enemyKp, extra) {
  const out = [], seen = /* @__PURE__ */ new Set();
  const add = (x, y) => {
    if (x < zoneSet.x0 || x > zoneSet.x1 || y < zoneSet.y0 || y > zoneSet.y1) return;
    const k = K(x, y);
    if (seen.has(k) || cells.has(k)) return;
    seen.add(k);
    out.push([x, y]);
  };
  if (myKing) {
    const kx = myKing[0], ky = myKing[1];
    for (let r = 1; r <= 3; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r) add(kx + dx, ky + dy);
      }
    }
    if (enemyKp) {
      const vx = Math.sign(enemyKp[0] - kx), vy = Math.sign(enemyKp[1] - ky);
      for (let d = 2; d <= 6; d++) for (let w = -2; w <= 2; w++) add(kx + vx * d - vy * w, ky + vy * d + vx * w);
    }
  }
  if (extra) for (const p of extra) add(p[0], p[1]);
  for (const p of dropTargets(cells, zoneSet, 24)) add(p[0], p[1]);
  return out;
}

// \u81EA\u9663(\u53EF\u52D5\u57DF)\u306B\u5165\u3063\u3066\u304D\u305F\u6575\u306E\u99D2\u3068\u3001\u5165\u3063\u3066\u304D\u305F\u6575\u7389\u3092\u4FA1\u5024\u9806\u306B\u62FE\u3046\u3002
function aiIntruders(W, army, piecesByOwner, limit) {
  const zs = army.zone.set, out = [];
  for (const oa of W.armies) {
    if (oa.id === army.id || !oa.alive || !oa.zone) continue;
    const oz = oa.zone.set;
    if (oz.x1 < zs.x0 || oz.x0 > zs.x1 || oz.y1 < zs.y0 || oz.y0 > zs.y1) continue;
    const pieces = piecesByOwner.get(oa.id);
    if (!pieces) continue;
    let seen = 0;
    for (const pos of pieces) {
      const x = pos[0], y = pos[1];
      if (x < zs.x0 || x > zs.x1 || y < zs.y0 || y > zs.y1) continue;
      if (++seen > 24) break;
      const p = W.cells.get(K(x, y));
      if (!p || p.owner === army.id) continue;
      out.push({ x, y, king: p.t === "K", value: p.t === "K" ? 200 : (VAL[p.t] || 1) * 3 });
    }
  }
  out.sort((a, b) => b.value - a.value);
  if (out.length > limit) out.length = limit;
  return out;
}

// \u8FCE\u3048\u6483\u3064\u305F\u3081\u306E\u6253\u3061\u5834\u6240\u3002\u6253\u3063\u305F\u77AC\u9593\u306B\u76EE\u6A19(\u4FB5\u5165\u3057\u3066\u304D\u305F\u99D2\u3084\u6575\u7389)\u3092\u72D9\u3048\u308B\u4F4D\u7F6E\u3092\u96C6\u3081\u308B\u3002
// \u89D2\u3084\u98DB\u306E\u3088\u3046\u306A\u8D70\u308A\u99D2\u306F\u96E2\u308C\u305F\u4F4D\u7F6E\u304B\u3089\u3067\u3082\u7389\u3092\u72D9\u3048\u308B\u306E\u3067\u3001\u5229\u304D\u7DDA\u4E0A\u306E\u7A7A\u304D\u30DE\u30B9\u3092\u5019\u88DC\u306B\u3059\u308B\u3002
function aiInterceptSpots(cells, zoneSet, hand, facing, targets, cap) {
  const spots = /* @__PURE__ */ new Map();
  let n = 0;
  const addSpot = (x, y, type, value) => {
    if (x < zoneSet.x0 || x > zoneSet.x1 || y < zoneSet.y0 || y > zoneSet.y1) return false;
    const k = K(x, y);
    if (cells.has(k)) return false;
    let e = spots.get(k);
    if (!e) {
      if (n >= cap) return true;
      n++;
      e = { x, y, best: 0, types: /* @__PURE__ */ new Map() };
      spots.set(k, e);
    }
    const prev = e.types.get(type) || 0;
    if (value > prev) e.types.set(type, value);
    if (value > e.best) e.best = value;
    return true;
  };
  for (const type of Object.keys(hand)) {
    const mv = pieceMoveVectors({ t: type, promoted: false });
    for (const tg of targets) {
      for (const st of mv.steps) {
        const v = rotV(st[0], st[1], facing);
        addSpot(tg.x - v[0], tg.y - v[1], type, tg.value);
      }
      for (const sl of mv.slides) {
        const v = rotV(sl[0], sl[1], facing);
        let x = tg.x - v[0], y = tg.y - v[1];
        for (let d = 0; d < 6; d++) {
          if (x < zoneSet.x0 || x > zoneSet.x1 || y < zoneSet.y0 || y > zoneSet.y1) break;
          if (cells.has(K(x, y))) break; // \u9014\u4E2D\u306B\u99D2\u304C\u3042\u308C\u3070\u305D\u306E\u5148\u304B\u3089\u306F\u72D9\u3048\u306A\u3044
          addSpot(x, y, type, tg.value);
          x -= v[0];
          y -= v[1];
        }
      }
    }
  }
  return spots;
}
// \u53EF\u52D5\u57DF\u306F\u6B63\u65B9\u5F62\u306A\u306E\u3067\u3001\u5EA7\u6A19\u306E\u6570\u5024\u6BD4\u8F03\u3060\u3051\u3067\u5224\u5B9A\u3067\u304D\u308B(zone.set.has \u3068\u540C\u3058\u7D50\u679C)\u3002
// \u4EE5\u524D\u306F\u8ECD\u3054\u3068\u306B"x,y"\u306E\u6587\u5B57\u5217\u3092\u4F5C\u3063\u3066\u5206\u89E3\u3057\u3066\u304A\u308A\u3001AI\u306E\u5019\u88DC\u624B1\u3064\u3054\u3068\u306B\u5168\u8ECD\u3076\u3093\u8D70\u3063\u3066\u91CD\u304B\u3063\u305F\u3002
// armies \u306B\u306F\u3001\u547C\u3073\u51FA\u3057\u5074\u3067\u95A2\u4FC2\u306E\u3042\u308B\u8ECD\u3060\u3051\u306B\u7D5E\u3063\u305F\u30EA\u30B9\u30C8\u3092\u6E21\u3057\u3066\u3082\u3088\u3044\u3002
function isInHostileZone(tx, ty, ownArmyId, armies) {
  for (const a of armies) {
    if (a.id === ownArmyId || !a.alive || !a.zone) continue;
    const z = a.zone.set;
    if (tx >= z.x0 && tx <= z.x1 && ty >= z.y0 && ty <= z.y1) return true;
  }
  return false;
}
function marchInBounds(pieces, dx, dy) {
  for (const [x, y] of pieces) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return false;
  }
  return true;
}
function relVector(facing, rel) {
  const front = F[facing], right = F[(facing + 1) % 4], back = F[(facing + 2) % 4], left = F[(facing + 3) % 4];
  switch (rel) {
    case "front": return front;
    case "back": return back;
    case "left": return left;
    case "right": return right;
    case "frontLeft": return [front[0] + left[0], front[1] + left[1]];
    case "frontRight": return [front[0] + right[0], front[1] + right[1]];
    case "backLeft": return [back[0] + left[0], back[1] + left[1]];
    case "backRight": return [back[0] + right[0], back[1] + right[1]];
    default: return [0, 0];
  }
}
function marchDirFor(W, a, kings, myPieces, lootGrid) {
  let dest = null;
  if (a.id === W.playerId || a.human) {
    if (!a.marchRel) return null;
    const [vx, vy] = relVector(a.facing, a.marchRel);
    let tx = a.center[0], ty = a.center[1];
    if (vx < 0) tx = 0; else if (vx > 0) tx = MAP_W - 1;
    if (vy < 0) ty = 0; else if (vy > 0) ty = MAP_H - 1;
    dest = [tx, ty];
    if (dest[0] === a.center[0] && dest[1] === a.center[1]) {
      a.marchRel = null;
      return null;
    }
  } else {
    let kp = null, bd = Infinity, bdReal = Infinity;
    const myK = a.kills || 0;
    for (const [oid, okp] of kings) {
      if (oid === a.id) continue;
      const oa = W.armies[oid];
      if (!oa || !oa.alive) continue;
      const d = Math.max(Math.abs(okp[0] - a.center[0]), Math.abs(okp[1] - a.center[1]));
      const gap = Math.max(0, (oa.kills || 0) - myK);
      const eff = d * (1 + Math.min(3, gap * 0.12));
      if (eff < bd) {
        bd = eff;
        bdReal = d;
        kp = okp;
      }
    }
    bd = bdReal;
    const tnow = now();
    if (a.aiDest && tnow < (a.aiDestHold || 0) && !(kp && bd <= 30)) {
      const dd = Math.max(Math.abs(a.aiDest[0] - a.center[0]), Math.abs(a.aiDest[1] - a.center[1]));
      if (dd > 2) dest = a.aiDest;
      else a.aiDest = null;
    }
    if (!dest) {
      const KING_SEEK_RANGE = 140;
      if (kp && bd <= KING_SEEK_RANGE) {
        dest = kp;
        if (bd > 30) {
          const dx = kp[0] - a.center[0], dy = kp[1] - a.center[1];
          if (Math.abs(dx) >= Math.abs(dy)) dest = [kp[0], Math.max(0, Math.min(MAP_H - 1, kp[1] + a.flankBias))];
          else dest = [Math.max(0, Math.min(MAP_W - 1, kp[0] + a.flankBias)), kp[1]];
        }
      } else {
        const loot = nearestLoot(W, a, typeof lootGrid === "function" ? lootGrid() : lootGrid, a.zone.r + 1);
        if (loot) dest = loot.pos;
        else if (kp) dest = kp;
        else return null;
      }
      a.aiDest = dest;
      a.aiDestHold = tnow + MARCH_INTERVAL * 6;
    }
  }
  if (!dest) return null;
  const sx = Math.sign(dest[0] - a.center[0]), sy = Math.sign(dest[1] - a.center[1]);
  const attempts = [];
  if (sx && sy) attempts.push([sx, sy]);
  const order = Math.abs(dest[0] - a.center[0]) >= Math.abs(dest[1] - a.center[1]) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
  attempts.push(...order);
  const zr = Math.min(zoneRadiusFor(a), ZONE_R_MAX);
  for (const [mx, my] of attempts) {
    if (!(mx || my)) continue;
    if (!marchInBounds(myPieces, mx, my)) continue;
    if (!zoneFits(a.center[0] + mx, a.center[1] + my, zr)) continue;
    return [mx, my];
  }
  return null;
}
function resolveSimultaneousMarch(W, movers, piecesOf) {
  const ev = { collisions: [], trampledTotal: 0, kingsKilled: [] };
  const cells = W.cells;
  // \u6301\u3061\u4E0A\u3052\u305F\u99D2\u3092\u300C\u8ECD\u30FB\u99D2\u30FB\u884C\u304D\u5148\u300D\u306E3\u3064\u306E\u914D\u5217\u3067\u6301\u3064\u3002\u99D2\u30091\u679A\u3054\u3068\u306B\u30AA\u30D6\u30B8\u30A7\u30AF\u30C8\u3084\u914D\u5217\u3092\u4F5C\u3089\u306A\u3044\u3002
  // (15\u79D2\u3054\u3068\u306E\u4E00\u6589\u9032\u8ECD\u3067\u306F\u76E4\u4E0A\u306E\u7D041\u4E07\u679A\u304C\u4E00\u5EA6\u306B\u52D5\u304F\u306E\u3067\u3001\u3053\u3053\u306E\u5272\u308A\u5F53\u3066\u304C\u305D\u306E\u307E\u307E\u56FA\u307E\u308A\u306B\u306A\u3063\u3066\u3044\u305F)
  const Lm = [], Lp = [], Ld = [];
  if (piecesOf) {
    // \u547C\u3073\u51FA\u3057\u5074\u304C\u540C\u3058\u30D5\u30EC\u30FC\u30E0\u3067\u96C6\u3081\u305F\u99D2\u306E\u5EA7\u6A19\u3092\u4F7F\u3046\u3002\u76E4\u9762\u5168\u4F53(\u6570\u4E07\u30DE\u30B9)\u306E\u8D70\u67FB\u3092\u7701\u304F\u3002
    for (const m of movers) {
      const list = piecesOf.get(m.army.id);
      if (!list) continue;
      const id = m.army.id, dx = m.dx, dy = m.dy;
      for (let i = 0; i < list.length; i++) {
        const x = list[i][0], y = list[i][1];
        const k = K(x, y);
        const p = cells.get(k);
        if (!p || p.owner !== id) continue;
        cells.delete(k);
        Lm.push(m); Lp.push(p); Ld.push(K(x + dx, y + dy));
      }
    }
  } else {
    const byId = new Map(movers.map((m) => [m.army.id, m]));
    const liftedKeys = [];
    for (const [k, p] of cells) {
      const m = byId.get(p.owner);
      if (!m) continue;
      const ci = k.indexOf(",");
      liftedKeys.push(k);
      Lm.push(m); Lp.push(p); Ld.push(K(+k.slice(0, ci) + m.dx, +k.slice(ci + 1) + m.dy));
    }
    for (const k of liftedKeys) cells.delete(k);
  }
  // \u884C\u304D\u5148\u3054\u3068\u306B\u307E\u3068\u3081\u308B\u3002\u307B\u3068\u3093\u3069\u306E\u30DE\u30B9\u306F1\u679A\u3057\u304B\u6765\u306A\u3044\u306E\u3067\u756A\u53F7\u3092\u305D\u306E\u307E\u307E\u6301\u3061\u3001\u885D\u7A81\u3057\u305F\u30DE\u30B9\u3060\u3051\u914D\u5217\u306B\u3059\u308B\u3002
  const byDest = /* @__PURE__ */ new Map();
  for (let i = 0; i < Ld.length; i++) {
    const dk = Ld[i];
    const cur = byDest.get(dk);
    if (cur === undefined) byDest.set(dk, i);
    else if (typeof cur === "number") byDest.set(dk, [cur, i]);
    else cur.push(i);
  }
  for (const [dk, v] of byDest) {
    let si = v;
    if (typeof v !== "number") {
      let total = 0;
      const weights = new Array(v.length);
      for (let j = 0; j < v.length; j++) {
        const ar = Lm[v[j]].army;
        const w = (0.35 + (ar.skill == null ? 0.6 : ar.skill)) * (1 + Math.min(2.5, (ar.kills || 0) * 0.05));
        weights[j] = w;
        total += w;
      }
      let pick = Math.random() * total;
      si = v[v.length - 1];
      for (let j = 0; j < v.length; j++) {
        pick -= weights[j];
        if (pick <= 0) { si = v[j]; break; }
      }
      const winArmy = Lm[si].army;
      for (let j = 0; j < v.length; j++) {
        const li = v[j];
        if (li === si) continue;
        const loserArmy = Lm[li].army, lp = Lp[li];
        ev.collisions.push({ winner: winArmy, loser: loserArmy, piece: lp });
        if (lp.t === "K") {
          ev.kingsKilled.push({ id: loserArmy.id, by: winArmy.id });
          addKillGrowth(winArmy, loserArmy.kills || 0);
        }
      }
    }
    const army = Lm[si].army, sp = Lp[si];
    const occ = cells.get(dk);
    if (occ && occ.owner !== army.id) {
      if (occ.t !== "K") army.hand[occ.t] = (army.hand[occ.t] || 0) + 1;
      ev.trampledTotal++;
      if (occ.t === "K") {
        ev.kingsKilled.push({ id: occ.owner, by: army.id });
        const victimArmy = W.armies[occ.owner];
        addKillGrowth(army, victimArmy ? victimArmy.kills || 0 : 0);
      }
    }
    cells.set(dk, sp);
    if (sp.t === "K") army.kingKey = dk;
  }
  for (const m of movers) {
    m.army.center = [m.army.center[0] + m.dx, m.army.center[1] + m.dy];
    refreshZone(m.army);
  }
  return ev;
}
function aiWantRotation(W, a, kings) {
  let kp = null, bd = Infinity;
  for (const [oid, okp] of kings) {
    if (oid === a.id) continue;
    const oa = W.armies[oid];
    if (!oa || !oa.alive) continue;
    const d = Math.abs(okp[0] - a.center[0]) + Math.abs(okp[1] - a.center[1]);
    if (d < bd) {
      bd = d;
      kp = okp;
    }
  }
  if (!kp || bd > 26) return 0;
  const dx = kp[0] - a.center[0], dy = kp[1] - a.center[1];
  const want = Math.abs(dx) >= Math.abs(dy) ? dx > 0 ? 1 : 3 : dy > 0 ? 2 : 0;
  if (want === a.facing) return 0;
  const diff = (want - a.facing + 4) % 4;
  return diff === 3 ? -1 : 1;
}
function buildThreat(W, army, piecesByOwner) {
  const set = /* @__PURE__ */ new Set();
  const zr = army.zone.r + 2;
  const cx = army.center[0], cy = army.center[1];
  for (const oa of W.armies) {
    if (oa.id === army.id || !oa.alive || !oa.zone) continue;
    const reach = zr + oa.zone.r;
    if (Math.abs(oa.center[0] - cx) > reach || Math.abs(oa.center[1] - cy) > reach) continue;
    const pieces = piecesByOwner.get(oa.id);
    if (!pieces) continue;
    let seen = 0;
    for (const [x, y] of pieces) {
      if (Math.abs(x - cx) > zr || Math.abs(y - cy) > zr) continue;
      if (++seen > AI_THREAT_PIECES) break;
      for (const [tx, ty] of legalMovesFrom(W.cells, x, y, oa.facing, oa.zone.set, AI_SLIDE_CAP)) set.add(K(tx, ty));
    }
  }
  return set;
}
function hasLocalBusiness(W, army, kings) {
  if (Object.keys(army.hand).length > 0) return true;
  for (const [oid, okp] of kings) {
    if (oid === army.id) continue;
    const oa = W.armies[oid];
    if (!oa || !oa.alive) continue;
    if (Math.max(Math.abs(okp[0] - army.center[0]), Math.abs(okp[1] - army.center[1])) <= army.zone.r + 14) return true;
  }
  const zs = army.zone.set;
  if (zs.size > W.cells.size) {
    for (const [k, p] of W.cells) {
      if (p.owner !== army.id && zs.has(k)) return true;
    }
    return false;
  }
  for (const k of zs) {
    const p = W.cells.get(k);
    if (p && p.owner !== army.id) return true;
  }
  return false;
}
const AI_PIECE_CAP = 80;
const AI_THREAT_PIECES = 60;
function aiPickAction(W, army, kings, piecesByOwner) {
  if (!hasLocalBusiness(W, army, kings)) return null;
  let nearestKp = null, nearestDist = Infinity;
  for (const [oid, okp] of kings) {
    if (oid === army.id) continue;
    const oa = W.armies[oid];
    if (!oa || !oa.alive) continue;
    const d = Math.abs(okp[0] - army.center[0]) + Math.abs(okp[1] - army.center[1]);
    if (d < nearestDist) {
      nearestDist = d;
      nearestKp = okp;
    }
  }
  const myKing0 = kings.get(army.id);
  let mine = piecesByOwner.get(army.id) || [];
  // 盤上の配置駒(王以外)が足りているか。可動域の広さと討王数から、これくらいは欲しいという数を決める。
  // 倍速の減衰や踏み潰しで減ったら、持ち駒を打って立て直す判断に使う。
  const boardCount = Math.max(0, mine.length - 1);
  const zs0 = army.zone.set;
  const boardWant = Math.min(Math.floor((zs0.x1 - zs0.x0 + 1) * (zs0.y1 - zs0.y0 + 1) * 0.3), 16 + (army.kills || 0) * 6);
  const boardDeficit = boardWant > 0 ? Math.max(0, 1 - boardCount / boardWant) : 0;
  const skill0 = army.skill == null ? 0.6 : army.skill;
  const cap = Math.round((AI_PIECE_CAP + Math.min(120, army.kills || 0)) * (0.45 + skill0 * 0.75));
  if (mine.length > cap) {
    const takeNear = (list, kx, ky, n) => {
      const BUCKET = 16, buckets = [];
      for (const p of list) {
        const d = (Math.abs(p[0] - kx) + Math.abs(p[1] - ky)) / BUCKET | 0;
        (buckets[d] || (buckets[d] = [])).push(p);
      }
      const out = [];
      for (let i = 0; i < buckets.length && out.length < n; i++) {
        const b = buckets[i];
        if (!b) continue;
        for (const p of b) { out.push(p); if (out.length >= n) break; }
      }
      return out;
    };
    const half = Math.floor(cap / 2);
    const picked = [];
    const seen = /* @__PURE__ */ new Set();
    const push = (arr) => {
      for (const p of arr) {
        const k = p[0] * 4096 + p[1];
        if (seen.has(k)) continue;
        seen.add(k);
        picked.push(p);
      }
    };
    if (myKing0) push(takeNear(mine, myKing0[0], myKing0[1], half));
    if (nearestKp) push(takeNear(mine, nearestKp[0], nearestKp[1], cap - picked.length));
    if (picked.length < cap) push(mine.slice(0, cap - picked.length));
    mine = picked;
  }
  const handKinds = Object.keys(army.hand).length;
  // \u81EA\u9663\u306B\u5165\u3063\u3066\u304D\u305F\u6575\u3092\u8FCE\u3048\u6483\u3064\u624B\u3092\u5148\u306B\u63A2\u3059\u3002\u6575\u7389\u304C\u81EA\u9663\u306B\u5165\u3063\u3066\u3044\u308C\u3070\u3001\u305D\u308C\u3092\u72D9\u3046\u4F4D\u7F6E\u304C\u6700\u512A\u5148\u306B\u306A\u308B\u3002
  let snipe = null, dropSpots = null;
  if (handKinds) {
    // \u72D9\u3044\u306F\u300C\u81EA\u9663\u306B\u5165\u3063\u3066\u304D\u305F\u6575\u7389\u300D\u306B\u7D5E\u308B\u3002\u4FB5\u5165\u3057\u3066\u304D\u305F\u666E\u901A\u306E\u99D2\u3092\u72D9\u3046\u52A0\u70B9\u3082\u8A66\u3057\u305F\u304C\u3001
    // \u738B\u306E\u5B88\u308A\u3092\u56FA\u3081\u308B\u6253\u3061\u624B\u3092\u62BC\u3057\u306E\u3051\u3066\u3057\u307E\u3044\u3001\u5F37\u3055\u306B\u5DEE\u304C\u51FA\u306A\u304B\u3063\u305F\u3002
    const targets = aiIntruders(W, army, piecesByOwner, 5).filter((tg) => tg.king);
    if (targets.length) snipe = aiInterceptSpots(W.cells, army.zone.set, army.hand, army.facing, targets, 48);
    const extra = [];
    if (snipe) for (const e of snipe.values()) extra.push([e.x, e.y]);
    dropSpots = aiDropSpots(W.cells, army.zone.set, myKing0, nearestKp, extra);
  }
  const acts = allActions(W.cells, army.id, army.facing, army.hand, army.zone.set, mine, dropSpots);
  if (!acts.length) return null;
  const threat = buildThreat(W, army, piecesByOwner);
  const myKing = kings.get(army.id);
  const inCheck = myKing ? threat.has(K(myKing[0], myKing[1])) : false;
  const guardWant = Math.min(90, 12 + Math.floor((army.kills || 0) * 0.8));
  let guardCount = 0;
  if (myKing) {
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const p = W.cells.get(K(myKing[0] + dx, myKing[1] + dy));
      if (p && p.owner === army.id) guardCount++;
    }
  }
  const skill = army.skill == null ? 0.6 : army.skill;
  const noise = (1 - skill) * 120;
  // \u5019\u88DC\u624B\u304C\u89E6\u308C\u308B\u7BC4\u56F2\u3068\u91CD\u306A\u308B\u4ED6\u8ECD\u306E\u53EF\u52D5\u57DF\u3060\u3051\u3092\u5148\u306B\u7D5E\u3063\u3066\u304A\u304F(\u6210\u308A\u5224\u5B9A\u3067\u6BCE\u56DE\u5168\u8ECD\u3092\u898B\u306A\u3044)\u3002
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const a of acts) {
    if (a.tx < bx0) bx0 = a.tx;
    if (a.tx > bx1) bx1 = a.tx;
    if (a.ty < by0) by0 = a.ty;
    if (a.ty > by1) by1 = a.ty;
    if (a.kind === "move") {
      if (a.fx < bx0) bx0 = a.fx;
      if (a.fx > bx1) bx1 = a.fx;
      if (a.fy < by0) by0 = a.fy;
      if (a.fy > by1) by1 = a.fy;
    }
  }
  const nearZones = W.armies.filter((o) => o.alive && o.id !== army.id && o.zone && o.zone.set.x1 >= bx0 && o.zone.set.x0 <= bx1 && o.zone.set.y1 >= by0 && o.zone.set.y0 <= by1);
  let best = null, bestScore = -Infinity;
  for (const a of acts) {
    let s = Math.random() * (0.3 + noise);
    if (a.kind === "move") {
      const destK = K(a.tx, a.ty);
      const victim = W.cells.get(destK);
      const mover = W.cells.get(K(a.fx, a.fy));
      const canPr = PROMOTABLE[mover.t] && !mover.promoted && (!!victim || isInHostileZone(a.tx, a.ty, army.id, nearZones) || isInHostileZone(a.fx, a.fy, army.id, nearZones));
      if (victim && victim.t === "K") return { ...a, promote: canPr };
      if (victim) s += VAL[victim.t] * 10 + (victim.promoted ? 20 : 0);
      if (victim && myKing) {
        const dk = Math.max(Math.abs(a.tx - myKing[0]), Math.abs(a.ty - myKing[1]));
        if (dk <= 4) s += (inCheck ? 400 : 80) * (1 - dk / 5);
      }
      if (canPr) s += 4;
      if (nearestKp) {
        const d0 = Math.abs(a.fx - nearestKp[0]) + Math.abs(a.fy - nearestKp[1]);
        const d1 = Math.abs(a.tx - nearestKp[0]) + Math.abs(a.ty - nearestKp[1]);
        s += (d0 - d1) * (mover.t === "K" ? -0.8 : 1.2);
      }
      if (mover.t === "K") {
        if (threat.has(destK)) s -= 800;
        else if (inCheck) s += 40;
      } else if (threat.has(destK)) {
        s -= VAL[mover.t] * (victim ? 3 : 2);
      }
      a.promote = canPr;
    } else {
      const destK = K(a.tx, a.ty);
      if (nearestKp) {
        const d = Math.abs(a.tx - nearestKp[0]) + Math.abs(a.ty - nearestKp[1]);
        s += Math.max(0, 6 - d) * 1.2 - VAL[a.type] * 0.3;
      } else s -= 5;
      let dk = 99;
      if (myKing) {
        dk = Math.max(Math.abs(a.tx - myKing[0]), Math.abs(a.ty - myKing[1]));
        if (dk <= 3 && guardCount < guardWant) {
          s += (inCheck ? 120 : 30) * (1 - dk / 4) * (1 + (guardWant - guardCount) / guardWant);
        }
      }
      // 配置駒が足りないほど、持ち駒を打って立て直す手を高く評価する(自玉に近いほど優先)。
      if (boardDeficit > 0) s += boardDeficit * (50 + (dk <= 3 ? 30 * (1 - dk / 4) : 0));
      // 自玉の近くで、自玉より敵玉寄りのマスに打つ手(壁になる)を少し優先する。
      if (myKing && nearestKp && dk <= 5) {
        const dSpot = Math.abs(a.tx - nearestKp[0]) + Math.abs(a.ty - nearestKp[1]);
        const dKing = Math.abs(myKing[0] - nearestKp[0]) + Math.abs(myKing[1] - nearestKp[1]);
        if (dSpot < dKing) s += 6;
      }
      // \u6253\u3063\u305F\u77AC\u9593\u306B\u4FB5\u5165\u8005\u3084\u6575\u7389\u3092\u72D9\u3048\u308B\u4F4D\u7F6E\u306A\u3089\u5927\u304D\u304F\u52A0\u70B9(\u89D2\u3084\u98DB\u3067\u96E2\u308C\u305F\u4F4D\u7F6E\u304B\u3089\u72D9\u3046\u624B\u3092\u542B\u3080)
      if (snipe) {
        const e = snipe.get(destK);
        if (e) {
          const v = e.types.get(a.type);
          if (v) s += v;
        }
      }
      if (threat.has(destK)) s -= VAL[a.type] * 1.5;
      s += Math.min(4, (army.hand[a.type] || 1) - 1) * 1.5;
    }
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}
function applyAction(W, army, a) {
  if (a.kind === "drop") {
    army.hand[a.type]--;
    if (army.hand[a.type] <= 0) delete army.hand[a.type];
    W.cells.set(K(a.tx, a.ty), { t: a.type, promoted: false, owner: army.id });
    return null;
  }
  const mover = W.cells.get(K(a.fx, a.fy));
  if (!mover || mover.owner !== army.id) return null;
  const victim = W.cells.get(K(a.tx, a.ty));
  W.cells.delete(K(a.fx, a.fy));
  if (victim && victim.t !== "K") {
    army.hand[victim.t] = (army.hand[victim.t] || 0) + 1;
  }
  if (a.promote) mover.promoted = true;
  W.cells.set(K(a.tx, a.ty), mover);
  if (mover.t === "K") army.kingKey = K(a.tx, a.ty);
  return victim;
}
const LOOT_KINDS = ["P", "P", "P", "P", "L", "N", "S", "G", "B", "R"];
function scatterLoot(cells, armies, neutralId, count) {
  let placed = 0;
  for (let attempt = 0; attempt < count * 14 && placed < count; attempt++) {
    const x = 2 + Math.floor(Math.random() * (MAP_W - 4));
    const y = 2 + Math.floor(Math.random() * (MAP_H - 4));
    const k = K(x, y);
    if (cells.has(k)) continue;
    let tooClose = false;
    for (const a of armies) {
      if (!a.alive) continue;
      if (Math.abs(x - a.center[0]) <= 10 && Math.abs(y - a.center[1]) <= 10) { tooClose = true; break; }
    }
    if (tooClose) continue;
    cells.set(k, { t: LOOT_KINDS[Math.floor(Math.random() * LOOT_KINDS.length)], promoted: false, owner: neutralId });
    placed++;
  }
  return placed;
}
const INIT_TIERS = [
  [30, 1, 8],
  [24, 9, 22],
  [5, 23, 38],
  [1, 39, 60]
];
function seedInitialProgress(W, skipId) {
  const TYPES = ["P", "P", "P", "L", "N", "S", "G", "B", "R"];
  const pool = W.armies.filter((a) => a.alive && a.id !== skipId);
  const taken = [];
  const assign = [];
  for (let t = INIT_TIERS.length - 1; t >= 0; t--) {
    const [count, lo, hi] = INIT_TIERS[t];
    for (let n = 0; n < count; n++) {
      const kills = lo + Math.floor(Math.random() * (hi - lo + 1));
      const r = Math.min(4 + kills, ZONE_R_MAX);
      let best = null, bestScore = -1;
      for (const a of pool) {
        if (a.__seeded) continue;
        const cx = a.center[0], cy = a.center[1];
        if (cx - r < 0 || cy - r < 0 || cx + r > MAP_W - 1 || cy + r > MAP_H - 1) continue;
        let near = Infinity;
        for (const o of taken) {
          const d = Math.abs(cx - o.center[0]) + Math.abs(cy - o.center[1]);
          if (d < near) near = d;
        }
        const score = taken.length ? near : Math.random();
        if (score > bestScore) { bestScore = score; best = a; }
      }
      if (!best) break;
      best.__seeded = true;
      taken.push(best);
      assign.push([best, kills]);
    }
  }
  for (const [a, kills] of assign) {
    delete a.__seeded;
    a.kills = kills;
    if (kills > 0) a.skill = Math.max(a.skill || 0, Math.min(0.98, 0.5 + kills * 0.012));
    refreshZone(a);
    const r = a.zone.r;
    const cx = a.center[0], cy = a.center[1];
    const extra = Math.round(kills * 30);
    const guardN = Math.round(extra * 0.25);
    let placed = 0;
    for (let d = 1; d <= r && placed < guardN; d++) {
      for (let dx = -d; dx <= d && placed < guardN; dx++) {
        for (let dy = -d; dy <= d && placed < guardN; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== d) continue;
          const x = cx + dx, y = cy + dy;
          if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
          const k = K(x, y);
          if (W.cells.has(k)) continue;
          const t = TYPES[Math.floor(Math.random() * TYPES.length)];
          W.cells.set(k, { t, promoted: !!PROMOTABLE[t] && Math.random() < 0.3, owner: a.id });
          placed++;
        }
      }
    }
    for (let n = 0; n < extra * 30 && placed < extra; n++) {
      const x = cx - r + Math.floor(Math.random() * (2 * r + 1));
      const y = cy - r + Math.floor(Math.random() * (2 * r + 1));
      if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) continue;
      const k = K(x, y);
      if (W.cells.has(k)) continue;
      const t = TYPES[Math.floor(Math.random() * TYPES.length)];
      W.cells.set(k, { t, promoted: !!PROMOTABLE[t] && Math.random() < 0.3, owner: a.id });
      placed++;
    }
    const handTotal = Math.round(kills * 6);
    for (let n = 0; n < handTotal; n++) {
      const t = TYPES[Math.floor(Math.random() * TYPES.length)];
      a.hand[t] = (a.hand[t] || 0) + 1;
    }
  }
}
function newWorld(mode, playerName, netOpts) {
  const total = CAP;
  const cells = /* @__PURE__ */ new Map();
  const names = generateNames(total);
  const cols = Math.ceil(Math.sqrt(total));
  const cell = Math.floor(Math.min(MAP_W, MAP_H) / cols);
  const jitterMax = Math.max(0, Math.floor(cell / 2) - 11);
  const slots = [];
  for (let r = 0; r < cols; r++) for (let c = 0; c < cols; c++) slots.push([c, r]);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const armies = [];
  for (let id = 0; id < total; id++) {
    const [c, r] = slots[id];
    const jx = Math.floor((Math.random() * 2 - 1) * jitterMax);
    const jy = Math.floor((Math.random() * 2 - 1) * jitterMax);
    const center = [
      Math.max(10, Math.min(MAP_W - 11, Math.floor((c + 0.5) * cell) + jx)),
      Math.max(10, Math.min(MAP_H - 11, Math.floor((r + 0.5) * cell) + jy))
    ];
    const facing = Math.floor(Math.random() * 4);
    placeArmyCentered(cells, id, center, facing);
    const isPlayerSlot = id === 0 && mode === "play";
    armies.push({
      id,
      facing,
      alive: true,
      hand: {},
      target: null,
      marchRel: null,
      lastMove: 0,
      lastAction: 0,
      center,
      zone: null,
      kills: 0,
      skill: makeSkill(),
      name: isPlayerSlot ? playerName ? playerName + "(\u3042\u306A\u305F)" : names[0] + "(\u3042\u306A\u305F)" : names[id],
      color: isPlayerSlot ? PLAYER_COLOR : makeColor(id),
      flankBias: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.floor(Math.random() * 5)),
      kingKey: K(center[0], center[1])
    });
  }
  for (const a of armies) refreshZone(a);
  let neutralId = null;
  let lootTarget = 0;
  if (mode !== "openworld") {
    seedInitialProgress({ cells, armies }, mode === "play" ? 0 : -1);
    neutralId = armies.length;
    armies.push({
      id: neutralId,
      facing: 0,
      alive: false,
      neutral: true,
      hand: {},
      target: null,
      marchRel: null,
      lastMove: 0,
      lastAction: 0,
      center: [Math.floor(MAP_W / 2), Math.floor(MAP_H / 2)],
      zone: null,
      kills: 0,
      name: "\u6B8B\u9AB8",
      color: { fill: "#9A9384", edge: "#2b2721", text: "#1d1a15", prom: "#C08A3E", zone: "rgba(0,0,0,0)", zoneEdge: "rgba(0,0,0,0)", chip: "#9A9384" },
      flankBias: 0
    });
    lootTarget = Math.floor(MAP_W * MAP_H * 0.017);
    scatterLoot(cells, armies, neutralId, lootTarget);
    if (mode === "play") {
      // \u30D7\u30EC\u30A4\u30E4\u30FC\u306E\u8ECD\u3060\u3051\u306F\u683C\u5B50\u72B6\u306E\u521D\u671F\u914D\u7F6E\u306E\u307E\u307E\u3060\u3068\u3001\u5927\u8ECD\u306E\u53EF\u52D5\u57DF\u306E\u4E2D\u3084
      // \u6575\u99D2\u306E\u771F\u96A3\u306B\u7F6E\u304B\u308C\u308B\u3053\u3068\u304C\u3042\u308A\u3001\u958B\u59CB\u76F4\u5F8C\u306E\u4E00\u6589\u9032\u8ECD\u3067\u8E0F\u307F\u6F70\u3055\u308C\u3066\u3044\u305F\u3002
      // \u9014\u4E2D\u53C2\u6226\u3068\u540C\u3058\u57FA\u6E96(\u4ED6\u8ECD\u306E\u53EF\u52D5\u57DF\u304B\u3089\u96E2\u308C\u305F\u5834\u6240)\u3078\u79FB\u3057\u76F4\u3059\u3002
      const W0 = { cells, armies };
      const pf = armies[0].facing;
      const spot = findSpawnSpot(W0, pf);
      if (spot) relocateArmy(W0, armies[0], spot, pf);
    }
  }
  return {
    mode,
    playerId: mode === "play" ? 0 : null,
    cells,
    armies,
    neutralId,
    lootTarget,
    lastLootSpawn: 0,
    focusId: 0,
    banner: null,
    msg: mode === "play" ? "\u5341\u5B57\u30AD\u30FC\u3067\u9032\u8ECD\u3001\u99D2\u30BF\u30C3\u30D7\u3067\u500B\u5225\u79FB\u52D5" : "\u89B3\u6226\u30E2\u30FC\u30C9: \u30BF\u30C3\u30D7\u3067\u8ECD\u306B\u30D5\u30A9\u30FC\u30AB\u30B9",
    sel: null,
    handSel: null,
    dropSpots: null,
    promo: null,
    over: false,
    myDefeated: false,
    winner: null,
    winnerName: "",
    reason: "",
    lastSpawnCheck: 0,
    marchAnchor: 0,
    lastMarchTick: 0,
    speckles: Array.from({ length: 1400 }, () => [Math.random() * MAP_W, Math.random() * MAP_H, Math.random() * 1.2 + 0.3])
  };
}
const SERIF = '"Shippori Mincho B1","Hiragino Mincho ProN","Yu Mincho","Noto Serif JP",serif';
const ENFONT = '"Playfair Display","Georgia",serif';
const KOMAFONT = '"Yuji Syuku","Shippori Mincho B1","Hiragino Mincho ProN",serif';
// \u753B\u50CF\u304C\u5C4A\u304F\u307E\u3067\u306E\u9593\u3082\u6728\u76EE\u3068\u307B\u307C\u540C\u3058\u6FC3\u3044\u8336\u8272\u306B\u898B\u3048\u308B\u3088\u3046\u3001\u6700\u5F8C\u306E url \u306B\u4E0B\u5730\u8272\u3092\u6DFB\u3048\u308B\u3002
// (\u4EE5\u524D\u306F\u660E\u308B\u3044\u8336\u8272\u304B\u3089\u6FC3\u3044\u8336\u8272\u3078\u5207\u308A\u66FF\u308F\u308B\u77AC\u9593\u304C\u898B\u3048\u3066\u3044\u305F)
const WOOD_BASE = "#1a0906";
const WOOD_GRAIN = `linear-gradient(rgba(20,10,4,0.12), rgba(20,10,4,0.12)), url('/wood-grain.jpeg') ${WOOD_BASE}`;
const C = {
  field: "#10140F",
  panel: WOOD_GRAIN,
  panelEdge: "#B08C4F",
  text: "#EAE4D0",
  sub: "#C9B896",
  gold: "#E3C27E",
  danger: "#E8604C",
  move: "rgba(159,208,138,0.85)",
  cap: "rgba(232,96,76,0.9)",
  selGlow: "#FFD866",
  board: "#EAD9A8",
  boardEdge: "#8B6F3E"
};
const OWS_SERVER_URL = "wss://ows-server-zibw.onrender.com";
function applyOpenWorldState(W, s, myArmyId) {
  const t = now();
  const prevMine = myArmyId != null ? (W.armies || []).find((a) => a.id === myArmyId) : null;
  const prevCenter = prevMine ? prevMine.center : null;
  W.cells = new Map((s.cells || []).map(([k, ty, pr, o]) => [k, { t: ty, promoted: !!pr, owner: o }]));
  W.armies = (s.armies || []).map((sa) => ({
    id: sa.id, facing: sa.facing, alive: sa.alive, hand: sa.hand || {}, target: sa.target || null, marchRel: sa.marchRel || null,
    center: sa.center, kills: sa.kills || 0, flankBias: sa.flankBias || 0, human: true, name: sa.name, speedMult: sa.speedMult || 1,
    lastMove: t - (MOVE_COOLDOWN - (sa.cd || 0)), lastAction: t - (MOVE_COOLDOWN - (sa.cd || 0)),
    zone: null, color: sa.id === myArmyId ? PLAYER_COLOR : makeColor(sa.id),
  }));
  for (const a of W.armies) refreshZone(a);
  const newMine = myArmyId != null ? W.armies.find((a) => a.id === myArmyId) : null;
  const newCenter = newMine ? newMine.center : null;
  if (prevCenter && newCenter) {
    const dx = newCenter[0] - prevCenter[0], dy = newCenter[1] - prevCenter[1];
    if (dx || dy) {
      const zoneSet = newMine.zone ? newMine.zone.set : new Set();
      if (W.sel) {
        const nx = W.sel.x + dx, ny = W.sel.y + dy;
        const p = W.cells.get(K(nx, ny));
        if (p && p.owner === myArmyId) {
          W.sel = { x: nx, y: ny, moves: legalMovesFrom(W.cells, nx, ny, newMine.facing, zoneSet) };
        } else {
          W.sel = null;
        }
      }
      if (W.dropSpots && W.handSel) {
        W.dropSpots = dropTargets(W.cells, zoneSet);
      }
    }
  }
  W.marchAnchor = s.marchAnchor || t;
  W.lastMarchTick = s.lastMarchTick || 0;
  W.cap = s.cap || CAP;
  W.playerId = myArmyId;
}
function newOpenWorld(myArmyId) {
  return {
    mode: "openworld", playerId: myArmyId, cells: /* @__PURE__ */ new Map(), armies: [],
    focusId: myArmyId, banner: null, msg: "オープンワールド: 王を守れ",
    sel: null, handSel: null, dropSpots: null, promo: null,
    over: false, myDefeated: false, winner: null, winnerName: "", reason: "",
    lastSpawnCheck: now(), marchAnchor: now(), lastMarchTick: 0, cap: CAP,
    speckles: Array.from({ length: 1400 }, () => [Math.random() * MAP_W, Math.random() * MAP_H, Math.random() * 1.2 + 0.3]),
  };
}

function updateWorld(W2) {
  const t = now();
  let kings = buildKingIndex(W2.cells, W2.armies);
  for (const a of W2.armies) {
    if (!a.alive) continue;
    refreshZone(a);
    if (!kings.has(a.id)) handleDefeat(W2, a);
  }
  if (W2.over) return;
  if (W2.neutralId != null && t - W2.lastLootSpawn >= LOOT_RESPAWN_MS) {
    W2.lastLootSpawn = t;
    let cur = 0;
    for (const [, p] of W2.cells) if (p.owner === W2.neutralId) cur++;
    const want = Math.min(LOOT_RESPAWN_BATCH, (W2.lootTarget || 0) - cur);
    if (want > 0) scatterLoot(W2.cells, W2.armies, W2.neutralId, want);
  }
  if (!W2.noAI && t - W2.lastSpawnCheck >= SPAWN_CHECK_INTERVAL) {
    W2.lastSpawnCheck = t;
    const deficit = CAP - aliveCount(W2);
    const toSpawn = Math.min(Math.max(deficit, 0), 6);
    let lastSpawned = null;
    let onBoardCache = null;
    if (toSpawn > 0) {
      onBoardCache = /* @__PURE__ */ new Set();
      for (const p of W2.cells.values()) onBoardCache.add(p.owner);
    }
    for (let i = 0; i < toSpawn; i++) {
      const a = spawnNewArmy(W2, onBoardCache);
      if (!a) break;
      kings.set(a.id, a.center);
      lastSpawned = a;
    }
    if (lastSpawned) {
      W2.msg = `\u65B0\u624B: ${lastSpawned.name} \u304C\u53C2\u6226!(\u6B8B\u5B58${aliveCount(W2)}/${CAP}\u8ECD)`;
    }
  }
  const uTick = Math.floor((t - W2.marchAnchor) / MARCH_TICK_UNIT);
  const prevU = W2.lastUTick || 0;
  if (uTick > prevU) {
    W2.lastUTick = uTick;
    // \u524D\u56DE\u51E6\u7406\u3057\u305F\u6642\u70B9\u304B\u3089\u300C\u533A\u5207\u308A\u3092\u307E\u305F\u3044\u3060\u304B\u300D\u3067\u5224\u5B9A\u3059\u308B\u3002\u30D5\u30EC\u30FC\u30E0\u304C\u8A70\u307E\u3063\u3066\u5358\u4F4D\u6642\u9593\u3092\u98DB\u3070\u3057\u3066\u3082
    // 15\u79D2\u306E\u4E00\u6589\u9032\u8ECD\u3092\u53D6\u308A\u3053\u307C\u3055\u305A\u3001\u9045\u308C\u3092\u53D6\u308A\u623B\u3059\u305F\u3081\u306E\u9023\u7D9A\u9032\u8ECD\u3082\u3057\u306A\u3044\u3002
    const crossed = (div) => Math.floor(uTick / div) > Math.floor(prevU / div);
    const isFullTick = crossed(16);
    // \u7B49\u500D\u306F16\u5358\u4F4D(15\u79D2)\u30014\u500D\u901F\u306F4\u5358\u4F4D(3.75\u79D2)\u300116\u500D\u901F\u306F\u6BCE\u5358\u4F4D(0.9375\u79D2)\u3054\u3068\u306B\u9032\u8ECD\u3002
    // \u5168\u8ECD\u304C\u540C\u3058marchAnchor\u57FA\u6E96\u306A\u306E\u3067\u3001\u4F55\u500D\u901F\u3067\u3082\u5FC5\u305A15\u79D2\u7D44\u3068\u6B69\u8ABF\u304C\u5408\u3046\u3002
    const due = W2.armies.filter((a) => a.alive && crossed(16 / (a.speedMult || 1)));
    if (due.length) {
      const byOwner = new Map(due.map((a) => [a.id, []]));
      for (const [k, p] of W2.cells) {
        const list = byOwner.get(p.owner);
        if (!list) continue;
        const ci = k.indexOf(",");
        list.push([+k.slice(0, ci), +k.slice(ci + 1)]);
      }
      if (isFullTick && W2.mode !== "openworld") {
        // AI\u306E\u500D\u901F\u5224\u65AD(15\u79D2\u3054\u3068)\u3002\u5404\u8ECD\u306E\u914D\u7F6E\u99D2\u306E\u6570\u306F\u3001\u76F4\u524D\u306B\u9032\u8ECD\u7528\u306B\u96C6\u3081\u305F\u99D2\u30EA\u30B9\u30C8\u304B\u3089\u6C42\u3081\u308B\u3002
        // \u4EE5\u524D\u306F\u8ECD\u3054\u3068\u306B\u76E4\u9762\u5168\u4F53\u3092\u6570\u3048\u76F4\u3057\u3066\u304A\u308A(\u7D04200\u8ECD\u00D7\u6570\u4E07\u30DE\u30B9)\u300115\u79D2\u3054\u3068\u306B\u5927\u304D\u304F\u56FA\u307E\u3063\u3066\u3044\u305F\u3002
        for (const a of W2.armies) {
          if (!a.alive || a.neutral || a.human || a.id === W2.playerId) continue;
          const list = byOwner.get(a.id);
          const ownCount = list ? Math.max(0, list.length - 1) : 0; // \u738B\u306E\u5206\u3092\u5F15\u304F
          let dNear = Infinity;
          for (const [oid, okp] of kings) {
            if (oid === a.id) continue;
            const oa2 = W2.armies[oid];
            if (!oa2 || !oa2.alive) continue;
            const d = Math.max(Math.abs(okp[0] - a.center[0]), Math.abs(okp[1] - a.center[1]));
            if (d < dNear) dNear = d;
          }
          const nearKing = dNear <= 100;
          if (dNear <= 35 && ownCount >= 20 && Math.random() < 0.3) a.speedMult = 16;
          else if (nearKing && ownCount >= 8 && Math.random() < 0.3) a.speedMult = 4;
          else if ((a.speedMult || 1) !== 1 && (!nearKing || ownCount < 5 || Math.random() < 0.25)) a.speedMult = 1;
        }
      }
      // \u6B8B\u9AB8\u306E\u4F4D\u7F6E\u7D22\u5F15\u306F\u3001\u6B8B\u9AB8\u3092\u63A2\u3059\u8ECD\u304C\u3044\u305F\u3068\u304D\u3060\u3051\u4F5C\u308B(\u6575\u7389\u3092\u8FFD\u3063\u3066\u3044\u308B\u8ECD\u3070\u304B\u308A\u306A\u3089\u4E0D\u8981)\u3002
      let lootGrid = null;
      const getLootGrid = () => lootGrid || (lootGrid = buildLootGrid(W2));
      const movers = [];
      for (const a of due) {
        const mine = byOwner.get(a.id) || [];
        // \u914D\u7F6E\u99D2\u304C\u738B\u3060\u3051\u306B\u306A\u3063\u305F\u8ECD\u306F\u500D\u901F\u3067\u304D\u306A\u3044\u3002\u500D\u901F\u3076\u3093\u306E\u4E00\u6B69\u306F\u53D6\u308A\u6D88\u3057\u3066\u901A\u5E38\u306E\u6B69\u8ABF\u306B\u623B\u3059\u3002
        if ((a.speedMult || 1) > 1 && mine.length <= 1) {
          a.speedMult = 1;
          if (!isFullTick) continue;
        }
        const d = marchDirFor(W2, a, kings, mine, getLootGrid);
        if (d) movers.push({ army: a, dx: d[0], dy: d[1] });
        else if ((a.speedMult || 1) > 1) a.speedMult = 1; // \u9032\u8ECD\u3057\u3066\u3044\u306A\u3044\u8ECD\u306F\u500D\u901F\u3092\u7DAD\u6301\u3057\u306A\u3044
      }
      if (movers.length) {
        const myMover = W2.playerId != null ? movers.find((m) => m.army.id === W2.playerId) : null;
        const ev = resolveSimultaneousMarch(W2, movers, byOwner);
        if (ev.collisions.length) {
          const c = ev.collisions[0];
          W2.msg = `\u6FC0\u7A81! ${c.loser.name}\u306E${kanjiOf(c.piece, W2.playerId)}\u304C\u8E0F\u307F\u8CA0\u3051\u305F(\u885D\u7A81${ev.collisions.length}\u4EF6)`;
        } else if (ev.trampledTotal) {
          W2.msg = `\u9032\u8ECD\u3067${ev.trampledTotal}\u679A\u304C\u8E0F\u307F\u6F70\u3055\u308C\u305F`;
        }
        for (const kk of ev.kingsKilled) handleDefeat(W2, W2.armies.find((x) => x.id === kk.id), W2.armies[kk.by] || null);
        if (W2.over) return;
        kings = buildKingIndex(W2.cells, W2.armies);
        if (myMover) {
          const dx = myMover.dx, dy = myMover.dy;
          const mine = W2.armies.find((a) => a.id === W2.playerId);
          const zoneSet = mine && mine.zone ? mine.zone.set : new Set();
          if (W2.sel) {
            const nx = W2.sel.x + dx, ny = W2.sel.y + dy;
            const p = W2.cells.get(K(nx, ny));
            if (p && p.owner === W2.playerId) {
              W2.sel = { x: nx, y: ny, moves: legalMovesFrom(W2.cells, nx, ny, mine.facing, zoneSet) };
            } else {
              W2.sel = null;
            }
          }
          if (W2.dropSpots && W2.handSel) {
            W2.dropSpots = dropTargets(W2.cells, zoneSet);
          }
        }
      }
    }
  }
  if (!W2.over) {
    // \u500D\u901F\u4E2D\u306E\u8ECD\u306F\u3001\u914D\u7F6E\u3057\u3066\u3044\u308B\u99D2(\u738B\u4EE5\u5916)\u306E\u6570\u30920.9\u500D(\u5C0F\u6570\u5207\u308A\u6368\u3066)\u306B\u6E1B\u3089\u3059\u3002
    // 4\u500D\u901F\u306F10\u79D2\u3054\u3068\u300116\u500D\u901F\u306F1\u79D2\u3054\u3068\u3002\u6E1B\u3063\u305F\u99D2\u306F\u76E4\u304B\u3089\u6D88\u3048\u308B(\u6B8B\u9AB8\u306B\u3059\u308B\u3068\u81EA\u8ECD\u304C\u3059\u3050\u8E0F\u3093\u3067\u6301\u3061\u99D2\u306B\u56DE\u53CE\u3067\u304D\u3066\u3057\u307E\u3046)\u3002
    let dueDecay = null;
    for (const a of W2.armies) {
      const m = a.speedMult || 1;
      if (!a.alive || m <= 1) continue;
      const interval = m >= 16 ? 1000 : 10000;
      const pending = a.decayNext || 0;
      if (a.decayMult !== m || pending <= t - interval) {
        // \u500D\u7387\u3092\u5909\u3048\u305F/\u3057\u3070\u3089\u304F\u7B49\u500D\u3060\u3063\u305F \u2192 1\u9593\u9694\u3076\u3093\u5F85\u3063\u3066\u304B\u3089\u6E1B\u3089\u3057\u59CB\u3081\u308B(\u9045\u308C\u3092\u53D6\u308A\u623B\u3059\u9023\u7D9A\u6E1B\u8870\u306F\u3057\u306A\u3044)\u3002
        // \u305F\u3060\u3057\u9593\u3082\u306A\u304F\u6765\u308B\u4E88\u5B9A\u304C\u65E2\u306B\u3042\u308C\u3070\u305D\u3061\u3089\u3092\u512A\u5148\u3059\u308B(\u7D30\u304B\u304F\u5207\u308A\u66FF\u3048\u3066\u6E1B\u8870\u3092\u9003\u308C\u308B\u6297\u3051\u9053\u3092\u585E\u3050)\u3002
        const next = t + interval;
        a.decayNext = pending > t && pending < next ? pending : next;
        a.decayMult = m;
        continue;
      }
      if (t < pending) continue;
      a.decayNext = t + interval;
      (dueDecay || (dueDecay = /* @__PURE__ */ new Set())).add(a.id);
    }
    if (dueDecay) {
      // \u6E1B\u8870\u3055\u305B\u308B\u8ECD\u306E\u99D2\u3092\u76E4\u97621\u56DE\u306E\u8D70\u67FB\u3067\u307E\u3068\u3081\u3066\u96C6\u3081\u308B(\u4EE5\u524D\u306F\u8ECD\u3054\u3068\u306B\u76E4\u9762\u5168\u4F53\u3092\u8D70\u67FB\u3057\u3066\u3044\u305F)\u3002
      const keysOf = /* @__PURE__ */ new Map();
      for (const [k, p] of W2.cells) {
        if (p.t === "K" || !dueDecay.has(p.owner)) continue;
        let list = keysOf.get(p.owner);
        if (!list) keysOf.set(p.owner, list = []);
        list.push(k);
      }
      for (const id of dueDecay) {
        const a = W2.armies[id];
        const keys = keysOf.get(id) || [];
        const n = keys.length;
        const remove = n - Math.floor(n * 0.9);
        for (let i = 0; i < remove; i++) {
          const j = i + Math.floor(Math.random() * (n - i));
          const tmp = keys[i]; keys[i] = keys[j]; keys[j] = tmp;
          W2.cells.delete(keys[i]);
        }
        const left = n - remove;
        if (left <= 0) {
          a.speedMult = 1;
        } else if (!a.human && id !== W2.playerId) {
          // AI\u306F\u99D2\u304C\u6E1B\u3063\u3066\u304D\u305F\u3089\u81EA\u5206\u3067\u901F\u5EA6\u3092\u843D\u3068\u3059(\u738B\u3060\u3051\u306B\u306A\u308B\u307E\u3067\u7206\u8D70\u3057\u306A\u3044)
          if (a.speedMult >= 16 && left < 12) a.speedMult = 4;
          else if (a.speedMult === 4 && left < 5) a.speedMult = 1;
        }
        if (id === W2.playerId) {
          W2.msg = left <= 0 ? "\u914D\u7F6E\u99D2\u304C\u5C3D\u304D\u305F\u306E\u3067\u7B49\u500D\u306B\u623B\u3063\u305F" : `\u500D\u901F\u3067\u914D\u7F6E\u99D2\u3092${remove}\u679A\u5931\u3063\u305F(\u6B8B\u308A${left}\u679A)`;
          if (W2.sel && !W2.cells.has(K(W2.sel.x, W2.sel.y))) W2.sel = null;
        }
      }
    }
  }
  if (W2.noAI) return;
  const aiDue = [];
  for (const a of W2.armies) {
    if (a.id === W2.playerId || a.human || !a.alive) continue;
    if (t - a.lastMove >= MOVE_COOLDOWN) aiDue.push(a);
  }
  const aiBudget = Math.min(24, Math.round(AI_PER_FRAME * owsTimeScale));
  if (aiDue.length > aiBudget) aiDue.sort((x, y) => x.lastMove - y.lastMove);
  const dueThisFrame = aiDue.slice(0, aiBudget);
  let piecesByOwner = null;
  if (dueThisFrame.length) {
    const need = /* @__PURE__ */ new Set();
    for (const a of dueThisFrame) {
      need.add(a.id);
      const zr = (a.zone ? a.zone.r : 0) + 2;
      const MARGIN = 6;
      for (const oa of W2.armies) {
        if (oa.id === a.id || !oa.alive || !oa.zone) continue;
        const reach = zr + oa.zone.r + MARGIN;
        if (Math.abs(oa.center[0] - a.center[0]) > reach || Math.abs(oa.center[1] - a.center[1]) > reach) continue;
        need.add(oa.id);
      }
    }
    piecesByOwner = /* @__PURE__ */ new Map();
    for (const [k, p] of W2.cells) {
      if (!need.has(p.owner)) continue;
      let list = piecesByOwner.get(p.owner);
      if (!list) {
        list = [];
        piecesByOwner.set(p.owner, list);
      }
      const ci = k.indexOf(",");
      list.push([+k.slice(0, ci), +k.slice(ci + 1)]);
    }
  }
  const frameStart = Date.now();
  const FRAME_BUDGET_MS = 8;
  let processed = 0;
  for (const a of dueThisFrame) {
    if (processed > 0 && Date.now() - frameStart > FRAME_BUDGET_MS) break;
    processed++;
    try {
      a.lastMove = t;
      const rot = aiWantRotation(W2, a, kings);
      if (rot !== 0 && Math.random() < 0.7) {
        a.facing = (a.facing + (rot > 0 ? 1 : 3)) % 4;
        a.lastAction = t;
      } else {
        const act = aiPickAction(W2, a, kings, piecesByOwner);
        if (act) {
          const victim = applyAction(W2, a, act);
          a.lastAction = t;
          if (victim && victim.t === "K") {
            const dead = W2.armies.find((x) => x.id === victim.owner);
            addKillGrowth(a, dead ? dead.kills || 0 : 0);
            handleDefeat(W2, dead, a);
          }
        }
      }
    } catch (err) {
      console.error("AI army error", a.id, err);
    }
    if (W2.over) return;
  }
}

// ---- ここから下はサーバー専用(クライアントのUI処理の代わり) ----
function handleDefeat(W, army) {
  if (!army || !army.alive) return;
  army.alive = false;
}
function aliveCount(W) {
  return W.armies.filter((a) => a.alive).length;
}
function banner() {}
function bump() {}
// 人が操作する軍だけの、AIのいない世界を作る
function newServerWorld() {
  return {
    mode: "server", noAI: true, playerId: null,
    cells: new Map(), armies: [],
    neutralId: null, lootTarget: 0, lastLootSpawn: 0,
    marchAnchor: now() - MARCH_INTERVAL, lastUTick: 0, lastMarchTick: 0,
    lastSpawnCheck: now(), over: false, msg: "",
  };
}
// クライアントから届いた操作を反映する
function applyGuestAction(W, army, action) {
  if (!army || !army.alive) return;
  const t = now();
  if ((action.type === "move" || action.type === "drop" || action.type === "rotate") && t - army.lastMove < MOVE_COOLDOWN) return;
  if (action.type === "move") {
    const v = applyAction(W, army, { kind: "move", fx: action.fx, fy: action.fy, tx: action.tx, ty: action.ty, promote: !!action.promote });
    army.lastMove = t;
    army.lastAction = t;
    if (v && v.t === "K") {
      const dead = W.armies.find((x) => x.id === v.owner);
      addKillGrowth(army, dead ? dead.kills || 0 : 0);
      handleDefeat(W, dead);
    }
  } else if (action.type === "drop") {
    if (!army.hand[action.dropType]) return;
    const zoneSet = army.zone ? army.zone.set : null;
    if (!zoneSet || !zoneSet.has(K(action.tx, action.ty)) || W.cells.has(K(action.tx, action.ty))) return;
    applyAction(W, army, { kind: "drop", type: action.dropType, tx: action.tx, ty: action.ty });
    army.lastMove = t;
    army.lastAction = t;
  } else if (action.type === "rotate") {
    army.facing = (army.facing + (action.dir > 0 ? 1 : 3)) % 4;
    army.lastMove = t;
    army.lastAction = t;
  } else if (action.type === "target") {
    army.target = [action.tx, action.ty];
  } else if (action.type === "targetRel") {
    // 絶対座標はここで持たず、相対方向の意図だけ保存する(実際の向きは進軍時に毎回facingから計算する)
    army.marchRel = action.rel;
  } else if (action.type === "stopTarget") {
    army.marchRel = null;
    army.target = null;
    army.speedMult = 1; // 進軍を止めたら倍速も解除(クライアントと同じ扱い)
  } else if (action.type === "speed") {
    const m = action.mult === 4 ? 4 : action.mult === 16 ? 16 : 1;
    if (m > 1) {
      if (!army.marchRel) return;              // 停止中は倍速にできない
      let n = 0;
      for (const p of W.cells.values()) if (p.owner === army.id && p.t !== "K") n++;
      if (n <= 0) return;                      // 配置駒がないと倍速にできない
    }
    army.speedMult = m;
  }
}
module.exports = {
  MAP_W, MAP_H, MOVE_COOLDOWN, MARCH_INTERVAL, CAP, NAME_MAX_LEN, K, now,
  newServerWorld, spawnNewArmy, applyGuestAction, updateWorld, handleDefeat,
  aliveCount, buildKingIndex, refreshZone, filterProfanity,
};
