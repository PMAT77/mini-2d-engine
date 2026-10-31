/**
 * 拾取可见性策略：决定某个掉落物这一帧能不能出现高亮点、E 提示和物品名。
 *
 * 这里是纯函数，只消费三层感知的结果与几何信息，不读取像素颜色；
 * 因此 hidden 的物品既不会画标记，也不会成为交互候选。
 */

import type { EntityVisibility, VisionMode } from "../vision/VisionTypes";
import type { PickupConfig } from "./PickupTypes";

export interface PickupVisibilityInput {
  config: PickupConfig;
  /** 感知系统给出的可见性等级。 */
  view: EntityVisibility;
  /** 玩家碰撞体中心到交互锚点的世界距离。 */
  distance: number;
  /** 玩家到锚点之间是否存在墙体硬遮挡（仅近身剪影/legacy 需要）。 */
  lineOfSight: boolean;
  /** 锚点是否落在近身感知半径内。 */
  nearSense: boolean;
  visionMode: VisionMode;
  /** legacy 模式下玩家视野的有效半径。 */
  legacyRange: number;
}

export interface PickupVisibilityDecision {
  /** 地面是否显示高亮点。 */
  marker: boolean;
  /** 是否显示 E 交互提示（AUTO 物品永远为 false）。 */
  prompt: boolean;
  /** 提示是否允许带具体物品信息；剪影只给通用“拾取”。 */
  named: boolean;
}

const NOT_VISIBLE: PickupVisibilityDecision = Object.freeze({
  marker: false,
  prompt: false,
  named: false,
});

/** 单帧判定；输入必须都是本帧数据，避免读到上一帧的感知结果。 */
export function resolvePickupVisibility(
  input: PickupVisibilityInput,
): PickupVisibilityDecision {
  if (!Number.isFinite(input.distance) || input.distance < 0) return NOT_VISIBLE;

  if (input.visionMode === "legacy") {
    return resolveLegacyVisibility(input);
  }

  if (input.view === "hidden") return NOT_VISIBLE;

  const alive = input.distance <= Math.max(0, input.config.discoveryRadius);
  if (input.view === "identified") {
    return {
      marker: alive && input.config.markerStyle !== "none",
      prompt: isInInteractionRange(input),
      named: isInInteractionRange(input),
    };
  }

  // silhouette：只允许“站在旁边摸到”的触觉拾取，远程和隔墙都不给提示。
  const tactile =
    isInInteractionRange(input) && input.nearSense && input.lineOfSight;
  return {
    marker: false,
    prompt: tactile,
    named: false,
  };
}

function isInInteractionRange(input: PickupVisibilityInput): boolean {
  return (
    input.config.mode === "INTERACT" &&
    input.config.interactionRadius > 0 &&
    input.distance <= input.config.interactionRadius
  );
}

/**
 * legacy 开发模式也必须受视野半径和墙体遮挡限制，不能借旧模式扩大交互范围，
 * 更不能在没有 LOS 的情况下透墙显示标记。
 */
function resolveLegacyVisibility(
  input: PickupVisibilityInput,
): PickupVisibilityDecision {
  const range = Math.max(0, input.legacyRange);
  const visible = input.distance <= range && input.lineOfSight;
  if (!visible) return NOT_VISIBLE;

  const inDiscovery =
    input.config.discoveryRadius > 0 && input.distance <= input.config.discoveryRadius;
  const inInteraction =
    input.config.mode === "INTERACT" &&
    input.config.interactionRadius > 0 &&
    input.distance <= input.config.interactionRadius;

  return {
    marker: inDiscovery && input.config.markerStyle !== "none",
    prompt: inInteraction,
    named: inInteraction,
  };
}
