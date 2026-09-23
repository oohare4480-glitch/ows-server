// クライアント(ows_app.html)のゲーム処理から、サーバー用の game.js を生成する。
// 手で移植するとルールがズレるので、必ずこの生成を通す。
const fs = require("fs");
const src = fs.readFileSync(process.argv[2], "utf8");
const code = src.match(/<script>\n(const \{ useRef[\s\S]*?)<\/script>/)[1];
let top = code.slice(0, code.indexOf("function OpenWorldShogi() {"));
top = top.replace("const { useRef, useState, useEffect, useCallback } = React;\n", "");
let upd = code.slice(code.indexOf("  function updateWorld(W2) {"), code.indexOf("  function attemptPlayerAction("));

// サーバー用の差し替え(意図しない書き換えが起きないよう、必ず1箇所だけ置換されることを確認する)
const patches = [
  // AI軍の自動参戦は、AIを置かない世界では行わない
  ['    if (W2.mode !== "openworld" && t - W2.lastSpawnCheck >= SPAWN_CHECK_INTERVAL) {',
   '    if (!W2.noAI && t - W2.lastSpawnCheck >= SPAWN_CHECK_INTERVAL) {'],
  // AIの思考も同様
  ['    if (W2.mode === "openworld") return;\n    const aiDue = [];',
   '    if (W2.noAI) return;\n    const aiDue = [];'],
  // 倍速の自動判断は、人が操作している軍には行わない
  ['          if (!a.alive || a.neutral || a.id === W2.playerId) continue;',
   '          if (!a.alive || a.neutral || a.human || a.id === W2.playerId) continue;'],
  // 残骸の補充と配置駒の減衰は、この世界でも動かす(mode ではなく中立軍の有無で判定)
  ['    if (W2.mode !== "openworld" && W2.neutralId != null && t - W2.lastLootSpawn >= LOOT_RESPAWN_MS) {',
   '    if (W2.neutralId != null && t - W2.lastLootSpawn >= LOOT_RESPAWN_MS) {'],
  ['    if (!W2.over && W2.mode !== "openworld") {',
   '    if (!W2.over) {'],
  // 速度を自動で落とすのはAIの軍だけ。人が選んだ倍率は勝手に変えない
  ['          } else if (id !== W2.playerId) {',
   '          } else if (!a.human && id !== W2.playerId) {'],
];
for (const [a, b] of patches) {
  const n = upd.split(a).length - 1;
  if (n !== 1) throw new Error(`置換対象が${n}件: ${a.slice(0, 60)}`);
  upd = upd.replace(a, b);
}
upd = upd.replace(/^  /gm, "").trimEnd() + "\n";

const serverPart = `
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
`;
const header = `// このファイルは自動生成です。直接編集せず、クライアント(ows_app.html)側を直してから
// build_server_game.js で作り直してください。ネット対戦とAI対戦のルールを完全に一致させるためです。
// 生成元: ${process.argv[2]}  生成日時: ${new Date().toISOString()}
`;
fs.writeFileSync(process.argv[3], header + top + "\n" + upd + serverPart);
console.log("generated", process.argv[3]);
