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
 * 静止/站立姿态：翻滚开始（0%）与结束（100%）都必须落在这里，
 * 所以两端与 drawNormalPose 的静态形状完全一致，不会跳变。
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

/**
 * 五个阶段的关键姿态。at 是翻滚进度（0–1），改这里的比例就能调整各阶段长短：
 * A 0–15% 降重心、低头、双臂前移；B 15–35% 头收胸前、肩前移、手臂弯曲支撑；
 * C 35–65% 蜷缩、肩背翻过去、头被躯干遮住；D 65–85% 手臂伸出、躯干舒展、头重新显露；
 * E 85–100% 回到站立。
 */
const ROLL_KEY_FRAMES: ReadonlyArray<{ at: number; pose: Partial<RollPose> }> = [
  {
    at: .15, pose: {
      headX: .10, headY: .02, headR: .25, headAlpha: 1,
      bodyX: 0, bodyY: .02, bodyRx: .40, bodyRy: .41,
      backX: -.05, backY: .02, backR: .44,
      plateX: .05, plateY: .02, plateR: .285,
      leftShoulderX: 0, leftShoulderY: -.30, leftElbowX: .10, leftElbowY: -.34, leftHandX: .26, leftHandY: -.34,
      rightShoulderX: 0, rightShoulderY: .30, rightElbowX: .10, rightElbowY: .34, rightHandX: .26, rightHandY: .34,
      leftKneeX: -.18, leftKneeY: -.18, leftFootX: -.38, leftFootY: -.20,
      rightKneeX: -.18, rightKneeY: .18, rightFootX: -.38, rightFootY: .20,
      legAlpha: .25,
      shellAlpha: 0,
      weaponAngle: -.15,
    },
  },
  {
    at: .35, pose: {
      headX: .09, headY: .03, headR: .19, headAlpha: .35,
      bodyX: .02, bodyY: .03, bodyRx: .36, bodyRy: .40,
      backX: -.04, backY: .03, backR: .43,
      plateX: .03, plateY: .03, plateR: .26,
      leftShoulderX: .04, leftShoulderY: -.28, leftElbowX: .24, leftElbowY: -.30, leftHandX: .18, leftHandY: -.40,
      rightShoulderX: .04, rightShoulderY: .28, rightElbowX: .24, rightElbowY: .30, rightHandX: .18, rightHandY: .40,
      leftKneeX: -.34, leftKneeY: -.26, leftFootX: -.50, leftFootY: -.18,
      rightKneeX: -.34, rightKneeY: .26, rightFootX: -.50, rightFootY: .18,
      legAlpha: .7,
      shellX: -.02, shellY: .01, shellRx: .31, shellRy: .35, shellAlpha: .6,
      weaponAngle: -.45,
    },
  },
  {
    at: .5, pose: {
      headX: 0, headY: .02, headR: .15, headAlpha: 0,
      bodyX: 0, bodyY: 0, bodyRx: .30, bodyRy: .37,
      backX: -.02, backY: 0, backR: .44,
      plateX: .02, plateY: 0, plateR: .22,
      leftShoulderX: -.02, leftShoulderY: -.24, leftElbowX: .14, leftElbowY: -.32, leftHandX: .20, leftHandY: -.34,
      rightShoulderX: -.02, rightShoulderY: .24, rightElbowX: .14, rightElbowY: .32, rightHandX: .20, rightHandY: .34,
      leftKneeX: -.34, leftKneeY: -.30, leftFootX: -.52, leftFootY: -.20,
      rightKneeX: -.34, rightKneeY: .30, rightFootX: -.52, rightFootY: .20,
      legAlpha: 1,
      shellX: -.03, shellY: 0, shellRx: .33, shellRy: .40, shellAlpha: 1,
      weaponAngle: -.55,
    },
  },
  {
    at: .65, pose: {
      headX: .06, headY: .02, headR: .21, headAlpha: .55,
      bodyX: .01, bodyY: .02, bodyRx: .35, bodyRy: .39,
      backX: -.04, backY: .02, backR: .44,
      plateX: .04, plateY: .02, plateR: .27,
      leftShoulderX: 0, leftShoulderY: -.28, leftElbowX: .28, leftElbowY: -.30, leftHandX: .30, leftHandY: -.30,
      rightShoulderX: 0, rightShoulderY: .28, rightElbowX: .28, rightElbowY: .30, rightHandX: .30, rightHandY: .30,
      leftKneeX: -.28, leftKneeY: -.38, leftFootX: -.44, leftFootY: -.30,
      rightKneeX: -.28, rightKneeY: .38, rightFootX: -.44, rightFootY: .30,
      legAlpha: .55,
      shellX: -.03, shellY: 0, shellRx: .31, shellRy: .35, shellAlpha: .45,
      weaponAngle: -.4,
    },
  },
  {
    at: .75, pose: {
      headX: .08, headY: .01, headR: .24, headAlpha: 1,
      bodyX: 0, bodyY: .01, bodyRx: .38, bodyRy: .40,
      backX: -.05, backY: 0, backR: .44,
      plateX: .05, plateY: .01, plateR: .28,
      leftShoulderX: 0, leftShoulderY: -.30, leftElbowX: .06, leftElbowY: -.38, leftHandX: .16, leftHandY: -.42,
      rightShoulderX: 0, rightShoulderY: .30, rightElbowX: .06, rightElbowY: .38, rightHandX: .16, rightHandY: .42,
      leftKneeX: -.22, leftKneeY: -.24, leftFootX: -.36, leftFootY: -.26,
      rightKneeX: -.22, rightKneeY: .24, rightFootX: -.36, rightFootY: .26,
      legAlpha: .35,
      shellAlpha: 0,
      weaponAngle: -.2,
    },
  },
  {
    at: .85, pose: {
      headX: .09, headY: .01, headR: .26, headAlpha: 1,
      bodyX: 0, bodyY: 0, bodyRx: .40, bodyRy: .41,
      backX: -.055, backY: 0, backR: .45,
      plateX: .055, plateY: 0, plateR: .285,
      leftShoulderX: 0, leftShoulderY: -.31, leftElbowX: .02, leftElbowY: -.40, leftHandX: .08, leftHandY: -.45,
      rightShoulderX: 0, rightShoulderY: .31, rightElbowX: .02, rightElbowY: .40, rightHandX: .08, rightHandY: .45,
      leftKneeX: -.18, leftKneeY: -.16, leftFootX: -.30, leftFootY: -.20,
      rightKneeX: -.18, rightKneeY: .16, rightFootX: -.30, rightFootY: .20,
      legAlpha: .12,
      shellAlpha: 0,
      weaponAngle: -.1,
    },
  },
];

