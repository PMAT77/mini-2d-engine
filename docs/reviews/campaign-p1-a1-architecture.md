# 据点生存 V1.0 · P1-A1 架构审查与迁移设计

- 审查日期：2026-11-02（Asia/Shanghai）
- 审查分支：codex/mouse-aim-shooting
- 本地 HEAD：f82e0fdf8c972b9a84abcfa288caed02e2d3ffd2
- 状态：P1 与 P2 木墙建设已完成；实现与验证记录见第 14–19 节，下一阶段为 P3 资源、仓库与建造经济。
- 规则来源：本次对话中的模块化总计划及八项规则答复。

## 1. 结论与本次边界

当前代码适合渐进接入 CampaignSession，不需要重写 GameScene，也不需要同时运行营地和野外两套场景。主要工作是建立明确的捕获、恢复与提交边界，把现有运行对象中的持久信息转为可验证的数据。

审查确认了五个必须处理的问题：

1. 玩家装备、生存状态、快捷栏、增益、地图掉落分别由不同对象拥有。只保存 Player 或 SurvivalSnapshot 都不完整。
2. SceneManager 会先退出旧场景，再调用目标场景的异步 onEnter，且不等待其完成。现有 LoadingScene 的错误显示不能替代战役切图的恢复流程。
3. 固定种子不能保证现有遭遇在重新进入时保持不变：生成位置依赖玩家出生点，实体 ID 也依赖运行时计数。
4. 地形 HP、已发放矿石掉落、地面物品和玩家物资必须一起提交。恢复时重放破坏回调会重复生成战利品。
5. 通过接口注册的静态障碍已经参与移动和子弹碰撞，但没有建筑命中身份，也不进入现有视线及阴影轮廓查询。P2 的重点是统一这条数据通路。

A1 审查阶段只新增此报告，未修改 src、tests、配置或依赖。读取的是上述本地提交及干净工作区；没有拉取远端，也不将“本地 HEAD”表述为已核实的远端最新提交。后续用户要求继续执行的 A2 另记在第 14 节。

## 2. 已确认的规则基线

| 主题 | 本轮确认的规则 | 实施边界 |
| --- | --- | --- |
| 交付顺序 | A1 先交架构报告，审查后再进行 A2 最小实现与测试 | 本次止于 A1 |
| 世界 | 单人、单一战役、统一世界时间；只模拟当前地点 | P1 |
| 玩家持久性 | 健康、感染进度、体力、两个枪械槽、全部弹药、消耗品、快捷栏、位置朝向保留 | A 定契约，C 接适配器 |
| 动作与得分 | 切图中断可取消动作；拉环手雷禁止直接切图；短期分数与连击结束 | P1-C |
| 刷新 | 普通敌人按日取得补充资格；普通资源隔数日有限补货；稀有物默认一次性 | P1 定契约；P3/P4 实施 |
| 刷新时机 | 日期决定资格；安全加载节点执行；切图本身不产生刷新资格 | P1-C 起遵守 |
| 夜晚 | 06:00 是最终边界；全部计划波次生成且威胁清除后可主动提前结束 | P4 |
| 夜间占位 | P1–P3 在 20:00 产生夜间事件后走空夜袭流程到次日 06:00 | P1-B；P4 替换 |
| 无人防守 | 围墙拖延、陷阱杀伤，核心活到天亮即守住；损伤写回真实建筑 | 陷阱 P3/P4，结算 P5 |
| 死亡 | 玩家死亡有损失且可恢复；死亡导致跨天时仍结算当晚；核心被毁才结束战役 | 契约 P1，规则随 P4–P6 落地 |
| 存档 | 单一持续战役、自动保存、继续最新有效档；不提供自由回档 | P1-D |
| 夜袭续玩 | 保存已发生的战斗进度和剩余袭击，不能重新开始整夜 | P4 |
| 暂停 | 菜单、后台、失焦暂停；普通背包不暂停；允许建设阶段的仓储/规划界面暂停 | 现有行为可部分复用 |
| 离线 | 关闭游戏期间不推进世界，不用现实时间补算消耗或夜袭 | 全程 |

补货比例、死亡损失、倍率与难度曲线仍属于后续配置。它们不阻碍 A2 的数据模型，但不能用“配置”掩盖尚未实现的资源或夜袭逻辑。

## 3. 当前源码的事实与状态归属

下表行号均对应审查提交。链接指向仓库内源码；“现有”与“拟新增”严格区分。

