// 关卡数据(原创拓扑 + 固定种子 + 经规则验证的解)
// 生成器与解序列在一起:先按遮挡规则剥离出合法移除顺序,
// 再沿该顺序每 3 张一组分配类型 —— 回放该顺序必然通关。
// 坐标系:8 单位 = 1 大格;牌占 10.24 x 11.52 单位(与原版 120x135 比例一致)。

const OCCLUDE_WINDOW = 8;

/** 确定性伪随机(mulberry32) */
function rng(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function coveredIn(set, t) {
  for (const o of set)
    if (o.layer > t.layer && Math.abs(o.col - t.col) < OCCLUDE_WINDOW
                         && Math.abs(o.row - t.row) < OCCLUDE_WINDOW) return true;
  return false;
}

/** 网格层:rows 行 cols 列,起点 (offRow, offCol),层号 layer */
function grid(arr, layer, rows, cols, offRow, offCol) {
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      arr.push({ layer, row: offRow + r * 8, col: offCol + c * 8 });
}

/**
 * 构建一关。
 * @param cells  {layer,row,col} 占位
 * @param typeCount 类型种数
 * @param seed   固定种子
 * 返回 { tiles:[{id,type,layer,row,col}], solution:[id] }
 */
function buildLevelFrom(cells, typeCount, seed) {
  // 1) 剥离顺序:每步从当前未被压住的牌中按种子优先级取一张
  const rand = rng(seed);
  const remaining = cells.map((c, i) => ({ ...c, key: rand(), i }));
  const order = [];
  while (remaining.length) {
    let pickIdx = -1;
    for (let k = 0; k < remaining.length; k++)
      if (!coveredIn(remaining, remaining[k])) {
        if (pickIdx < 0 || remaining[k].key > remaining[pickIdx].key) pickIdx = k;
      }
    if (pickIdx < 0) throw new Error("level deadlock: no uncovered tile");
    order.push(remaining.splice(pickIdx, 1)[0]);
  }
  // 2) 沿剥离顺序每 3 张同类型成组;组内类型按组号轮转分配
  if (order.length % 3 !== 0) throw new Error("tile count not multiple of 3");
  const tiles = order.map((c, i) => ({
    id: `t${seed}_${String(i).padStart(3, "0")}`,
    type: (Math.floor(i / 3) % typeCount) + 1,
    layer: c.layer, row: c.row, col: c.col,
  }));
  // solution 即剥离顺序本身(每 3 张一组入槽即消,槽位峰值 3)
  return { tiles, solution: tiles.map(t => t.id) };
}

/** 第一关:三层金字塔 + 两侧翼(48 张 / 8 类型) */
export function buildLevel1() {
  const cells = [];
  grid(cells, 0, 4, 5, 0, 16);   // 主阵 20
  grid(cells, 1, 3, 4, 4, 20);   // 二层 12
  grid(cells, 2, 2, 4, 8, 24);   // 塔顶 8
  grid(cells, 0, 3, 1, 4, 0);    // 左翼 3
  grid(cells, 0, 3, 1, 4, 56);   // 右翼 3
  grid(cells, 1, 1, 2, 12, 8);   // 左翼压条 2
  return buildLevelFrom(cells, 8, 1001);
}

/** 第二关:七层双塔(120 张 / 12 类型) */
export function buildLevel2() {
  const cells = [];
  grid(cells, 0, 5, 8, 0, 0);    // 底盘 40
  grid(cells, 1, 4, 7, 4, 4);    // 28
  grid(cells, 2, 4, 6, 8, 8);    // 24
  grid(cells, 3, 3, 5, 8, 12);   // 15
  grid(cells, 4, 3, 3, 12, 16);  // 9
  grid(cells, 5, 2, 2, 16, 20);  // 4
  return buildLevelFrom(cells, 12, 2002);
}

export function buildLevel(levelIdx) {
  return levelIdx === 0 ? buildLevel1() : buildLevel2();
}

export const LEVEL_COUNT = 2;
