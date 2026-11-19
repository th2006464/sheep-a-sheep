// 对局状态机测试:三连/槽满/道具/撤销/复活/胜利条件
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGame, pick, useMoveout, useUndo, useShuffle, revive,
         isCovered, effectiveCount, canPick } from "../public/game-core.mjs";

/** 造一局自定义关卡:types 数组给出各明牌类型(全部 layer0、互不遮挡) */
function flatGame(types, extra = []) {
  const tiles = types.map((type, i) => ({
    id: `a${i}`, type, layer: 0, row: Math.floor(i / 6) * 16, col: (i % 6) * 16,
  })).concat(extra);
  return createGame({ tiles });
}

test("被压住的牌不可点,无效动作不产生事件", () => {
  const game = createGame({ tiles: [
    { id: "bottom", type: 1, layer: 0, row: 8, col: 8 },
    { id: "top",    type: 2, layer: 1, row: 8, col: 8 },
  ]});
  assert.equal(isCovered(game, "bottom"), true);
  const r = pick(game, "bottom");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "covered");
  assert.equal(game.slot.length, 0);
});

test("AAAA 只消一组(互不重叠三连)", () => {
  const game = flatGame([1, 1, 1, 1, 2, 2, 2]);
  let crushes = 0;
  for (const id of ["a1", "a2", "a3", "a0"]) {
    const r = pick(game, id);
    assert.ok(r.ok);
    crushes += r.events.filter(e => e.t === "crush").length;
  }
  assert.equal(crushes, 1);           // 四张同类只消一组
  assert.equal(game.slot.length, 1);  // 剩 1 张
});

test("AAAAAA 消两组", () => {
  const game = flatGame([1, 1, 1, 1, 1, 1]);
  for (let i = 0; i < 6; i++) assert.ok(pick(game, `a${i}`).ok);
  assert.equal(game.slot.length, 0);
});

test("有效槽数:AAABB 不扣、AAAB 扣 3", () => {
  const game = flatGame([1, 1, 1, 2, 2]);
  for (const id of ["a0", "a1", "a3"]) pick(game, id); // 1 1 2
  assert.equal(effectiveCount(game), 3);
  pick(game, "a2"); // 1 1 1 2 -> 消成 2
  assert.equal(effectiveCount(game), 1);
});

test("槽满闸门与失败时序", () => {
  // 有效数达到 7 的那张本身可入槽,但随后立即失败结算
  const game = flatGame([1, 2, 3, 4, 5, 6, 7, 8]);
  for (let i = 0; i < 6; i++) assert.ok(pick(game, `a${i}`).ok);
  const r7 = pick(game, "a6"); // 第 7 张:入槽前有效数 6,允许;入槽后 7 且无三连
  assert.ok(r7.ok);
  assert.equal(game.phase, "failed");
  assert.ok(r7.events.some(e => e.t === "fail"));
  assert.equal(pick(game, "a7").reason, "not-playing");
});

test("闸门按有效数而非原始数:入槽瞬间成三连则不判失败", () => {
  // A A B C D E + A:第 7 张插入同类型组后立即消除,游戏继续
  const game = flatGame([1, 1, 2, 3, 4, 5, 1, 6]);
  for (const id of ["a0", "a1", "a2", "a3", "a4", "a5"]) assert.ok(pick(game, id).ok);
  assert.equal(game.phase, "playing");
  const r = pick(game, "a6");
  assert.ok(r.ok);
  assert.ok(r.events.some(e => e.t === "crush"));
  assert.equal(game.phase, "playing");
  assert.equal(game.slot.length, 4); // AAAB CDE -> 消 AAA 剩 B C D E
});

test("失败:7 张无异类三连且无暂存可救 -> failed;复活后可继续", () => {
  const game = flatGame([1, 2, 3, 4, 5, 6, 7]);
  let lastEvents = [];
  for (let i = 0; i < 7; i++) lastEvents = pick(game, `a${i}`).events;
  assert.equal(game.phase, "failed");
  assert.ok(lastEvents.some(e => e.t === "fail"));
  // 失败后点击与道具均拒绝
  assert.equal(pick(game, "a0").ok, false);
  // 复活:免费移出前 3
  const rv = revive(game);
  assert.ok(rv.ok);
  assert.equal(game.phase, "playing");
  assert.equal(game.moveout[0].length, 1);
  assert.equal(game.moveout[1].length, 1);
  assert.equal(game.moveout[2].length, 1);
  assert.equal(game.revived, true);
  assert.equal(revive(game).ok, false); // 只能一次
});

