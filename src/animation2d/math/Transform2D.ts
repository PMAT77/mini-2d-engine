/**
 * 2D 变换与向量。
 *
 * 绑定姿态（bind）与运行时姿态（pose）使用同一套单位：一个玩家身位 = 1。
 * 世界像素只在绘制阶段乘 size，因此骨架层与分辨率/配置尺寸无关。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export interface Transform2D {
  x: number;
  y: number;
  rotation: number;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function transform2D(x = 0, y = 0, rotation = 0): Transform2D {
  return { x, y, rotation };
}

/** 按角度旋转向量，不改变长度。 */
export function rotateVector(vector: Readonly<Vec2>, angle: number): Vec2 {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: vector.x * c - vector.y * s, y: vector.x * s + vector.y * c };
}

/**
 * 父变换 ∘ 子变换。
 * 子变换的平移会先被父旋转，再叠加到父平移上；旋转直接相加（不做归一化，
 * 与旧的 RollPose 整体旋转保持同样的数值行为）。
 */
export function composeTransforms(
  parent: Readonly<Transform2D>,
  child: Readonly<Transform2D>,
): Transform2D {
  const c = Math.cos(parent.rotation), s = Math.sin(parent.rotation);
  return {
    x: parent.x + child.x * c - child.y * s,
    y: parent.y + child.x * s + child.y * c,
    rotation: parent.rotation + child.rotation,
  };
}

/** 变换一个点（忽略点自身的旋转）。 */
export function transformPoint(transform: Readonly<Transform2D>, point: Readonly<Vec2>): Vec2 {
  const c = Math.cos(transform.rotation), s = Math.sin(transform.rotation);
  return {
    x: transform.x + point.x * c - point.y * s,
    y: transform.y + point.x * s + point.y * c,
  };
}
