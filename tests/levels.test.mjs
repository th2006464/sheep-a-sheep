// 关卡数据测试:确定性、唯一性、可解性回放
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLevel, buildLevel1, buildLevel2, LEVEL_COUNT } from "../public/levels.mjs";
import { createGame, pick, effectiveCount } from "../public/game-core.mjs";

test("两关数据确定性:同输入生成完全相同牌阵", () => {
  for (const build of [buildLevel1, buildLevel2]) {
    assert.deepEqual(build(), build());
  }
});

test("ID 唯一、坐标为有限数、同层无重复占位", () => {
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const { tiles } = buildLevel(i);
    const ids = new Set(tiles.map(t => t.id));
    assert.equal(ids.size, tiles.length, "id 重复");
    const pos = new Set();
    for (const t of tiles) {
      assert.ok(Number.isFinite(t.row) && Number.isFinite(t.col) && Number.isFinite(t.layer));
      assert.ok(t.type >= 1, "type 从 1 开始");
      const key = `${t.layer}:${t.row}:${t.col}`;
      assert.ok(!pos.has(key), `同层重复占位 ${key}`);
      pos.add(key);
    }
  }
});

test("每种类型数量均为 3 的倍数", () => {
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const counts = {};
    for (const t of buildLevel(i).tiles) counts[t.type] = (counts[t.type] ?? 0) + 1;
    for (const [type, n] of Object.entries(counts))
      assert.equal(n % 3, 0, `类型 ${type} 数量 ${n} 不是 3 的倍数`);
  }
});

test("保留解回放:全部合法点击并胜利,过程槽位有效数 < 7", () => {
  for (let i = 0; i < LEVEL_COUNT; i++) {
    const level = buildLevel(i);
    const game = createGame(level);
    let maxEffective = 0;
    for (const id of level.solution) {
      const r = pick(game, id);
      assert.ok(r.ok, `第${i + 1}关 ${id} 非法点击: ${r.reason}`);
      maxEffective = Math.max(maxEffective, effectiveCount(game));
      assert.ok(maxEffective < 7, "回放中槽位有效数达 7");
    }
    assert.equal(game.phase, "won", `第${i + 1}关未胜利`);
  }
});

test("关卡规模符合设计(48 / 120)", () => {
  assert.equal(buildLevel(0).tiles.length, 48);
  assert.equal(buildLevel(1).tiles.length, 120);
});
