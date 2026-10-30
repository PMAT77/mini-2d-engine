/**
 * 翻滚的程序化姿态：只描述“画在哪”，不描述物理。
 *
 * 单位统一为玩家 size（1 = 一个身位），局部坐标 +x 为面朝（翻滚）方向、+y 为右手侧，
 * 与 WeaponVisuals 的约定一致。每个字段都能独立插值，所以头、躯干、双臂、腿、
 * 肩背外壳可以各自运动，而不是把整个人整体缩放或镜像。
 */
export interface RollPose {
  /** 头部中心、半径与不透明度；中段被肩背外壳遮住时 alpha 降低 */
  headX: number;
  headY: number;
  headR: number;
  headAlpha: number;
  /** 躯干椭圆中心与半径；翻滚中段 rx 收缩、ry 略涨，形成蜷缩的球体 */
  bodyX: number;
  bodyY: number;
  bodyRx: number;
  bodyRy: number;
  /** 躯干后的深色轮廓 */
  backX: number;
  backY: number;
  backR: number;
  /** 胸板 */
  plateX: number;
  plateY: number;
  plateR: number;
  /** 左臂：肩 → 肘 → 手；肘在肩手连线上时与原来的一整根胶囊完全重合 */
  leftShoulderX: number;
  leftShoulderY: number;
  leftElbowX: number;
  leftElbowY: number;
  leftHandX: number;
  leftHandY: number;
  /** 右臂（持枪手） */
  rightShoulderX: number;
  rightShoulderY: number;
  rightElbowX: number;
  rightElbowY: number;
  rightHandX: number;
  rightHandY: number;
  /** 简化腿部：髋由躯干外缘推出，这里只给膝与脚；legAlpha 为 0 时不画 */
  leftKneeX: number;
  leftKneeY: number;
  leftFootX: number;
  leftFootY: number;
  rightKneeX: number;
  rightKneeY: number;
  rightFootX: number;
  rightFootY: number;
  legAlpha: number;
  /** 中段翻过去的肩背外壳：椭圆盖住头与胸板；shellAlpha 为 0 时不画 */
  shellX: number;
  shellY: number;
  shellRx: number;
  shellRy: number;
  shellAlpha: number;
  /** 手中武器在握点处额外的旋转（弧度），0 与站立时完全一致 */
  weaponAngle: number;
}

const TAU = Math.PI * 2;

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge1 <= edge0) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

/**
 * 静止/站立姿态：翻滚开始（0%）与结束（100%）都必须落在这里。
 * Player 会在两端把这份固定姿态与当前真实的站立/瞄准姿态混合，
 * 所以固定 REST 只作为翻滚自身的锚点，不再直接承担“起滚/收尾不跳变”。
 */
export const ROLL_REST_POSE: RollPose = {
  headX: .09, headY: 0, headR: .265, headAlpha: 1,
  bodyX: 0, bodyY: 0, bodyRx: .405, bodyRy: .405,
  backX: -.055, backY: 0, backR: .45,
  plateX: .055, plateY: 0, plateR: .29,
  leftShoulderX: 0, leftShoulderY: -.31,
  leftElbowX: .024, leftElbowY: -.40,
  leftHandX: .04, leftHandY: -.46,
  rightShoulderX: 0, rightShoulderY: .31,
  rightElbowX: .024, rightElbowY: .40,
  rightHandX: .04, rightHandY: .46,
  leftKneeX: -.18, leftKneeY: -.16, leftFootX: -.30, leftFootY: -.20,
  rightKneeX: -.18, rightKneeY: .16, rightFootX: -.30, rightFootY: .20,
  legAlpha: 0,
  shellX: -.04, shellY: 0, shellRx: .34, shellRy: .30, shellAlpha: 0,
  weaponAngle: 0,
};

interface FrameSpec {
  at: number;
  head: readonly [number, number, number, number];
  body: readonly [number, number, number, number];
  left: readonly [number, number, number, number, number, number];
  right: readonly [number, number, number, number, number, number];
  legs: readonly [number, number, number, number, number, number, number, number];
  legAlpha: number;
  shell: readonly [number, number, number, number, number];
  weaponAngle: number;
}

