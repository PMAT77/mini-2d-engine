# 白昼 / 黄昏 / 夜晚视觉升级

## 视觉与玩法

白昼以低饱和灰绿地表、暖白环境光和中等太阳投影形成探索可读性；黄昏使用琥珀夕照、冷蓝灰背光面和长投影支持返程/备战压力；夜晚保留冷色地表底光，由手电与营地灯建立局部观察空间。没有全屏曝光、饱和度滤镜或泛光。

环境参数由 `CampaignSession.worldMinute` 派生，0 表示第 1 天 06:00。没有第二个运行时计时器，没有新增视觉存档字段。非战役沙盒固定为 12:00。开发预览不提交时间或存档，生产构建拒绝预览接口。

- 白昼自然光同时影响玩家和怪物。玩家仍受最大 450 世界像素、墙体 LOS 和烟雾限制；近身感知维持 100。
- 黄昏前半段自然光辨识半径 300；19:00 后平滑缩小到 0。怪物在各自原有明/暗视距之间变化，不修改确认时间、听觉或战斗数值。
- 手电保留原有 400 射程、120°光锥、0.95 逻辑强度、内圈和软边。视觉权重独立调整，不影响照明判定。
- 18:00 仍是返程截止；20:00 后完整运行默认 300 秒夜晚，再于次日 06:00 换日。营地夜间不能出发。
- 营地固定灯位置 `(350,400)`、`(750,450)`，半径 230、强度 0.85、色彩 `#FFD59B`、光源半径 10。固定设施定义不保存为新的消耗品或建造数据。
- `setRaidVisualState({wave,totalWaves})` 接收真实夜袭状态：夜间设施灯视觉贡献提高 15%，HUD 显示实际波次。缺省只显示“夜间防守时间”，不生成袭击。

## 参数

强度均为光照贡献，数值越高越亮；色温是美术意图，实际渲染使用 RGB 色值。

| 参数 | 白昼 | 黄昏 | 夜晚 |
| --- | --- | --- | --- |
| 环境色 / 强度 | `#E9E5D9` / 0.72 | `#91A4C4` / 0.40 | `#879FBE` / 0.28 |
| 太阳色 / 强度 | `#FFE9CA` / 0.24 | `#FFB36B` / 0.38 | 关闭 |
| 色温意图 | 约 5500K | 约 3200K | 冷蓝灰 |
| 太阳投影长度 | 0.65 格 | 2.2 格，晚昏延伸至 2.8 格并淡出 | 0 |
| 太阳遮蔽比例 | 0.85 | 0.95 | 0 |
| 阴影柔边 | 0.08 格 | 0.12 格 | 沿用各局部光源 |
| 朝阳边缘 | 0.10 | 0.18 | 0 |
| 水面 / 金属高光上限 | 0.08 / 0.04 | 0.12 / 0.07 | 0.04 / 0.03，仅局部照明 |
| 空气层最大透明度 | 0.015 | 0.025 | 0.025 |
| 人工光视觉权重 | 0.30 | 0.65 | 1.00 |
| 自然光辨识半径 | 450 | 300，19:00 后降到 0 | 0，黎明前逐渐恢复 |

地表反照色为 `#596057`，墙体为 `#747870`，资源类型色保留。太阳固定从左上照向右下，投影单位向量 `(0.8,0.6)`；墙体高度倍率 1.0、矿块 0.6、人物 0.8、交易设施 1.2。倍率只影响表现，不改变碰撞。

关键帧采用 smoothstep：05:30–06:30 黎明，太阳从 06:00 开始贡献；06:30–16:30 稳定白昼；16:30–18:00 变暖并拉长投影；18:00–19:00 稳定夕照；19:00–20:00 淡出太阳；20:00–05:30 稳定夜晚。暂停冻结，恢复/切图由权威时间直接重建。17:00 起返程提示逐渐变暖，黄昏倒计时进一步增强，无频闪。

配置在 `public/configs/graphicsConfig.json` 的 `dayNight` 下，包含 `mode`、两种反照色和三套视觉预设；旧 JSON 缺省合并默认值。F2“昼夜光照”可调所有叶子。`manual` 模式恢复原有环境/地形光参数，但不改变由时钟决定的玩法感知。

