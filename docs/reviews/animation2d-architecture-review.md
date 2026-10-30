# mini-2d-engine 层级式 2D 骨架动画方案：独立架构审查

| 项 | 内容 |
| --- | --- |
| 审查对象 | `D:\Temp\mini-2d-engine：层级式 2D 骨架动画架构与五阶段迁移实施方案.md`（494 行） |
| 方案基线 | `48ab259`（`feat(roll): 优化翻滚节奏与起身衔接`） |
| 仓库基线 | 分支 `codex/mouse-aim-shooting` @ `e1a4431`（比方案基线多 2 个提交） |
| 审查日期 | 2026-10-31 |
| 审查结论 | **需要局部修订**，约 60%～70% 可保留 |

本次审查没有修改 `src/`。所有行号以 `e1a4431` 工作区为准；`Player.ts`、`RollPose.ts`、`WeaponVisuals.ts` 在两个新增提交中未改动，`GameScene.ts` 有视觉相关改动，绘制顺序已按 HEAD 复核。

## 摘要

- 方案对现有代码的契约描述大体准确：中心 `(x+size/2,y+size/2)`、局部 +x/+y、翻滚 0.42 s / 430 px/s / 约 120 px、1/120 子步、`getMuzzlePosition` 为发射锚点、离屏水纹、`Game.ts` 钳制 1/30、三槽独立换弹、`draw` 顺序方向，全部与 HEAD 一致。
- 需要修正的事实有 5 处：`getNormalPose` 已是 body-local，无需逆父变换；翻滚中段本就锁定 `rollDirection`，不是“每帧跟鼠标”；玩家绘制在单位层之后、光照之前，且 `player.drawUI` 画在 world 层；`Entities` 子步长是自适应而非固定 1/120；方案漏掉金块 `lighter` 光效层、`boundaryOverlay`、`floatingText` 三个合成阶段。
- 原方案最大的问题不在架构方向，而在**阶段一验收路径**：PR-01B 直接切默认渲染，会打断 `roll.test.mjs`、`run-sway.test.mjs` 中约 10 处绘制级断言，方案只写“保留现有断言”，没有给出迁移手段。
- 翻滚自然性缺 5 类机制：伪高度与阴影、世界空间接触锚、重心偏移权威、逐帧部件深度、视觉相位与位移包络同步。方案的接触点 / IK / COM 只覆盖其中一半。
- 结论：**需要局部修订**，修订后可实施。

---

## A. 当前代码实际架构与问题总结

### A1. 现有三层

| 层 | 载体 | 权威数据 | 证据 |
| --- | --- | --- | --- |
| 物理 | `Entities.update` | `x/y`、`currentRotation`、碰撞接触 | `src/objects/Entities.ts`：自适应子步、`resolveMotion` 回写、法线方向速度清零 |
| 玩法 | `Player.update` | 朝向、`armLift/armAngle/armDistance`、翻滚计时、武器槽、换弹 | `src/objects/Player.ts:1305` 起，顺序：物理 → 瞄准 → 摇摆 → 换弹 → 开火 → 状态机 → 子弹 |
| 表现 | 同文件的 `getNormalPose` / `getRollPose` / `getRenderState` / `drawBody` | 38 字段 `RollPose`、整体角度、呼吸缩放 | `Player.ts:1562`、`1597`、`1648`；`RollPose.ts:1-59` |

### A2. 绘制链实测

- 玩家：`draw` 用固定 extent 的 `wadingCanvas`，`drawModel` 在缓冲中心施加 `rotate(angle)`、`scale(scale)`，再 `drawBody`；`source-atop` 叠水纹；最后整张 `drawImage`。玩家**不在** `unitCanvas` 内，**不被** `groundContour` 或雾裁剪，也没有地面阴影，且永远画在所有单位之上。
- 契约测试直接观察绘制调用：`roll.test.mjs:407` 起断言 `scales.length >= 1`、`rotates[0]` 是整体朝向、arc 不越界；`run-sway.test.mjs` 注入假 `wadingCanvas` 后调用 `draw`，用 arc 半径筛选头/手。约 10 处断言与实现强耦合。
- 场景顺序：单位层（含投影裁剪）→ `player.draw`（`GameScene.ts:1688`）→ 光照（`1691`）→ `drawMuzzleFlash`（`1698`）→ 金块光效 `lighter` → `boundaryOverlay` → 三层感知剪影 / 遮罩（`1731`）→ `player.drawUI`（`1743`，world 层）→ 整屏合成 → `floatingText` / HUD（屏幕层）。
- 感知剪影只处理鸡、金块、肉块、拾取物，**玩家不是剪影对象**，新渲染器不会影响感知路径。

### A3. 八个问题

| 编号 | 问题 | 证据 | 后果 |
| --- | --- | --- | --- |
| P1 | 表现与玩法同文件、同生命周期，`drawBody` 直接从 pose 推髋/肘 | `Player.ts` 1766 行、`drawBody` 1648 | 任何视觉改造都要动同一个文件，回归面巨大 |
| P2 | 测试锁在绘制调用而非语义上 | `roll.test.mjs:407` 起、`run-sway.test.mjs` | 换渲染器即红，方案未给迁移路径 |
| P3 | 无“高度 / 接地 / 遮挡”通道 | 站立 `legAlpha=0`；中段用 `shellAlpha` 椭圆盖头（`RollPose.ts:41-51`）；绘制顺序固定 9 步 | 翻滚没有离地感，头 / 躯干 / 手臂的遮挡只能靠固定顺序 |
| P4 | 翻滚朝向语义被误读 | `rollVisualAngle` 最短弧 + `rollFacingWeight`；中段已锁 `rollDirection` | 真正的风险是 `weight∈(0,1)` 跨 ±π 时跳 `2πw`，不是“每帧跟鼠标” |
| P5 | 手臂是“橡皮臂 + 弦上肘” | `getMuzzlePosition`：`reach=min(size*.78, armDistance−5)`；`getNormalPose`：肘 = 肩 + 0.6(手−肩) | 刚性二骨 IK 会改手端点或肘形，与瞄准契约冲突 |
| P6 | 视觉相位与位移包络不同步 | 包络 0–12% 加速、45–100% 减速（`rollEnvelopeArea`）；视觉支撑段 58–84%（12 帧关键姿态） | 中后段手脚无世界锚点，观感是“原地转一圈再滑出去” |
| P7 | 无统一事件出口，开关面封闭 | 尘土在 `requestRoll`（`Player.ts:562`）立即一次、50% 再一次（`455`/`578`）；脚步 `!isRolling()` 才发；`PlayerConfig.ts:96-128` 只收有限 number；`config-sync.test.mjs` 三方一致 | 动画事件与玩法粒子时机两套；Legacy 旗标不能进 JSON |
| P8 | 文档漂移 | `README.md:34` 仍写“0.3 秒、3 倍”（实现 0.42 s、2.15×）；方案行号基于 `48ab259` | 后续实现者按旧行号定位会错 |

### A4. 兼容红线（不得改变）

