import { DEFAULT_SENSE_RULES, type SenseRules } from "./SenseRules";

export type ChickenAlertState = "wander" | "startled" | "flee" | "recover";

export interface ChickenThreat {
  x: number;
  y: number;
}

export interface ChickenBehaviorView {
  state: ChickenAlertState;
  threatX: number;
  threatY: number;
  /** 本次更新刚刚从漫游进入警觉：场景据此播放唯一一次惊叫。 */
  justStartled: boolean;
}

/** 惊跳停顿：发现威胁后先僵住一下再逃，不是立刻弹射。 */
const STARTLE_SECONDS = 0.12;
const FLEE_MIN_SECONDS = 0.9;
const FLEE_SPAN_SECONDS = 0.8;
/** 逃跑途中再次看见威胁时，至少再跑这么久，但不重复惊叫。 */
const FLEE_REFRESH_SECONDS = 0.5;
const RECOVER_MIN_SECONDS = 0.5;
const RECOVER_SPAN_SECONDS = 0.5;

/**
 * 小鸡警觉状态机：只消费“有没有威胁、威胁在哪”，不碰地图、碰撞或音频。
 *
 * Wander → Startled → Flee → Recover → Wander；Flee 期间再感知到威胁只延长逃跑、
 * 刷新威胁位置，不会再次播放惊叫。运动与避障仍由 Chicken/Entities 负责。
 */
export class ChickenBehavior {
  private state: ChickenAlertState = "wander";
  private timer = 0;
  private threatX = 0;
  private threatY = 0;
  private readonly rules: SenseRules;
  private readonly random: () => number;

  constructor(rules: SenseRules = DEFAULT_SENSE_RULES, random: () => number = Math.random) {
    this.rules = rules;
    this.random = random;
  }

  getState(): ChickenAlertState {
    return this.state;
  }

  getThreatX(): number {
    return this.threatX;
  }

  getThreatY(): number {
    return this.threatY;
  }

  reset(): void {
    this.state = "wander";
    this.timer = 0;
  }

  update(delta: number, threat: ChickenThreat | null): ChickenBehaviorView {
    const dt = Number.isFinite(delta) && delta > 0 ? delta : 0;
    if (threat) {
      this.threatX = threat.x;
      this.threatY = threat.y;
    }

    let justStartled = false;
    const canStartle = this.state === "wander" || this.state === "recover";
    if (canStartle && threat) {
      // 只有从漫游被惊到才算“首次发现”，恢复期再看见只重新进入警觉、不再尖叫。
      justStartled = this.state === "wander";
      this.state = "startled";
      this.timer = STARTLE_SECONDS;
    } else if (this.state === "startled") {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = "flee";
        this.timer = FLEE_MIN_SECONDS + this.random() * FLEE_SPAN_SECONDS;
      }
    } else if (this.state === "flee") {
      if (threat) this.timer = Math.max(this.timer, FLEE_REFRESH_SECONDS);
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = "recover";
        this.timer = RECOVER_MIN_SECONDS + this.random() * RECOVER_SPAN_SECONDS;
      }
    } else if (this.state === "recover") {
      this.timer -= dt;
      if (this.timer <= 0) this.state = "wander";
    }

    return {
      state: this.state,
      threatX: this.threatX,
      threatY: this.threatY,
      justStartled,
    };
  }
}