## 分阶段文件与技术实现

### 1. 环境与材质

- 新增 `src/core/EnvironmentLighting.ts`：纯函数采样、默认预设、自然光边缘权重。
- 修改 `src/core/GraphicsConfig.ts`、`public/configs/graphicsConfig.json`：原子校验、深拷贝和缺省兼容。
- 修改 `src/map/TileMap.ts`：独立的地表/墙体反照色；只在材质改变时重建地形分块。
- 修改 `src/scenes/GameScene.ts`、`src/core/LightingSystem.ts`：应用当前环境；环境颜色不进入太阳几何缓存键。
- 修改 `src/ui/debugSchema.ts`、`src/ui/PlayerDebugPanel.ts`：所有参数及嵌套预设的 F2 读写。

### 2. 太阳与投影

- 新增 `src/core/DirectionalShadow.ts`：平行投影几何与人物近似投影。
- 修改 `src/core/LightingSystem.ts`：`setDirectionalLight`，半分辨率无色太阳遮挡缓存；按 1 世界像素量化长度，按几何/占用变化失效。颜色与强度连续变化不重新栅格化。
- 修改 `src/map/TileMap.ts`、`src/structures/StructureSystem.ts`：使用现有实体轮廓/动态木墙登记几何，朝阳与背阳边缘分开处理；木墙仅在已观察时绘制细节。
- 修改 `src/objects/TradingStation.ts`、`src/scenes/GameScene.ts`：设施、角色、鸡、丧尸与金块共用太阳方向；隐藏实体不投影，接地阴影保留。
- 地形投影在地面裁剪中取并集，只移除太阳贡献，不能压黑墙顶；后画的局部光可以重新照亮太阳阴影。

### 3. 材质与空气层

- 修改 `src/map/WaterTerrain.ts`：世界坐标固定的稀疏水面反光，复用湖泊 alpha，缓存随地图比例正确失效。
- 修改 `src/map/TileMap.ts`、`src/core/LightingSystem.ts`：已有水域/金属轮廓上的轻微高光，绘制区域限制到实际材质包围盒；太阳遮挡削弱高光，夜间使用已有人工照明遮罩。
- 修改 `src/scenes/GameScene.ts`：空气层限制在观察区域内、位于感知遮罩之前。没有逐帧全屏像素读取、随机闪光或体积雾。

### 4. 感知与持续夜晚

- 修改 `src/vision/IlluminationProbe.ts`、`src/vision/PerceptionSystem.ts`、`src/vision/PerceptionRenderer.ts`：辨识、探索、记忆、小地图观察日志与渲染开孔使用相同自然光状态；不修改全局 `ambientIdentifies`。感知阴影统一填充以消除白昼高对比下的分片射线。
- 修改 `src/core/LightSource.ts`、`src/ai/VisionSensor.ts`、`src/enemies/EnemySystem.ts`、`src/objects/Chicken.ts`：视觉权重与逻辑照度分离，怪物/鸡同步自然光。
- 修改 `src/campaign/CampaignSession.ts`、`src/campaign/LocationDefinitions.ts`、`src/campaign/LocationManager.ts`：运行完整夜晚、固定营地灯、正确夜间出发提示。
- 修改 `src/ui/DayClockHudLayout.ts`、`src/ui/DayClockHud.ts`：逐渐增强的返程/备战色彩和真实夜袭状态。

最终合成：地表 → 静态物件/受光分面与地面投影 → 实体 → 环境/太阳/局部光 → 材质高光和空气层 → 感知遮蔽 → 战斗与操作提示 → 屏幕 HUD。枪口火焰、受击反馈和 HUD 保持原有独立顺序。

## 验收与交付

新增 `tests/day-night.test.mjs`、`tests/day-night-fixture.html`、`tests/day-night.browser.mjs`、`tests/day-night.performance.mjs`。更新战役/存档跨夜测试，并让原有隔离光照/视野测试显式使用静态夜间设置；F2 窄屏测试等待 Chromium 完成聚焦控件引发的视口重排后验收，不降低布局断言。

命令：