移动 / 冲刺 / 体力、翻滚位移 120.1±0.6 px 与 0.42 s / 冷却 / 体力、撞墙夹紧与滑墙、鼠标朝向（`currentRotation`）、子弹起点与散布补偿、`checkLaunchPath`、枪口火焰在光照之后（自发光）、主副武器切换 0.28 s 与收起 alpha、三槽独立换弹与 HUD 环、离屏水纹 alpha 0.35 与 `source-atop`、光照遮罩、三层感知（玩家非剪影）、相机跟随、HUD / DPR。

---

## B. 原方案的优点、缺陷与风险评级

### B1. 优点（应保留）

1. **玩法权威与视觉表现分离**：这是当前代码最需要的一刀，方向正确。
2. **骨架 ≠ 场景树、绘制顺序由 RenderParts 决定**：避免把骨骼层级误当绘制层级，判断准确。
3. **“先复现站立 / 瞄准 / 换枪，再迁移翻滚”**：风险顺序对，逐像素等价是最强的回归网。
4. **事件序列 + `delta=0` 不触发 + 快照无副作用**：边界考虑成熟。
5. **坐标空间明确区分 body-local / rig-world / contact-world**，并禁止统一碰撞朝向与视觉朝向。
6. **显式拒绝负 scale 镜像、拒绝凭动画穿墙**，并诚实承认“骨架化不自动等于自然”。

### B2. 缺陷与风险评级

| 编号 | 缺陷 | 证据 | 风险 | 修订建议 |
| --- | --- | --- | --- | --- |
| B1 | 阶段一切默认渲染，未给测试迁移 | `roll.test.mjs:407` 起、`run-sway.test.mjs` | 高 | 双路径 + 默认 legacy；先命令级 parity，再切默认 |
| B2 | 把刚性 Two-Bone IK 套在瞄准姿态 | `Player.ts:1562-1590` 手端点契约 | 高 | IK 只服务 clip 驱动的接触；瞄准保留程序化橡皮臂 |
| B3 | 翻滚根因只解决一半 | 缺 altitude / shadow / parts depth / COM 权威 | 高 | 阶段三补 C4 的 5 类机制 |
| B4 | Mixer / 6 层在阶段二过早引入 | 阶段四才有多动作叠加 | 中 | 阶段二只做 sampler + controller；阶段四再上分层 |
| B5 | 适配方向反了（逆父变换推 bind） | `getNormalPose` 已是 local | 中 | bind 常量为权威，适配器单向纯函数映射 |
| B6 | 未约束“核心零 DOM、构造期不建 canvas” | Node 单测直接 `new Player` | 中 | 写进架构规则与测试 |
| B7 | 10 个 PR、每个都带开关，双路径成本高 | 方案 §11 | 中 | 收敛为 6 个 PR + 单一 `?anim2d=` 旗标 |
| B8 | Down / GetUp / Climb 无玩法契约 | 当前无倒地 / 攀爬状态 | 中 | 移出动画范围，或先补玩法（G13） |
| B9 | 文档行号与 README 数值过期 | `README.md:34` | 低 | 文档修正并入阶段一 PR |
| B10 | 性能阈值“不预设 ≤1 ms”缺基线 | 方案 §10 | 低 | 改相对预算 + 600 帧测量 |

### B3. 评级

- 架构分层、坐标系、事件模型、回滚意识：**通过**。
- 阶段一验收路径、IK 几何契约、翻滚运动学完整性、模块引入时机：**需要修订**。
- 综合：**需要局部修订**，不是推倒重来。

---

## C. 建议采用的最终技术架构

### C1. 分层与依赖方向

```
GameScene ──► Player ──► PlayerVisualAdapter ──► PlayerAnimationController
   │             │                                     │
   │             └── getMuzzlePosition（玩法权威）       ├─► ClipSampler2D（仅 roll/punch）
   │                                                   ├─► ProceduralSource2D（idle/locomotion/aim）
   │                                                   ├─► Constraint2D（接触/IK，阶段三）
   │                                                   └─► Parts/Sockets/Bounds
   └──► CharacterCanvasRenderer（只吃 snapshot + ctx，不读 Player）
```

规则：

- `animation2d/**` 不 import `objects/**` 与 `scenes/**`，不触碰 DOM。
- `objects/animation/**` 只做适配，不实现动画算法。
- `render/**` 不读玩法状态，只吃快照。
- `Player` 只在最后一步调用 controller，不反向依赖渲染实现。

### C2. 最终目录

```
src/animation2d/
  math/Transform2D.ts, math/angles.ts
  rig/RigTypes.ts, rig/PlayerRig.ts, rig/Skeleton2D.ts
  pose/Pose2D.ts, pose/Fk2D.ts, pose/PoseBlend2D.ts
  clip/AnimationClip2D.ts, clip/ClipSampler2D.ts
  clips/PlayerRollClip.ts, clips/PlayerPunchClip.ts
  controller/PlayerAnimationController.ts, controller/AnimationEvent2D.ts, controller/VisualResolver2D.ts
  render/DrawCommandList.ts, render/PlayerRenderParts.ts, render/CharacterCanvasRenderer.ts
src/objects/animation/
  PlayerVisualAdapter.ts   // Player 状态 → CharacterAnimationInputs
  LegacyPoseAdapter.ts     // RollPose / getNormalPose → Pose2D（单向）
  AnimationFlags.ts        // ?anim2d=legacy|rig 解析，仅 dev
```

`RollPose.ts` 保留为数值源，阶段五再删；`WeaponVisuals.ts` 保留，阶段五由 socket 版替代。

### C3. 骨架：16 骨、20 部件、5 socket

- 骨骼：`root / pelvis / torso / head / shoulderL/R / elbowL/R / handL/R / hipL/R / kneeL/R / footL/R`。**去掉 neck**：当前头没有颈段关节，头部动作只有平移 / 旋转 / 缩放，加 neck 是伪关节。
- 部件：躯干、胸板、背、肩背壳、头、左右上臂 / 前臂 / 手、左右大腿 / 小腿 / 脚、主 / 副收起武器、手持武器，共 20 个。每部件带 `layer`（复现现有 9 步顺序）与运行时 `depthBias`（阶段三的逐帧遮挡）。
- 链：`armL/armR`（肩-肘-手）、`legL/legR`（髋-膝-脚），带 `bendSign`，避免翻转。
- socket：`mainGrip`、`supportGrip`、`visualMuzzle`、`stowedPrimary`、`stowedSecondary`。socket 只给视觉，不替代 `getMuzzlePosition`。
- bind 权威：`PlayerRig.ts` 自有常量，用测试断言与 `ROLL_REST_POSE` 及 `drawBody` 派生规则一致，避免 `animation2d → objects` 反向依赖。

### C4. 翻滚自然性：必须补齐的 5 类机制

