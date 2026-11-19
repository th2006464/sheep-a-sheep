# 羊了个羊 · 网页复刻版 🐑

对原版《羊了个羊》Android APK 进行逆向分析后,在 HTML5 中 **1:1 复刻其消除玩法模块** 的开源实现:原版方块美术、音效与 UI 布局,配合依据反编译代码还原的完整玩法机制。

> 玩法规则(游戏机制)不受版权保护;本项目代码为原创实现。美术与音频资源提取自用户自有的 APK 副本,仅供个人学习研究,请勿商用。

## 玩法机制(逆向自原版 Cocos Creator 2.x bundle)

| 机制 | 实现 | 逆向依据 |
|---|---|---|
| 槽位栏 | **7 格**,`failNumber = 7` | `crushArea` 构造器 |
| 消除规则 | **相邻 3 个同类型** 且全部落定即消 | `isCrushBlock()` / `CrushMatchBlockCount = 3` |
| 入槽排序 | 插入到最后一个同类型块之后;同类型数量为 3 的倍数时排到队尾 | `getNewPosit()` |
| 遮挡判定 | 更高层块落在 ±8 网格单位窗口内即被压(黑遮罩,不可点) | `chessboard.checkIsShow()` |
| 槽满锁定 | 有效槽位数 ≥7 时棋盘块不可再拿 | `removeCardNode()` 闸门 |
| 移出道具 | 槽内前 3 块进入 3 列暂存区,仅每列顶块可点回槽 | `moveOutBlock()` |
| 撤销道具 | 退回最后入槽的块;发生消除即清空撤销栈 | `cancelOneStep()` |
| 洗牌道具 | 棋盘剩余块类型整体重排 | `updateBlockArea()` |
| 失败结算 | 7 格占满且无可消三连,延迟 1 秒弹窗;可"复活"(=使用一次移出) | `checkBlockCrush()` |
| 关卡 | 第一关热身 / 第二关地狱难度(原版关卡由服务端 protobuf 下发,本地以同构布局生成) | `proto_game_map.GameMap` |

## 运行

纯静态站,任选其一:

```bash
# 方式一:任意静态服务器
cd public && python3 -m http.server 8080

# 方式二:Cloudflare Workers(与 mahjong.game.foxtang.com 同款部署方式)
npm install
npx wrangler dev      # 本地开发
npx wrangler deploy   # 部署(需 wrangler login)
```

自定义域名:在 `wrangler.jsonc` 中取消 `routes` 注释并替换为你的域名。

## 目录结构

```
├── public/            # 静态站点
│   ├── index.html     # 游戏(单文件,无依赖)
│   ├── assets/
│   │   ├── blocks/    # 原版 daily 主题方块图 (block_1..40 / block_bg / blackMask)
│   │   ├── ui/        # 道具图标、PWA 图标
│   │   └── wallpaper.png
│   └── audio/         # 原版音效 (click/crush/moveout/shuffle/levelInit/bgm…)
├── src/index.js       # Cloudflare Worker 入口(静态资源分发)
└── wrangler.jsonc     # Cloudflare 部署配置
```

## 逆向分析方法

1. APK 解包:`assets/assets/main/index.js` 为未加密 Cocos Creator 2.x bundle(7.2MB)
2. 资源映射:解析 `resources/config.json` 的 Cocos 压缩 UUID(前 2 位保留 + 20 字符 base64 对 → 30 位 hex),将 `block/daily/block_N` 等逻辑路径映射到 `native/<xx>/<uuid>.png`
3. 机制还原:定位 `crushArea` / `chessboard` / `blockPrefab` 模块,提取常量与算法(见上表)
