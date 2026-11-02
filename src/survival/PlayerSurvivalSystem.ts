import type { Player } from '../objects/Player';
import type { PlayerDamageResult } from '../combat/PlayerDamage';
import { InfectionController } from './InfectionController';
import { ConsumableInventory } from './ConsumableInventory';
export interface VaccineUseContext { paused: boolean; rolling: boolean; reloading: boolean; interacting: boolean; actionInput: boolean; source?: 'gameplay' | 'backpack'; }
export interface SurvivalSnapshot { alive: boolean; infected: boolean; vaccines: number; infectionRemainder: number; }

export class PlayerSurvivalSystem {
  readonly infection = new InfectionController();
  readonly inventory = new ConsumableInventory();
  constructor(private readonly player: Player) {}
  update(delta: number): PlayerDamageResult | null {
    if (!this.player.isAlive()) { this.infection.clear(); return null; }
    const ticks = this.infection.advance(delta);
    if (!ticks) return null;
    const result = this.player.applyDamage({ kind: 'infection', amount: ticks });
    if (!this.player.isAlive()) this.infection.clear();
    return result;
  }
  onMeleeDamage(result: PlayerDamageResult, probability: number, random: () => number): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('感染概率必须在 0–1');
    if (!this.player.isAlive()) { this.infection.clear(); return false; }
    if (!(result.appliedAmount > 0) || result.blocked || this.infection.isInfected()) return false;
    return random() < probability && this.infection.infect();
  }
  collectVaccine(pickup: { markCollected(): boolean }): boolean {
    if (!this.player.isAlive() || !this.inventory.canAddVaccines(1) || !pickup.markCollected()) return false;
    this.inventory.addVaccines(); return true;
  }
  /** All eligibility checks precede the synchronous inventory/status mutation. */
  getVaccineUseFailure(context: VaccineUseContext): string | null {
    if (!this.player.isAlive()) return '角色已死亡';
    if (context.paused && context.source !== 'backpack') return '游戏已暂停';
    if (context.rolling) return '翻滚时无法使用';
    if (context.reloading) return '换弹时无法使用';
    if (context.interacting || context.actionInput) return '当前动作中无法使用';
    if (this.inventory.getVaccines() < 1) return '疫苗不足';
    if (!this.infection.isInfected()) return '当前未感染';
    return null;
  }
  tryUseVaccine(context: VaccineUseContext): boolean {
    if (this.getVaccineUseFailure(context)) return false;
    this.inventory.consumeVaccine(); this.infection.clear(); return true;
  }
  resetLife(): void { this.player.resetLifeState(); this.infection.clear(); }
  snapshot(): SurvivalSnapshot { return { alive: this.player.isAlive(), infected: this.infection.isInfected(), vaccines: this.inventory.getVaccines(), infectionRemainder: this.infection.getRemainder() }; }
  dispose(): void { this.infection.clear(); this.inventory.clear(); }
}