/**
 * 五段节奏的关键姿态（占比是初始参考）：
 * A 0–12% 蓄力俯身：头略降、重心前移、双臂收紧，身体还没缩起来；
 * B 12–34% 前倾入滚：头收向胸口、左臂前伸、肩背开始成为视觉主体；
 * C 34–58% 核心翻滚：躯干收成窄椭圆，肩背外壳盖住头，双腿完全收起；
 * D 58–84% 撑地起身：左臂先前伸撑地，再随身体前移“扫”回体侧，
 *   重心从肩背回到躯干，头从外壳下逐渐露出，双腿伸展后收回；
 * E 84–100% 收势站立：外壳淡出，双手与武器回到站立位置。
 *
 * 所有数值都是“相对翻滚体”的局部坐标。肩背 back / 胸板 plate 由躯干自动派生，
 * 避免多份数据在插值时互相打架。
 */
const ROLL_KEY_FRAMES: ReadonlyArray<FrameSpec> = [
  {
    // A：重心刚刚压下去，手臂开始收，但头还完整露着。
    at: .06,
    head: [.105, .005, .255, 1],
    body: [.02, 0, .398, .398],
    left: [.015, -.30, .06, -.37, .10, -.40],
    right: [.015, .30, .06, .37, .10, .40],
    legs: [-.20, -.18, -.33, -.22, -.20, .18, -.33, .22],
    legAlpha: .10,
    shell: [-.03, 0, .33, .30, .04],
    weaponAngle: -.06,
  },
  {
    // A 末：深蹲蓄力，手臂收到胸前，为入滚做准备。
    at: .12,
    head: [.115, .010, .248, 1],
    body: [.04, .010, .388, .382],
    left: [.03, -.285, .11, -.335, .17, -.345],
    right: [.03, .285, .11, .335, .17, .345],
    legs: [-.23, -.21, -.36, -.25, -.23, .21, -.36, .25],
    legAlpha: .30,
    shell: [-.015, .005, .325, .305, .15],
    weaponAngle: -.14,
  },
  {
    // B：左臂向前探，头开始往胸口收，肩背露头。
    at: .20,
    head: [.13, .008, .225, .90],
    body: [.055, .015, .365, .383],
    left: [.04, -.27, .18, -.31, .30, -.31],
    right: [.03, .27, .12, .32, .20, .315],
    legs: [-.27, -.25, -.41, -.20, -.27, .25, -.41, .20],
    legAlpha: .55,
    shell: [0, .005, .34, .335, .35],
    weaponAngle: -.28,
  },
  {
    // B 末：身体压得更低，左臂几乎撑到地，肩背盖住后脑。
    at: .28,
    head: [.12, .002, .19, .55],
    body: [.07, .012, .338, .386],
    left: [.05, -.255, .24, -.29, .38, -.26],
    right: [.04, .255, .14, .305, .22, .295],
    legs: [-.31, -.28, -.45, -.16, -.31, .28, -.45, .16],
    legAlpha: .80,
    shell: [.01, 0, .35, .36, .62],
    weaponAngle: -.42,
  },
  {
    // C：完全蜷起，头只剩一点轮廓；撑地手收回到身体侧面。
    at: .36,
    head: [.09, -.004, .155, .20],
    body: [.06, .005, .31, .385],
    left: [.04, -.245, .16, -.33, .10, -.35],
    right: [.03, .235, .10, .315, .15, .325],
    legs: [-.34, -.30, -.47, -.12, -.34, .30, -.47, .12],
    legAlpha: .95,
    shell: [.02, 0, .36, .385, .88],
    weaponAngle: -.52,
  },
  {
    // C 核心：肩背外壳完全盖住头，躯干最窄，双腿收到身体两侧。
    at: .44,
    head: [.04, -.008, .125, 0],
    body: [.045, 0, .285, .385],
    left: [.01, -.22, 0, -.31, -.09, -.31],
    right: [.02, .22, .07, .31, .12, .33],
    legs: [-.36, -.31, -.48, -.08, -.36, .31, -.48, .08],
    legAlpha: 1,
    shell: [.03, 0, .37, .40, 1],
    weaponAngle: -.58,
  },
  {
    // C 末：外壳仍盖着头，左臂重新向前探，准备撑地。
    at: .52,
    head: [.07, -.004, .14, 0],
    body: [.05, 0, .30, .385],
    left: [.02, -.23, .10, -.31, .20, -.33],
    right: [.02, .23, .09, .31, .15, .325],
    legs: [-.35, -.30, -.47, -.10, -.35, .30, -.47, .10],
    legAlpha: 1,
    shell: [.02, 0, .36, .385, .94],
    weaponAngle: -.53,
  },
  {
    // D 起：左臂前伸找到支点，头开始从外壳下露出。
    at: .60,
    head: [.10, 0, .195, .32],
    body: [.05, .008, .325, .382],
    left: [.03, -.265, .20, -.335, .36, -.34],
    right: [.02, .25, .11, .32, .18, .33],
    legs: [-.32, -.28, -.44, -.15, -.32, .28, -.44, .15],
    legAlpha: .90,
    shell: [.005, .004, .35, .36, .68],
    weaponAngle: -.42,
  },
  {
    // D：手撑住，身体从肩背上方挪过去；手相对身体向后“扫”。
    at: .70,
    head: [.115, .002, .225, .72],
    body: [.04, .008, .35, .388],
    left: [.03, -.295, .27, -.38, .48, -.40],
    right: [.02, .265, .12, .34, .20, .35],
    legs: [-.28, -.25, -.40, -.20, -.28, .25, -.40, .20],
    legAlpha: .70,
    shell: [-.015, .004, .335, .335, .38],
    weaponAngle: -.30,
  },
  {
    // D 末：重心回到躯干，头基本露出，左臂卸力回扫，双腿伸开。
    at: .78,
    head: [.115, .004, .248, .92],
    body: [.03, .004, .375, .398],
    left: [.025, -.305, .18, -.39, .32, -.45],
    right: [.015, .285, .10, .36, .18, .39],
    legs: [-.24, -.22, -.36, -.24, -.24, .22, -.36, .24],
    legAlpha: .45,
    shell: [-.035, .002, .315, .30, .15],
    weaponAngle: -.16,
  },
  {
    // E：身体展开，外壳只剩一点轮廓，手还在回收。
    at: .86,
    head: [.102, .003, .26, .99],
    body: [.015, .002, .395, .402],
    left: [.01, -.31, .11, -.395, .22, -.45],
    right: [.01, .30, .06, .385, .13, .435],
    legs: [-.20, -.185, -.32, -.23, -.20, .185, -.32, .23],
    legAlpha: .20,
    shell: [-.043, 0, .30, .27, .04],
    weaponAngle: -.06,
  },
  {
    // E 末：只剩很轻的收势惯性，交给 Player 混合回真实站立姿态。
    at: .93,
    head: [.094, .001, .263, 1],
    body: [.004, 0, .402, .404],
    left: [0, -.31, .04, -.40, .10, -.455],
    right: [0, .31, .04, .40, .10, .455],
    legs: [-.18, -.165, -.30, -.205, -.18, .165, -.30, .205],
    legAlpha: .06,
    shell: [-.04, 0, .28, .25, .01],
    weaponAngle: -.02,
  },
];

