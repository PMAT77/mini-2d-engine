/**
 * 玩家渲染适配器：把 Player 当前的渲染状态固化成快照，交给命令渲染器。
 *
 * 翻滚姿态由 PlayerRollClip 采样，朝向经 RollFacingTracker 展开；
 * 翻滚期间叠加伪高度（阴影在缓冲外）、重心前压、接触链 IK 与逐帧深度；
 * 非翻滚帧按 base → punch → reload → hit react → 接触约束的顺序叠层。
 * 适配器只读 Player 的公开成员，不持有游戏对象引用，也不创建 DOM/Canvas。
 */

import type { Player } from "../Player";
import type { WeaponKind } from "../Weapon";
import { solveForwardKinematics, resolveSockets } from "../../animation2d/pose/Fk2D";
import { solveTwoBoneIk } from "../../animation2d/pose/TwoBoneIk2D";
import { PLAYER_RIG } from "../../animation2d/rig/PlayerRig";
import type { CharacterRenderSnapshot } from "../../animation2d/render/CharacterSnapshot";
import { renderCharacterSnapshot } from "../../animation2d/render/CharacterCanvasRenderer";
import type { RollPose } from "../RollPose";
import { interpolateRollPose, rollEntryBlend, rollExitBlend, rollFacingWeight } from "../RollPose";
import { legacyPoseToLocalPose, legacyPoseToParams } from "./LegacyPoseAdapter";
import { PlayerAnimationController } from "./PlayerAnimationController";
import { sampleRollPose } from "./PlayerRollClip";
import {
  FOOT_CONTACT_CHAIN,
  HAND_CONTACT_CHAIN,
  RollContactTracker,
  boneWorldPoint,
  inContactWindow,
  worldPointToLocal,
} from "./RollContactTracker";
import { rollAltitudePx, rollComOffsetX, rollDepthTucked } from "./RollGrounding";
import { RollFacingTracker } from "./RollFacingTracker";
import { poseWithOffsets } from "../../animation2d/pose/PoseLayers";
import type { PoseOffsets } from "../../animation2d/pose/PoseLayers";
import { buildPunchOffsets, punchAmount } from "./PlayerPunchClip";
import { buildReloadOffsets, reloadGestureAmount } from "./PlayerReloadGesture";

/**
 * 受击 additive：躯干轻微后压、头后仰。只施加在 heads/torso 上，
 * 不做任何累积，因此每帧都从当前 base 重新得到同一结果。
 */
const HIT_REACT_OFFSETS: PoseOffsets = {
  torso: { x: -0.012, rotation: 0.025 },
  head: { x: -0.02, rotation: -0.06 },
};

const controllers = new WeakMap<Player, PlayerAnimationController>();
const facingTrackers = new WeakMap<Player, RollFacingTracker>();
const contactTrackers = new WeakMap<Player, RollContactTracker>();

function getFacingTracker(player: Player): RollFacingTracker {
  let tracker = facingTrackers.get(player);
  if (!tracker) {
    tracker = new RollFacingTracker();
    facingTrackers.set(player, tracker);
  }
  return tracker;
}

function getContactTracker(player: Player): RollContactTracker {
  let tracker = contactTrackers.get(player);
  if (!tracker) {
    tracker = new RollContactTracker();
    contactTrackers.set(player, tracker);
  }
  return tracker;
}

/** 每个玩家一份控制器；只推进事件窗口与相位，不持有游戏状态。 */
export function getPlayerAnimationController(player: Player): PlayerAnimationController {
  let controller = controllers.get(player);
  if (!controller) {
    controller = new PlayerAnimationController();
    controllers.set(player, controller);
  }
  return controller;
}

/** 测试隔离：清空事件窗口、朝向展开与接触锚。 */
export function resetPlayerVisualState(player: Player): void {
  getPlayerAnimationController(player).reset();
  facingTrackers.get(player)?.reset();
  getContactTracker(player).reset();
}

