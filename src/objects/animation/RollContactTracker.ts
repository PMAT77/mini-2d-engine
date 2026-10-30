/**
 * 翻滚接触锚：记录支撑手 / 脚在**世界像素**里的落点，每帧用逆变换拉回骨骼。
 *
 * 锚点只在窗口内有效；一旦 IK 不可达（身体已经滚出可达半径）就丢弃，
 * 回落到 clip 姿态，绝不把肢体强行拉长。
 */

import type { GlobalPose2D } from "../../animation2d/pose/Pose2D";
import type { BoneId } from "../../animation2d/rig/RigTypes";

export interface WorldAnchor {
  x: number;
  y: number;
}

export interface ContactWindow {
  start: number;
  end: number;
}

export const HAND_CONTACT_WINDOW: ContactWindow = { start: .30, end: .54 };
export const FOOT_CONTACT_WINDOW: ContactWindow = { start: .54, end: .76 };

export interface ContactChain {
  root: BoneId;
  mid: BoneId;
  end: BoneId;
  window: ContactWindow;
}

export const HAND_CONTACT_CHAIN: ContactChain = {
  root: "shoulderR",
  mid: "elbowR",
  end: "handR",
  window: HAND_CONTACT_WINDOW,
};

export const FOOT_CONTACT_CHAIN: ContactChain = {
  root: "hipR",
  mid: "kneeR",
  end: "footR",
  window: FOOT_CONTACT_WINDOW,
};

/** 取接触链末端当前的世界位置；与渲染器共用同一套中心 / 朝向 / 缩放。 */
export function boneWorldPoint(
  world: GlobalPose2D,
  bone: BoneId,
  centerX: number,
  centerY: number,
  facing: number,
  size: number,
): WorldAnchor {
  const point = world.world[bone];
  const cos = Math.cos(facing);
  const sin = Math.sin(facing);
  return {
    x: centerX + (point.x * cos - point.y * sin) * size,
    y: centerY + (point.x * sin + point.y * cos) * size,
  };
}

/** 世界点 → body-local（单位 = 身高），与 `boneWorldPoint` 严格互逆。 */
export function worldPointToLocal(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  facing: number,
  size: number,
): WorldAnchor {
  const dx = (x - centerX) / size;
  const dy = (y - centerY) / size;
  const cos = Math.cos(-facing);
  const sin = Math.sin(-facing);
  return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
}

export function inContactWindow(window: ContactWindow, progress: number): boolean {
  return progress >= window.start && progress < window.end;
}

export class RollContactTracker {
  private hand: WorldAnchor | null = null;
  private foot: WorldAnchor | null = null;

  getHand(): WorldAnchor | null {
    return this.hand;
  }

  getFoot(): WorldAnchor | null {
    return this.foot;
  }

  anchorHand(point: WorldAnchor): void {
    this.hand = { x: point.x, y: point.y };
  }

  anchorFoot(point: WorldAnchor): void {
    this.foot = { x: point.x, y: point.y };
  }

  releaseHand(): void {
    this.hand = null;
  }

  releaseFoot(): void {
    this.foot = null;
  }

  reset(): void {
    this.hand = null;
    this.foot = null;
  }
}

/** 给测试与调试用的链序常量（root→mid→end），避免魔法字符串散落。 */