test("移出道具:成功才扣次数;空槽拒绝且不扣", () => {
  const game = flatGame([1, 2, 3]);
  assert.equal(useMoveout(game).ok, false); // 空槽
  assert.equal(game.props.moveout, 3);
  for (const id of ["a0", "a1", "a2"]) pick(game, id);
  const r = useMoveout(game);
  assert.ok(r.ok);
  assert.equal(game.props.moveout, 2);
  assert.deepEqual(game.moveout.map(c => c.length), [1, 1, 1]);
  assert.equal(game.slot.length, 0);
});

test("暂存区只有顶牌可点;有效数满时暂存顶牌同样受闸门约束", () => {
  const game = flatGame([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  for (let i = 0; i < 5; i++) pick(game, `a${i}`);   // 槽内 5 张
  assert.ok(useMoveout(game).ok);                    // 前 3 入暂存,槽内 2
  const tops = game.moveout.map(c => c[c.length - 1]);
  assert.equal(canPick(game, tops[0]).ok, true);     // 顶牌可点
  for (let i = 5; i < 10; i++) assert.ok(pick(game, `a${i}`).ok); // 槽内 7 张(各异)
  // 有效数 7 但暂存区可救场 -> 未失败;此时暂存顶牌被闸门拦下
  assert.equal(game.phase, "playing");
  assert.equal(canPick(game, game.moveout[0][0]).reason, "slot-full");
  // 用移出腾出槽位后,新的顶牌恢复可点
  assert.ok(useMoveout(game).ok);
  const newTop = game.moveout[0][game.moveout[0].length - 1];
  assert.equal(canPick(game, newTop).ok, true);
});

test("撤销:棋盘牌回棋盘,暂存牌回原列顶", () => {
  const game = flatGame([1, 2, 3, 4, 5, 6]);
  pick(game, "a0"); pick(game, "a1"); pick(game, "a2");
  useMoveout(game);                       // 三张进暂存
  const col0Top = game.moveout[0][0];
  assert.ok(pick(game, col0Top).ok);      // 顶牌回槽
  const r = useUndo(game);
  assert.ok(r.ok);
  assert.equal(game.moveout[0][game.moveout[0].length - 1], col0Top); // 回到列顶
  // 撤销棋盘来源的牌
  pick(game, "a3");
  const r2 = useUndo(game);
  assert.ok(r2.ok);
  assert.equal(game.tiles.get("a3").area, "board");
  assert.equal(game.props.undo, 3 - 2);
});

test("消除清空撤销栈(不能撤销已消除的牌)", () => {
  const game = flatGame([1, 1, 1, 2]);
  for (const id of ["a0", "a1", "a2"]) pick(game, id);
  assert.equal(game.undoStack.length, 0);
  assert.equal(useUndo(game).ok, false);
});

test("洗牌:仅重排棋盘牌,类型多重集不变", () => {
  const game = flatGame([1, 2, 3], [
    { id: "s0", type: 5, layer: 0, row: 100, col: 0 },
  ]);
  let seed = 7;
  const r = useShuffle(game, () => (seed = (seed * 16807) % 2147483647) / 2147483647);
  assert.ok(r.ok);
  const board = [...game.tiles.values()].filter(t => t.area === "board").map(t => t.type).sort();
  assert.deepEqual(board, [1, 2, 3, 5]);
  assert.equal(game.props.shuffle, 2);
  // 空棋盘拒绝且不扣
  const g2 = flatGame([1, 1, 1]);
  for (const id of ["a0", "a1", "a2"]) pick(g2, id);
  assert.equal(useShuffle(g2).ok, false);
  assert.equal(g2.props.shuffle, 3);
});

test("胜利条件:棋盘空但暂存未清空不算赢", () => {
  const game = flatGame([1, 1, 1]);
  for (const id of ["a0", "a1"]) pick(game, id);
  useMoveout(game);          // 2 张进暂存,棋盘剩 1 张
  pick(game, "a2");          // 最后一张入槽:槽内 1,暂存 2
  assert.equal(game.phase, "playing");
  // 取回暂存并凑齐三连
  assert.ok(pick(game, game.moveout[0][0]).ok);
  assert.ok(pick(game, game.moveout[1][0]).ok);
  assert.equal(game.phase, "won");
});

test("胜利后一切动作拒绝", () => {
  const game = flatGame([1, 1, 1]);
  for (const id of ["a0", "a1", "a2"]) pick(game, id);
  assert.equal(game.phase, "won");
  assert.equal(useMoveout(game).ok, false);
  assert.equal(useUndo(game).ok, false);
  assert.equal(useShuffle(game).ok, false);
});

test("换局隔离:新对局不受旧对象操作影响", () => {
  const old = flatGame([1, 1, 1]);
  for (const id of ["a0", "a1", "a2"]) pick(old, id);
  const fresh = flatGame([2, 2, 2]);
  assert.equal(fresh.phase, "playing");
  assert.equal(fresh.crushed.size, 0);
  assert.equal(old.crushed.size, 3); // 旧局保持自身终态
});