/** 每帧至多推进一次；由 Player.update 末尾调用。 */
export function advancePlayerAnimation(player: Player, delta: number): void {
  if (!Number.isFinite(delta) || delta < 0) return;
  getPlayerAnimationController(player).update(player.getRollProgress(), player.isRolling(), delta);
}

/**
 * 把当前 Player 状态固化为快照；除读取公开成员外无副作用。
 * 翻滚时姿态改用 clip 采样并以与 getRenderState() 相同的 enter/exit 权重混合，
 * 朝向在跨 ±π 的帧上使用展开角，其余帧与旧公式逐位一致。
 */
export function createPlayerRenderSnapshot(player: Player): CharacterRenderSnapshot {
  const state = player.getRenderState();
  const size = player.getSize();
  const rawFacing = player.getVisualFacing();
  const view = player.getWeaponView();

  let pose: RollPose = state.pose;
  let facing = state.angle;
  let altitudePx = 0;
  let depthTuck = false;
  let comOffset = 0;
  if (state.rolling) {
    const progress = state.progress;
    pose = sampleRollPose(progress);
    const enter = rollEntryBlend(progress);
    const exit = rollExitBlend(progress);
    if (enter < 1 || exit > 0) {
      const normal = player.getNormalPose(size, rawFacing);
      if (enter < 1) pose = interpolateRollPose(normal, pose, enter);
      if (exit > 0) pose = interpolateRollPose(pose, normal, exit);
    }
    const weight = rollFacingWeight(progress);
    facing = weight > 0 ? getFacingTracker(player).resolve(rawFacing, player.getRollAngle(), weight) : rawFacing;
    if (weight <= 0) facingTrackers.get(player)?.reset();
    // 被墙削掉实际位移时同步压低伪高度与前压，避免“原地翻滚还在腾空”。
    const grounding = player.getRollGroundingScale();
    altitudePx = rollAltitudePx(progress, size) * grounding;
    depthTuck = rollDepthTucked(progress);
    comOffset = rollComOffsetX(progress) * grounding;
  } else {
    facingTrackers.get(player)?.reset();
  }

  let locals = legacyPoseToLocalPose(pose);
  const params = legacyPoseToParams(pose);
  if (comOffset !== 0) {
    // 骨盆前压带动全部子骨；躯干附着的背 / 胸板 / 外壳同步平移，避免脱节。
    locals.locals.pelvis.x += comOffset;
    params.backX += comOffset;
    params.plateX += comOffset;
    params.shellX += comOffset;
  }

  // 分层顺序：base → action（拳击，只覆盖上半身）→ additive（受击）→ constraint（接触 IK）。
  // 翻滚是全身覆盖，不再叠加这两层，避免与接触锚/伪高度互相冲突。
  const controller = getPlayerAnimationController(player);
  const punchProgress = state.rolling ? 0 : controller.punchProgress;
  const hitReactProgress = state.rolling ? 0 : player.getHitReactProgress();
  const reloadProgress = state.rolling ? 0 : (view.isReloading ? view.reloadProgress : 0);
  if (punchProgress > 0) {
    const amount = punchAmount(punchProgress);
    if (amount > 0) {
      const offsets = buildPunchOffsets(amount);
      locals = poseWithOffsets(locals, offsets, 1);
      const shift = offsets.torso?.x ?? 0;
      params.backX += shift;
      params.plateX += shift;
      params.shellX += shift;
    }
  }
  if (reloadProgress > 0) {
    // 换弹手势只下沉持枪臂；包络两端为 0，不会在换弹结束后残留偏移。
    const amount = reloadGestureAmount(view.isReloading, reloadProgress);
    if (amount > 0) locals = poseWithOffsets(locals, buildReloadOffsets(amount), 1);
  }
  if (hitReactProgress > 0) {
    // 剩余幅度平方：受击瞬间最强，随后平滑衰减到 0；每帧从 base 重算，不累积。
    const envelope = hitReactProgress * hitReactProgress;
    if (envelope > 0) {
      locals = poseWithOffsets(locals, HIT_REACT_OFFSETS, envelope);
      const shift = (HIT_REACT_OFFSETS.torso?.x ?? 0) * envelope;
      params.backX += shift;
      params.plateX += shift;
      params.shellX += shift;
    }
  }

  let world = solveForwardKinematics(PLAYER_RIG, locals);

  const contacts = getContactTracker(player);
  if (state.rolling) {
    applyContact(player, contacts, locals, world, HAND_CONTACT_CHAIN, HAND_CONTACT_CHAIN.window, state.progress, facing, size, "hand");
    applyContact(player, contacts, locals, world, FOOT_CONTACT_CHAIN, FOOT_CONTACT_CHAIN.window, state.progress, facing, size, "foot");
    // IK 会改写局部量，重新 FK 一次得到最终骨骼与 socket。
    world = solveForwardKinematics(PLAYER_RIG, locals);
  } else {
    contacts.reset();
  }
  const sockets = resolveSockets(PLAYER_RIG, world);

  return {
    size,
    facing,
    scale: state.scale,
    progress: state.progress,
    rolling: state.rolling,
    stowedAlpha: state.stowedAlpha,
    activeSlot: player.getActiveWeaponSlot(),
    weaponKind: view.kind as WeaponKind,
    altitudePx,
    depthTuck,
    punchProgress,
    hitReactProgress,
    reloadProgress,
    pose: params,
    locals,
    world,
    sockets,
  };
}

