# 《羊了个羊》APK 逆向分析报告

> 分析对象:`羊了个羊.apk`(SHA-256 `b7a69fb3c6801b197abb9705830db0956283ce8ee47ed54bb4b1023fd8e9c0ff`,306 MB)
> 分析工具:REA(artifact 清单 + 资源图)、静态 JS bundle 切片阅读
> 本报告用于支撑本仓库 HTML 复刻版的玩法实现;游戏机制(规则)不受版权保护,资源版权归原厂所有,仅供学习研究。

## 1. APK 总体结构(Evidence: `inspect_artifact`, 34860 个条目)

| 路径 | 内容 |
|---|---|
| `assets/src/cocos2d-jsb.js` | Cocos Creator 2.x 引擎(1.6MB) |
| `assets/assets/main/index.js` | **游戏逻辑 bundle,7.2MB,未加密未混淆**(模块名保留) |
| `assets/assets/main/config.json` | main bundle 清单:4 场景 + 53 个资源 |
| `assets/assets/resources/` | 33954 个资源文件(config.json + import/*.json + native/*) |
| `assets/assets/postcard-bundle` | 明信片子系统 |
| `assets/src/settings.js` | 启动配置:`launchScene = hotupdate.fire` |

场景链:`hotupdate.fire`(热更)→ `main.fire`(登录/加载)→ `game.fire`(游戏主场景)。
**`game2.fire` 不是第二关**,而是主场景加载超时(15s)/失败时的容灾备用场景(`loadLayer` 模块)。
第二关是同一场景内 `playNextLevelMap()` 切换 `levelDataArray[1]` 数据实现。

## 2. 核心消除规则(crushArea 模块,bundle 偏移 ~956691)

```js
// crushArea 构造器
this.crushArray = new Array();
this.blockMaxWidth = 120;   // 槽内每格宽
this.newScale = .8;         // 入槽缩放
this.moveSpeed = 2e3;
this.cancelArray = [];      // 撤销栈
this.failNumber = 7;        // 槽位总数 = 7
```

- **消除判定** `isCrushBlock()`:槽内**相邻三个** `type` 相等且都已 `isReady`(移动动画结束)→ 播放 crush.mp3、三块缩放消失、`splice(i,3)`,并清空 `cancelArray`。
- **有效槽数** `getCrushBlockNum()` = `length − 相邻三连×3`(即将消除的不占失败判定)。
- **入槽插入** `getNewPosit()`:新块插到最后一个同类型块之后;若槽内同类型数量恰为 3 的倍数(组已完整)则排整个槽末尾。
- **常量表** `EBlockConst`:`CrushMatchBlockCount=3`、`ChangeRandNum=4`(洗牌翻滚次数)、`GoldBlockMaxPiecesCount=4`、`CakeBlockMaxPiecesCount=4`。

## 3. 点击判定(chessboard / blockPrefab 模块)

- 棋盘块按 `nowLevelBlockObj[layerNum][rowNum][rolNum]` 三维索引存储;`minBlockNum = 8`,块物理尺寸 120×135。
- **遮挡判定** `checkIsShow(layer, rol, row)`:存在 `layerNum` 更大的块,其 rol/row 均落在 `(当前±8)` 开区间内 → 被压(`blackMask` 黑遮罩,透明度 0.3s 渐变),不可点。
- 点击反馈:`touchStart` 播 clickBlock.mp3 + 短震动 + 按压放大;按住 3 秒自动取消。
- **槽满闸门** `removeCardNode()`:`getCrushBlockNum() >= 7` 时块弹回棋盘,不允许再拿。
- 坐标公式(chessboard.addBlockFunc):`x = rol*unit + 大列宽/2`,`y = −(row*unit + blockH/2)`,其中 `unit = 板宽/(widthNum×8)`;渲染层级 `setSiblingIndex(10000)`。

## 4. 关卡数据(dataTs / proto_game_map 模块)

- **关卡不在本地**:请求 `/sheep/v1/game/map_info_ex` 拿到 `map_md5[]`(每日两关)、洗牌种子 `map_seed/map_seed_2`、道具数量;再从 `cfgHost + maps/<md5>.map` 下载二进制地图(带 localStorage 缓存),跳过头 21 字节后用 **protobuf `proto_game_map.GameMap`** 解码。
- Node 字段:`id="layer-col-row"`、`type`(0=随机池分配)、`rolNum/rowNum/layerNum`、`moldType`(0 随机 / 1 固定 / 2 问号隐藏)、`metaType`(0 普通 / 2 消除后变色 / 3 金块 / 4 蛋糕)。
- **类型分配**:`blockTypeData{type: 组数}` 每类型生成 `3×组数` 个 type 塞入 `blockTypeArr`,用 **XorShift(mapSeed)** 种子洗牌;`moldType=0` 的块按 pop 领类型(服务器控种子,防作弊)。
- 地图尺寸表 `mapType`:6×7 / 7×9 / 8×10 / 9×11 / 10×12;默认 `widthNum=8, heightNum=10`。

## 5. 三个道具(PropType: remove/cancel/random/relive)

- **移出 remove**(`moveOutBlock`):把槽内前 3 块搬入 `moveOutArea` 三列暂存区(`moveOutObj={1:[],2:[],3:[]}`),每列纵向错位堆叠,**只有每列顶块可点**;点顶块仍回槽,受 7 格闸门限制。前置:前 3 块已停稳。音效 moveOut.mp3。
- **撤销 cancel**(`cancelOneStep`):从 `cancelArray` pop 最后入槽的块,按 layer/rol/row 三元组从槽中移除;原在暂存区则退回对应列,否则飞回棋盘原位。**消除发生时栈已清空,故不能撤销已消除的**。
- **洗牌 random**(`updateBlockArea`):收集棋盘所有可洗块(Normal/ColorFixed/Cake meta)的类型值重排,逐块播放旋转动画换类型;服务器开启校验时重排结果由 `useRandomProp` 接口下发。音效 random.mp3。
- **复活 relive**:失败弹窗看广告 → `rebornGameFunc` = 免费执行一次 `moveOutBlock()`。
- (另有 UFO 道具:金块集齐后按槽内分组从棋盘吸走 3 的倍数块,本复刻未实现。)

## 6. 失败/胜利流程

- 失败:每次块停稳后 `checkBlockCrush()`:无可消三连 && `crushArray.length >= 7` && 全部 isReady && 无待消三连 → 延迟 1 秒 `gameOverFunc()`(failType: 1=槽满 2=CD重试 3=炸弹超时)。失败弹窗面板从 y=0 弹到 y=438(`failNodeNum` 只是动画参数)。
- 胜利:`checkIsWIn()` = 棋盘空 && 暂存区空;每日模式还有第二关则 `playNextLevelMap()`,否则 winPop。

## 7. 块类型与图片映射

- 基础 16 种(`blockTypeConfig=[1..16]`)+ 扩展(≥17 直接按序号);金币块 `EBlockType.Coin=24`。
- 图片路径(block-slot-data-manager.getSlotImagePath):默认 `block/daily/block_N`;话题/大世界模式 `block/theme{id}/block_N`;底图 `block_bg`(金块 `block_bg_gold`、变色 `block_bg_change`)、遮挡遮罩 `blackMask` 同目录。resources 内共 **257 个主题**(theme1..theme240+ 等,4654 个 block 图片)。

## 8. 音效清单(玩法相关)

| 文件 | 用途 |
|---|---|
| clickBlock.mp3 | 按压可点击的块 |
| crush.mp3 | 三连消除 |
| crush_change.mp3 | 变色块刷新 |
| moveOut.mp3 | 移出/撤销道具 |
| random.mp3 | 洗牌道具 |
| levelInit.mp3 | 开局块下落 |
| blockRandom.mp3 / block-switch.mp3 | 块翻滚/类型切换 |
| boom.mp3 | 炸弹倒计时超时 |
| coin-fly.mp3 | 金币块收集 |
| game_cycle.mp3(音乐) | 游戏内循环 BGM |
| main_music.mp3(音乐) | 主界面 BGM |
| game_begin.mp3(音乐) | 进场曲,播完接 game_cycle |

## 9. Cocos 资源 UUID 压缩算法(资源提取关键)

resources bundle 的 `native/` 文件名是标准 UUID,而 `config.json` 的 `uuids[]` 是 22 字符压缩格式:

```
压缩UUID = 前2位原样 + 20个base64字符
解压:hex = 前2位;每2个base64字符 → v = idx[c1]*64 + idx[c2] → 追加 v 的3位十六进制
结果 2+30=32 位 hex → 8-4-4-4-12 标准 UUID
验证:10393/10393 个 native 文件全部命中
```

解码脚本见 `docs/tools/uuid_map.js`;`block/daily/block_1` → `native/77/7707a34c-69ce-4387-bb34-2aeb87bfc465.png` 等全部映射见 `docs/resource-map.txt`。

## 10. 复刻对照表

| 原版行为 | 复刻实现 |
|---|---|
| 7槽/3消/插入排序 | `index.html` SLOT_COUNT/MATCH_COUNT/insertPos() |
| ±8格遮挡窗+黑遮罩 | refreshCover()/OCCLUDE_WIN=8 |
| 槽满闸门(有效槽数≥7弹回) | effectiveSlotCount() |
| 移出3块进3列暂存(仅顶可点) | useMoveout()/mountMoveout() |
| 撤销断栈 | state.undoStack(消除时清空) |
| 失败延迟1秒+复活=移出3 | checkFail()/reviveGame() |
| 服务端关卡 | buildLevel() 同构布局本地生成(类型数恒为3的倍数) |