/** 关键帧展开成完整姿态，插值时不必再处理缺省字段。 */
const ROLL_FRAMES: ReadonlyArray<{ at: number; pose: RollPose }> = ROLL_KEY_FRAMES.map(frame => ({
  at: frame.at,
  pose: { ...ROLL_REST_POSE, ...frame.pose },
}));

/** 每个关键帧的进度，方便测试与调参；首尾固定落在静止姿态。 */
export const ROLL_POSE_STOPS: readonly number[] = [0, ...ROLL_FRAMES.map(frame => frame.at), 1];

/** 线性插值两个姿态；t 会被夹到 0–1。 */
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
  if (p <= 0) return { ...ROLL_REST_POSE };
  for (let i = 0; i < ROLL_FRAMES.length; i++) {
    const frame = ROLL_FRAMES[i];
    if (p > frame.at) continue;
    const prevAt = i === 0 ? 0 : ROLL_FRAMES[i - 1].at;
    const prevPose = i === 0 ? ROLL_REST_POSE : ROLL_FRAMES[i - 1].pose;
    const span = frame.at - prevAt;
    const t = span <= 0 ? 1 : smoothstep(0, 1, (p - prevAt) / span);
    return interpolateRollPose(prevPose, frame.pose, t);
  }
  // 最后一个关键帧之后回到静止姿态，保证 100% 与站立完全一致。
  const last = ROLL_FRAMES[ROLL_FRAMES.length - 1];
  const t = smoothstep(0, 1, (p - last.at) / (1 - last.at));
  return interpolateRollPose(last.pose, ROLL_REST_POSE, t);
}

/**
 * 翻滚视觉朝向对 rollDirection 的权重：起滚 14% 内升到 1，55% 后开始回落到 0。
 * 中段为 1，视觉朝向完全对齐锁定的 rollDirection（鼠标瞄准转身体也拉不动它）；
 * 两端为 0，回到 currentRotation 的实际朝向，所以起滚/收尾都不会突跳。
 */
export function rollFacingWeight(progress: number): number {
  const p = clamp01(progress);
  return smoothstep(0, .14, p) * (1 - smoothstep(.55, 1, p));
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