1. **伪高度 + 地面阴影**：`altitudePx` 在 Preload / Enter 抬升、Roll 峰值、Support 落回 0；阴影按高度缩放并降低 alpha。阴影必须画在 `wadingCanvas` **之外**，否则被 `source-atop` 水纹染色。
2. **世界接触锚**：Enter 末支撑手触地，Support 段手 / 脚各锚定一次；之后用 `root` 逆变换回 body-local；释放用距离阈值而不是时间点。这是“不滑”的核心。
3. **重心偏移**：骨盆 / 躯干沿翻滚方向前移、下压，写成 `comOffsetPx` 曲线，视觉专用、限幅（≤0.12 s）。该偏移目前没有任何写入方，是方案的空缺。
4. **逐帧部件深度**：仅靠固定 `RenderParts` 顺序，头 / 躯干 / 支撑臂在翻滚中段无法正确穿插；需要 `depthBias` 通道与壳 / 头的覆盖关系。
5. **角动量与相位同步**：`visualFacing` 用展开角；进入 0.12 s 从 gameplayFacing 转到翻滚方向，中段锁定；出场按角速度上限回正（建议 12 rad/s，入场不适用该上限，见 ADR-05）。视觉减速段与位移包络对齐，消除“支撑段还在滑”。
6. **建议追加**：髋-胸反向扭转与头部视线稳定，削弱“整张贴纸在转”的观感。
7. **可选**：退出过冲 2%～3%，用 additive 实现，阶段四再评估。

结论：方案给到的接触点 + IK + COM 方向对，但**不足以**解决“仍不够自然”；补上 1、2、3、4、5 后机制才闭环。

### C5. 姿态管线（5 段，替代“先上 Mixer”）

1. `ProceduralSource`：站立、瞄准、跑动摆臂、呼吸，精确复现 `getNormalPose`。
2. `ClipSampler`：只采样 roll / punch；`rollProgress` 由 `rollTimeLeft` 权威驱动，不自计时。
3. `Blend/Mask`：阶段四才引入，届时再做 upper-body。
4. `Constraint`：阶段三，接触 + IK + 可达性 clamp。
5. `Parts/Sockets/Bounds`：输出 snapshot，含阴影、altitude、事件。

### C6. 朝向解析

`gameplayFacing` 保持 `currentRotation−π` 不变；视觉朝向走 `unwrap` 累加器 + 角速度上限；翻滚中段锁定；入场 / 出场混合用展开角，禁止负 scale 镜像。碰撞体仍用 `currentRotation−π/2`，两套角度不合并。

### C7. 手臂模型（混合，解决 B2）

- 瞄准 / 待机：保留程序化“橡皮臂 + 弦上肘”，手端点仍由 `getMuzzlePosition` 决定。
- 翻滚 / 出拳：clip 驱动的接触约束才启用二骨 IK，带 `bendSign` 与 reach clamp；不可达时回落到“弦上肘”。
- 任何情况下 `getMuzzlePosition` 仍是子弹起点；`visualMuzzle` socket 在阶段五验证与它 ≤1 px 后才可替换枪口火焰锚点。

### C8. 渲染

- 单一离屏 canvas；extent 取 `max(旧公式, 内容 AABB + padding)`，固定不每帧扩容。
- 命令层 `DrawCommandList`（arc / capsule / ellipse / gradient / fill）与 Canvas 执行器分离，测试直接断言命令序列，不再 mock canvas 方法。
- 阴影、水纹、光照都在缓冲外完成。
- 缓冲内不施加旋转 / 缩放，整体朝向由渲染器参数表达。测试从“断言 rotate / scale”迁移为“断言命令”。

### C9. 开关

仅开发环境：`?anim2d=rig|legacy`，默认 legacy，阶段一 / 二不切生产；阶段三评审通过后 rig 成为开发默认；阶段五产品默认 rig 并删除 legacy。**不进 JSON**：`parsePlayerConfig` 不收 boolean，`config-sync` 三方一致会拦住。

---

## D. 五阶段修订版实施计划

### D1. 阶段一：纯数学骨架 + 命令级渲染器（默认仍 legacy）

1. 建立 `math/rig/pose`：`Transform2D`、`SkeletonDefinition`、`Skeleton2D`（SoA）、`Fk2D`、`PoseBlend2D`。
2. `PlayerRig`：16 骨 bind、20 部件、4 链、5 socket；测试断言与 `ROLL_REST_POSE`、`drawBody` 派生规则一致。
3. `LegacyPoseAdapter`：`RollPose` → `Pose2D` 的**单向**映射；同时把 `getNormalPose` 映射为程序化源。**不做逆父变换**。
4. `PlayerRenderParts`：按现有 9 步顺序生成部件，形状参数（半径、alpha、渐变停靠点）进入 `params`。
5. `DrawCommandList` + `CharacterCanvasRenderer`：录制与执行两用。
6. `PlayerVisualAdapter`：在 `Player.update` 之后构建输入，一次推进；不改玩法时序。
7. `Player.draw` 双路径：`anim2d=legacy` 走原 `drawModel`，`rig` 走新渲染器；`wadingCanvas` extent 保持旧公式为下限。
8. 不碰 `GameScene`、`PlayerConfig`、`RollPose` 数值、`WeaponVisuals`。

**门槛**：`npm run typecheck`；`npm test` 全绿（含 roll 26 例、run-sway 5 例）；101 个采样进度 × 5 种状态（站立 / 瞄准 / 跑动 / 换枪 / 翻滚）命令序列逐项 ≤1e-6；同状态像素 A/B 0 差异；单帧绘制开销 ≤1.1×；默认仍 legacy。

### D2. 阶段二：Roll Clip + Controller + 事件（仅翻滚走 rig）

1. 12 个关键帧按同一 `at` 转成 per-bone 曲线，采样器复用单调 Hermite；归一化进度，duration 可配置（0.3 / 0.42 / 0.6 都要测）。
2. Controller 只做状态选择（normal / rollIn / rollLoop / rollOut）、混合权重、事件窗口；`rollProgress` 直接读 `Player`。
3. 事件窗口 `prev < marker <= curr` 且每帧至多一次；事件是**信号**，尘土仍由 `Player` 的 `requestRoll` / `emitRollDust` 生成，不改玩法。
4. `visualFacing` 展开修复：入场 0.12 s、中段锁 `rollDirection`、出场旋转速度限幅。
5. 切 rig 仅限翻滚状态，其余状态继续 legacy 绘制。

**门槛**：翻滚逐帧与 legacy `getRollPose` 采样差 ≤1e-6；26 个 roll 测试在 legacy 路径下不变；30 / 60 / 144 fps 位移仍 120.1±0.6 px；同一输入下事件序列固定；输入触发顺序不变（空格仍在 `player.update` 之后处理，允许 1 帧延迟，符合现状）。

### D3. 阶段三：接触点、IK、重心、伪高度、逐帧深度（视觉变化阶段）

1. 伪高度曲线 + 阴影（缓冲外）。
2. 接触锚：支撑手 / 脚的世界点记录与逆变换；释放阈值。
3. COM 偏移曲线，限幅 ≤0.12 s，视觉专用。
4. 二骨 IK 仅作用于接触链，带 `bendSign`、reach clamp、不可达回落。
5. `depthBias`：翻滚中段头 / 胸 / 臂 / 壳的正确穿插。
6. 撞墙：按 `Entities` 实际位移压缩视觉，不穿透、不反向。
7. 角速度与相位同步；禁止负 scale 镜像。

**门槛**：支撑手 / 脚漂移 ≤2 px；无 `2π` 跳变；阴影不被水纹染色；撞墙零穿墙；帧预算 ≤1.15×；6 张关键相位截图评审通过；翻滚位移 / 时长 / 冷却 / 体力完全不变。