| 数据或职责 | 现有拥有者与证据 | 迁移决定 |
| --- | --- | --- |
| 应用生命周期 | [main.ts:24](../../src/main.ts#L24) 复用 window.__miniGame；[Game.ts:44](../../src/core/Game.ts#L44) 创建输入、渲染和场景管理 | 在应用组合处持有一个战役会话；不让每个 GameScene 创建战役 |
| 场景切换 | [Scene.ts](../../src/core/Scene.ts) 的 changeScene/update 先调用旧 onExit，再调用新 onEnter | 战役切换由 LocationManager 协调；SceneManager 继续负责显示场景 |
| 菜单入口 | [MenuScene.ts:25](../../src/scenes/MenuScene.ts#L25) 创建 GameScene 和 LoadingScene | P1-C/D 添加新战役/继续入口；保持无战役场景的兼容入口 |
| 加载 | [LoadingScene.ts:13](../../src/scenes/LoadingScene.ts#L13) 有 generation 防迟到完成，失败时只显示错误 | 增加战役失败恢复回调及目标激活完成确认 |
| 玩家构造 | [GameScene.ts:431](../../src/scenes/GameScene.ts#L431) 创建地图、敌人、玩家、生存系统及灯光 | 继续复用构造流程；战役模式禁止隐式重新生成已有内容 |
| HP、体力、状态 | [Player.ts:170](../../src/objects/Player.ts#L170)、[Player.ts:271](../../src/objects/Player.ts#L271) | Player 保留实时计算；正式适配器捕获/恢复持久字段 |
| 武器真实状态 | [Player.ts:366](../../src/objects/Player.ts#L366) 的 weapons、ownedFirearms、activeSlot、lastFirearmSlot | 两个枪械槽分别保存，空槽用 null，不能恢复默认枪 |
| 弹药语义 | [Weapon.ts:35](../../src/objects/Weapon.ts#L35)、[Player.ts:1408](../../src/objects/Player.ts#L1408) | null 备用弹药保留为无限；有限备弹扣除目前尚未完整实现，不能声称 P1 已实现 |
| 装填进度 | [Player.ts:1477](../../src/objects/Player.ts#L1477) 会逐发入匣；切枪会取消旧动作 | 捕获已入匣数量；切图不保存动作进度，也不自动完成换弹 |
| 感染 | [InfectionController.ts:1](../../src/survival/InfectionController.ts#L1) 持有感染标志和小数秒余量 | 二者均保存；恢复不能通过 infect() 重置余量 |
| 消耗品与预占 | [ConsumableInventory.ts:3](../../src/survival/ConsumableInventory.ts#L3) 持有 counts/reserved | 数量与已拉环投掷物必须一致；不能仅用可用数量替代总数 |
| 生存快照 | [PlayerSurvivalSystem.ts:46](../../src/survival/PlayerSurvivalSystem.ts#L46) 只有生死、感染、疫苗及感染余量 | 现有 snapshot 保持调试用途，增加正式完整接口 |
| 快捷栏与手电 | [GameScene.ts:221](../../src/scenes/GameScene.ts#L221)、[GameScene.ts:321](../../src/scenes/GameScene.ts#L321) | 四格绑定和手电开关纳入玩家持久数据 |
| 增益 | [ModifierManager.ts:40](../../src/core/ModifierManager.ts#L40)、[ModifierManager.ts:149](../../src/core/ModifierManager.ts#L149) | 保存实际增益及剩余模拟秒；不使用 Date.now 补算离线时间 |
| 金块与肉块 | [Player.ts:178](../../src/objects/Player.ts#L178)、[GameScene.ts:1121](../../src/scenes/GameScene.ts#L1121) | 金块数量保存；当前肉块是拾取后直接回血，没有“肉库存”可迁移 |
| 背包 | [GameScene.ts:2109](../../src/scenes/GameScene.ts#L2109)、[BackpackView.ts](../../src/ui/BackpackView.ts) | 当前是武器/消耗品的投影视图，不再增加第二份背包库存副本 |
| 地面物品 | [GameScene.ts:208](../../src/scenes/GameScene.ts#L208)、[GameScene.ts:2121](../../src/scenes/GameScene.ts#L2121) | 当前数组是运行对象；映射为地图物品记录，持久 ID 与所有权一起迁移 |
| 地形与矿石记账 | [TileMap.ts:448](../../src/map/TileMap.ts#L448)、[GameScene.ts:899](../../src/scenes/GameScene.ts#L899) | 保存类型/HP，以及 goldDroppedByTile 对应的已发放数量 |
| 探索记忆 | [ExplorationGrid.ts:13](../../src/vision/ExplorationGrid.ts#L13)、[TerrainMemory.ts:38](../../src/vision/TerrainMemory.ts#L38) | 属于地点持久信息；保存探索覆盖和“曾经观察到”的地形，不用实时地图重建记忆 |
| 敌人与寻路 | [EnemySystem.ts:27](../../src/enemies/EnemySystem.ts#L27)、[EnemySystem.ts:190](../../src/enemies/EnemySystem.ts#L190) | 敌人存在性/HP/位置可持久；路径、搜索队列和感知缓存重建 |
| 动作与投掷物 | [ThrowableController.ts:8](../../src/throwables/ThrowableController.ts#L8)、[GameScene.ts:1949](../../src/scenes/GameScene.ts#L1949) | 区分安全中断动作与已产生资源、伤害后果的实体 |
| 暂停 | [GameScene.ts:2219](../../src/scenes/GameScene.ts#L2219) 将输入阻塞与世界暂停分开 | 沿用此区分；新增仓储/规划原因，禁止“输入阻塞即暂停” |
| 退出清理 | [GameScene.ts:1616](../../src/scenes/GameScene.ts#L1616) 清敌人、生存库存、快捷栏、投掷物、输入和 UI | 清理前必须提交；保留清理职责，不把清理后的对象作为存档 |
| 死亡入口 | [GameScene.ts:1710](../../src/scenes/GameScene.ts#L1710) 死亡后 Enter 返回菜单 | 战役路径必须走恢复/结算状态，不能沿用“重新开始一局”代替恢复 |
| 调试与显示快照 | [Player.ts:1054](../../src/objects/Player.ts#L1054)、[Player.ts:1643](../../src/objects/Player.ts#L1643) | 不用作存档：前者仅覆盖当前武器部分数据，后者含应用增益后的显示属性 |

GameScene 当前 3332 行，Player 1854 行，TileMap 891 行。没有发现现成的战役存档仓储。已有 snapshot 名称主要用于调试、HUD、感知或表现，不代表具有完整恢复能力。

## 4. 必须在迁移时保持的约束

### 4.1 配置先加载，持久状态后恢复

GameScene.load() 会调用 Player.applyConfig()；后者会按比例调整 HP/体力并限制弹匣容量。若先恢复存档再加载配置，玩家资源可能再次变化。

恢复顺序固定为：

1. 验证存档与内容版本，构造地点基础配置。
2. 加载配置，确定角色和武器的基础参数。
3. 静默恢复地形与已有建筑，重建碰撞、导航和遮挡。
4. 恢复玩家位置、真实武器属性、资源、生存状态与增益。
5. 恢复地点物品和敌人；不执行默认随机遭遇生成。
6. 恢复探索记忆，重建灯光、相机和 HUD。
7. 确认激活成功后接受输入。

位置恢复失败不能调用现有随机出生兜底后悄悄继续。正常加载应恢复保存坐标；若内容迁移造成坐标无效，使用明确的安全入口修复并记录提示，无法修复则返回已有有效状态。

### 4.2 资源所有权与地图变化必须一起提交

拾取疫苗时，库存增加和地面物品消失是一次变更；丢枪时，装备槽变空和地面枪械出现是一次变更；采矿时，地形损伤、掉落记账与新掉落是一次变更。

恢复地形不得调用会再次派发 onTileDestroyed/onTileDamaged 的正常战斗入口。增加静默数据恢复入口，并统一更新所需缓存。否则即使只“恢复一堵破墙”，也可能再次发放矿石奖励。

### 4.3 种子、生成点与实体身份必须分开

现有 EnemySystem.add() 使用 zombie-N，ThrowablePickup/DroppedWeaponPickup 使用静态计数器。GameScene.load() 还会围绕当前玩家位置重新寻找遭遇落点。

正式身份规则：

- 地点定义中的 spawnId/containerId 在内容版本内稳定，例如 residential/street-east/shambler-01。
- 可刷新的生成点带 generation。每次合法补充产生新实例，实例 ID 可由地点、生成点和 generation 确定。
- 玩家丢弃、采矿产生的物品使用战役级递增序号分配实例 ID；序号与创建记录一起提交。
- 存档恢复使用保存的实例 ID 和坐标，不能重新调用随机生成来替代恢复。
- ID 不依赖数组位置、切图次数或随机调用顺序。

同一天往返不会增加 generation。刷新资格和应用记录按生成点/容器保存，一个地点级 lastRefreshDay 不足以表达敌人每日刷新、资源隔日补货和一次性物品三种规则。

### 4.4 静态障碍的真实能力边界

[TileMap.ts:294](../../src/map/TileMap.ts#L294) 的 getCollisionObstacles() 会把 staticObstacles 加入 movement 和 projectile 两种查询。因此它们已经能挡住子弹。

缺口在于：

- blocksLightAt、blocksSightBetween、getBlockingPolygons 查询 SolidTerrain，不查询 staticObstacles。
- 静态障碍命中被标成 col/row = -1；[Bullet.ts:187](../../src/objects/Bullet.ts#L187) 只向非负瓦片坐标分派 damageTile，无法给建筑扣血。
- setStaticObstacles 是覆盖整个列表；现有交易站及 onExit 也会操作它。新增建筑不能独立覆盖同一列表。

P1-E 验证一份以 ownerId 为键的动态几何来源，通过 TileMap 的既有查询入口服务碰撞、射线、光照和导航；P2 再正式接入建筑定义、耐久及渲染。不要让每个消费者各存一份墙数组，也不要用瓦片坐标 -1 充当建筑身份。

### 4.5 世界分钟与实时模拟秒不可混用

[Game.ts:66](../../src/core/Game.ts#L66) 对每帧 delta 上限限制为 1/30 秒。时钟接入应使用同一份被接受的模拟时间，而不是额外读取墙上时钟追赶。

感染余量、增益持续时间、投掷物引信目前以模拟秒计。它们不能因为世界进入夜间或旅行跳时，就直接吃到数小时的 delta。普通帧按模拟秒更新；旅行、过夜、建设等跳时的消耗由相应业务结算器计算，再原子推进世界分钟。

### 4.6 实时防守转自动防守必须接续剩余袭击

玩家夜袭中途死亡时，不能拿完整 RaidPlan 再对已经受损的墙计算一遍整夜。

P4/P5 的交接输入必须包括：同一 raidId、原始计划、当前阶段与已生成波次、剩余敌人的 HP/位置或对应方向分组、剩余时间、当前建筑/陷阱状态、已消耗资源。未生成波次继续存在，已击杀敌人不能复活。

resolvedRaidIds 只能表达结果已完成，不能单独表达这一过程。P4 需要有 planned/active/resolved 状态的 RaidRecord，并把“结果、真实损失、结算标记”一起保存。

## 5. 建议的数据契约

本节是拟采用的契约，不是当前源码。A2 只实现创建、验证、独立快照与受约束更新；不会顺带实现全部使用这些字段的玩法。

### 5.1 战役与玩家

采用纯数据、有限数值、显式 null、可验证枚举。地点姿态只存一份，集中在 presence，避免 currentLocationId 与 player.location 冲突。位置与现有 Player 一致，为世界像素左上角；facing 为视觉朝向弧度，由适配器转换内部旋转值。

~~~typescript
type LocationId = "outpost" | "residential";
type FirearmSlot = "primary" | "secondary";
type WeaponSlot = FirearmSlot | "melee";
type ConsumableId = "vaccine" | "grenade" | "smokeGrenade";
type QuickBinding = WeaponSlot | ConsumableId;
type QuickSlots = [
  QuickBinding | null, QuickBinding | null,
  QuickBinding | null, QuickBinding | null
];
type Point = { x: number; y: number };
type Pose = { position: Point; facing: number };
type EffectStat = "maxSpeed" | "damage" | "fireRate" | "bulletSpeed";

interface PersistentFirearm {
  instanceId: string;
  definitionId: string;
  // 基础实例属性，不包含临时增益；显示名和音画资源由定义提供。
  attributes: {
    damage: number;
    fireIntervalSeconds: number;
    bulletSpeed: number;
    knockbackImpulse: number;
    magazineCapacity: number;
    reloadSeconds: number;
  };
  magazineAmmo: number;
  chambered: boolean;
  reserveAmmo: number | null; // null 精确保留无限备弹语义
}

interface PersistentEffect {
  id: string;
  stat: EffectStat;
  value: number;
  isMultiplier: boolean;
  remainingSeconds: number | null; // null 为永久；临时效果必须 > 0
}

interface PersistentPlayerState {
  hp: number; // 生死与 CampaignLifecycle 联合验证，避免多份 alive 标志
  baseMaxHp: number;
  infection: { infected: boolean; remainderSeconds: number };
  stamina: number;
  baseMaxStamina: number;
  exhausted: boolean;
  staminaRegenDelaySeconds: number;
  weapons: {
    primary: PersistentFirearm | null;
    secondary: PersistentFirearm | null;
    activeSlot: WeaponSlot;
    lastFirearmSlot: FirearmSlot;
  };
  consumables: Record<ConsumableId, number>;
  quickSlots: QuickSlots;
  gold: number;
  effects: PersistentEffect[];
  recovery: {
    rollCooldownSeconds: number;
    fireCooldownSeconds: number;
    meleeGraceSeconds: number;
  };
  preferences: {
    autoReload: boolean;
    defaultReloadMode: "reload" | "load";
    flashlightOn: boolean;
  };
}

type CampaignLifecycle =
  | { kind: "playing" }
  | {
      kind: "recovering";
      resolutionId: string;
      deathLocationId: LocationId;
      deathWorldMinute: number;
      raidId: string | null;
    }
  | { kind: "failed"; reason: "core-destroyed"; worldMinute: number };

interface CampaignState {
  schemaVersion: 1;
  definitionVersion: string;
  campaignId: string;
  worldSeed: number;
  worldMinute: number;
  revision: number;
  nextInstanceSequence: number;
  lifecycle: CampaignLifecycle;
  presence: Pose & { locationId: LocationId };
  player: PersistentPlayerState;
  locations: Record<LocationId, LocationState>;
  resolvedRaidIds: string[]; // P1 为空，P4 迁移为完整 RaidRecord
  statistics: { kills: number; expeditions: number };
}
~~~

具体约束：

- 新战役 ID/种子只在创建时生成，之后不可更改。纯逻辑层允许显式注入 ID/种子，方便测试；组合入口负责默认生成。
- 初始 HP、体力、武器和物资来自版本化的战役定义，不在多个构造函数重复硬编码。初始据点中的玩家使用明确的入口姿态。
- worldSeed/location.seed 为无符号 32 位整数；计数、序号和弹匣为非负安全整数；所有坐标、时间、HP 均为有限数。
- 弹匣不能超过容量，膛内单独计算；不能用“总可射击弹数”覆盖 magazineAmmo。
- activeSlot 为枪械槽时该槽必须非空；lastFirearmSlot 可以指向已经丢弃的历史槽，恢复选枪时按现有可用槽回退。
- 快捷栏恰好四格且不重复绑定；允许绑定数量已为零的消耗品，保持现有补货后可继续使用的语义。
- exhausted 和恢复等待会影响战斗能力，应保存；按键按住、指针位置、速度、翻滚动作和完美闪避窗口不保存。
- 冷却保存非负剩余时间。切图取消动作不会免费清除翻滚或开火冷却。
- 增益保存基础参数与剩余时间，不能把 HUD 已加成的伤害再当成基础伤害恢复。
- baseMaxHp/baseMaxStamina 是当前需维持的基础上限；未来永久成长引入明确的来源字段并迁移版本，不同时维护互相矛盾的“上限”和“成长总和”。
- playing 要求 HP > 0；HP = 0 且战役未失败时必须有 recovering 记录。不得通过普通状态更新把死亡玩家改回满血。
- 存活天数从世界时间推导，不额外保存另一个 daysSurvived。

引擎调试参数、画面和音频配置不自动成为战役成长。正式的永久属性、武器实例属性和已有增益必须保留；调试台配置快照仍作为独立调试能力。

### 5.2 地点、刷新与物品

P1 的物品联合类型只覆盖已经启用的武器、消耗品、金块和现有直接效果，不提前实现 P3 的通用物品经济。P3 再将它们迁移到统一 ItemDefinition/InventoryContainer。

~~~typescript
type CurrentItem =
  | { kind: "consumable"; itemId: ConsumableId; quantity: number }
  | { kind: "firearm"; weapon: PersistentFirearm }
  | { kind: "gold"; quantity: number }
  | {
      kind: "effect";
      stat: EffectStat | "health";
      value: number;
      isMultiplier: boolean;
      durationSeconds: number | null;
    };

interface GroundItemState {
  instanceId: string;
  position: Point;
  item: CurrentItem;
}

interface EnemyInstanceState {
  instanceId: string;
  kind: "shambler" | "runner";
  pose: Pose;
  hp: number;
}

interface SpawnState {
  spawnId: string;
  generation: number;
  lastRefreshDay: number | null;
  // null 保留“本代已死亡/已取走”的记录，不能在载入时当作未初始化。
  occupant:
    | { kind: "enemy"; value: EnemyInstanceState | null }
    | { kind: "loot"; value: GroundItemState | null };
}

interface ContainerState {
  containerId: string;
  opened: boolean;
  generation: number;
  lastRefreshDay: number | null;
  contents: CurrentItem[];
}

interface TerrainChange {
  col: number;
  row: number;
  tileTypeId: string; // 在边界校验为现有 TileTypeId
  hp: number;
  goldAlreadyIssued: number;
}

interface ExplorationState {
  cellSize: number;
  cols: number;
  rows: number;
  exploredCellIndices: number[];
  observedTiles: {
    col: number; row: number; tileTypeId: string; damageStage: number;
  }[];
}

interface LocationState {
  locationId: LocationId;
  definitionVersion: string;
  seed: number;
  initialized: boolean;
  lastVisitedDay: number | null;
  spawns: Record<string, SpawnState>;
  containers: Record<string, ContainerState>;
  // 只放玩家丢弃及玩法动态生成的物品；不重复放 spawns 中的自然物品。
  groundItems: GroundItemState[];
  terrainChanges: TerrainChange[];
  exploration: ExplorationState | null;
}

type RefreshPolicy =
  | { kind: "once" }
  | { kind: "daily-enemy"; populationCap: number }
  | {
      kind: "periodic-resource";
      intervalDays: number;
      refillCap: number;
    };
~~~

地图定义拥有尺寸、入口、固定生成点、刷新策略与初始内容；LocationState 拥有变化。定义加载器、运行对象和策略函数均不进入存档。initialized 区分“尚未生成”与“生成过但已经搜空”，不能用数组是否为空作判断。

实例 ID 在当前战役内唯一。自然生成枪械被捡起或丢弃时保持武器 instanceId；其原生成点 occupant 置空，武器不得同时存在于装备槽和地面。容器的多件相同枪械也分别具有实例 ID。

P1-C 的测试地点采用少量显式内容，未启用的小鸡、火把和交易站要明确关闭默认生成。若某个测试地点启用它们，必须同时定义相应持久变化，不能宣称“全地图状态持久”却每次重新生成这些对象。

建筑从 P2 扩展 LocationState，采用如下明确契约；A2 不创建空建筑运行系统：

~~~typescript
interface StructureState {
  instanceId: string;
  definitionId: string;
  position: Point;
  rotation: number;
  level: number;
  hp: number;
  enabled: boolean;
}
~~~

建筑所属地点由所在 LocationState 唯一决定，无需重复保存第二个 locationId。外部服务引用建筑时携带 locationId + instanceId。

刷新函数在 P1 只定接口和资格测试：输入世界日、定义策略与已应用记录，输出“无变化”或候选补充；P3/P4 才执行实际补货/补兵。跨很多天后仍受单次补充和总量上限约束，不按离开天数无限堆积。

连续滞留野外到早晨时，不在仍可操作的地图中突然刷怪。先只标记资格；在后续明确的安全重建节点应用，否则延后到下一次进入。每个补充与其 lastRefreshDay/generation 一起提交。

### 5.3 存档快照与活动地图恢复数据

PersistentPlayerState 是长期资源与状态契约，不承担正在飞行的投掷物等地点运行数据。P1-D 保存的完整快照还要包含“当前地图恢复数据”；P4 扩展这层以支持夜袭中途继续。

| 数据 | P1-C 切图 | P1-D 同地图继续 |
| --- | --- | --- |
| 正在换弹/逐发装填 | 中断；保留已入匣子弹 | 采用相同安全中断规则 |
| 翻滚/拳击/交互读条 | 中断，保留已付出的体力/资源及冷却 | 中断，不赠送无敌或免费完成动作 |
| 未进入不可取消阶段的投掷准备 | 释放预占，安全取消 | 可安全取消；总物资不变 |
| 已拉环手雷 | 拒绝切图 | 保存手持种类、引信、预占关系及必要目标信息，恢复一次预占 |
| 已投出的手雷 | P1 测试切图入口暂时禁止仍有未决爆炸的离开 | 保存现有 ThrowableBody 的必要数值和固定步长余量，不退物资 |
| 烟雾弹 | 不带到目标地图；来源地点保存其必要状态 | 保存烟雾年龄及来源实体，重建 SmokeSystem 的遮挡 |
| 飞行子弹 | 允许清理；已消耗弹药不退还 | 安全清理，既有命中不重放；接受极短弹道被截断的原型限制 |
| 敌人前摇/攻击 | 不跨图保存动作实例 | 取消未结算攻击并设置明确恢复冷却；已造成伤害不再触发 |
| 粒子、血雾、声音播放、相机震动 | 清理 | 重建或省略，不属于玩法资源 |

这部分不能全部推迟到 P4：当前版本已经有拉环手雷和实际扣除的投掷物。P1-D 若在这种状态保存，只存消耗品数字会丢失危险实体或错误退还物资。

恢复层应复用 ThrowableBody 已有的纯数值结构，筛掉回调与渲染对象，明确字段白名单和恢复约束；不设计通用实体序列化框架。后台暂停和关闭游戏不消耗保存的引信及烟雾剩余时间。

## 6. CampaignSession 的最小职责与 A2 范围

建议 A2 新增：

- src/campaign/CampaignState.ts：战役、玩家及地点基础纯数据类型，所需小型验证函数。
- src/campaign/CampaignSession.ts：创建、私有状态、独立快照与原子提交。
- tests/campaign-state.test.mjs：纯 Node 验证和状态隔离测试。

类型可以先集中在一个文件；体积增长后再将玩家/地点契约拆出。此时不创建 GameClock、LocationManager、SaveRepository 的空实现。

建议接口形状：

~~~typescript
class CampaignSession {
  static create(input: NewCampaignInput): CampaignSession;
  getSnapshot(): CampaignState;
  commitCurrentLocation(
    expectedRevision: number,
    checkpoint: CurrentLocationCheckpoint
  ): void;
}
~~~

NewCampaignInput 包含 definitionVersion、初始玩家 player、据点出生姿态 outpostSpawn，以及可选的 campaignId/worldSeed。未提供 ID/种子时使用平台原生 crypto 创建；显式提供时保持确定性。A2 建立两个尚未初始化的地点记录，从世界种子派生各自的固定种子；具体地点定义与内容加载在 P1-C 接入。CurrentLocationCheckpoint 包含 locationId、player、pose、location、reason；reason 为普通检查点，或带稳定 resolutionId 的玩家死亡观察。死亡地点和时间由会话当前状态生成，调用方不能任意替换生命周期对象。A2 的提交只能更新当前地点，不能修改 ID、种子、定义版本、时间或传送到另一地点。

更新步骤为：复制输入 → 校验字段与引用 → 校验相对旧状态的合法转移 → 一次性替换内部状态并增加 revision。失败时内部状态和 revision 都不变。输入对象、返回快照和后续提交之间不得共享可变的嵌套数组或对象。

不开放任意 Partial<CampaignState> 合并接口，不把任意回调拿到内部 state 的能力交给 UI，也不依赖 TypeScript 的浅层 Readonly 实现运行时隔离。

生命周期规则先验证，具体业务后置：

- A2 创建 playing 战役，允许同地点正常资源/健康状态更新。
- HP 到零必须作为明确的死亡观察提交，同时产生 recovering 记录；纯数据层不决定扣哪些装备或推进几天。
- 普通提交不能执行 recovering → playing 或 failed → playing；恢复和核心失败由后续专用业务入口完成。
- 时间推进属于 P1-B；换图属于 P1-C；保存/恢复入口属于 P1-D。A2 不为证明“可更新”而提前实现这些功能。

P1-C 接入新物品实例创建时，再增加由会话分配 nextInstanceSequence 的事务入口；创建物品与推进序号一起成功或一起失败。A2 不提前实现拾取、掉落或建造命令。

CampaignSession 不导入 Player、GameScene、Canvas、DOM、localStorage 或声音系统。类型边界允许复用纯类型，但不引入运行时场景依赖。

## 7. 活动地图与战役状态如何保持一致

采用显式提交模型，避免在 P1 就重写 Player 的全部字段访问：

- CampaignSession 保存唯一可提交、可存档的世界状态。
- 当前 GameScene 是活动地点实时数据的唯一写入者；Player、EnemySystem 等继续按现有流程模拟。
- 未活动地点只保留数据，不运行 AI。
- HUD 从当前实时对象读取；不能拿上一次战役快照当作当前 HP 显示。
- 保存、切图、跨天、死亡等边界，先在完整模拟步结束后捕获玩家、地图和必要恢复数据，再进行一次提交。
- 只有提交后的完整快照能交给 SaveRepository；禁止分别保存“新背包”和“旧地面物品”。
- LocationManager 不得在活动场景背后修改同一地点的数据。需要应用外部结算时，先暂停/交还运行态，再提交并恢复。

这意味着 session.getSnapshot() 是最近一次完整提交，不是绕过适配器实时窥视 Player 的接口。P1-C/D 的保存入口必须统一经过活动地点捕获；不能允许某个定时器直接保存一个尚未捕获的旧快照。

revision 用于拒绝过期的加载结果或状态提交。异步加载使用运行时 transition token；它不属于存档，不需要引入事件溯源或持久化命令队列。

## 8. 场景切换、加载失败与清理时序

### 8.1 当前顺序

MenuScene 创建 GameScene → LoadingScene 执行 target.load() → SceneManager 切到目标 → onEnter 加载/挂载界面。

地图、玩家和部分对象在构造函数创建；load() 应用配置并生成遭遇；onEnter() 注册输入、DOM 面板与监听；onExit() 清理资源。复用同一个已退出的场景不能保证恢复世界，因为 loaded/loadingPromise 仍在，但敌人和生存数据已被清理。

### 8.2 P1-C 建议顺序

1. 检查阶段、入口和动作限制。锁定本次切换，暂停模拟，阻止重复触发。
2. 安全中断动作；拉环手雷等不满足条件时直接拒绝，未扣旅行成本。
3. 捕获源地点完整快照并提交；记录该 revision 作为本次回退点。P1-D 接入后保存这个完整检查点。
4. 切到 LoadingScene，退出并释放源 GameScene。此后 sourceLocationId 仍是战役的当前位置。
5. 使用独立候选数据加载目标地图，按资格处理目标地点的刷新；候选期间不修改已提交战役。
6. 在配置和地图恢复完成后恢复玩家与目标实体，完成目标场景准备。
7. 明确等待目标激活成功。在输入仍锁定时，一次提交目标地点、目标姿态和旅行成本；随后自动保存。
8. 解除切换锁与加载暂停，目标地点开始模拟。

步骤 7 需要一个可观察的激活完成/失败结果。现有 onEnter() 捕获错误到 loadError、SceneManager 不 await 的组合不能充当成功信号。P1-C 应以小范围调整暴露 ready/activation 结果，保持普通 changeScene 的既有行为。

此流程允许旧地图释放后才准备新地图，内存中不需要两套活跃世界，也不依赖保存旧 GameScene 对象。

### 8.3 失败与迟到完成

| 故障 | 处理 |
| --- | --- |
| 检查/快照校验失败 | 原地图仍有效，解除本次锁并提示；状态未提交 |
| 目标资源加载失败 | 销毁候选对象，从源检查点创建一个新的 GameScene 恢复原地图 |
| 目标激活失败 | 清理已注册的目标监听/UI，再按源检查点恢复；不扣旅行时间 |
| 源地图重建也失败 | 保留会话与有效存档，显示可重试/返回菜单；不自动创建新战役覆盖 |
| 旧异步任务后来完成 | transition token 不匹配则释放候选，不切场景、不提交 |
| 保存失败 | 不回滚已经完成的游戏动作；保留最新内存状态和旧有效档，显示未保存并允许重试 |

未激活候选的清理应是局部 dispose，不能直接调用会重置全局输入的完整 onExit，从而影响刚恢复的活动场景。原 onExit 继续承担退出清理，不自行发起保存事务。

P1-C 的旅行成本先为 0；P5 接入真实旅行时间时，在同一提交点只结算一次，加载耗时不计入世界时间。

P1–P3 尚无完整死亡恢复规则时，战役模式应保留 recovering 状态并提供明确的原型提示，不复用旧 Enter 入口偷偷创建新战役。若需测试复活，应使用显式调试操作；正式的损失、夜袭补算与次日恢复随 P4/P5 实施。

## 9. GameClock 与阶段事件设计

建议约定 worldMinute = 0 表示第 1 生存日 06:00。生存日从 06:00 换日，日历显示从该单一值推导：

- 生存日 = floor(worldMinute / 1440) + 1。
- 当天钟面分钟 = (worldMinute + 360) mod 1440。
- 第 1 天返程截止为 720，第 1 夜开始为 840，第 2 天早晨为 1440。
- 午夜不新增一个袭击编号；当晚 raidId 归属于其 20:00 开始的生存日。

此为本报告建议的内部纪元约定，解决午夜/06:00 的编号歧义；UI 应使用“第 N 生存日”的含义。worldMinute 可含小数，不按每帧整分钟取整。

GameClock 只负责纯时间推进计划、边界枚举与阶段识别。CampaignSession 保存时间值，阶段协调器执行规则；怪物 AI 不写时间。

普通推进按时间顺序切分跨越的边界；截止、夜间开始、次日开始分别只处理一次。存档中的时间与对应后果一起提交，载入时不从零重播过去事件。暂停/加载时不推进；恢复后台时重置帧基线，不补算墙上时间。

P1–P3 的空夜袭由独立的临时阶段处理分支执行：20:00 → NightStarted → 空夜袭完成 → 次日 06:00 → DayStarted。不要把“到夜晚就跳过”永久写死在 GameClock 中。P4 接管后，夜晚只由真实袭击阶段和结束条件推进。

GameClock 的模拟测试比较等量模拟秒在 30/60/144 FPS 下的结果。现有 MAX_DELTA 意味着严重掉帧时会慢于现实时间；不能宣称任意帧率和任意卡顿都与现实钟表同步。

建设或旅行的批量时间消耗先检查阶段边界，再提交材料/状态/时间。不能先扣材料，然后才发现操作跨过夜袭开始时刻。

## 10. 持续存档与夜袭去重

### 10.1 P1-D

SaveRepository 只接受完整的已验证快照，不遍历运行对象。首版 localStorage 实现可以很小，无需新依赖。

建议为当前 campaignId 保留两个完整自动快照槽，每份包含格式版本、campaignId、单调 saveSequence、完整 payload。读取两个槽，结构与引用均有效时选择序号最高者；最新损坏则使用上一份有效档，并给出恢复提示。

写入先序列化并校验，在备用槽完成整份写入后再视为成功。不要先删除上一次有效档，也不要依赖多个独立字段逐项写入形成一致状态。saveSequence 与状态 revision 区分，不能用保存时的现实日期决定新旧。

新战役使用新的 campaignId 命名空间，首份有效快照完成后才切换活动战役标识；否则失败回退可能意外加载另一场战役。创建新战役的 UI 以后需明确处理覆盖意图，本次不实现。

自动保存触发器按用户确认规则接入，重要事件在事务完成后立即请求保存；周期保存合并同一帧重复请求。保存动作不改变游戏进度。页面关闭事件只能作为尽力保存补充，不能作为唯一保障。

schemaVersion 区分数据格式，definitionVersion 区分生成器/内容定义。未知更高版本应提示不兼容并保留原档，不能静默重置。正式迁移只在新内存副本完成验证后写新档。

### 10.2 P4/P5

RaidRecord 必须保存：

- 唯一 raidId、nightDay、稳定的原始 RaidPlan。
- planned/active/resolved 状态、已生成波次、尚未生成的安排。
- 阶段运行进度及剩余敌人必要状态。
- 已发生的资源与结构变化，以及最终结果。

P4 将 P1 的空 resolvedRaidIds 迁移为完整记录；完成标记以 RaidRecord 为唯一来源，避免数组和记录各说各话。

实时结束、无人值守结束、玩家死亡后的剩余袭击结束，调用同一结算提交入口。该入口验证 raidId 未完成，然后一次提交损伤、物资消耗、玩家恢复/战役失败及完成标记。相同请求重试不重复扣除资源。

白天死亡导致的跨天使用 resolutionId 标记待处理结果，不能只保存 HP=0 然后下次自动复活。夜间中途读档继续剩余战斗，不回到完整夜袭初始状态。

恢复最近有效自动档可能丢失最后一小段尚未保存的过程，这是已确认的崩溃恢复边界；不承诺浏览器被强制终止后仍逐帧精确恢复。

## 11. 拟修改文件与实施批次

| 阶段 | 新增/修改范围 | 目的 |
| --- | --- | --- |
| A2 | 新增 campaign/CampaignState.ts、CampaignSession.ts、campaign-state.test.mjs | 创建、纯数据验证、快照隔离、受约束更新 |
| B | 新增 GameClock 及纯逻辑测试；必要的 Campaign 事件类型 | 一份时间、边界事件、暂停、临时空夜袭 |
| C | 新增 LocationDefinitions、LocationManager、LocationRuntimeAdapter；修改 GameScene/MenuScene/LoadingScene，必要时小改 SceneManager/应用组合处 | 两地点、捕获恢复、激活确认、切换恢复 |
| C | Player、PlayerSurvivalSystem、InfectionController、ConsumableInventory、ModifierManager | 正式捕获/恢复接口；不再利用 debug setter 或显示快照 |
| C | TileMap、必要拾取对象、EnemySystem、ExplorationGrid/TerrainMemory | 静默地图恢复、稳定 ID、现有实体与记忆的最小持久化 |
| D | SaveSchema、SaveRepository、菜单继续入口、活动地点保存协调 | 校验、双槽自动档、错误反馈、当前地图恢复数据 |
| E | 最小动态墙体验证及 P2 接口决策 | 几何一致性、命中身份、导航失效和释放 |
| P2 | Structures 与正式几何适配 | 独立建筑 HP/位置，修复/破坏、遮挡、持久化 |
| P3/P4 | 通用库存/刷新、陷阱、RaidRecord 与攻城扩展 | 经济和真实防守 |
| P5 | 远征与过夜/死亡剩余结算 | 统一跨天闭环 |

接口适配可以集中由 LocationRuntimeAdapter 编排，但它不能用强制转换访问 private 字段。字段所属类提供正式 DTO 方法，编排器负责调用顺序和跨对象一致性。

当前 docs/game-design.md、docs/roadmap.md 仍描述旧的单局路线，且部分现状已过时。本报告记录新版基线；旧文档的正式更新归 P0-06，本次不批量改写以免混入 A1 审查外的交付。

## 12. 测试基线与可执行验收方案

### 12.1 本次实际执行

| 检查 | 结果 |
| --- | --- |
| git status --short | 审查开始为空，工作区干净 |
| npm test | 620/620 通过，0 失败、0 跳过 |
| npm run typecheck | 通过 |
| npm run build | 通过；Vite 提示主 JS 包约 522.73 kB，超过默认 500 kB 告警阈值 |
| git diff --check 与报告检查 | 通过；报告另检查空白、代码围栏与源码链接 |
| 浏览器游戏与浏览器测试 | 本次未运行，不据此声称视觉、交互或夜袭性能已验证 |

测试使用现有 scripts/test.mjs：将 src 编译到系统临时目录，再用 Node test runner 执行 tests/*.test.mjs。无需为 A2 引入测试框架或修改构建流程。

### 12.2 现有测试能提供的保障

| 测试 | 已覆盖 | 仍需补充 |
| --- | --- | --- |
| weapon-reload / weapon-switching | 两槽弹药、切枪中断、逐发入匣保留 | 完整捕获/恢复、空槽及 null 备弹往返 |
| zombie-survival | 感染小数余量、消耗品原子操作、死亡事件 | 生存状态恢复与跨图后余量延续 |
| backpack / tab-switch | 武器丢弃拾回、快捷栏、输入交接 | 稳定物品 ID、跨图/读档的完整所有权 |
| throwables | 预占、锁定、引信、一次消费、爆炸和烟雾 | 带危险实体的保存/恢复、切图禁止条件 |
| mining | 分段掉落和总预算、不重复支付 | 部分开采后保存/回图仍不超发 |
| exploration-memory | 覆盖与观察记忆分离 | 两地图独立记忆的序列化与恢复 |
| regression | 场景转换防重复、加载错误/取消、监听和面板清理 | 战役回退、异步激活失败、旅行成本只提交一次 |
| zombie-navigation / collision / vision | 寻路修订、碰撞与基础遮挡 | 动态结构同时改变全部查询并恢复 |

已有测试通过不意味着新的战役能力已存在。比如 regression 中的场景重入检查关注监听/面板数量，不能证明退出后敌人和物资仍完整。

### 12.3 A2 验收

运行 npm test、npm run typecheck、npm run build，新增纯 Node 用例至少验证：

1. 固定输入创建的战役 ID、种子、初始时间和地点稳定；第二个战役独立。
2. 修改创建输入、getSnapshot 返回值的深层数组/武器/地图内容，内部状态不变。
3. 合法当前地点检查点一次提交成功，revision 恰好增加一次。
4. NaN/Infinity、负数、溢出、超容量弹匣、非法 ID、重复实例、非法快捷栏均拒绝，失败不留部分写入。
5. 两枪独立，空槽不重新配枪，reserveAmmo = null 与 0 往返后仍可区分。
6. 感染剩余小数、体力与增益余量原样保存。
7. 不允许通过普通提交改变世界时间、战役身份或当前地点；过期 revision 被拒绝。
8. 死亡观察必须带 recovering 记录；普通更新不能复活或撤销战役失败。
9. 同一枪械不能同时存在于玩家、生成点、容器和动态地面掉落。
10. 模块在没有 window/document/Canvas 的 Node 环境可直接创建、验证与提交。

### 12.4 B–E 的后续验收

| 批次 | 必测场景 |
| --- | --- |
| B | 一次大步跨多个边界按序各触发一次；从边界档恢复不重播；30/60/144 等量模拟秒一致；叠加暂停原因中任一仍存在时不推进 |
| C | 受伤、感染 0.7 秒余量、主副枪不同余弹、空槽、快捷栏和增益往返保持；同日重复进入不生成新敌人/战利品 |
| C | 部分开采后离开，返回继续开采，总发放不超预算；恢复破坏地形不调用掉落回调 |
| C | 连续按出口只切一次；加载失败/激活失败恢复源地点；迟到异步任务不覆盖新状态 |
| C | 往返至少 20 次，监听、DOM 面板、音效、玩家灯和输入拥有者不积累 |
| D | 刷新页面恢复两地点、日期、坐标、弹药和物品；最后档损坏恢复上一有效档；存储拒绝写入时提示且旧档仍可读 |
| D | 消费/丢弃/拾取/死亡与保存交错，无半完成库存；拉环/飞行投掷物恢复不返还或重复消费 |
| E | 增墙→阻挡玩家/怪物/子弹/视线/光照；移除→通路恢复；已有路径失效；命中身份可指向对应建筑 |
| E | 注册墙不覆盖交易站等既有障碍；销毁候选场景不清除当前场景的障碍或输入 |

浏览器阶段复用 package.json 已有的 collision、terrain-light、visibility、perception、backpack、zombie、throwables 等脚本，按实际修改面选择执行。A2 仅新增纯模型时无需提前跑完全部图形/性能套件。

## 13. 后续执行边界

A1 的交付已经具备：当前源码依据、状态所有者、完整玩家契约、地点与刷新契约、会话最小接口、切换/失败恢复时序、存档语义、文件范围和可执行测试方案。

A1 审查后，用户要求继续，已按第 6 节范围实施 A2，并完成 B 的统一时钟、C 的地图与运行态切换、D 的自动保存及安全读取。P1-E 的动态墙体技术验证和 P2 接口决策也已完成，见第 18 节；P2 木墙建设实施见第 19 节，下一阶段为 P3 资源与建造经济。

## 14. P1-A2 实现记录

实现日期：2026-11-02。新增两个源码文件和一个测试文件：

- [CampaignState.ts](../../src/campaign/CampaignState.ts)：玩家、地点、生成点、物品、生命周期与检查点契约；完整数据校验和独立副本生成。
- [CampaignSession.ts](../../src/campaign/CampaignSession.ts)：战役创建、运行时私有状态、独立快照、基于 revision 的当前地点原子提交。
- [campaign-state.test.mjs](../../tests/campaign-state.test.mjs)：17 项纯 Node 测试，覆盖创建、隔离、物品转移、非法数据与非法状态转移。

实现时补齐了 A1 示例类型遗漏的 infection 字段，保存感染标志与不足一秒的累计余量，和报告正文及用户规则保持一致。

已落实的边界：

- 初始资源由调用方提供的版本化数据决定；创建战役不会自动补满生命、弹药或消耗品。
- 普通检查点可一起提交玩家、姿态和当前地点，校验失败不会改变任何内部数据或 revision。
- 检查点不能修改战役身份、时间、另一个地点、地点种子或定义版本。
- 地点初始化后，普通提交不能删除生成点、重置刷新代数、复活已清空的生成点或重新关闭已打开的容器。
- 武器实例在玩家、自然生成点、动态掉落及容器之间只有一个所有者；丢枪和拾回通过同一完整检查点转移。
- 死亡需要显式观察记录；进入 recovering 后，普通检查点不能直接复活。失败状态是数据契约的一部分，本阶段不提供把战役改成失败或结算恢复的业务入口。
- 纯数据模块只使用既有类型的 type import，不加载 Player、场景或地图运行模块。校验并复制快照不等于已实现浏览器存档。

实际验证：

| 检查 | 结果 |
| --- | --- |
| npm test | 637/637 通过，新增 17 项 |
| npm run typecheck | 通过 |
| npm run build | 通过；仍有既有主包超过 500 kB 的提示 |
| git diff --check / 新文件空白检查 | 通过 |

A2 未接入游戏运行入口，因此本阶段没有新的游戏界面或昼夜行为。GameClock、地图切换、保存读取及正式运行态适配按后续批次实施。

## 15. P1-B 实现记录

实现日期：2026-11-02。完成纯时间逻辑和战役提交入口，未改动现有 GameScene、主循环或 HUD。

| 文件 | 本批职责 |
| --- | --- |
| [GameClock.ts](../../src/campaign/GameClock.ts) | 单值日历推导、阶段倍率、向前推进/跳时、边界事件和独立暂停原因 |
| [PrototypeNight.ts](../../src/campaign/PrototypeNight.ts) | P1–P3 临时空夜袭协调，P4 替换 |
| [CampaignSession.ts](../../src/campaign/CampaignSession.ts) | 时钟结果原子提交、revision 校验、提前结束白天、规划暂停限制 |
| [CampaignState.ts](../../src/campaign/CampaignState.ts) | 地点日期校验复用同一生存日日历 |
| [game-clock.test.mjs](../../tests/game-clock.test.mjs) | 13 项时钟与空夜袭测试 |
| [campaign-state.test.mjs](../../tests/campaign-state.test.mjs) | 新增 6 项时钟与战役状态集成测试 |

### 15.1 时间与事件

- CampaignSession 仍是 worldMinute 的唯一持有者。GameClock 只计算给定起点的推进计划，不缓存另一份日期或分钟数。
- 初始为第 1 生存日 06:00；18:00、20:00、次日 06:00 分别产生 DuskStarted、NightStarted、DayStarted。DuskStarted 同时作为返程截止信号，不另外重复派发截止事件。
- 事件携带确定的世界分钟、生存日及战役内稳定 ID，例如 day-1:NightStarted。午夜不改变当夜编号。
- 默认白天 900 模拟秒、黄昏 120 模拟秒、正常夜间 300 模拟秒；这些是当前原型的可配置时长，尚未经过玩法平衡。配置被复制为倍率，各战役互不影响。
- 大步推进在每个边界切分剩余模拟秒，进入下一阶段后使用新阶段倍率；显式跳时按 (起点, 终点] 枚举边界。从恰好位于边界的值继续推进，不重播起点事件。
- 普通推进只在阶段边界容忍最多百万分之一世界分钟的浮点误差；显式跳时不越过请求的目标。单次最多枚举 4096 个边界，超限拒绝整次提交，避免异常输入阻塞。
- P1–P3 达到 20:00 后，临时协调器立即推进至次日 06:00，同时按顺序返回 NightStarted 和 DayStarted；剩余模拟秒继续用于次日。通用 GameClock 本身仍保留完整夜间。
- worldMinute 的跳变不作为感染、增益、引信等实时逻辑的 delta，也不会补充资源、补货、补兵或制造真实夜袭结算记录。

### 15.2 提交和暂停

- advanceTime(expectedRevision, deltaSeconds) 在计算成功后一次提交新时间，revision 只增加一次；零推进及暂停不消耗 revision。失败保留完整原状态。
- getClockReading 返回轻量、独立的读数，避免每帧深拷贝整张地图。持久快照依然通过 getSnapshot 获取。
- 菜单、失焦、后台、加载、仓储、建造规划和调试暂停分别记录，解除一个原因不会解除其他原因。暂停不入存档，不记录墙上时间，不在恢复时补算。
- 仓储和建造规划暂停只能在营地白天开启；普通背包不属于暂停原因。未来 UI 必须同时暂停实时模拟，不能只停世界钟表。
- endDay 仅允许存活战役在营地白天调用，并停在 18:00，保留完整黄昏；有其他暂停原因时不推进。确认弹窗及确认后关闭相应暂停由后续 UI 接入负责。
- recovering 或 failed 状态不允许普通推进，避免通过跳时绕过死亡/核心失败结算。

### 15.3 验证与后续接入

| 检查 | 结果 |
| --- | --- |
| npm test | 656/656 通过；本批新增 19 项 |
| npm run typecheck | 通过 |
| npm run build | 通过；既有主包 522.73 kB 提示仍在 |
| git diff --check / 新文件空白检查 | 通过 |
| 浏览器/视觉验收 | 本批没有运行，尚未接入游戏画面 |

新增用例验证多日大步推进、边界恢复不重播、30/60/144 FPS 的等量模拟时间结果、叠加暂停、空夜袭、超限原子拒绝、过期检查点、资源不被跳时篡改及死亡状态禁止普通推进。帧率测试使用相同的已接受模拟秒数，不代表卡顿时对现实钟表追赶。

P1-C 负责让当前活动场景与 CampaignSession 共享运行态生命周期，连接主循环的模拟 delta、现有暂停菜单、失焦/后台/加载事件和最简时间显示。返回前台时需重置帧基线。阶段时长应来自同一版本化配置；P1-D 读取快照时恢复 worldMinute，而不是从 0 重播事件或恢复上次 UI 暂停原因。P4 替换临时夜袭协调时，还需把真实袭击后果与时间推进放入同一事务，不能只用事件 ID 代替结算记录。

## 16. P1-C 实现记录

实现日期：2026-11-02。当前已接通两张地图、完整玩家运行态与地点状态、事务式切图、统一时钟和游戏界面；不包含浏览器存档。

### 16.1 可操作的验证地图

- 主菜单 N 新建据点战役；Enter 保留原自由测试入口，便于既有战斗和视觉回归。
- LocationDefinitions 提供营地与废弃住宅区的尺寸、入口、明确的固定内容及定义版本。出生和切图均采用入口的位置与朝向；切图不使用随机安全位置来掩盖无效存档位置。
- 从入口附近的按钮往返。营地只允许白天出发；住宅区目前允许返回，返程超时后果由 P5 接入。P1 旅行耗时为零。
- 营地包含两块矿石，住宅区包含墙体、四块矿石、三名丧尸和三件消耗品。固定生成点保留 spawnId、generation、lastRefreshDay 与耗尽记录，重新进入不会调用旧随机遭遇生成器。
- 按 A1 边界关闭战役地图中的小鸡、火把和交易站；这些对象尚无本阶段认可的持久数据契约。自由测试仍保留原功能。

### 16.2 捕获、恢复与状态归属

没有新增通用的 LocationRuntimeAdapter 抽象层：GameScene 负责组合各状态所有者的捕获和恢复，Player、生存系统、增益系统、地形及感知模块各自提供小型接口。

| 状态 | 实现与保证 |
| --- | --- |
| 玩家核心 | HP、最大 HP、体力、耗尽锁定、恢复延迟、黄金、动作冷却、当前及上次枪械槽、入口姿态；完整校验后才改运行对象 |
| 装备 | 两个可空枪槽、稳定实例 ID、定义 ID、枪械属性、弹匣、膛内状态及备用弹药；明确区分 0 与无限备用弹药 null |
| 生存与操作 | 感染及不足一秒的累计、消耗品、快捷栏、手电和装填偏好、增益 ID/数值/剩余秒数 |
| 地点 | 被破坏或受损的瓦片、已发放矿石收益、地面物品、敌人 HP/位置/朝向、固定生成点耗尽状态、探索格与已观察地形 |
| 动态掉落 | 首次捕获时分配战役实例序号，与地点和玩家在同一事务提交；固定增益掉落保留既定数值，不因返回重抽 |
| 恢复安全性 | 配置加载完成后再应用快照；无效玩家或敌人位置拒绝候选；地形恢复不触发伤害、击碎或掉落回调，并恢复受损矿石外观 |

活动地点的运行对象仍是当前权威；CampaignSession 在切图或死亡结算点接收完整检查点，时钟每帧只提交轻量读数更新，不深拷贝地图。P1-D 保存前必须捕获当前地点，不能直接将会话中的旧地点快照当作最新运行态。

枪械掉落与玩家枪槽使用同一物品契约。当前地面消耗品和金块只支持单件实例，批量堆叠快照会明确拒绝。敌人短期 AI、攻击前摇、飞行子弹、粒子及战斗连击不做跨图持续；正式夜袭恢复另属 P4。

### 16.3 切图事务和失败恢复

1. LocationManager 检查阶段、入口距离、存活和暂停状态；拉环手雷、尚未消亡的投掷物或烟雾会阻止离开。可取消的装填、拳击、未拉环投掷准备及背包操作在出发前收束。
2. 暂停源场景并捕获玩家、源地图及动态实例序号。源场景保留完整运行对象，候选场景在后台完成配置和数据恢复。
3. 候选准备完成后，通过 SceneManager.changePreparedScene 暂停源场景的界面与输入所有权，同步激活候选，再原子提交两张地图、随身资源、目的地及序号。
4. 校验或激活失败时销毁候选并恢复源场景，保留原资源和会话版本；提示失败并允许重试。只有提交成功才释放源运行态。提交后的旧资源清理异常不能回滚已提交的目的地。
5. 取消与重复请求由递增代次控制；迟到候选只清理自己持有的资源，不解绑当前场景的输入、时钟或 HUD。每次恢复重置帧时间基线。

新增 onSuspend/onResume/onEnterPrepared 生命周期，避免为了验证候选而提前销毁源场景。CampaignSession.commitLocationTransition 校验两侧检查点、资源一致性、版本与序号单调性，最后才替换状态。

### 16.4 时间、界面与死亡边界

- GameScene 的有效模拟秒推进唯一 worldMinute；菜单、调试面板、失焦、后台、加载的暂停原因独立叠加，并同时暂停模拟。背包继续实时运行。
- 桌面及窄屏已接入工作区同时开发的 DayClockHud，显示来自 CampaignSession 的日期和阶段；CampaignHud 保留出发、取消和结束白天操作，位于时间下方，避免重复显示钟表。
- “结束白天”需要再次点击确认，停在 18:00，保留黄昏。到 20:00 使用 P1–P3 空夜袭占位推进至次日 06:00；没有真实袭击、离线追赶、隐式补给或资源刷新。
- 玩家死亡以完整检查点进入 recovering，停止普通推进和切图，显示等待恢复结算；不会因 Enter 或切图普通流程复活。正式死亡损失与恢复玩法未提前实现。
- P1-C 交付时战役仅驻留内存；后续 P1-D 已补齐继续游戏及双槽自动存档，见第 17 节。

### 16.5 验证

| 检查 | 结果 |
| --- | --- |
| npm test | 669/669 通过；包含 P1-C 运行态/事务用例及并行时钟 HUD 用例 |
| npm run typecheck | 通过 |
| npm run build | 通过；本次构建主包 575.80 kB，仍有超过 500 kB 的打包体积提示 |
| npm run test:campaign-browser | 通过；连续 20 次完整往返、两地图状态、加载/激活失败、取消与迟到候选、危险投掷物、叠加暂停、结束白天、死亡和 UI 数量 |
| npm run test:zombie-browser | 通过；丧尸、战斗反馈、完美闪避三个浏览器套件 |
| npm run test:mining-browser | 通过；DPR 1/1.25/2 的矿石收益、破损和遮挡 |
| npm run test:throwables-browser | 通过；投掷锁定、暂停、烟雾与界面 |
| 背包及 inventory-actions 浏览器脚本 | 分别通过；背包实时模拟、暂停、拖放回收、快捷栏与消耗品使用 |
| 桌面与 390×844 画面 | 已检查 .review/campaign-outpost.png、campaign-mobile.png；时间与操作区不覆盖小地图 |
| git diff --check | 通过 |

旧丧尸准星用例补上当前规则要求的右键瞄准，并以敌人的实际位置计算鼠标目标，避免已经移动的敌人仍使用最初生成坐标；没有改动准星识别规则。背包组合脚本的一次运行受到开发服务器热更新打断，随后在代码稳定后单独重跑 inventory-actions 通过。

本阶段没有增加依赖，也未提交 Git。P1-C 完成后，按原计划继续 P1-D 自动存档；P1-E 建筑碰撞验证、资源刷新策略执行器、正式夜袭与死亡恢复仍在各自阶段实施。


## 17. P1-D 实现记录

实现日期：2026-11-02。本批完成本地自动存档、继续游戏、双槽异常恢复，以及同地图恢复所需的现有投掷物运行态。复用 P1-C 的捕获、恢复和候选场景激活流程，没有新增依赖或通用实体序列化框架。

### 17.1 存档格式与写入保护

SaveRepository 将存档封装与读写放在一个文件，复用 CampaignState 的严格校验。每份封装包含 formatVersion=1、campaignId、saveSequence、完整 payload，以及当前地点的 runtime；运行态的字段白名单和约束由 LocationResumeState 定义。

- 活动索引为 mini-2d-engine:campaign:active；每个战役的两个完整快照位于 mini-2d-engine:campaign:<编码后的 campaignId>:0/1。
- saveSequence 独立于 revision 和世界时间。两个槽中优先读取序号较大且有效的快照；不存在自由选择旧档的 UI。
- 每次先验证、复制并序列化，再用单次 localStorage.setItem 写另一个槽。失败不删除或覆盖最后有效槽，不回滚已经完成的游戏动作。
- 新建战役先完成场景准备及首份快照写入，再切换活动索引；成功后才清理旧战役的两个槽。索引写入失败时保留旧索引，并尽力清理未激活的新槽。
- 结构损坏、非法数据或当前地图恢复位置无效时尝试同一战役的上一有效快照，并显示恢复提示。两份均无效时保留原始数据并留在菜单，不自动新建。
- 未知更高的封装/数据格式，或不兼容的内容定义版本，明确提示并保留原档，不静默回退到不兼容数据的旧副本。
- 写入前核对活动索引和已观察的槽内容；发现其他窗口改动时停止本窗口写入，提示刷新后继续。这是本地单一写入窗口的冲突保护，不是云同步或多设备并发存档服务。

### 17.2 自动保存与继续流程

LocationManager 是唯一保存协调入口。每次先捕获当前活动地点、玩家及运行态，提交完整检查点，再交给 SaveRepository。没有直接将会话里尚未捕获的地点数据当作最新世界保存。

| 触发点 | 行为 |
| --- | --- |
| 新建战役 | 首份有效快照完成后才激活为当前战役 |
| 出发和成功抵达 | 加载前保存源地点，切换事务成功后保存目的地；加载中的重复请求排队 |
| 普通游戏 | 每 30 秒已接受的模拟时间自动保存；暂停和后台不累计周期 |
| 阶段变化/结束白天 | 保存已经完成的时间与状态事务；P1 空夜袭同帧合并为次日的完整状态 |
| 玩家死亡 | 先完成不可取消手雷的落地与物资扣除，再把 recovering、玩家、地图和运行态一起保存 |
| 暂停、失焦、隐藏、pagehide | 尝试捕获并保存；相同内容请求合并，不连续挤掉备份 |
| 保存失败 | 保留最新内存状态和已有完整档，显示错误及“重试自动保存”；不会每帧重复写入 |

菜单提供 C/按钮“继续战役”、N/按钮“新建据点战役”，Enter 保留自由测试。有活动战役时，新建需要第二次确认，可用 Esc 取消。继续时先校验存档，再用保存的地图 ID、实际位置和朝向准备候选；激活失败恢复菜单，原存档不变。加载资源失败不被误当作存档损坏而自动回退。

CampaignSession.restore 直接恢复权威 worldMinute，不重播过去的日期事件，不恢复上一次的 UI 暂停原因，也不按关闭期间的现实时间推进。recovering/failed 原样恢复；P1 的死亡仍等待后续正式恢复规则，不会因继续游戏获得复活。

### 17.3 活动地图运行态与安全恢复

本批落实第 5.3 节的现有玩法要求，保存危险状态时不会仅保存库存数字：

- 手持已拉环手雷：保存引信、目标与返回武器槽；读取后只恢复一次库存预占，按新输入继续投掷，不伪造松手事件，不退还或重复扣除物资。
- 飞行/落地手雷和烟雾弹：保存 ThrowableBody 的白名单数值、稳定 ID、已用 ID 计数及固定步长余量。恢复不重新发射、不重放落地声音或已经完成的爆炸。
- 已成形烟雾：保留烟雾年龄、来源实体和物理状态，重建 SmokeSystem 及地图视线遮挡。引信和烟雾年龄不会因为离线时间缩短。
- 换弹、翻滚、拳击、交互和未拉环准备采用已确认的安全中断规则，保留已实际消耗/装入的资源和玩家冷却。飞行子弹可清理，已消耗弹药不返还。
- 敌人旧攻击不重播；同地图继续时取消未结算前摇，经过该敌人配置的一次 recovery 时间后才能重新起手。正式夜袭的波次与阶段恢复仍由 P4 扩展。
- 处理帧末近战致死：即使死亡发生在本帧投掷物更新之后，保存前仍完成已拉环手雷的单次落地/扣除，避免留下可恢复的旧存活档。

投掷物位置、ID、阶段、引信、预占与库存关系均参与验证。活动数据与战役数据放在同一个槽、同一次写入；不存在分开保存库存和飞行物导致重复消费或物资复制的窗口。

### 17.4 验证与边界

| 检查 | 结果 |
| --- | --- |
| npm test | 679/679 通过；涵盖双槽、失败保护、版本拒绝、状态恢复、运行态校验和预占恢复 |
| npm run typecheck / npm run build | 通过；主包 589.95 kB，既有超过 500 kB 的构建提示仍在 |
| npm run test:campaign-save-browser | 通过；两图/日期/坐标/弹药/丢枪/地形刷新恢复、周期/阶段/pagehide/死亡保存、容量错误重试、坏档/非法位置回退、未来版本拒绝、新战役失败保护 |
| 投掷物刷新验收（同上） | 已拉环、飞行及烟雾状态分别刷新；引信和物理余量保持，烟雾遮挡一致，爆炸只执行一次，死亡携带手雷扣除一次 |
| npm run test:campaign-browser | 通过；连续 20 次往返、暂停、失败与迟到候选恢复，监听和 DOM 数量稳定 |
| npm run test:day-clock-browser | 通过；6 种尺寸 × DPR 1/1.25/2/3，背包/暂停/切图及既有 HUD 像素回归 |
| npm run test:throwables-browser | 通过；鼠标组合、锁定、暂停、烟雾与 DPR 1/2 |
| npm run test:zombie-browser | 通过；丧尸、战斗反馈与完美闪避三个套件 |
| git diff --check / 新文件空白检查 | 通过 |

页面关闭保存是补充保障；浏览器强制结束时，恢复最近完整自动档，不承诺逐帧记录。存档属于当前浏览器和站点来源，未实现云同步、手动历史档管理或自由回档。没有真实夜袭，因此不把空夜袭占位保存冒充正式 RaidRecord 恢复。

截图为 .review/campaign-continued.png 与 .review/campaign-save-error.png。原菜单单测的输入桩现只模拟它声明的 Enter 键，并提供清除输入方法，避免把 Esc、N、C 同时当成按下。本批没有提交 Git；下一阶段为 P1-E 动态墙体技术验证。


## 18. P1-E 动态墙体技术验证与 P2 接口决策

实现日期：2026-11-02。已完成最小可交互墙体验证及回归，P1 阶段结束。新增内容集中在 TileMap 的对象归属几何入口、子弹命中分发和现有画面缓存接入；没有把正式建造、建筑经济或建筑存档提前塞进本阶段。

### 18.1 统一实心几何入口

TileMap.registerSolid(ownerId, colliders, onProjectileHit?) 注册一个对象的完整实心多边形，并返回只属于该次注册的释放函数。登记时复制并验证碰撞形状和姿态；失败不会改动原注册或导航版本。

| 消费者 | 接入方式 |
| --- | --- |
| 玩家与丧尸移动 | getCollisionObstacles 加入注册物体；继续使用 ActorCollisionWorld/既有运动求解器 |
| 子弹与枪口扫掠 | ShapeCastHit 保留 CollisionObstacle.ownerId；onProjectileHit 接收不可变 BulletImpact，扣血和结构销毁由对象所有者执行 |
| 视线与听觉遮挡 | blocksLightAt、blocksSightBetween 查询相同多边形；原 SightGeometry/VisionSensor 等调用方沿用既有入口 |
| 点光、软阴影、地形短阴影 | getBlockingPolygons/getShadowEdges 包含注册几何；环境分块签名加入实心几何版本，拆墙无需手动清缓存 |
| 地面/单位遮罩 | GameScene、PerceptionRenderer 和 LightingSystem 改用统一 clipGround/fillGround，重叠墙体或墙体与瓦片相交时不产生 evenodd 抵消空洞 |
| 导航 | 注册、替换和移除增加导航版本；旧网格失效，待执行路径取消，下一请求使用新几何计算 |
| 生命周期 | 释放函数核对该次注册的身份；旧释放任务不删除同名对象的新版本，不影响其他地图或旧的交易站障碍 |

保留 setStaticObstacles 兼容原交易站等对象，它与新注册表互不覆盖。col/row=-1 继续作为非瓦片的兼容标记，实际命中对象由 ownerId 和该次注册的回调识别，不把 -1 当作建筑身份。

没有注册墙体的现有场景保持快速查询路径。当前注册表使用少量物体的线性范围筛选；建筑达到数百个时，应在此入口增加空间索引，不给每个消费者维护独立墙数组。

### 18.2 可复现的验证场景

1. 运行 npm run dev，使用终端输出的开发地址访问 /tests/dynamic-wall-fixture.html。
2. 初始墙体 HP=30，玩家在左、丧尸在右。点击“双方向前移动”，两者由实际 ActorCollisionWorld 求解并停在各自墙边。
3. 点击“射击”三次，每次由真实 Bullet 扣除 10 HP；第三次移除注册几何，路径、视线和照明随即恢复。
4. 可用“注册／重建墙体”“移除墙体”和“重置位置”重复验证。页面展示 HP、实际命中次数、视线及导航版本。
5. 运行 npm run test:dynamic-wall-browser 自动覆盖上述操作、硬/软光、环境光缓存、重叠遮罩及 DPR 1/1.25/2。截图保存到 .review/dynamic-wall/closed-dpr-*.png 与 open-dpr-*.png。

场景直接复用 Player、EnemySystem、ActorCollisionWorld、Bullet、NavigationScheduler、TileMap 和 LightingSystem。按钮为技术验收操作；尚未加入战役的正式建筑目录、放置规则或结构存档。

### 18.3 P2 正式实施决策

- Structures 持有建筑实例 ID、定义 ID、位置/朝向、HP 与持久状态；TileMap 只持有由这些数据派生的运行态几何，不拥有建筑资源或自动存档规则。
- 每个建筑以稳定实例 ID 作为 ownerId 注册，保存释放函数。拆除、击毁或地点退出释放该次注册；换朝向、开关门等几何变化使用同 ID 的新注册替换。HP 变化若不改变通行性，不触发拓扑重建。
- 子弹沿新回调进入 Structures 的扣血方法；近战、爆炸和后续攻城也应调用相同的结构扣血入口。P1-E 只验证子弹伤害，尚未让近战或爆炸自动给建筑扣血。
- 注册入口目前表达“移动、弹道、视线、光照都阻挡”的实心多边形。P2 先接普通木墙；门、透明材料或特殊设施确有需求时，再扩展相应阻挡策略。圆形遮挡轮廓本阶段明确拒绝。
- 存档保存建筑 DTO，在候选地点加载时重新注册几何和渲染；不保存 Collider、释放函数或回调。新增结构字段必须升级/迁移存档契约，并保持资源消耗、结构变化与保存的事务边界。
- 地面裁剪和蒙版统一使用 clipGround/fillGround；原始 getGroundContour 路径不能直接作为相交结构的 evenodd 并集使用。测试已验证两个墙体及墙体/瓦片重叠区的地面 alpha=0、顶面 alpha=255。
- 注册物体的真实外观仍由 Structures 绘制，本实验页使用简单墙顶色块。相邻建筑的内边合并、结构的长期可见性记忆和大规模遮挡优化属于 P2 的正式接入工作；本阶段不宣称已完成通用建筑轮廓合并器。
- 放置验证必须检查世界边界、现有物体和动态角色，防止把新墙直接放进角色身体。此项属于 P2；P1-E 提供的入口校验几何有效性，不替代玩法层的合法放置规则。

### 18.4 实际验证

| 检查 | 结果 |
| --- | --- |
| npm test | 683/683 通过；新增 4 项几何/伤害/导航/归属测试 |
| npm run typecheck | 通过 |
| npm run build | 通过；主包 592.54 kB，既有超过 500 kB 提示仍在 |
| npm run test:dynamic-wall-browser | 通过；三种 DPR 下的真实物理阻挡、单次伤害、击毁移除、路径绕行/恢复、硬/软光及缓存和重叠遮罩 |
| npm run test:terrain-light-browser | 通过；原地形光照/短阴影回归 |
| npm run test:collision-browser | 通过；63 项 DPR/帧率/形状及长帧检查 |
| npm run test:perception-browser | 通过；未知轮廓、记忆、剪影遮挡、墙顶和渐变 |
| npm run test:campaign-browser | 通过；连续 20 次往返、失败恢复、暂停、死亡和清理 |
| npm run test:campaign-save-browser | 通过；刷新、双槽异常恢复、投掷物/烟雾及死亡保存 |
| git diff --check / 新文件空白检查 | 通过 |

回归检查发现零长度视线查询必须保留“起点可见则畅通”的原语义，已修正并通过原随机射线对照测试。当前变更未增加依赖，也没有提交 Git。下一阶段按总计划进入 P2 据点建设基础。


## 19. P2 据点建设基础 · 木墙实现记录

实现日期：2026-11-02 至 2026-11-03。按总计划 P2-01 至 P2-10 接入第一种正式建筑：普通木墙。沿用已确认的阶段边界，P2 提供免费建设和修理，材料、仓库、返还和真实操作耗时在 P3 接入；当前免费操作不扣世界分钟。

### 19.1 数据、耐久与运行态所有权

- StructureDefinition 定义 wood-wall、等级 1、最大耐久 120、长度 1 格、厚度 0.32 格。当前地图 50 像素一格，对应 50×16 的横墙或 16×50 的竖墙。
- StructureState 保存稳定实例 ID、定义 ID、等级、列/行、横/竖朝向、实际 HP、standing/destroyed 和上次观察到的 HP。建筑数据位于各 LocationState.structures 中，不存 Collider 或回调。
- GameScene 的 StructureSystem 持有活动建筑运行态，捕获地点时输出独立 DTO；几何仍通过 P1-E 的 registerSolid 注册，子弹命中回调只通知该建筑所有者。
- 玩家建造使用战役 nextInstanceSequence，结构实例与计数一起进入完整检查点。拆除后重建获得新 ID；同一实例 ID 不能同时出现在装备、掉落或另一地点中。
- 未摧毁的受损墙仍阻挡移动、弹道、视线与光照。部分受损和修理不改导航版本，HP 到零才释放几何、取消旧路径并保留残骸记录；清理残骸或拆除显式删除该实例。
- 读档时先验证全部建筑及相互重叠，再注册到候选地图。保存的玩家/敌人位置被墙占据时拒绝候选并沿用 P1-D 备份恢复，不随机挪走角色。
- 每个地点最多保留 512 条建筑/残骸记录；清理残骸后可继续建造。此上限是数据边界，不代表已证明 512 面墙的渲染性能。

### 19.2 建设界面和放置规则

营地白天点击顶部“营地建设”进入规划。将面板中的木墙拖到地图，或在地图按住拖动预览，松手后自动按网格放置；不再提供列/行输入。R 切换新墙横/竖朝向，黄色框标识选中的已有建筑，绿/红预览提示基本放置检查，Esc 或“完成建设”退出。点击已有墙体后管理选择保持稳定，可移入面板进行修理或拆除。桌面使用侧面板，窄屏使用底部双列面板；支持触控拖拽，方向键和放置按钮保留键盘操作。

- 建造、修理与拆除操作距离 175 世界像素；已拉环或尚未消亡的投掷物、加载、非营地、黄昏/夜间、死亡及其他暂停状态均不能开始建设。
- 规划使用独立 construction 暂停原因，同时暂停实时模拟和世界时钟。关闭规划不会解除失焦、后台或菜单等其他暂停原因；规划期间背包与 F2 不争抢输入。
- 放置验证地形、原有障碍、建筑/残骸、玩家、敌人、小鸡及主要地面物资的占位，并为营地入口保留玩家半径的通行空间。
- 最终确认还用带“拟建碰撞体”的 NavigationGrid 检查玩家到入口的实际通路；试算不注册临时墙，也不改变地图导航版本。无法返回入口的方案被拒绝。
- 预览执行基本几何检查，较重的通路检查在确认建造时完成。无效操作不分配实例 ID、不改变建筑或世界拓扑。
- 活墙可修理到满耐久；被击毁的残骸不可直接修复，需清理后重建。拆除/清理需要再次点击确认。P2 暂不返还材料。
- 建造、修理和拆除完成后立即请求完整自动保存；写入失败保留内存中的真实结果，并通过既有保存错误/重试提示处理，不回滚已经完成的操作。

### 19.3 伤害、遮挡和观察记忆

子弹、拳击与爆炸统一修改 StructureSystem 的实际 HP：

| 来源/系统 | 行为 |
| --- | --- |
| 子弹 | 原 Bullet/枪口扫掠保留 ownerId，命中回调每发只扣一次耐久；击毁立即释放碰撞 |
| 拳击 | 与现有单位近战候选比较距离，结算本次拳击的第一个可达目标；墙后单位不会被穿透命中 |
| 爆炸 | 先在完整旧几何上收集墙体与地形受击列表，再结算单位与墙体伤害；一次爆炸不会穿过同一次结算刚击毁的前墙 |
| 导航 | 增墙、拆墙、破墙递增拓扑版本；旧网格/路径失效，重计算使用实际墙体 |
| 邻接墙段 | 缓存完全共有且方向相反的边，排除木墙内部接缝投影；击毁一段后端面重新参与投影。未增加通用多边形布尔运算框架 |
| 当前观察 | 用现有 PerceptionSystem 的完整辨识检查墙面外侧采样点；观察到后才更新 observedHp，绘制本身不修改持久状态 |
| 记忆 | 已知但当前不可见的建筑只显示较暗的上次观察外观；未观察到的损伤不通过真实 HP 更新记忆图像 |

墙体外观由 StructureSystem 从同一份实例数据绘制，采用木板轮廓、受损颜色、可见时的耐久提示和残骸。建筑位于正确的世界/光照层；记忆和规划预览在感知合成后绘制。P4 的敌人攻城决策、陷阱和营地核心仍属于后续阶段。

### 19.4 第 1 版存档迁移

CampaignState.schemaVersion 升为 2，SaveRepository 使用共享当前版本上限。封装 formatVersion 仍为 1，现有两个快照槽及投掷物 runtime 格式保持兼容。

1. 读取合法 schemaVersion=1 数据时，严格校验旧字段，在独立副本中为两个地点添加 structures=[]，输出 schemaVersion=2。
2. 迁移不重播日期、不补充物资、不改 HP/弹药/时间/种子，不直接重写原槽。
3. 候选世界验证与激活成功后继续游戏；下一次有效自动保存把新格式写入另一个槽，原始旧档仍作为备份。
4. 第 2 版遗漏建筑字段、非法耐久/状态/等级/坐标、重复实例或同格建筑被拒绝；未知更高版本仍提示不兼容并保留原档。

建筑和玩家/地面物品在同一检查点、同一完整快照中提交。战斗中的结构变化在本帧结算结束后请求保存；规划界面的完整操作在返回事件循环前提交，不存在半次建造或半次扣血的保存窗口。

### 19.5 验证与性能边界

新增 tests/structures.test.mjs 覆盖状态、观察记忆、耐久与恢复、非法放置、自我封锁、爆炸遮挡、旧档迁移、实际拳击及邻接投影。tests/structures.browser.mjs 在 DPR 1/1.25/2 下覆盖建造、鼠标选格、暂停、修理、清理/重建、旋转、受损刷新、跨图、爆炸不穿透、窄屏和旧档迁移。往返套件另验证营地恰有一个建设面板，住宅区没有遗留面板。

| 检查 | 结果 |
| --- | --- |
| npm test | 当前工作区 695/695 通过；本批新增 7 项结构相关用例，包含工作区并行日夜用例 |
| npm run typecheck | 通过 |
| npm run build | 使用下述工作区临时目录通过；本次主包 629.11 kB，仍有超过 500 kB 的提示 |
| npm run test:structures-browser | 通过；DPR 1/1.25/2，含桌面和窄屏的实际点击选格、完整建筑与旧档流程 |
| npm run test:structures-performance | 完成 0/64 墙、30/60/144 Hz 的更新与绘制采样 |
| npm run test:campaign-browser | 通过；20 次往返并检查建设面板的清理 |
| npm run test:campaign-save-browser | 通过；旧有存档、坏档恢复、投掷物/烟雾和死亡流程 |
| npm run test:dynamic-wall-browser | 通过；几何、硬/软光、环境缓存与重叠遮罩 |
| npm run test:perception-browser / test:terrain-light-browser | 通过 |
| npm run test:throwables-browser / test:boxing-browser | 通过 |
| npm run test:day-clock-browser / backpack.browser.mjs | 分别通过；时间 HUD、背包实时世界、暂停、快捷栏和窄屏 |
| git diff --check / 新文件空白检查 | 通过 |

背包回归的一次并行运行在固定 150ms 动画断言处失败，单独重跑通过；未修改动画代码或放宽该断言。并行日夜调试控件的 flatMap 调用改为等价 map+reduce，以兼容项目现有 ES2017 类型库，没有改变控件内容。

性能采样使用 1280×720、DPR 1、Chromium 156、i5-12600KF。先预热 20 帧，再按各固定步长执行一模拟秒的真实 GameScene.update+draw，单独运行、不与本轮其他检查并行。下表为这轮调用耗时，不是显示器实际 FPS 或稳定 60/144 FPS 保证。

| 固定模拟步长 | 0 墙平均 / P95 | 64 墙平均 / P95 |
| --- | --- | --- |
| 30 Hz | 16.900 / 27.8 ms | 23.387 / 34.1 ms |
| 60 Hz | 17.108 / 29.3 ms | 22.527 / 34.6 ms |
| 144 Hz | 16.563 / 28.2 ms | 22.501 / 33.2 ms |

结果位于 .review/structures/performance.json，可用 npm run test:structures-performance 重新采样。64 墙比空场景增加约 5–6.5 ms；进一步扩大建筑规模时，注册物体范围查询与遮罩仍需继续优化。这一轮保留了工作区并行的日夜光照改动，性能数字对应采样时的代码快照。

本机默认系统临时目录使 esbuild 大输入的临时文件删除报 Access is denied；构建验证改用工作区 .review/esbuild-temp 的 TEMP/TMP 后完成，没有修改项目依赖或给构建器申请额外权限。此环境可用以下 PowerShell 命令复现：

```powershell
$taskBuildTemp = (New-Item -ItemType Directory -Path .review\esbuild-temp -Force).FullName
$env:TEMP = $taskBuildTemp
$env:TMP = $taskBuildTemp
npm run typecheck
npm run build
```

未提交 Git。下一阶段为 P3：资源、背包、仓库与建造经济，将材料消耗、返还、操作耗时和完整事务接入当前木墙流程。

### 19.6 手动拖拽与网格吸附调整（2026-11-03）

按用户反馈移除建设面板的列/行输入。木墙可从面板卡片拖入地图，也可在地图按住拖动预览；松手才通过原有完整建造校验并保存。建设范围显示 50 世界像素网格，预览自动吸附格心，R 或旋转按钮切换方向。点击已有墙体保持管理选择，移入面板不会丢失选中项；方向键与放置按钮提供键盘操作。

- 鼠标和原生触控共用 Pointer Events 与指针捕获。只有实际位于游戏画布上的松手才尝试放置，面板、画布外、已有建筑和非法占位均不会创建实例。
- Esc、失焦、后台、窗口缩放、pointercancel、捕获丢失和关闭建设会取消拖拽。全局监听只在拖拽期间注册，结束或取消立即清理，切图不留下监听。
- 复用 screenToWorld 和原有建筑数据；缩放、DPR 和相机变换不会改变最终网格位置，存档格式与建造规则沿用 P2。

验证：695/695 逻辑测试、类型检查、构建通过（主包 634.36 kB，沿用工作区临时目录）；拖拽浏览器验收通过 DPR 1/1.25/2、桌面/窄屏、鼠标卡片/画布拖动、原生触控、取消、旋转、缩放 0.7 和键盘放置。20 次地图往返与存档浏览器回归通过，截图包括 .review/structures/drag.png、planning.png、mobile.png。

跨图回归最初发现营地常驻的 4 个全局拖拽监听使两地点监听计数不同，已改为仅拖拽期间注册并复验通过。测试重跑曾沿用构建的工作区 TEMP/TMP，使 CommonJS 临时产物被项目的 type=module 解释；恢复测试默认临时目录后 695 项通过，未改测试运行器或模块配置。