/** 肩背与胸板跟着躯干走，减少每帧重复数据。 */
function buildPose(frame: FrameSpec): RollPose {
  const [headX, headY, headR, headAlpha] = frame.head;
  const [bodyX, bodyY, bodyRx, bodyRy] = frame.body;
  const [leftShoulderX, leftShoulderY, leftElbowX, leftElbowY, leftHandX, leftHandY] = frame.left;
  const [rightShoulderX, rightShoulderY, rightElbowX, rightElbowY, rightHandX, rightHandY] = frame.right;
  const [leftKneeX, leftKneeY, leftFootX, leftFootY, rightKneeX, rightKneeY, rightFootX, rightFootY] = frame.legs;
  const [shellX, shellY, shellRx, shellRy, shellAlpha] = frame.shell;
  const ratio = (bodyRx + bodyRy) / (ROLL_REST_POSE.bodyRx * 2);
  return {
    headX, headY, headR, headAlpha,
    bodyX, bodyY, bodyRx, bodyRy,
    backX: bodyX - .055, backY: bodyY, backR: .45,
    plateX: bodyX + .055, plateY: bodyY, plateR: ROLL_REST_POSE.plateR * ratio * ratio,
    leftShoulderX, leftShoulderY, leftElbowX, leftElbowY, leftHandX, leftHandY,
    rightShoulderX, rightShoulderY, rightElbowX, rightElbowY, rightHandX, rightHandY,
    leftKneeX, leftKneeY, leftFootX, leftFootY,
    rightKneeX, rightKneeY, rightFootX, rightFootY,
    legAlpha: frame.legAlpha,
    shellX, shellY, shellRx, shellRy, shellAlpha,
    weaponAngle: frame.weaponAngle,
  };
}

