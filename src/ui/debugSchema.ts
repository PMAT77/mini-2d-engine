/**
 * 调试面板的声明式字段表：配置里每个可调叶子都必须在这里出现一次，
 * `tests/config-sync.test.mjs` 会用配置默认值反向检查，漏项或悬空项都会失败。
 */
export type DebugTabId = "character" | "visual" | "audio";
export type ConfigDomain = "player" | "graphics" | "audio";

export type SectionId =
  | "life" | "combat" | "ballistics" | "movement" | "stamina" | "roll" | "ammo" | "waterDrag" | "body" | "ui"
  | "camera" | "ambient" | "playerLight" | "flashlight" | "fog" | "visibility"
  | "master" | "weapon" | "footsteps" | "pickups" | "chicken";

export interface ConfigControl {
  domain: ConfigDomain;
  /** player：分组名，或 `activeFirearm`（跟随当前枪）；audio 根字段用空串。 */
  group: string;
  key: string;
  tab: DebugTabId;
  section: SectionId;
  label: string;
  unit: string;
  kind: "number" | "color" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  /** 显示值 = 原值 × scale（水体阻力用 100）。 */
  scale?: number;
  /** 显示值 = 1 / 原值（射速用）。 */
  reciprocal?: boolean;
}

export const DEBUG_TABS: { id: DebugTabId; title: string }[] = [
  { id: "character", title: "角色" },
  { id: "visual", title: "画面" },
  { id: "audio", title: "音效" },
];

export const DEBUG_SECTIONS: { id: SectionId; tab: DebugTabId; title: string; note?: string }[] = [
  { id: "life", tab: "character", title: "生命" },
  { id: "combat", tab: "character", title: "攻击" },
  { id: "ballistics", tab: "character", title: "弹道散布" },
  { id: "movement", tab: "character", title: "移动" },
  { id: "stamina", tab: "character", title: "体力" },
  { id: "roll", tab: "character", title: "翻滚" },
  { id: "ammo", tab: "character", title: "弹药与换弹" },
  { id: "waterDrag", tab: "character", title: "子弹水体阻力", note: "界面单位为每秒百分比" },
  { id: "body", tab: "character", title: "体型与动画" },
  { id: "ui", tab: "character", title: "界面" },
  { id: "camera", tab: "visual", title: "视角" },
  { id: "ambient", tab: "visual", title: "环境光" },
  { id: "playerLight", tab: "visual", title: "角色微光", note: "只照地面，不影响地形顶面" },
  { id: "flashlight", tab: "visual", title: "锥形手电筒", note: "G 键开关；默认张角 120°" },
  { id: "fog", tab: "visual", title: "战争迷雾", note: "只影响单位的可见范围；地形始终可见" },
  { id: "visibility", tab: "visual", title: "三层视野遮蔽", note: "只影响三层模式的遮蔽表现；legacy 模式不生效" },
  { id: "master", tab: "audio", title: "总音量" },
  { id: "weapon", tab: "audio", title: "武器" },
  { id: "footsteps", tab: "audio", title: "脚步" },
  { id: "pickups", tab: "audio", title: "拾取与开关" },
  { id: "chicken", tab: "audio", title: "小鸡" },
];

const tabOf = (section: SectionId): DebugTabId => DEBUG_SECTIONS.find(entry => entry.id === section)!.tab;

function control(base: Omit<ConfigControl, "tab">): ConfigControl {
  return { ...base, tab: tabOf(base.section) };
}

function playerNumber(group: string, key: string, section: SectionId, label: string, unit: string,
  min: number, step: number, extra: Partial<ConfigControl> = {}): ConfigControl {
  return control({ domain: "player", group, key, section, label, unit, kind: "number", min, step, ...extra });
}

function graphicsNumber(group: string, key: string, section: SectionId, label: string, unit: string,
  min: number, step: number, extra: Partial<ConfigControl> = {}): ConfigControl {
  return control({ domain: "graphics", group, key, section, label, unit, kind: "number", min, step, ...extra });
}