```powershell
npm test
npm run typecheck
npm run build
npm run test:browser
npm run test:day-night-browser
npm run test:day-night-performance
```

浏览器沿用已有 Playwright，不增加依赖；本机使用 `PLAYWRIGHT_MODULE=D:\SDK\nodejs\node_modules\playwright`，`BROWSER_EXECUTABLE=C:\Users\Administrator\AppData\Local\ms-playwright\chromium_headless_shell-1248\chrome-headless-shell-win64\chrome-headless-shell.exe`，`TEST_BASE_URL` 指向开发服务。

固定种子 8351/817、相同相机/对象/手电方向；街道、墙角、营地、水面，12:00 / 18:45 / 22:00，手电开/关，DPR 1 / 1.25 / 2。基线 72 张；升级后共 149 张，包含阶段 1–3 的 DPR 1 图、真实战役、波次接口注入和窄屏截图。波次注入只验收接口与 HUD，不表示已经生成真实袭击。

实现前的固定镜头基线只驱动了光束，手电胶囊保留初始状态；最终截图同步驱动胶囊。正常游戏的 G 开关与胶囊由独立 HUD 回归覆盖。

截图和机器可读数据位于 `.review/day-night/`，该目录沿用项目的忽略规则，可通过脚本重新生成。`comparison.html` 提供同镜头的原始/分阶段/最终画廊。`after/metrics.json` 记录亮度、投影和缓存检查；`performance.json` 记录配对性能检查。

已取得的实机采样（0–255 亮度，街道同一可观察地表，DPR 结果一致）：原始 11.73，白昼 87.86，黄昏 64.26，夜晚 23.41。白昼约为原始 7.5 倍；夜晚近身地表保持可读。

最终检查记录：

| 检查 | 结果 | 记录 |
| --- | --- | --- |
| `npm test` | 695 / 695 通过 | `.review/day-night/unit.log` |
| `npm run typecheck` | 通过 | `.review/day-night/typecheck.log` |
| `npm run build` | 通过；630.62 kB JS，保留既有 500 kB 提示 | `.review/day-night/build.log` |
| `npm run test:browser` | 完整 20 个脚本通过 | `.review/day-night/browser.log` |
| 追加浏览器回归 | 时间 HUD、动态墙、建筑、战役、存档、生命体力、状态、战斗反馈、昼夜共 9 个脚本通过 | `.review/day-night/extra-browser.log` |
| 昼夜实机专项 | 亮度顺序/最低可见度、太阳方向/长影/并集/破坏、缓存复用、完整夜晚、波次接口与 F2 嵌套控件通过 | `.review/day-night/visual.log` |
| 配对夜间性能 | 12 / 12 场景通过；p95 变化 −11.0% 至 +14.0%，均在 +15% 内 | `.review/day-night/performance.json` |
| `git diff --check` | 通过 | `.review/day-night/diff-warnings.log` |

性能对照保持同一地形、角色、逻辑灯数量、感知和视口，比较旧手动环境通道与新自动夜间通道，交替 AB/BA，每次预热 12 帧、采样 40 帧，取两轮中较低的 p95。该指标是稳定镜头的 CPU 绘制成本；旧原型的完整运行基准另保存在 `baseline-performance.log`。

完整检查过程中，原有小地图“未知区域占多数”用例需明确以夜间空探索状态启动；白昼扩大探索是预期行为。调整只作用于测试初始化，保留原有比例、裁剪、相机稳定与性能断言。

## 已知限制

- 没有屋顶/室内数据，不从围墙轮廓推断室内照度；墙与烟雾仍阻挡观察。
- 人物投影为风格化近似，太阳首版方向固定；没有新增树木或箱体资产。
- 夜晚现在可持续游玩，但没有新增袭击波次、建造经济、灯具燃料或建筑攻击 AI。
- 原有单位灯只照地面的规则保留，矿块/墙顶不会被手电直接提亮；夜间高光同样遵守这些遮罩。
- 当前软件渲染浏览器的旧绝对性能基线已有 33.4ms p95、未达到旧测试的 16.7ms 门槛。本次另报告同场景/同灯数量的配对渲染成本，不把 CPU draw 时长当成真实游玩 FPS。
