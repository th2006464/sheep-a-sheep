// 游戏核心状态机(纯逻辑,无 DOM,可在 Node 与浏览器中运行)
// 规则依据 docs/reverse-engineering-report.md 的逆向结论:
//   7 槽位 / 相邻 3 同类型消除 / 按类型插入 / ±8 网格单位遮挡窗
// 本模块为原创实现,所有状态迁移经由单一动作入口并输出事件流。

export const SLOT_COUNT = 7;
export const MATCH_COUNT = 3;
export const OCCLUDE_WINDOW = 8; // ±8 网格单位(开区间)

/** 生成一局游戏。levelData: buildLevel() 的输出 */
export function createGame(levelData, opts = {}) {
  const tiles = new Map();
  for (const t of levelData.tiles) {
    tiles.set(t.id, { ...t, area: "board", moveoutCol: -1, origin: null });
  }
  return {
    gameId: 1,
    phase: "playing", // playing | won | failed
    tiles,
    slot: [],                 // 槽位内牌的有序 id 列表
    moveout: [[], [], []],    // 三列暂存区(每列栈,末尾为顶)
    undoStack: [],            // 已入槽且未消除的牌(按入槽顺序)
    crushed: new Set(),
    props: { moveout: 3, undo: 3, shuffle: 3 },
    revived: false,
    pickCount: 0,
  };
}

/** 牌是否被更高层的牌压住(仅棋盘上的牌参与) */
export function isCovered(game, id) {
  const t = game.tiles.get(id);
  if (!t || t.area !== "board") return false;
  for (const o of game.tiles.values()) {
    if (o.area === "board" && o.layer > t.layer &&
        Math.abs(o.col - t.col) < OCCLUDE_WINDOW &&
        Math.abs(o.row - t.row) < OCCLUDE_WINDOW) return true;
  }
  return false;
}

/** 棋盘上当前可点的牌 */
export function uncoveredIds(game) {
  const out = [];
  for (const t of game.tiles.values())
    if (t.area === "board" && !isCovered(game, t.id)) out.push(t.id);
  return out;
}

/** 槽位中互不重叠的相邻三连(从左到右贪心,AAAA 只算一组) */
export function slotTriples(game) {
  const triples = [];
  const types = game.slot.map(id => game.tiles.get(id).type);
  let i = 0;
  while (i + MATCH_COUNT <= types.length) {
    if (types[i] === types[i + 1] && types[i + 1] === types[i + 2]) {
      triples.push(game.slot.slice(i, i + MATCH_COUNT));
      i += MATCH_COUNT;
    } else i++;
  }
  return triples;
}

/** 有效槽数 = 槽数 - 即将消除的三连占用 */
export function effectiveCount(game) {
  return game.slot.length - slotTriples(game).length * MATCH_COUNT;
}

/** 新牌入槽位置:并入同类型组;若同类型已是 3 的倍数则排队尾 */
export function insertPos(game, type) {
  for (let i = game.slot.length - 1; i >= 0; i--) {
    if (game.tiles.get(game.slot[i]).type === type) {
      let same = 0;
      for (let j = i; j >= 0; j--)
        if (game.tiles.get(game.slot[j]).type === type) same++;
      if (same % MATCH_COUNT === 0) break;
      return i + 1;
    }
  }
  return game.slot.length;
}

/** 是否可点:棋盘明牌或暂存区顶牌,且受有效槽数闸门约束 */
export function canPick(game, id) {
  if (game.phase !== "playing") return { ok: false, reason: "not-playing" };
  const t = game.tiles.get(id);
  if (!t) return { ok: false, reason: "no-tile" };
  if (t.area === "slot") return { ok: false, reason: "in-slot" };
  if (t.area === "crushed") return { ok: false, reason: "crushed" };
  if (t.area === "moveout") {
    const col = game.moveout[t.moveoutCol];
    if (col[col.length - 1] !== id) return { ok: false, reason: "not-top" };
  } else if (t.area === "board" && isCovered(game, id))
    return { ok: false, reason: "covered" };
  if (effectiveCount(game) >= SLOT_COUNT) return { ok: false, reason: "slot-full" };
  return { ok: true };
}

/** 单一动作入口:点牌入槽(棋盘明牌 / 暂存区顶牌) */
export function pick(game, id) {
  const gate = canPick(game, id);
  if (!gate.ok) return { ok: false, reason: gate.reason, events: [] };
  const t = game.tiles.get(id);
  const events = [];
  const from = { area: t.area, moveoutCol: t.moveoutCol };

  if (t.area === "moveout") {
    const col = game.moveout[t.moveoutCol];
    col.pop();
    events.push({ t: "leave-moveout", id, col: t.moveoutCol });
  }
  t.area = "slot";
  t.moveoutCol = -1;
  t.origin = from;
  const idx = insertPos(game, t.type);
  game.slot.splice(idx, 0, id);
  game.undoStack.push(id);
  game.pickCount++;
  events.push({ t: "enter-slot", id, index: idx });

  // 结算:连续消除直到没有三连
  let crushed = settle(game, events);
  // 失败与胜利判定
  checkPhase(game, events);
  return { ok: true, events };
}

