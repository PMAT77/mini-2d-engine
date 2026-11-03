import type { TileMap } from '../map/TileMap';
import { rectangleCollider, circleCollider, collide } from '../physics/Collider';
import type { Collider, Point } from '../physics/Collider';
import { NavigationGrid } from '../navigation/NavigationGrid';
import { WOOD_WALL } from './StructureDefinition';
import type { StructureState } from './StructureDefinition';
import { parseStructureState } from '../campaign/CampaignState';
import { blastDamage, THROWABLE_CONFIG } from '../throwables/ThrowableConfig';
import type { EnvironmentState } from '../core/EnvironmentLighting';

export interface PlacementContext { actors: readonly Collider[]; player: Collider; entrance: Point; }
export function structureCollider(state: Pick<StructureState, 'col' | 'row' | 'rotation'>, size: number): Collider {
  const width = size * (state.rotation ? WOOD_WALL.thicknessTiles : WOOD_WALL.lengthTiles);
  const height = size * (state.rotation ? WOOD_WALL.lengthTiles : WOOD_WALL.thicknessTiles);
  return rectangleCollider((state.col + .5) * size - width / 2, (state.row + .5) * size - height / 2, width, height);
}
/** 建筑数据拥有者；几何、渲染都从同一份建筑状态派生，存档不包含回调。 */
export class StructureSystem {
  private readonly states = new Map<string, StructureState>();
  private readonly releases = new Map<string, () => void>();
  private readonly visible = new Set<string>();
  constructor(readonly map: TileMap, saved: readonly StructureState[], private readonly changed: () => void) {
    if (saved.length > 512) throw new Error('建筑数量超出当前上限');
    const candidates = saved.map(parseStructureState), ids = new Set<string>(), cells = new Set<string>(), standing: Collider[] = [];
    for (const state of candidates) {
      const cell = state.col + ':' + state.row;
      if (ids.has(state.instanceId) || cells.has(cell) || state.col >= map.width || state.row >= map.height) throw new Error('建筑位置或身份无效');
      ids.add(state.instanceId); cells.add(cell);
      if (state.status !== 'standing') continue;
      const body = structureCollider(state, map.tileSize);
      if (map.queryShape(body).some(c => c.depth > 1e-7) || standing.some(other => collide(body, other).some(c => c.depth > 1e-7))) throw new Error('建筑与地形或其他建筑重叠');
      standing.push(body);
    }
    try { for (const state of candidates) { this.states.set(state.instanceId, state); if (state.status === 'standing') this.register(state); } }
    catch (error) { this.dispose(); throw error; }
  }
  snapshot(): StructureState[] { return Array.from(this.states.values(), state => ({ ...state })); }
  at(col: number, row: number): StructureState | undefined {
    const result = Array.from(this.states.values()).find(state => state.col === col && state.row === row);
    return result && { ...result };
  }
  private register(state: StructureState): void {
    this.releases.set(state.instanceId, this.map.registerSolid(state.instanceId, [structureCollider(state, this.map.tileSize)],
      impact => { this.damage(state.instanceId, impact.damage); }));
  }
  placementError(col: number, row: number, rotation: 0 | 1, context: PlacementContext, checkRoute = true): string | null {
    if (!Number.isSafeInteger(col) || !Number.isSafeInteger(row) || col < 0 || row < 0 || col >= this.map.width || row >= this.map.height || ![0, 1].includes(rotation)) return '请选择地图内的网格';
    if (this.states.size >= 512) return '建筑数量已达当前上限，请清理残骸';
    if (this.at(col, row)) return '此处已有建筑或残骸';
    const body = structureCollider({ col, row, rotation }, this.map.tileSize);
    if (Math.hypot(body.pose.x - context.player.pose.x, body.pose.y - context.player.pose.y) > 175) return '距离过远，请靠近后建设';
    if (this.map.queryShape(body).some(c => c.depth > 1e-7)) return '此处与地形或障碍重叠';
    if (context.actors.some(actor => collide(body, actor).some(c => c.depth > 1e-7))) return '此处有角色或物品';
    if (collide(body, circleCollider(context.entrance.x, context.entrance.y, context.player.radius + 6)).length) return '请保留营地出入口';
    if (checkRoute && !this.preservesRoute(context, body)) return '此处会封住返回入口的通路';
    return null;
  }
  private preservesRoute(context: PlacementContext, body: Collider): boolean {
    const grid = new NavigationGrid(this.map, context.player.radius, [body]);
    const start = context.player.pose, goal = context.entrance;
    if (Number.isFinite(grid.segmentCost(start, goal))) return true;
    const goals = new Set(grid.connections(goal).map(c => c.point.key)), queue = grid.connections(start).map(c => c.point);
    const seen = new Set(queue.map(point => point.key));
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i]; if (goals.has(current.key)) return true;
      for (const { point } of grid.neighbors(current)) if (!seen.has(point.key)) { seen.add(point.key); queue.push(point); }
    }
    return false;
  }
  build(instanceId: string, col: number, row: number, rotation: 0 | 1, context: PlacementContext): void {
    const error = this.placementError(col, row, rotation, context); if (error) throw new Error(error);
    if (this.states.has(instanceId)) throw new Error('建筑实例重复');
    const state = parseStructureState({ instanceId, definitionId: WOOD_WALL.id, level: 1, col, row, rotation, hp: WOOD_WALL.maxHp, status: 'standing', observedHp: WOOD_WALL.maxHp });
    this.register(state); this.states.set(instanceId, state); this.visible.add(instanceId); this.changed();
  }
  damage(id: string, amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const state = this.states.get(id); if (!state || state.status !== 'standing') return false;
    state.hp = Math.max(0, state.hp - amount);
    if (!state.hp) { state.status = 'destroyed'; this.releases.get(id)?.(); this.releases.delete(id); }
    this.changed(); return true;
  }
  repair(id: string): void {
    const state = this.states.get(id); if (!state || state.status !== 'standing') throw new Error('残骸无法修理，请清理后重建');
    if (state.hp === WOOD_WALL.maxHp) throw new Error('建筑耐久已满');
    state.hp = state.observedHp = WOOD_WALL.maxHp; this.changed();
  }
  dismantle(id: string): void {
    if (!this.states.has(id)) throw new Error('建筑不存在');
    this.releases.get(id)?.(); this.releases.delete(id); this.states.delete(id); this.visible.delete(id); this.changed();
  }
  collectBlast(x: number, y: number): { id: string; damage: number }[] {
    const hits: { id: string; damage: number }[] = [];
    for (const state of this.states.values()) {
      if (state.status !== 'standing') continue;
      const body = structureCollider(state, this.map.tileSize), move = { x: body.pose.x - x, y: body.pose.y - y };
      if (Math.hypot(move.x, move.y) > THROWABLE_CONFIG.blastRadius + body.radius) continue;
      const hit = this.map.castShape(circleCollider(x, y, .1), move, 'projectile');
      if (hit?.obstacle.ownerId !== state.instanceId) continue;
      const damage = blastDamage(Math.hypot(move.x, move.y) * hit.fraction); if (damage > 0) hits.push({ id: state.instanceId, damage });
    }
    return hits;
  }
  meleeHit(origin: Point, facing: number, range: number, halfAngle: number): { id: string; distance: number } | null {
    let best: { id: string; distance: number } | null = null;
    for (const state of this.states.values()) {
      if (state.status !== 'standing') continue;
      const b = structureCollider(state, this.map.tileSize).bounds;
      const points = [{ x: Math.max(b.x, Math.min(b.x + b.width, origin.x)), y: Math.max(b.y, Math.min(b.y + b.height, origin.y)) },
        { x: b.x, y: b.y }, { x: b.x + b.width, y: b.y }, { x: b.x, y: b.y + b.height }, { x: b.x + b.width, y: b.y + b.height }];
      for (const p of points) {
        const dx = p.x - origin.x, dy = p.y - origin.y, distance = Math.hypot(dx, dy);
        const angle = Math.atan2(Math.sin(Math.atan2(dy, dx) - facing), Math.cos(Math.atan2(dy, dx) - facing));
        if (distance > range || Math.abs(angle) > halfAngle || (best && distance >= best.distance)) continue;
        const hit = this.map.castShape(circleCollider(origin.x, origin.y, 1), { x: dx, y: dy }, 'projectile');
        if (hit?.obstacle.ownerId === state.instanceId) best = { id: state.instanceId, distance };
      }
    }
    return best;
  }
  observe(canSee: (x: number, y: number) => boolean): void {
    this.visible.clear();
    for (const state of this.states.values()) {
      const b = structureCollider(state, this.map.tileSize).bounds;
      if (![[b.x - 1, b.y + b.height / 2], [b.x + b.width + 1, b.y + b.height / 2], [b.x + b.width / 2, b.y - 1], [b.x + b.width / 2, b.y + b.height + 1]].some(([x, y]) => canSee(x, y))) continue;
      this.visible.add(state.instanceId);
      if (state.observedHp !== state.hp) { state.observedHp = state.hp; this.changed(); }
    }
  }
  draw(ctx: CanvasRenderingContext2D, ox: number, oy: number, memory = false, environment?: EnvironmentState): void {
    for (const state of this.states.values()) {
      if (memory ? this.visible.has(state.instanceId) || state.observedHp === null : !this.visible.has(state.instanceId)) continue;
      const body = structureCollider(state, this.map.tileSize), { x, y, width, height } = body.bounds;
      ctx.save(); ctx.translate(x - ox, y - oy);
      const hp = memory ? state.observedHp! : state.hp;
      if (memory) ctx.globalAlpha *= .32;
      if (!hp) {
        ctx.fillStyle = '#5b4937'; for (let i = 0; i < 4; i++) ctx.fillRect(i * width / 4 + 1, i % 2 * height / 3, Math.max(3, width / 5), height / 3);
      } else {
        ctx.fillStyle = hp <= WOOD_WALL.maxHp / 2 ? '#72533b' : '#a77c4b'; ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = '#d6b077'; ctx.lineWidth = 1; ctx.strokeRect(.5, .5, width - 1, height - 1);
        ctx.strokeStyle = '#4b3626'; ctx.beginPath();
        if (!state.rotation) { for (let i = 1; i < 5; i++) { ctx.moveTo(i * width / 5, 0); ctx.lineTo(i * width / 5, height); } }
        else { for (let i = 1; i < 5; i++) { ctx.moveTo(0, i * height / 5); ctx.lineTo(width, i * height / 5); } }
        ctx.stroke();
        if (environment && environment.sunIntensity > 0) {
          ctx.save(); ctx.globalAlpha *= environment.edgeIntensity * Math.min(1, environment.sunIntensity / .24);
          ctx.strokeStyle = environment.sunColor; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(1.5, height - 1.5); ctx.lineTo(1.5, 1.5); ctx.lineTo(width - 1.5, 1.5); ctx.stroke();
          ctx.strokeStyle = '#172635'; ctx.beginPath(); ctx.moveTo(width - 1.5, 1.5); ctx.lineTo(width - 1.5, height - 1.5); ctx.lineTo(1.5, height - 1.5); ctx.stroke(); ctx.restore();
        }
        if (!memory && hp < WOOD_WALL.maxHp) { ctx.fillStyle = '#d38a68'; ctx.fillRect(0, height + 3, width * hp / WOOD_WALL.maxHp, 2); }
      }
      ctx.restore();
    }
  }
  dispose(): void { for (const release of this.releases.values()) release(); this.releases.clear(); }
}
