const MAP_W = 480, MAP_H = 480;
const ZONE_R_BASE = 4;
const MOVE_COOLDOWN = 5e3;
const MARCH_INTERVAL = 15e3;
const AI_PER_FRAME = 4;
const SPAWN_CHECK_INTERVAL = 8e3;
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
const now = () => Date.now();
function zoneRadiusFor(army) {
  return ZONE_R_BASE + (army.kills || 0);
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
const kanjiOf = (p, playerId) => p.t === "K" ? p.owner === playerId ? "\u7389" : "\u738B" : p.promoted ? PKANJI[p.t] : KANJI[p.t];
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
    const name = pickName();
    if (used.has(name)) continue;
    used.add(name);
    out.push(name);
  }
  return out;
}
function generateOneName(existingNames) {
  let name;
  do {
    name = pickName();
  } while (existingNames.has(name));
  return name;
}
const CHAT_LINES = {
  join: ["{A} has entered the battlefield!", "{A} rejoint la bataille !", "\xA1{A} se une a la batalla!", "{A} betritt das Schlachtfeld!", "{A} \u304C\u53C2\u6226\u3057\u305F!", "{A} \u0432\u0441\u0442\u0443\u043F\u0430\u0435\u0442 \u0432 \u0431\u043E\u0439!", "\u0627\u0646\u0636\u0645 {A} \u0625\u0644\u0649 \u0627\u0644\u0645\u0639\u0631\u0643\u0629!"],
  defeat: ["{A} has fallen...", "{A} est tomb\xE9...", "{A} ha ca\xEDdo...", "{A} ist gefallen...", "{A} \u304C\u58CA\u6EC5\u3057\u305F...", "{A} \u043F\u0430\u043B...", "\u0633\u0642\u0637 {A}..."],
  kill: ["{A} struck down {B}'s king!", "{A} a abattu le roi de {B} !", "\xA1{A} derrib\xF3 al rey de {B}!", "{A} hat {B}s K\xF6nig gest\xFCrzt!", "{A} \u304C {B} \u306E\u738B\u3092\u8A0E\u3063\u305F!", "{A} \u0441\u0440\u0430\u0437\u0438\u043B \u043A\u043E\u0440\u043E\u043B\u044F {B}!", "{A} \u0623\u0633\u0642\u0637 \u0645\u0644\u0643 {B}!"],
  banter: ["Hold the line!", "Tenez la ligne !", "\xA1Mantened la l\xEDnea!", "Haltet die Stellung!", "\u6301\u3061\u3053\u305F\u3048\u308D!", "\u0414\u0435\u0440\u0436\u0438\u043C \u0441\u0442\u0440\u043E\u0439!", "\u062D\u0627\u0641\u0638\u0648\u0627 \u0639\u0644\u0649 \u0627\u0644\u062E\u0637!", "Victory will be ours.", "La victoire sera n\xF4tre.", "\xA1La victoria ser\xE1 nuestra!", "\u738B\u624B\u306E\u6C17\u914D\u2026", "\u0421\u043A\u043E\u0440\u043E \u0431\u0443\u0434\u0435\u0442 \u043D\u0430\u0448 \u0445\u043E\u0434.", "\u0627\u0644\u0646\u0635\u0631 \u0644\u0646\u0627 \u0642\u0631\u064A\u0628\u0627."]
};
function fillLine(tmpl, A, B) {
  return tmpl.replace("{A}", A).replace("{B}", B || "");
}
function randLine(kind, A, B) {
  const arr = CHAT_LINES[kind];
  return fillLine(arr[Math.floor(Math.random() * arr.length)], A, B);
}
function pushChat(W, name, color, text) {
  W.chat.push({ id: W.chat.length + "-" + Date.now() + "-" + Math.random(), name, color, text });
  if (W.chat.length > 60) W.chat.shift();
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
const PLAYER_COLOR = { fill: "#EFDCAC", edge: "#7d6236", text: "#241a0e", prom: "#B3392B", zone: "rgba(233,208,150,0.13)", zoneEdge: "rgba(201,169,106,0.6)", chip: "#C9A96A" };
function makeColor(i) {
  const h = Math.round(i * 137.508 % 360);
  return {
    fill: `hsl(${h},34%,26%)`,
    edge: `hsl(${h},40%,11%)`,
    text: `hsl(${h},28%,88%)`,
    prom: `hsl(${(h + 45) % 360},95%,72%)`,
    zone: `hsla(${h},60%,55%,0.10)`,
    zoneEdge: `hsla(${h},55%,58%,0.5)`,
    chip: `hsl(${h},55%,64%)`
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
function buildKingIndex(cells) {
  const kings = /* @__PURE__ */ new Map();
  for (const [k, p] of cells) {
    if (p.t === "K") kings.set(p.owner, k.split(",").map(Number));
  }
  return kings;
}
function nearestLoot(W, a) {
  const R = a.zone.r + 24;
  const cx = a.center[0], cy = a.center[1];
  let best = null, bd = Infinity;
  for (const [k, p] of W.cells) {
    if (p.owner === a.id) continue;
    const oa = W.armies[p.owner];
    if (oa && oa.alive) continue;
    const [x, y] = k.split(",").map(Number);
    if (Math.abs(x - cx) > R || Math.abs(y - cy) > R) continue;
    const d = Math.max(Math.abs(x - cx), Math.abs(y - cy));
    if (d < bd) {
      bd = d;
      best = [x, y];
    }
  }
  return best ? { pos: best, dist: bd } : null;
}
function zoneAt(center, r) {
  const [cx, cy] = center;
  const set = /* @__PURE__ */ new Set();
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < MAP_W && y < MAP_H) set.add(K(x, y));
  }
  return { cx, cy, r, set };
}
function refreshZone(a) {
  const zr = zoneRadiusFor(a);
  if (!a.zone || a.zone.cx !== a.center[0] || a.zone.cy !== a.center[1] || a.zone.r !== zr) {
    a.zone = zoneAt(a.center, zr);
  }
}
function findSpawnSpot(W) {
  const margins = [SPAWN_CLEAR_MARGIN, 4, 2, 0];
  for (const margin of margins) {
    for (let attempt = 0; attempt < 150; attempt++) {
      const cx = 10 + Math.floor(Math.random() * (MAP_W - 20));
      const cy = 10 + Math.floor(Math.random() * (MAP_H - 20));
      let clash = false;
      for (const a of W.armies) {
        if (!a.alive || !a.zone) continue;
        const clear = a.zone.r + margin;
        if (Math.abs(cx - a.center[0]) <= clear && Math.abs(cy - a.center[1]) <= clear) {
          clash = true;
          break;
        }
      }
      if (!clash) return [cx, cy];
    }
  }
  return null;
}
function armyHasBoardPieces(W, id) {
  for (const p of W.cells.values()) if (p.owner === id) return true;
  return false;
}
function spawnNewArmy(W) {
  const center = findSpawnSpot(W);
  if (!center) return null;
  const facing = Math.floor(Math.random() * 4);
  const existingNames = new Set(W.armies.map((x) => x.name));
  const t = now();
  const flankBias = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.floor(Math.random() * 5));
  const name = generateOneName(existingNames);
  const reuse = W.armies.find((a2) => !a2.alive && !armyHasBoardPieces(W, a2.id));
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
    name,
    color: makeColor(id),
    flankBias,
    human: true
  };
  if (reuse) Object.assign(reuse, fresh);
  else W.armies.push(fresh);
  const a = reuse || fresh;
  refreshZone(a);
  return a;
}
function legalMovesFrom(cells, x, y, facing, zoneSet) {
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
    let nx = x + rx, ny = y + ry;
    while (zoneSet.has(K(nx, ny))) {
      const q = cells.get(K(nx, ny));
      if (!q) out.push([nx, ny]);
      else {
        if (q.owner !== p.owner) out.push([nx, ny]);
        break;
      }
      nx += rx;
      ny += ry;
    }
  }
  return out;
}
function dropTargets(cells, zoneSet) {
  const out = [];
  for (const k of zoneSet) if (!cells.has(k)) {
    const [x, y] = k.split(",").map(Number);
    out.push([x, y]);
  }
  return out;
}
function allActions(cells, armyId, facing, hand, zoneSet, ownPieces) {
  const acts = [];
  for (const [x, y] of ownPieces) {
    for (const [tx, ty] of legalMovesFrom(cells, x, y, facing, zoneSet)) acts.push({ kind: "move", fx: x, fy: y, tx, ty });
  }
  const keys = Object.keys(hand);
  if (keys.length) {
    const dts = dropTargets(cells, zoneSet);
    for (const t of keys) for (const [x, y] of dts) acts.push({ kind: "drop", type: t, tx: x, ty: y });
  }
  return acts;
}
function isInHostileZone(tx, ty, ownArmyId, armies) {
  for (const a of armies) {
    if (a.id === ownArmyId || !a.alive) continue;
    if (a.zone && a.zone.set.has(K(tx, ty))) return true;
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
function marchDirFor(W, a, kings, myPieces) {
  let dest = null;
  if (a.id === W.playerId || a.human) {
    // 相対方向(marchRel)を、そのarmy自身の"現在の"facingから毎tick再計算する。
    // 絶対座標を1回だけ計算して覚えておく方式だと、進軍中に回転しても
    // 古い方向のまま進んでしまうため、必ずここで現在のfacingを使う。
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
    let kp = null, bd = Infinity;
    for (const [oid, okp] of kings) {
      if (oid === a.id) continue;
      const oa = W.armies[oid];
      if (!oa || !oa.alive) continue;
      const d = Math.max(Math.abs(okp[0] - a.center[0]), Math.abs(okp[1] - a.center[1]));
      if (d < bd) {
        bd = d;
        kp = okp;
      }
    }
    const loot = nearestLoot(W, a);
    if (loot && (!kp || loot.dist < bd * 0.6)) {
      dest = loot.pos;
    } else if (kp) {
      dest = kp;
      if (bd > 12) {
        const dx = kp[0] - a.center[0], dy = kp[1] - a.center[1];
        if (Math.abs(dx) >= Math.abs(dy)) dest = [kp[0], Math.max(0, Math.min(MAP_H - 1, kp[1] + a.flankBias))];
        else dest = [Math.max(0, Math.min(MAP_W - 1, kp[0] + a.flankBias)), kp[1]];
      }
    } else {
      return null;
    }
  }
  if (!dest) return null;
  const sx = Math.sign(dest[0] - a.center[0]), sy = Math.sign(dest[1] - a.center[1]);
  const attempts = [];
  if (sx && sy) attempts.push([sx, sy]);
  const order = Math.abs(dest[0] - a.center[0]) >= Math.abs(dest[1] - a.center[1]) ? [[sx, 0], [0, sy]] : [[0, sy], [sx, 0]];
  attempts.push(...order);
  for (const [mx, my] of attempts) if ((mx || my) && marchInBounds(myPieces, mx, my)) return [mx, my];
  return null;
}
function resolveSimultaneousMarch(W, movers) {
  const ev = { collisions: [], trampledTotal: 0, kingsKilled: [] };
  const byId = new Map(movers.map((m) => [m.army.id, m]));
  const lifted = [];
  for (const [k, p] of [...W.cells]) {
    const m = byId.get(p.owner);
    if (!m) continue;
    W.cells.delete(k);
    const [x, y] = k.split(",").map(Number);
    lifted.push({ m, x, y, p });
  }
  const byDest = /* @__PURE__ */ new Map();
  for (const it of lifted) {
    const dk = K(it.x + it.m.dx, it.y + it.m.dy);
    if (!byDest.has(dk)) byDest.set(dk, []);
    byDest.get(dk).push(it);
  }
  for (const [dk, list] of byDest) {
    let survivor = list[0];
    if (list.length > 1) {
      survivor = list[Math.floor(Math.random() * list.length)];
      for (const loser of list) {
        if (loser === survivor) continue;
        ev.collisions.push({ winner: survivor.m.army, loser: loser.m.army, piece: loser.p });
        if (loser.p.t === "K") {
          ev.kingsKilled.push(loser.m.army.id);
          survivor.m.army.kills = (survivor.m.army.kills || 0) + 1;
        }
      }
    }
    const occ = W.cells.get(dk);
    if (occ && occ.owner !== survivor.m.army.id) {
      if (occ.t !== "K") survivor.m.army.hand[occ.t] = (survivor.m.army.hand[occ.t] || 0) + 1;
      ev.trampledTotal++;
      if (occ.t === "K") {
        ev.kingsKilled.push(occ.owner);
        survivor.m.army.kills = (survivor.m.army.kills || 0) + 1;
        const victimArmy = W.armies[occ.owner];
      }
    }
    W.cells.set(dk, survivor.p);
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
    for (const [x, y] of pieces) {
      if (Math.abs(x - cx) > zr || Math.abs(y - cy) > zr) continue;
      for (const [tx, ty] of legalMovesFrom(W.cells, x, y, oa.facing, oa.zone.set)) set.add(K(tx, ty));
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
  for (const k of army.zone.set) {
    const p = W.cells.get(k);
    if (p && p.owner !== army.id) return true;
  }
  return false;
}
function aiPickAction(W, army, kings, piecesByOwner) {
  if (!hasLocalBusiness(W, army, kings)) return null;
  const acts = allActions(W.cells, army.id, army.facing, army.hand, army.zone.set, piecesByOwner.get(army.id) || []);
  if (!acts.length) return null;
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
  const threat = buildThreat(W, army, piecesByOwner);
  const myKing = kings.get(army.id);
  const inCheck = myKing ? threat.has(K(myKing[0], myKing[1])) : false;
  let best = null, bestScore = -Infinity;
  for (const a of acts) {
    let s = Math.random() * 0.3;
    if (a.kind === "move") {
      const destK = K(a.tx, a.ty);
      const victim = W.cells.get(destK);
      const mover = W.cells.get(K(a.fx, a.fy));
      const canPr = PROMOTABLE[mover.t] && !mover.promoted && (!!victim || isInHostileZone(a.tx, a.ty, army.id, W.armies) || isInHostileZone(a.fx, a.fy, army.id, W.armies));
      if (victim && victim.t === "K") return { ...a, promote: canPr };
      if (victim) s += VAL[victim.t] * 10 + (victim.promoted ? 20 : 0);
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
  if (!mover || mover.owner !== army.id) return null; // 盤面が変わっていて、もうその駒が存在しない(取られた等)場合は何もしない
  const victim = W.cells.get(K(a.tx, a.ty));
  W.cells.delete(K(a.fx, a.fy));
  if (victim && victim.t !== "K") {
    army.hand[victim.t] = (army.hand[victim.t] || 0) + 1;
  }
  if (a.promote) mover.promoted = true;
  W.cells.set(K(a.tx, a.ty), mover);
  return victim;
}
function aliveCount(W) {
  return W.armies.filter((a) => a.alive).length;
}
function handleDefeat(W, army) {
  if (!army || !army.alive) return;
  army.alive = false;
}
// 相対方向(前/後/左/右/斜め)を、そのarmy自身の現在のfacingを基準に絶対ベクトルへ変換する。
// クライアントの facing が一瞬でもサーバーとずれていても、進軍方向は必ずサーバー側の
// 正しい facing を基準に計算されるので食い違わない。
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
function applyGuestAction(W, army, action) {
  if (!army || !army.alive) return;
  const t = now();
  if ((action.type === "move" || action.type === "drop" || action.type === "rotate") && t - army.lastMove < MOVE_COOLDOWN) return;
  if (action.type === "move") {
    const v = applyAction(W, army, { kind: "move", fx: action.fx, fy: action.fy, tx: action.tx, ty: action.ty, promote: !!action.promote });
    army.lastMove = t;
    army.lastAction = t;
    if (v && v.t === "K") {
      army.kills = (army.kills || 0) + 1;
      const dead = W.armies.find((x) => x.id === v.owner);
      handleDefeat(W, dead);
    }
  } else if (action.type === "drop") {
    applyAction(W, army, { kind: "drop", type: action.dropType, tx: action.tx, ty: action.ty });
    army.lastMove = t;
    army.lastAction = t;
  } else if (action.type === "rotate") {
    army.facing = (army.facing + (action.dir > 0 ? 1 : 3)) % 4;
    army.lastMove = t;
    army.lastAction = t;
    // 進軍中に回転したら、次の進軍tickを待たずに目標地点を新しい正面基準で
    // 即座に更新する(表示・実際の移動方向がすぐに反映されるように)。
    if (army.marchRel) {
      const [vx, vy] = relVector(army.facing, army.marchRel);
      let tx = army.center[0], ty = army.center[1];
      if (vx < 0) tx = 0; else if (vx > 0) tx = MAP_W - 1;
      if (vy < 0) ty = 0; else if (vy > 0) ty = MAP_H - 1;
      army.target = [tx, ty];
    }
  } else if (action.type === "target") {
    army.target = [action.tx, action.ty];
  } else if (action.type === "targetRel") {
    // 絶対座標はここで計算せず、相対方向の意図だけ保存する。
    // 実際の目的地はmarchDirForが毎tick、その時点のfacingから計算し直す。
    army.marchRel = action.rel;
  } else if (action.type === "stopTarget") {
    army.marchRel = null;
    army.target = null;
  } else if (action.type === "chat") {
    pushChat(W, army.name, army.color.chip, action.text);
  }
}
function updateWorld(W) {
  const t = now();
  let kings = buildKingIndex(W.cells);
  for (const a of W.armies) {
    refreshZone(a);
    if (a.alive && !kings.has(a.id)) handleDefeat(W, a);
  }
  const marchTick = Math.floor((t - W.marchAnchor) / MARCH_INTERVAL);
  if (marchTick > W.lastMarchTick) {
    W.lastMarchTick = marchTick;
    const due = W.armies.filter((a) => a.alive);
    if (due.length) {
      const byOwner = new Map(due.map((a) => [a.id, []]));
      for (const [k, p] of W.cells) {
        const list = byOwner.get(p.owner);
        if (list) list.push(k.split(",").map(Number));
      }
      const movers = [];
      for (const a of due) {
        const d = marchDirFor(W, a, kings, byOwner.get(a.id) || []);
        if (d) movers.push({ army: a, dx: d[0], dy: d[1] });
      }
      if (movers.length) {
        const ev = resolveSimultaneousMarch(W, movers);
        for (const id of ev.kingsKilled) handleDefeat(W, W.armies.find((x) => x.id === id));
        kings = buildKingIndex(W.cells);
      }
    }
  }
  // net play: every army on the board is human-controlled, no AI armies.
}
module.exports = {
  MAP_W, MAP_H, MOVE_COOLDOWN, MARCH_INTERVAL, CAP, NAME_MAX_LEN, K,
  now, spawnNewArmy, applyGuestAction, updateWorld, handleDefeat, aliveCount,
  buildKingIndex, refreshZone, filterProfanity, pushChat, randLine,
};
