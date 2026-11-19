# 菜园叠叠消 · Sheep Match 🥕

叠层三消网页游戏(羊了个羊类玩法)。玩法机制依据对原版 APK 的逆向分析实现(规则见下),**界面、牌面、图标与音效全部为本仓库原创**(CSS + 手绘 SVG + WebAudio 合成,无任何提取素材)。

> 游戏机制(规则)不受版权保护;本项目代码与美术均为原创。逆向分析过程见 [docs/reverse-engineering-report.md](docs/reverse-engineering-report.md),改造工单见 [docs/rea-web-handoff.md](docs/rea-web-handoff.md)。

## 玩法(逆向自原版 Cocos bundle 的机制)

| 机制 | 实现 |
|---|---|
| 7 格槽位栏(`failNumber=7`) | `game-core.mjs` `SLOT_COUNT` |
| 相邻 3 同类型消除,互不重叠(AAAA 只消一组) | `slotTriples()` |
| 入槽按类型插入(同类型 3 的倍数则排队尾) | `insertPos()` |
| 遮挡判定:更高层牌落在 ±8 网格单位窗口内即被压 | `isCovered()` |
| 槽满闸门按**有效槽数**(即将消除的三连不占) | `effectiveCount()` |
| 移出(前 3 张进 3 列暂存区,仅顶牌可点)/ 撤回(退回原区域,消除即断栈)/ 洗牌(仅重排棋盘牌) | `useMoveout/useUndo/useShuffle` |
| 失败:有效槽数满且无三连且暂存无可救;复活 = 免费移出一次 | `checkPhase()/revive()` |
| 两关原创拓扑(48 / 120 张),每关附**经规则回放验证的解序列** | `levels.mjs` |

## 架构

```
public/
├── index.html        # 视图层:响应式布局、动画、音效、弹窗
├── game-core.mjs     # 纯逻辑状态机(单一动作入口 + 事件流,无 DOM)
├── levels.mjs        # 关卡数据:确定性生成 + 保留解(剥离顺序构造,必然可解)
└── assets/original/  # 原创素材:12 种蔬果 SVG 图标、应用图标
tests/
├── levels.test.mjs       # 确定性/唯一性/类型3倍数/解回放通关
└── game-state.test.mjs   # 三连/槽满/道具/撤回/复活/胜利条件/换局隔离
```

- **布局**:牌阵按自身包围盒整体缩放居中(`layoutBoard()`),已验收 360×800、390×844、594×1320、768×1024、1280×800 五视口零裁切。
- **音效**:WebAudio 合成(点击/入槽/消除/移出/洗牌/失败/胜利),可关闭,无外部音频文件。
- **可访问性**:牌与按钮支持键盘焦点(Enter/Space 拾取),`prefers-reduced-motion` 降级动画。

## 运行

```bash
node --test tests/                 # 20 项测试
cd public && python3 -m http.server 8080   # 任一静态服务器
# 调试:?level=1 直接进入第二关;?solve=1 按保留解自动通关演示

npm install && npx wrangler dev    # Cloudflare Workers(同 mahjong.game.foxtang.com 部署方式)
npx wrangler deploy                # 部署(自定义域名见 wrangler.jsonc routes 注释)
```

## 验证记录

- `node --test`:20/20 通过(2026-11-19,Node 26.8.1)
- 浏览器:两关解序列全流程通关;五视口 + 1280×800/360×800 第二关复验,裁切数均为 0
