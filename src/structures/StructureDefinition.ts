export const WOOD_WALL = Object.freeze({ id: 'wood-wall', name: '木墙', level: 1, maxHp: 120,
  lengthTiles: 1, thicknessTiles: .32 });
export interface StructureState {
  instanceId: string;
  definitionId: 'wood-wall';
  level: 1;
  col: number;
  row: number;
  rotation: 0 | 1;
  hp: number;
  status: 'standing' | 'destroyed';
  observedHp: number | null;
}