const ROLL_FRAMES: ReadonlyArray<{ at: number; pose: RollPose }> =
  ROLL_KEY_FRAMES.map(frame => ({ at: frame.at, pose: buildPose(frame) }));

/** 每个关键帧的进度，方便测试与调参；首尾固定落在静止姿态。 */
export const ROLL_POSE_STOPS: readonly number[] = [0, ...ROLL_FRAMES.map(frame => frame.at), 1];

const STOP_POSES: readonly RollPose[] = [
  ROLL_REST_POSE,
  ...ROLL_FRAMES.map(frame => frame.pose),
  ROLL_REST_POSE,
];

const POSE_KEYS = Object.keys(ROLL_REST_POSE) as (keyof RollPose)[];

/**
 * 单调三次 Hermite 的切线（Fritsch–Carlson）：
 * 段内不会过冲，关键帧处速度连续；局部极值处切线为 0，动作会自然“顿”一下，
 * 而不是旧版每段 smoothstep 首尾都把速度归零。
 */
function monotoneTangents(xs: readonly number[], ys: readonly number[]): number[] {
  const n = xs.length;
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    slopes.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  }
  const tangents = new Array<number>(n);
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slopes[i - 1] * slopes[i] <= 0) {
      tangents[i] = 0;
    } else {
      const h0 = xs[i] - xs[i - 1];
      const h1 = xs[i + 1] - xs[i];
      const w0 = 2 * h1 + h0;
      const w1 = h1 + 2 * h0;
      tangents[i] = (w0 + w1) / (w0 / slopes[i - 1] + w1 / slopes[i]);
    }
  }
  // 限制切线，保证每一段都单调，不会让身体尺寸/透明度冲过关键帧。
  for (let i = 0; i < n - 1; i++) {
    const slope = slopes[i];
    if (Math.abs(slope) < 1e-12) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / slope;
    const b = tangents[i + 1] / slope;
    const sum = a * a + b * b;
    if (sum > 9) {
      const scale = 3 / Math.sqrt(sum);
      tangents[i] = scale * a * slope;
      tangents[i + 1] = scale * b * slope;
    }
  }
  return tangents;
}

const TANGENTS = {} as Record<keyof RollPose, number[]>;
for (const key of POSE_KEYS) {
  TANGENTS[key] = monotoneTangents(ROLL_POSE_STOPS, STOP_POSES.map(pose => pose[key]));
}

function hermite(
  x0: number, x1: number, y0: number, y1: number, m0: number, m1: number, t: number,
): number {
  const h = x1 - x0;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * y0
    + (t3 - 2 * t2 + t) * h * m0
    + (-2 * t3 + 3 * t2) * y1
    + (t3 - t2) * h * m1;
}

/** 线性插值两个姿态；t 会被夹到 0–1。Player 用它把翻滚姿态与真实站立姿态混合。 */
export function interpolateRollPose(a: RollPose, b: RollPose, t: number): RollPose {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const out = { ...a } as RollPose;
  const target = out as unknown as Record<string, number>;
  const from = a as unknown as Record<string, number>;
  const to = b as unknown as Record<string, number>;
  for (const key of Object.keys(out)) target[key] = from[key] + (to[key] - from[key]) * t;
  return out;
}