function audioNumber(group: string, key: string, section: SectionId, label: string,
  min: number, step: number, extra: Partial<ConfigControl> = {}): ConfigControl {
  return control({ domain: "audio", group, key, section, label, unit: "", kind: "number", min, step, ...extra });
}

const waterDragLabels: Record<string, string> = {
  shallow: "浅水减速", water: "普通水减速", deep: "深水减速", ultraDeep: "极深水减速",
};

export const CONFIG_CONTROLS: ConfigControl[] = [
  // 角色。max 同时决定滑条上限与数值框校验边界。
  playerNumber("base", "maxHealth", "life", "血量上限", "", 1, 1, { max: 1000 }),
  playerNumber("activeFirearm", "damage", "combat", "基础攻击力", "", 0.01, 1, { max: 1000 }),
  playerNumber("activeFirearm", "fireRate", "combat", "射速", "发/秒", 0.01, 0.1, { reciprocal: true, max: 5 }),
  playerNumber("activeFirearm", "bulletSpeed", "combat", "子弹速度", "px/s", 0.01, 10, { max: 10000 }),
  playerNumber("shooting", "maxRange", "combat", "最大射程", "px", 1, 50, { max: 5000 }),
  playerNumber("shooting", "spreadHorizontal", "ballistics", "基础水平半角", "度", 0, 0.1, { max: 44 }),
  playerNumber("shooting", "spreadVertical", "ballistics", "基础垂直半角", "度", 0, 0.1, { max: 44 }),
  playerNumber("shooting", "maxSpreadHorizontal", "ballistics", "最大水平半角", "度", 0, 0.1, { max: 44 }),
  playerNumber("shooting", "maxSpreadVertical", "ballistics", "最大垂直半角", "度", 0, 0.1, { max: 44 }),
  playerNumber("shooting", "recoilPerShot", "ballistics", "每发累积强度", "", 0, 0.01, { max: 1 }),
  playerNumber("shooting", "recoilRecoveryDelay", "ballistics", "恢复延迟", "秒", 0, 0.05, { max: 2 }),
  playerNumber("shooting", "recoilRecoveryDuration", "ballistics", "满强度恢复时长", "秒", 0.01, 0.1, { max: 5 }),
  playerNumber("base", "maxSpeed", "movement", "基础移速", "px/s", 0, 10, { max: 2000 }),
  playerNumber("sprint", "speedMultiplier", "movement", "快速移速倍率", "倍", 1, 0.1, { max: 10 }),
  playerNumber("movement", "startSpeedRatio", "movement", "起步速度比例", "", 0, 0.05, { max: 1 }),
  playerNumber("movement", "startupDuration", "movement", "起步时长", "秒", 0, 0.01, { max: 2 }),
  playerNumber("movement", "turnDamping", "movement", "转向阻尼", "秒", 0, 0.001, { max: 1 }),
  playerNumber("movement", "stopDuration", "movement", "停止滑行时长", "秒", 0, 0.01, { max: 2 }),
  playerNumber("sprint", "rampDuration", "movement", "冲刺升速时长", "秒", 0, 0.01, { max: 2 }),
  playerNumber("sprint", "maxStamina", "stamina", "体力上限", "", 0.01, 1, { max: 1000 }),
  playerNumber("sprint", "drainPerSecond", "stamina", "每秒消耗", "/秒", 0.01, 1, { max: 500 }),
  playerNumber("sprint", "regenPerSecond", "stamina", "每秒恢复", "/秒", 0.01, 1, { max: 500 }),
  playerNumber("sprint", "regenDelay", "stamina", "恢复延迟", "秒", 0, 0.1, { max: 5 }),
  playerNumber("sprint", "restartThreshold", "stamina", "耗尽恢复门槛", "比例", 0.001, 0.05, { max: 1 }),
  playerNumber("roll", "duration", "roll", "翻滚时长", "秒", 0.05, 0.01, { max: 5 }),
  playerNumber("roll", "speedMultiplier", "roll", "翻滚速度倍率", "倍", 1.1, 0.1, { max: 10 }),
  playerNumber("roll", "cooldown", "roll", "翻滚冷却", "秒", 0, 0.05, { max: 5 }),
  playerNumber("roll", "staminaCost", "roll", "体力消耗", "", 0, 1, { max: 100 }),
  playerNumber("activeFirearm", "magazineSize", "ammo", "弹匣容量", "发", 1, 1, { max: 100 }),
  playerNumber("activeFirearm", "reloadDuration", "ammo", "换弹时长", "秒", 0.01, 0.1, { max: 10 }),
  ...Object.entries(waterDragLabels).map(([key, label]) =>
    playerNumber("bulletWaterDrag", key, "waterDrag", label, "%/秒", 0, 0.01, { scale: 100, max: 5 })),
  playerNumber("base", "size", "body", "角色体型", "px", 1, 1, { max: 400 }),
  playerNumber("collider", "radius", "body", "碰撞半径", "×size", 0.01, 0.1, { max: 2 }),
  playerNumber("base", "rotationSpeed", "body", "转向速度", "弧度/秒", 0, 0.1, { max: 50 }),
  control({
    domain: "player", group: "base", key: "rotationStrategy", section: "body",
    label: "转向策略", unit: "", kind: "select",
    options: [{ value: "auto", label: "自动" }, { value: "cw", label: "顺时针" }, { value: "ccw", label: "逆时针" }],
  }),
  playerNumber("animation", "breathingAmplitude", "body", "呼吸幅度", "px", 0, 0.5, { max: 100 }),
  playerNumber("animation", "breathingSpeed", "body", "呼吸速度", "Hz", 0, 0.1, { max: 50 }),
  playerNumber("animation", "runSwayAmplitude", "body", "跑步摇摆幅度", "%size", 0, 0.1, { max: 100 }),
  playerNumber("animation", "runSwaySpeed", "body", "跑步摇摆速度", "弧度/秒", 0, 0.1, { max: 50 }),
  playerNumber("ui", "fadeSpeed", "ui", "换弹圆环淡入淡出", "速度", 0.1, 0.5, { max: 50 }),

  // 画面
  graphicsNumber("camera", "zoom", "camera", "视角缩放", "倍", 0.5, 0.05, { max: 2 }),
  control({
    domain: "graphics", group: "ambient", key: "color", section: "ambient",
    label: "环境光颜色", unit: "", kind: "color",
  }),
  graphicsNumber("ambient", "intensity", "ambient", "环境光强度", "", 0, 0.05, { max: 2 }),
  control({
    domain: "graphics", group: "terrainLight", key: "color", section: "ambient",
    label: "地形光颜色", unit: "", kind: "color",
  }),
  graphicsNumber("terrainLight", "intensity", "ambient", "地形光强度", "", 0, 0.05, { max: 2 }),
  graphicsNumber("terrainLight", "shadowScale", "ambient", "阴影长度", "倍", 0, 0.05, { max: 2 }),
  graphicsNumber("terrainLight", "softnessScale", "ambient", "阴影柔边", "倍", 0, 0.05, { max: 2 }),
  control({
    domain: "graphics", group: "playerLight", key: "color", section: "playerLight",
    label: "微光颜色", unit: "", kind: "color",
  }),
  graphicsNumber("playerLight", "radius", "playerLight", "微光半径", "px", 0, 25, { max: 1600 }),
  graphicsNumber("playerLight", "intensity", "playerLight", "微光强度", "", 0, 0.05, { max: 2 }),
  graphicsNumber("playerLight", "sourceRadius", "playerLight", "发光体半径", "px", 0, 2, { max: 400 }),
  control({
    domain: "graphics", group: "flashlight", key: "color", section: "flashlight",
    label: "手电颜色", unit: "", kind: "color",
  }),
  graphicsNumber("flashlight", "range", "flashlight", "手电筒距离", "px", 100, 25, { max: 1600 }),
  graphicsNumber("flashlight", "angle", "flashlight", "张角", "度", 1, 1, { max: 180 }),
  graphicsNumber("flashlight", "intensity", "flashlight", "手电筒强度", "", 0, 0.05, { max: 2 }),
  graphicsNumber("flashlight", "softness", "flashlight", "边缘柔和", "比例", 0, 0.01, { max: 0.5 }),
  graphicsNumber("flashlight", "innerRadius", "flashlight", "内圈半径", "px", 0, 5, { max: 800 }),
  graphicsNumber("flashlight", "innerFade", "flashlight", "内圈过渡", "px", 1, 1, { max: 200 }),
  graphicsNumber("fog", "range", "fog", "迷雾半径", "px", 100, 10, { max: 1600 }),
  graphicsNumber("fog", "feather", "fog", "迷雾过渡", "px", 10, 10, { max: 1000 }),
  graphicsNumber("visibility", "maskScale", "visibility", "遮蔽分辨率", "倍", 0.25, 0.05, { max: 1 }),
  graphicsNumber("visibility", "memoryBrightness", "visibility", "记忆亮度", "", 0, 0.01, { max: 1 }),
  graphicsNumber("visibility", "edgeFeather", "visibility", "边缘柔化", "px", 0, 1, { max: 64 }),
  graphicsNumber("visibility", "outlineContrast", "visibility", "轮廓对比度", "", 0, 0.005, { max: 0.5 }),

  // 音效
  audioNumber("", "master", "master", "总音量", 0, 0.05, { max: 1 }),
  audioNumber("weapon", "secondaryVolume", "weapon", "格洛克枪声", 0, 0.05, { max: 1 }),
  audioNumber("weapon", "primaryVolume", "weapon", "冲锋枪枪声", 0, 0.05, { max: 1 }),
  audioNumber("weapon", "reloadVolume", "weapon", "换弹声", 0, 0.05, { max: 1 }),
  audioNumber("footsteps", "waterVolume", "footsteps", "涉水脚步", 0, 0.05, { max: 1 }),
  audioNumber("footsteps", "dryVolume", "footsteps", "干地脚步", 0, 0.05, { max: 1 }),
  audioNumber("pickups", "goldVolume", "pickups", "金块拾取", 0, 0.05, { max: 1 }),
  audioNumber("pickups", "meatVolume", "pickups", "肉块拾取", 0, 0.05, { max: 1 }),
  audioNumber("flashlight", "switchVolume", "pickups", "手电开关", 0, 0.05, { max: 1 }),
  audioNumber("chicken", "stepVolume", "chicken", "小鸡脚步", 0, 0.05, { max: 1 }),
  audioNumber("chicken", "cluckVolume", "chicken", "小鸡叫声", 0, 0.05, { max: 1 }),
  audioNumber("chicken", "range", "chicken", "发声距离", 0, 50, { max: 5000, unit: "px" }),
  audioNumber("chicken", "minAttenuation", "chicken", "静音阈值", 0, 0.01, { max: 1 }),
];

/** 这些字段仍被解析器接受，但不控制运行时行为，因此不放进调试面板。 */
export const PLAYER_DEBUG_EXCLUSIONS: { path: string; reason: string }[] = [
  { path: "base.accel", reason: "旧兼容字段，移动由 movement 控制" },
  { path: "base.decel", reason: "旧兼容字段，移动由 movement 控制" },
  { path: "base.nonlinearFactor", reason: "旧兼容字段，移动由 movement 控制" },
  { path: "shooting.aimTurnDuration", reason: "已停用，鼠标瞄准立即生效" },
  { path: "shooting.aimContinuityWindow", reason: "已停用，鼠标瞄准不会超时" },
];