function applyContact(
  player: Player,
  contacts: RollContactTracker,
  locals: ReturnType<typeof legacyPoseToLocalPose>,
  world: ReturnType<typeof solveForwardKinematics>,
  chain: typeof HAND_CONTACT_CHAIN,
  window: { start: number; end: number },
  progress: number,
  facing: number,
  size: number,
  kind: "hand" | "foot",
): void {
  const anchored = kind === "hand" ? contacts.getHand() : contacts.getFoot();
  if (!inContactWindow(window, progress)) {
    if (kind === "hand") contacts.releaseHand();
    else contacts.releaseFoot();
    return;
  }

  const centerX = player.x + size / 2;
  const centerY = player.y + size / 2;
  let anchor = anchored;
  if (!anchor) {
    anchor = boneWorldPoint(world, chain.end, centerX, centerY, facing, size);
    if (kind === "hand") contacts.anchorHand(anchor);
    else contacts.anchorFoot(anchor);
  }

  const target = worldPointToLocal(anchor.x, anchor.y, centerX, centerY, facing, size);
  const solved = solveTwoBoneIk(locals, world, chain.root, chain.mid, chain.end, target);
  if (!solved) {
    if (kind === "hand") contacts.releaseHand();
    else contacts.releaseFoot();
  }
}

export function renderPlayerSnapshot(
  ctx: CanvasRenderingContext2D,
  snapshot: CharacterRenderSnapshot,
  centerX: number,
  centerY: number,
): void {
  renderCharacterSnapshot(ctx, snapshot, centerX, centerY);
}

/**
 * 枪口在世界坐标中的位置与朝向：优先走骨架的 visualMuzzle socket。
 * 仅在 rig 后端可用；返回 null 时调用方回退到旧的 getMuzzlePosition 路径。
 */
export function getPlayerMuzzleWorld(player: Player): { x: number; y: number; facing: number } {
  const snapshot = createPlayerRenderSnapshot(player);
  const socket = snapshot.sockets.visualMuzzle;
  const size = snapshot.size;
  const scale = size * snapshot.scale;
  const lx = socket.x * scale;
  const ly = socket.y * scale;
  const c = Math.cos(snapshot.facing);
  const sn = Math.sin(snapshot.facing);
  return {
    x: player.x + size / 2 + lx * c - ly * sn,
    y: player.y + size / 2 + lx * sn + ly * c,
    facing: snapshot.facing,
  };
}