/** 翻滚进度对应的姿态；0 与 1 都精确等于静止姿态。 */
export function getRollPose(progress: number): RollPose {
  const p = clamp01(progress);
  if (p <= 0 || p >= 1) return { ...ROLL_REST_POSE };

  let index = 0;
  while (index < ROLL_POSE_STOPS.length - 2 && p > ROLL_POSE_STOPS[index + 1]) index++;
  const x0 = ROLL_POSE_STOPS[index];
  const x1 = ROLL_POSE_STOPS[index + 1];
  const t = (p - x0) / (x1 - x0);
  const from = STOP_POSES[index];
  const to = STOP_POSES[index + 1];
  const out = {} as RollPose;
  for (const key of POSE_KEYS) {
    out[key] = hermite(x0, x1, from[key], to[key], TANGENTS[key][index], TANGENTS[key][index + 1], t);
  }
  // 切线受限已经保证不过冲；这里只做最后一道 0–1 / 非负保护。
  out.headAlpha = clamp01(out.headAlpha);
  out.legAlpha = clamp01(out.legAlpha);
  out.shellAlpha = clamp01(out.shellAlpha);
  out.headR = Math.max(0, out.headR);
  out.bodyRx = Math.max(0, out.bodyRx);
  out.bodyRy = Math.max(0, out.bodyRy);
  out.backR = Math.max(0, out.backR);
  out.plateR = Math.max(0, out.plateR);
  out.shellRx = Math.max(0, out.shellRx);
  out.shellRy = Math.max(0, out.shellRy);
  return out;
}

/**
 * 起滚入场混合：0 是真实站立姿态，12% 时完全进入翻滚姿态。
 * 与视觉转向错开（转向从 12% 才开始），两段姿态不会在同一帧里用错坐标系。
 */
export function rollEntryBlend(progress: number): number {
  return smoothstep(0, .12, clamp01(progress));
}

/**
 * 收尾出场混合：84% 开始从翻滚姿态回到当前真实站立/瞄准姿态。
 * 到 100% 时绘制姿态与 drawNormalPose 完全相同，物理结束那一帧不会跳。
 */
export function rollExitBlend(progress: number): number {
  return smoothstep(.84, 1, clamp01(progress));
}

/**
 * 翻滚视觉朝向对 rollDirection 的权重：12–30% 升到 1，58–84% 回落到 0。
 * 中段完全对齐锁定的 rollDirection（鼠标瞄准转身体也拉不动它）；
 * 两端为 0，回到 currentRotation 的实际朝向。入场/出场姿态混合正好在
 * 权重为 0 的区间里完成，所以不会出现“姿态在错误坐标系里混合”的错位。
 */
export function rollFacingWeight(progress: number): number {
  const p = clamp01(progress);
  return smoothstep(.12, .30, p) * (1 - smoothstep(.58, .84, p));
}

/**
 * 背部武器（主武器斜挎、副武器挂腰）在翻滚中的可见度：
 * 起滚时先淡出，收尾时再淡回，避免斜挎的枪管横穿收起的头和蜷缩的球。
 */
export function rollStowedAlpha(progress: number): number {
  const p = clamp01(progress);
  const fadedOut = smoothstep(.04, .16, p);
  const fadedBack = smoothstep(.84, .97, p);
  return 1 - fadedOut * (1 - fadedBack);
}

/** 从身体朝向到翻滚方向的最短弧角度差，结果在 (-π, π]。 */
export function rollAngleDelta(facing: number, rollAngle: number): number {
  const raw = (rollAngle - facing) % TAU;
  return raw > Math.PI ? raw - TAU : raw <= -Math.PI ? raw + TAU : raw;
}

/** 本帧实际用于旋转画面的角度。 */
export function rollVisualAngle(progress: number, facing: number, rollAngle: number): number {
  const weight = rollFacingWeight(progress);
  if (weight <= 0) return facing;
  return facing + rollAngleDelta(facing, rollAngle) * weight;
}