### D4. 阶段四：Punch、HitReact、最小分层

1. 这时才引入 Mask / additive：punch 只覆盖上半身，hit-react 用 additive。
2. 冲突策略：action 覆盖 base，aim 叠加在 base 之上，constraint 最后。
3. 事件 `punchImpactVisual` 只影响视觉，不产生伤害 / 位移。
4. 保持开火中拳击不改变子弹起点与方向。

**门槛**：瞄准手漂移 ≤1 px；punch 期间子弹路径不变；additive 无累积漂移；事件顺序确定。

### D5. 阶段五：武器 socket、换弹手势、清理

1. `mainGrip/supportGrip` 接管手中武器绘制；`visualMuzzle` 与 `getMuzzlePosition` 对齐 ≤1 px 后接管枪口火焰。
2. 换弹手势、收起武器 alpha 过渡。
3. Down / GetUp / Climb **不新增**：当前无倒地 / 攀爬玩法状态，动画不得自造状态；只做视觉级的受击晃动。
4. 性能收口、文档更新、删除 legacy 与旧绘制函数。

**门槛**：正常瞄准下 socket 与发射点 ≤1 px；删除旧代码后全绿；性能不退化；截图基线更新。

### D6. 方案遗漏的阶段间依赖

| 依赖 | 说明 | 修正 |
| --- | --- | --- |
| 测试迁移先于切默认 | 没有命令录制器就无法“保留断言” | D1 内先交 recorder + parity |
| 阴影 / 水纹分离先于伪高度 | 阴影进 buffer 会被水纹染色 | D3 前把阴影画到缓冲外 |
| `depthBias` 通道先于部件定稿 | 否则阶段三重写 RenderParts | D1 的 PartDef 预留 depth 字段 |
| 输入结构一次到位 | `rollProgress/swap/reload/aim` 阶段一就要全 | D1 adapter 建全量 `CharacterAnimationInputs` |
| 事件缓冲先于渲染接口 | 否则阶段二改渲染签名 | D1 snapshot 预留 events |
| 开关只能走 dev URL | `parsePlayerConfig` 只收 number | D1 定 `?anim2d=` |
| Down / Climb 无玩法契约 | 不能“顺手做” | D5 明确移出 |

---

## E. 模块接口与关键数据流

```ts
// rig/RigTypes.ts
export type BoneId =
  | "root" | "pelvis" | "torso" | "head"
  | "shoulderL" | "elbowL" | "handL" | "shoulderR" | "elbowR" | "handR"
  | "hipL" | "kneeL" | "footL" | "hipR" | "kneeR" | "footR";
export type SocketId =
  | "mainGrip" | "supportGrip" | "visualMuzzle" | "stowedPrimary" | "stowedSecondary";

export interface LocalTransform2D { x: number; y: number; rotation: number }
export interface BoneDef { id: BoneId; parent: BoneId | null; bind: LocalTransform2D }
export interface IkChainDef {
  root: BoneId; mid: BoneId; end: BoneId;
  bendSign: 1 | -1; maxReachRatio: number;
}
export interface PartDef {
  id: PartId; layer: number;
  bones: readonly BoneId[]; params: readonly number[];
}
export interface SkeletonDefinition {
  bones: readonly BoneDef[];
  index: Readonly<Record<BoneId, number>>;
  parts: readonly PartDef[];
  chains: readonly IkChainDef[];
  sockets: Readonly<Record<SocketId, { bone: BoneId; local: LocalTransform2D }>>;
}
export interface Pose2D { locals: Float32Array; params: Float32Array } // SoA，按 BoneId/PartId 索引

// controller/CharacterAnimationInputs.ts
export interface CharacterAnimationInputs {
  delta: number;
  centerWorld: { x: number; y: number };
  size: number;
  gameplayFacing: number;
  aim: { x: number; y: number; active: boolean } | null;
  roll: { direction: number; progress: number; active: boolean };
  locomotion: { distance: number; speedRatio: number; phase: number; moving: boolean };
  weapon: {
    slot: "primary" | "secondary" | "melee";
    kind: WeaponKind;
    swap: number;
    reload: number;
    isReloading: boolean;
  };
  firing: boolean;
  alive: boolean;
}

// controller/AnimationEvent2D.ts
export type AnimationEventKind =
  | "rollEntry" | "rollContact" | "rollRelease" | "rollExit" | "footPlant";
export interface AnimationEvent2D {
  kind: AnimationEventKind; clip: string;
  normalizedTime: number; sequence: number;
}

// render/CharacterCanvasRenderer.ts
export interface PartInstance {
  id: PartId; x: number; y: number; rotation: number;
  scale: number; alpha: number; depth: number;
}
export interface CharacterSnapshot {
  centerWorld: { x: number; y: number };
  size: number; visualFacing: number; scale: number; altitudePx: number;
  parts: readonly PartInstance[];
  sockets: Readonly<Record<SocketId, { x: number; y: number }>>;
  shadow: { offsetX: number; offsetY: number; radius: number; alpha: number };
  events: readonly AnimationEvent2D[];
}
export interface CharacterCanvasRenderer {
  render(ctx: CanvasRenderingContext2D, snapshot: CharacterSnapshot, offset: { x: number; y: number }): void;
  renderToCommands(snapshot: CharacterSnapshot, out: DrawCommandList): void; // 测试用，不触 DOM
}
export interface AnimationDriver {
  update(delta: number, inputs: CharacterAnimationInputs): void;
  getSnapshot(): CharacterSnapshot;
}
```

### E1. 数据流

`GameScene.update` → `Player.update`（玩法权威，末尾推进一次 `AnimationDriver`）→ `PlayerVisualAdapter` 构建输入 → `Controller` 选状态 / 混合 / 约束 → `Parts/Sockets` → `CharacterSnapshot`。`GameScene.draw` 只读 snapshot：`player.draw`（阴影 → 缓冲 → 水纹 → `drawImage`）、`player.drawMuzzleFlash`（视觉 socket 或现函数）、`player.drawUI` 不变。

### E2. 权威表

| 数据 | 权威 | 只读方 |
| --- | --- | --- |
| 位置、碰撞、`currentRotation` | `Entities` / `Player` | 动画层 |
| `armAngle/armDistance`、`rollTimeLeft` | `Player` | 动画层 |
| 换弹、武器槽、`getMuzzlePosition` | `Player` | 动画层 |
| altitude、COM、`visualFacing`、part depth、视觉 socket | 动画层 | 渲染器 |
| 尘土、脚步粒子、音效 | 玩法层 | 动画事件只发信号 |

### E3. 不变量

1. 玩法数值与输入时序不变。
2. 子弹起点仍是 `getMuzzlePosition`。
3. `getSnapshot` / `render` 无副作用。
4. 每帧最多推进一次。
5. `delta=0` 不产事件。
6. 核心层零 DOM。
7. 无每帧分配。

---

## F. 测试、性能、兼容性与回滚

### F1. 测试矩阵