/** 消除所有可消的三连,返回消除组数 */
function settle(game, events) {
  let groups = 0;
  for (;;) {
    const triples = slotTriples(game);
    if (!triples.length) break;
    // 一次结算一组(最左),事件顺序稳定
    const trio = triples[0];
    const idx = game.slot.indexOf(trio[0]);
    game.slot.splice(idx, MATCH_COUNT);
    for (const id of trio) {
      game.tiles.get(id).area = "crushed";
      game.crushed.add(id);
    }
    game.undoStack = []; // 消除即清空撤销栈(原版语义)
    groups++;
    events.push({ t: "crush", ids: [...trio] });
  }
  return groups;
}

function checkPhase(game, events) {
  if (game.phase !== "playing") return;
  const boardLeft = [...game.tiles.values()].some(t => t.area === "board");
  const moveoutLeft = game.moveout.some(c => c.length > 0);
  if (!boardLeft && game.slot.length === 0 && !moveoutLeft) {
    game.phase = "won";
    events.push({ t: "win" });
    return;
  }
  // 失败:槽内牌数已达 7、无可消三连、且暂存区没有可回填的顶牌救场
  if (game.slot.length >= SLOT_COUNT && slotTriples(game).length === 0) {
    const rescuable = game.moveout.some(c => c.length > 0);
    if (!rescuable) {
      game.phase = "failed";
      events.push({ t: "fail" });
    }
  }
}

/** 移出道具:槽内前 3 块进入三列暂存区 */
export function useMoveout(game) {
  if (game.phase !== "playing") return fail("not-playing");
  if (game.props.moveout <= 0) return fail("no-prop");
  if (game.slot.length === 0) return fail("empty-slot");
  const events = [];
  const n = Math.min(game.slot.length, MATCH_COUNT);
  for (let i = 0; i < n; i++) {
    const id = game.slot.shift();
    const t = game.tiles.get(id);
    t.area = "moveout";
    t.moveoutCol = i;
    game.moveout[i].push(id);
    events.push({ t: "enter-moveout", id, col: i });
  }
  game.props.moveout--;
  checkPhase(game, events);
  return { ok: true, events };
}

/** 撤销道具:退回最后入槽且未消除的牌到原区域 */
export function useUndo(game) {
  if (game.phase !== "playing") return fail("not-playing");
  if (game.props.undo <= 0) return fail("no-prop");
  const id = game.undoStack[game.undoStack.length - 1];
  if (!id) return fail("nothing-to-undo");
  const events = [];
  game.undoStack.pop();
  const idx = game.slot.indexOf(id);
  if (idx < 0) return fail("stale"); // 不应发生
  game.slot.splice(idx, 1);
  const t = game.tiles.get(id);
  const origin = t.origin || { area: "board", moveoutCol: -1 };
  if (origin.area === "moveout") {
    t.area = "moveout";
    t.moveoutCol = origin.moveoutCol;
    game.moveout[t.moveoutCol].push(id); // 回到该列顶
    events.push({ t: "return-moveout", id, col: t.moveoutCol });
  } else {
    t.area = "board";
    t.moveoutCol = -1;
    events.push({ t: "return-board", id });
  }
  t.origin = null;
  game.props.undo--;
  return { ok: true, events };
}

/** 洗牌道具:仅重排仍在棋盘上的牌的类型(类型多重集不变) */
export function useShuffle(game, rng = Math.random) {
  if (game.phase !== "playing") return fail("not-playing");
  if (game.props.shuffle <= 0) return fail("no-prop");
  const boardIds = [...game.tiles.values()].filter(t => t.area === "board").map(t => t.id);
  if (boardIds.length === 0) return fail("empty-board");
  const types = boardIds.map(id => game.tiles.get(id).type);
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  const events = [];
  boardIds.forEach((id, i) => {
    const t = game.tiles.get(id);
    if (t.type !== types[i]) {
      events.push({ t: "retype", id, from: t.type, to: types[i] });
      t.type = types[i];
    }
  });
  game.props.shuffle--;
  return { ok: true, events };
}

/** 复活:失败后免费使用一次移出(不消耗道具) */
export function revive(game) {
  if (game.phase !== "failed") return fail("not-failed");
  if (game.revived) return fail("already-revived");
  if (game.slot.length === 0) return fail("empty-slot");
  game.phase = "playing";
  game.revived = true;
  const events = [{ t: "revive" }];
  const n = Math.min(game.slot.length, MATCH_COUNT);
  for (let i = 0; i < n; i++) {
    const id = game.slot.shift();
    const t = game.tiles.get(id);
    t.area = "moveout";
    t.moveoutCol = i;
    game.moveout[i].push(id);
    events.push({ t: "enter-moveout", id, col: i });
  }
  return { ok: true, events };
}

function fail(reason) { return { ok: false, reason, events: [] }; }