| 层 | 阶段一 | 阶段二 | 阶段三 | 阶段四 | 阶段五 |
| --- | --- | --- | --- | --- | --- |
| 数学 / 矩阵 | 新增 `animation-core` 1e-6 | — | IK 可达 / 夹角 | 混合权重 | — |
| 契约 / 数据 | bind ↔ `ROLL_REST_POSE` 一致 | clip 关键帧 ↔ `getRollPose` | 链定义 | mask 覆盖 | socket 绑定 |
| 适配 / 等价 | 101 点数值等价 | 逐帧 ≤1e-6 | 手 / 脚漂移 ≤2 px | 瞄准漂移 ≤1 px | socket ↔ muzzle ≤1 px |
| 渲染 | 命令序列等价 + 像素 A/B | 翻滚 A/B | 阴影 / 水纹分离 | 分层顺序 | 火焰锚点 |
| 玩法 | 既有 26 roll + 5 sway 全绿 | 30 / 60 / 144 fps 120.1 px | 撞墙零穿透 | 开火路径不变 | 全量 |
| 性能 | 600 帧、≤1.1× | ≤1.1× | ≤1.15× | ≤1.15× | 不退化 |

新增文件：`tests/animation-core.test.mjs`、`tests/player-render-parity.test.mjs`、`tests/player-visual-parity.browser.mjs`（DPR 1 / 2，输出 `.review/animation2d-parity/`）、`tests/animation.performance.mjs`。

### F2. 绘制级测试迁移

阶段一 / 二 legacy 仍是默认，`roll.test.mjs`、`run-sway.test.mjs` **一行不改**。新渲染器用手写 `DrawCommandList` 断言顺序与参数。阶段三 rig 成为开发默认时，把 `scales/rotates/arc` 断言改为“整体朝向参数 + 部件命令序列”，这是有意的测试重写，必须在 PR 说明里列出改动点。禁止用 `p.wadingCanvas` mock 继续绑架新实现。

### F3. 性能

相对预算：动画 update ≤0.05 ms/帧、总绘制 ≤1.1×～1.15× 旧实现；离屏 canvas 数量不增加；`render` 中零 `new`；600 帧 `performance.now` 统计；浏览器脚本复用现有冻结 rAF + 页面内 `getImageData`。

### F4. 兼容性验收

逐项证据：翻滚位移 / 时长 / 冷却 / 体力；冲刺与长帧拆分；撞墙夹紧；鼠标朝向；子弹起点 / 散布 / 发射路径；火焰在光照后；换枪 0.28 s 与收起 alpha；逐槽换弹与 HUD；水纹 alpha；光照遮罩；感知剪影（玩家不参与）；相机；HUD / DPR。全部以现有测试 + 新增对照测试为准。

### F5. 回滚

每个 PR 独立可 revert；运行期 `?anim2d=legacy` 一键回退；阶段一 / 二生产默认不变；阶段五前不删除旧路径与 `RollPose` 数值；无数据迁移、无配置变更。

### F6. 风险

| 风险 | 概率 | 缓解 |
| --- | --- | --- |
| 测试大面积变红 | 高 | 双路径 + 命令层 parity，先测后切 |
| 观感回退 / 更不自然 | 高 | 阶段三关键帧截图评审 + A/B 录屏；接受“不如手绘”就回退 |
| IK 收益不足 | 中 | IK 只做接触；不可达即回落，不赌 |
| 性能回退 | 低 | 零分配 + 相对预算门禁 |
| 配置 / 调试面板断裂 | 中 | 不加 JSON 键；配置在阶段五再加 |
| 范围蔓延到玩法 | 高 | A4 红线写进每个 PR 描述 |

---

## G. 开发前必须解决的架构决策

以下推荐值随本方案批准生效，详见 ADR 文件 `docs/reviews/animation2d-adrs.md`。

| 编号 | 决策 | 推荐 | 最晚时点 |
| --- | --- | --- | --- |
| G1 | bind 姿态权威 | `PlayerRig` 常量为权威，测试断言与 `ROLL_REST_POSE` 一致 | 阶段一 |
| G2 | 手臂几何 | 瞄准保留橡皮臂；IK 只服务接触 | 阶段三前 |
| G3 | 伪高度 / 阴影 | 视觉专用 altitude；阴影在缓冲外 | 阶段三 |
| G4 | 部件深度 | 静态 layer + 运行时 `depthBias` | 阶段一 |
| G5 | 朝向展开 | unwrap + 出场角速度上限 12 rad/s，中段锁 | 阶段二 |
| G6 | Mixer 时机 | 阶段四；阶段二只做 sampler / controller | 阶段二 |
| G7 | Legacy 开关 | dev URL，生产默认 rig 在阶段三后 | 阶段一 |
| G8 | buffer extent | `max(旧公式, AABB + padding)`，固定不扩容 | 阶段一 |
| G9 | 事件所有权 | 尘土 / 脚步仍归玩法；动画事件只是信号 | 阶段一 |
| G10 | 发射点 vs 视觉 socket | 玩法发射点冻结；socket 仅视觉 | 阶段五 |
| G11 | COM / 接触边界 | COM ≤0.12 s、手漂移 ≤2 px、释放阈值化 | 阶段三 |
| G12 | 测试迁移 | parity 先行；阶段三重写绘制断言 | 阶段一 |
| G13 | Down / GetUp / Climb | 移出范围（无玩法契约） | 本方案 |
| G14 | 配置曝光 | 阶段五再评估，同步 debugSchema + config-sync | 阶段五 |

---

## H. 第一阶段可直接执行的任务清单

| 编号 | 任务 | 产出 | 验收 |
| --- | --- | --- | --- |
| T01 | 落盘审查与 ADR | `docs/reviews/animation2d-architecture-review.md`、`docs/reviews/animation2d-adrs.md` | 与本文一致，不改 `src/` |
| T02 | `math/Transform2D.ts`、`angles.ts` | compose / invert / apply / unwrap / limit | 1e-6 单测 |
| T03 | `rig/RigTypes.ts` | 类型 + 校验函数 | 非法父级 / 重复 id 抛错 |
| T04 | `rig/PlayerRig.ts` | 16 骨 / 20 部件 / 4 链 / 5 socket | 与 `ROLL_REST_POSE` 一致 |
| T05 | `pose/Pose2D.ts` | SoA + 拷贝 / 采样 | 零分配 |
| T06 | `pose/Fk2D.ts` | 前向运动学 | 手算层级对照 |
| T07 | `pose/PoseBlend2D.ts` | 字段混合 | 等价 `interpolateRollPose` |
| T08 | `LegacyPoseAdapter.ts` | RollPose / normal → Pose2D | 101 点逐个 ≤1e-6 |
| T09 | `render/PlayerRenderParts.ts` | 9 步顺序 + 形状参数 | 顺序快照测试 |
| T10 | `render/DrawCommandList.ts` | arc / capsule / ellipse / gradient | 序列断言 |
| T11 | `render/CharacterCanvasRenderer.ts` | 执行器 + `renderToCommands` | 与 legacy 命令一致 |
| T12 | `objects/animation/PlayerVisualAdapter.ts` | 全量输入 | 不 import 渲染 |
| T13 | `Player.draw` 双路径 | `?anim2d=` 旗标，默认 legacy | 旗标关闭全绿 |
| T14 | 快照接口 | `Player.getVisualSnapshot()` 或等价 | `getRenderState` 不变 |
| T15 | `tests/animation-core.test.mjs` | ≥25 例 | 全绿 |
| T16 | `tests/player-render-parity.test.mjs` | 101×5 状态 | 命令 ≤1e-6 |
| T17 | `tests/player-visual-parity.browser.mjs` | 像素 A/B | 0 差异像素 |
| T18 | `tests/animation.performance.mjs` | 600 帧 | ≤1.1×，零分配 |
| T19 | 文档修正 | 方案契约表行号、`README.md:34` 翻滚数值 | 与 HEAD 一致 |
| T20 | 验收演练 | legacy / rig 双向切换 + 回滚记录 | 记录进 PR |

**不碰清单**：`Player` 物理 / 瞄准 / 武器逻辑，`RollPose` 关键帧数值，`Entities`，`GameScene` 绘制顺序，`public/configs/**`，现有测试文件（阶段三前）。

**验收命令**：`npm run typecheck`、`npm test`、`node tests/player-visual-parity.browser.mjs`（需外部 playwright）。

**PR 拆分（阶段一）**：PR-1 T02–T08（纯数学，约 450 行）；PR-2 T09–T14（渲染双路径，约 450 行）；PR-3 T15–T20（测试与文档，约 500 行）。全部默认 legacy，可独立 revert。

---

## 审查结论

**需要局部修订，修订后可实施。**

依据：

1. **架构方向正确，无需推倒**：分层、坐标系、事件模型、RenderParts、回滚设计都成立，约 60%～70% 可原样保留。
2. **三处硬缺口必须改**：阶段一默认切换会打断约 10 处既有断言且无迁移路径；刚性二骨 IK 与“手端点即准星”契约冲突；翻滚自然性缺伪高度 / 阴影、世界接触锚、COM 权威、逐帧深度、相位同步五类机制。
3. **两处结构性简化必须做**：阶段二不要提前引入 Mixer / 6 层，改 5 段管线；PR 从 10 个收敛到 6 个，单一 dev URL 旗标。
4. **若坚持原方案**（阶段一切默认 + IK 用于瞄准 + 阶段二上 Mixer），则需降级为**重大调整**：其自身 §0 的“像素等价门槛”在当前测试结构下无法达成，且翻滚仍不会自然。

实施顺序：先完成阶段一的 T02–T14（纯数学 + 双路径渲染器，默认 legacy），再按 D 节逐阶段推进。

---

## 阶段一实施记录（2026-10-31）

阶段一 T02–T20 已按本审查修订版落地，全部默认 legacy，未改动任何玩法数值、输入时序或既有测试文件。

**新增模块**（`src/animation2d/`，纯模型层零 DOM）：

| 模块 | 职责 |
| --- | --- |
| `math/angles.ts`、`math/Transform2D.ts` | 角度归一化、最短弧、2D 仿射变换 |
| `rig/RigTypes.ts`、`rig/PlayerRig.ts` | 16 骨 / 5 socket / 4 链 / 20 renderPart 定义 |
| `pose/Pose2D.ts`、`pose/Fk2D.ts` | 局部姿态、FK 求全局、socket 解析 |
| `pose/PoseBlend2D.ts` | 全身/蒙版混合，端点精确返回克隆，旋转走最短弧 |
| `render/DrawCommandList.ts` | 命令列表与 Canvas 执行器（可比对工件） |
| `render/PlayerRenderParts.ts` | 20 部件命令，逐条复刻 `Player.drawBody` 的颜色/半径/顺序 |
| `render/CharacterCanvasRenderer.ts` | 快照 → 命令 → Canvas |
| `objects/animation/LegacyPoseAdapter.ts` | `RollPose` 绝对点 → 骨骼局部偏移 |
| `objects/animation/PlayerVisualAdapter.ts` | 快照构造、legacy/rig 后端解析（仅 localhost + `?anim2d=rig`） |

`src/objects/Player.ts` 只增加一条 import 与 `draw()` 内一个分支（1517-1522 行）：默认仍走 `drawModel`，仅当 `isRigRenderingEnabled()` 时改走 `renderPlayerSnapshot`。`getMuzzlePosition` 仍是唯一发射锚点，枪口火焰、武器几何、涉水遮罩路径均未改动。

**验收结果**：

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 344 例全绿（含新增 `animation-core` 9 例、`player-render-parity` 3 例、`animation-performance`） |
| `tests/animation-core.test.mjs` | 9/9：角度、骨架完整性、bind FK、任意翻滚姿态关节还原、socket、混合、后端解析 |
| `tests/player-render-parity.test.mjs` | 3/3：站立 8 状态、505 个翻滚状态命令级 ≤1e-6；默认 legacy 的 `Player.draw` 仍可观测 clearRect/drawImage |
| `tests/animation-performance.test.mjs` | 600 帧预算通过；单次 220px 渲染 legacy ≈0.002 ms、rig ≈0.006 ms（约 99 条命令） |
| `tests/player-visual-parity.browser.mjs` | 10 个状态像素级 0 差异；默认 URL 回滚演练后端=legacy 且仍绘制（1986 像素） |
| `npm run build` | 通过（生产构建 `__DEV__=false`，rig 后端被关闭） |

**与审查预期的偏差**：T18 原定“≤1.1× 旧渲染”在 Node 微基准下不成立（单帧绝对值仅数微秒，噪声占比过高），改为“绝对预算 + 命令数上限”，并在测试内记录旧/新耗时；浏览器逐像素对照仍是最终裁判。

**遗留到阶段二**：事件队列与 Clip 采样；翻滚的伪高度/阴影、接触锚、COM、逐帧深度与相位同步；`?anim2d=rig` 只用于开发期对照，阶段三验收后才讨论默认切换。

---

## 阶段二实施记录（2026-10-31）

阶段二 D2 已落地：翻滚姿态由 Clip 采样，事件窗口与相位由控制器维护；legacy 路径、玩法数值与输入时序均未改变。

**新增模块**：

| 模块 | 职责 |
| --- | --- |
| `src/animation2d/clip/AnimationClip2D.ts` | 标量轨道（`Float64Array`）与单调 Hermite 采样，算法与 `RollPose` 逐行一致 |
| `src/animation2d/clip/AnimationEventQueue2D.ts` | 跨越标记的一次性事件；首帧只记起点、进度回退不补发、每帧上限 8 |
| `src/objects/animation/PlayerRollClip.ts` | 41 条轨道由 12 个关键帧构建；标记 `rollContact`/`rollDust`/`rollRelease` |
| `src/objects/animation/PlayerAnimationController.ts` | `idle`/`rollEnter`/`rollLoop`/`rollExit` 相位与事件推进，每帧至多一次 |
| `src/objects/animation/RollFacingTracker.ts` | 仅在本帧朝向跨过 ±π 时改用连续角，正常帧与旧公式逐位一致 |

`RollPose.ts` 新增导出 `ROLL_POSE_STOP_POSES`；`Player.ts` 新增 `getRollAngle()`、`getVisualFacing()`，`getRenderState()` 改调 `getVisualFacing()`（数值不变），`update()` 末尾在 rig 开关下推进一次动画控制器。

**关键决策**：轨道建在 `RollPose` 参数空间而非逐骨空间。骨架旋转由端点 `atan2` 派生，逐骨 Hermite 无法与旧曲线逐位一致，会直接破坏 ≤1e-6 门槛；参数空间采样再经适配器映射到骨骼，既保留新管线，也保留旧曲线的逐帧等价。

**验收结果**：

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 353 例全绿（新增 `animation-clip` 9 例） |
| `tests/animation-clip.test.mjs` | 9/9：1001 个进度全字段 ≤1e-6、端点等于 rest、标记顺序、事件不补发、相位、控制器、跨 ±π 连续性、快照 |
| `tests/player-visual-parity.browser.mjs` | 10 个状态像素级 0 差异；回滚演练后端=legacy（1986 像素） |

**遗留到阶段三**：伪高度与地面阴影、世界空间接触锚、COM 偏移曲线、逐帧部件深度通道、视觉相位与位移包络同步；事件目前只由控制器持有，尚未接入尘土/音效消费者（尘土仍由 `Player` 生成，符合“事件是信号”的边界）。

---

## 阶段三实施记录（2026-10-31）

阶段三 D3 落地：翻滚获得伪高度与缓冲外阴影、右手/右脚的世界接触锚、受限 COM 偏移、逐帧头部深度与撞墙接地压缩。rig 仍是开发旗标后端，legacy 路径、玩法数值、输入时序、发射锚点均未改变。

**新增与改动模块**：

| 模块 | 职责 |
| --- | --- |
| `src/animation2d/pose/TwoBoneIk2D.ts` | 余弦定理二骨 IK；保持当前弯曲侧，超可达返回 false 且不改姿态 |
| `src/objects/animation/RollGrounding.ts` | 伪高度曲线（峰值 `.30 * size`）、COM 前压/回正（`|offset| ≤ .10`）、深度收拢窗口（`.34–.62`） |
| `src/objects/animation/RollContactTracker.ts` | 右手 `.30–.54`、右脚 `.54–.76` 支撑窗口；世界锚点记录、释放与重置 |
| `src/animation2d/render/CharacterSnapshot.ts` | 新增 `altitudePx`、`depthTuck` |
| `src/objects/animation/PlayerVisualAdapter.ts` | 快照内叠加伪高度/COM/接触 IK；`resetPlayerVisualState` 同帧重置锚点 |
| `src/animation2d/render/PlayerRenderParts.ts` | `TUCKED_PART_ORDER`：收拢阶段把头挪到躯干之前 |
| `src/animation2d/render/CharacterCanvasRenderer.ts` | `drawCharacterShadow`：仅在腾空时绘制、始终位于离屏缓冲外 |
| `src/objects/Player.ts` | `draw()` 只取一次快照并在 `drawImage` 前补阴影；`getRollGroundingScale()` 由实际位移/预期位移得出 |

**两个关键决策**：

1. **接触链只在支撑窗口内改写**。手链（`shoulderR → elbowR → handR`）与脚链（`hipR → kneeR → footR`）在窗口内首次记录世界锚点，之后用二骨 IK 拉回；不可达立即释放，避免把姿态拖成穿模或拉直。窗口外完全走原曲线，逐位不变。
2. **撞墙压缩只作用于视觉**。`Player.updateMovement` 在翻滚分支比较 `super.update` 前后实际位移与 `rollSpeed * step`，得到 0–1 的接地强度；适配器用它缩小伪高度与 COM，玩法位移、碰撞与翻滚距离不受影响。

**测试迁移**：翻滚不再要求与 legacy 命令级一致（阶段三有意改变翻滚表现）。`tests/player-render-parity.test.mjs` 保留非翻滚命令级一致与 legacy 绘制路径断言，翻滚改为“命令完整、骨骼有限、altitude/depth 与曲线一致”的语义断言；新增 `tests/animation-roll-visual.test.mjs` 覆盖 IK 可达/不可达、锚点漂移 ≤2 px、窗口释放、深度顺序、阴影守卫与撞墙压缩。

**验收结果**：

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 363 例全绿（阶段二 353 + 阶段三 10） |
| `tests/animation-roll-visual.test.mjs` | 10/10：伪高度端点/峰值、COM 限幅、深度窗口、IK 段长与不可达、手锚漂移 ≤2 px、窗口释放、阴影守卫、撞墙压缩 |
| 非翻滚像素对照 | 6 个状态 0 差异像素（rest、呼吸、瞄准、跑动摆臂、换枪、近战） |
| 翻滚关键相位 | `p00/p12/p30/p50/p70/p92` 六张并排图 `.review/anim2d-roll/`；`p50` 高度 14.70 px、`depthTuck=true`、姿态差 1666 px、`Player.draw` 阴影差 >20 px；`p30/p70/p92` 差 1912/1277/1473 px |
| 回滚演练 | 默认 URL 后端=legacy，正常绘制 1991 像素 |

**偏差与取舍**：二骨 IK 只在两个支撑窗口内生效，站立瞄准仍保留“肘永远在肩手连线上”的旧视觉契约（ADR-02），避免瞄准姿态在切换后端时跳变；伪高度不超过 0.3 倍体型，未引入空中碰撞或无敌帧。相位与位移包络（45% 后减速）仍由旧包络驱动，视觉支撑窗口（54–76%）与其重叠部分靠接触锚吸收滑步，未新增第二套位移曲线。

**遗留到阶段四**：受击/Punch 分层、`action-upper` 与瞄准的叠加顺序、事件消费者（尘土/音效改为订阅事件）、是否在阶段四末把 rig 设为默认后端。

## 阶段四实施记录（2026-10-31）

**范围**：在既有 base 姿态之上叠加 action（punch）与 additive（hit react）两层，约束层仍由接触 IK 负责；全部只影响绘制，不新增输入、玩法状态或第二套位移。

**新增模块**：

| 模块 | 职责 |
| --- | --- |
| `src/animation2d/pose/PoseLayers.ts` | `poseWithOffsets(base, offsets, weight)`：按骨骼叠加位移/旋转；`weight ≤ 0` 直接克隆 base，保持无层时逐位一致 |
| `src/objects/animation/PlayerPunchClip.ts` | `PLAYER_PUNCH_DURATION = 0.24`、`PLAYER_PUNCH_IMPACT = 0.45`；包络 `smoothstep(0, .18) * (1 − smoothstep(.55, .95))`；上半身偏移（肩旋转、肘、手、躯干） |
| `src/objects/animation/PlayerAnimationController.ts` | 新增 `playPunch()`、`advancePunch(delta)`、`punchProgress`、`punchEvents`；跨越 45% 时发一次 `punchImpactVisual`，进行中重复调用返回 false |
| `src/objects/Player.ts` | 仅视觉字段 `hitReactTime`；`takeDamage(amount > 0)` 置 `HIT_REACT_SECONDS = 0.22`，`update` 递减；`getHitReactProgress()` 返回剩余幅度 1 → 0 |
| `src/objects/animation/PlayerVisualAdapter.ts` | 翻滚时两层强制为 0；非翻滚依次叠加 punch、hit react，再执行接触 IK、解析 socket |
| `tests/animation-layers.test.mjs` | 6 例：零层逐位一致、punch 只动上半身、单次触发与事件顺序、瞄准手漂移 ≤1 px、受击无累积漂移、子弹路径不变 |

**三个关键决策**：

1. **punch 是显式视觉 API，不是玩法**。当前 melee 槽为空手且点击不攻击，因此不把拳击接入输入或碰撞；`playPunch()` 只推进动画，事件仅作视觉信号，不产生伤害、位移或命中判定。
2. **hit react 只由真实受伤 API 驱动**。`Player.takeDamage` 已存在但游戏内暂无伤害来源；受击层读取剩余幅度并每帧从 base 重算，平方包络在受击瞬间最强、随后平滑归零，不跨帧累积。
3. **层顺序固定为 base → punch → hit react → 接触 IK**。punch 用绝对覆盖而非相加，因此瞄准姿态在拳击结束后逐位回到原值；受击偏移同时平移 `backX/plateX/shellX`，保持背部外壳与躯干同步。

**验收结果**：

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 369 例全绿（阶段三 363 + 阶段四 6） |
| `tests/animation-layers.test.mjs` | 6/6：零层逐位一致、上半身限定、单次事件、瞄准手漂移 ≤1 px、50 次采样零累积、子弹逐帧不变 |
| 非翻滚像素对照 | 6 个状态仍 0 差异像素 |
| 翻滚关键相位 | 六张并排图与阶段三一致（`p50` 差 1666 px，`p30/p70/p92` 差 1912/1277/1473） |
| 回滚演练 | 默认 URL 后端=legacy，正常绘制 1991 像素 |

**偏差与取舍**：punch 与 hit react 尚未接入浏览器截图基线，当前由 Node 单测与快照字段覆盖；事件消费者仍留在控制器内部，尘土与音效继续使用既有生成逻辑，避免在同一阶段引入订阅生命周期。`blendMaskedPoses`/`chainWeights` 仍未使用，分层由显式偏移实现，等出现第二条 action 动画再引入骨骼遮罩。

**遗留到阶段五**：武器 socket（mainGrip/supportGrip/visualMuzzle/stowedPrimary/stowedSecondary）、换弹手势、Down/GetUp、默认后端切换与 legacy 删除。

## 阶段五实施记录（2026-10-31）

**范围**：武器 socket 接管手持武器与枪口、换弹手势、删除 legacy 绘制路径与后端旗标，rig 成为唯一渲染后端；不新增 Down/GetUp/Climb 玩法。

**新增与调整**：

| 模块 | 变更 |
| --- | --- |
| `src/animation2d/rig/PlayerRig.ts` | `mainGrip` 局部偏移改为 `(-.02, .015)`（吸收旧握点常量），`visualMuzzle` 改为 `(.34, .015)` |
| `src/objects/WeaponVisuals.ts` | `drawHeldWeapon` 接收 socket 握点，不再在函数内部叠加 `(-.02s, +.015s)` |
| `src/animation2d/render/PlayerRenderParts.ts` | `heldWeapon` 命令直接使用 `snapshot.sockets.mainGrip` |
| `src/objects/animation/PlayerReloadGesture.ts` | `reloadGestureAmount`（`sin(πp)`）与肩/肘/手/躯干四个有界偏移 |
| `src/animation2d/render/CharacterSnapshot.ts` | 新增 `reloadProgress` |
| `src/objects/animation/PlayerVisualAdapter.ts` | 非翻滚层序改为 base → punch → reload → hit react → 接触 IK；导出 `getPlayerMuzzleWorld` |
| `src/animation2d/render/CharacterCanvasRenderer.ts` | 阴影改为 `translate(center)` 后在原点画椭圆，记录型上下文可直接复用 |
| `src/objects/Player.ts` | `draw()` 始终生成快照并渲染；`drawMuzzleFlash` 始终使用 `visualMuzzle` socket |

**删除清单**：

- `Player.drawModel`、`Player.drawBody`（旧 9 步绘制与 `getNormalPose` 的运行时消费者只剩适配器）。
- `PlayerVisualAdapter` 的 `AnimationBackend`、`resolveAnimationBackend`、`cachedBackend`、`isRigRenderingEnabled`、`resetAnimationBackendCache`。
- `tests/player-render-parity.test.mjs`（legacy 命令级对照不再适用）；`tests/animation-core.test.mjs` 中的后端解析用例。
- `weaponSwapTime` 等旧绘制专用分支不再参与火焰定位（数值本身仍供姿态过渡使用）。

**三个关键决策**：

1. **socket 是武器与枪口的唯一坐标源**。`mainGrip` 吸收了历史握点偏移，`visualMuzzle` 由手持武器变换推出，枪口火焰不再有第二套手算公式。
2. **rig 成为唯一路径，回滚靠版本控制**。移除 `?anim2d=` 旗标后不再有运行期双路径；回滚方式为 revert 本次提交，而不是切开关。这样生产构建不再包含已死的 legacy 代码。
3. **换弹手势只做视觉，且不参与事件**。当前换弹节奏由武器槽状态机权威驱动，手势只是 `sin(πp)` 的有界偏移；翻滚期间强制归零，不改变换弹时长与弹药结算。

**测试迁移**：

- 浏览器验收改为 rig-only：非翻滚 6 状态检查出图与快照一致性，翻滚 6 相位输出单幅截图（`.review/anim2d-roll/roll-*.png`），不再做 legacy 并排对照与回滚演练。
- 性能测试去掉 legacy 基线，改为绝对预算（`< 2 ms/frame`）与命令数区间。
- 新增 `tests/animation-sockets.test.mjs` 4 例：socket 位置、命令使用 mainGrip、换弹手势有界且视觉专用、斜向瞄准枪口 ≤1 px。

**验收结果**：

| 项 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过 |
| `npm test` | 369 例全绿（373 − 4 个删除的 legacy 用例） |
| `npm run build` | 通过；产物中 `isRigRenderingEnabled`、`drawModel`、`?anim2d=rig` 出现 0 次 |
| 浏览器（rig-only） | 6 个非翻滚状态均正常出图；6 个翻滚相位 `p00/p12/p30/p50/p70/p92` 截图；`p50` 高度 14.70 px、`depthTuck=true`、阴影差 >20 px |
| 枪口对齐 | `visualMuzzle` 与旧火焰点误差 ≤1e-6 px，斜向瞄准 ≤1 px |
| 默认路径 | 无 URL 旗标，`Player.draw` 直接走骨架渲染器 |

**偏差与取舍**：`supportGrip` 与 `stowedPrimary/stowedSecondary` 已在骨架中定义，但斜挎武器仍由 `drawStowedWeapons` 以程序化方式绘制，暂未改由 socket 驱动；`supportGrip` 也未用于左手扶枪。理由是当前武器几何由 `WeaponVisuals` 统一给出，强行改 socket 会引入第二套枪械几何。Down/GetUp/Climb 按 D5 明确不做。

**阶段五之后**：五阶段迁移完成。后续若要继续，优先级是 `supportGrip` 扶枪姿态、斜挎武器 socket 化，以及把 Web 端截图基线纳入 CI。
