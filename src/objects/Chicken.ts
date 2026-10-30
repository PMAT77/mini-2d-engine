import { Input } from "../core/Input";
import { TileMap } from "../map/TileMap";
import { Vector2 } from "../math/Vector2";
import { circleCollider, Point } from "../physics/Collider";
import { Entities } from "./Entities";

/** 小鸡色板：硬边平涂，保持低多边形的块面感。 */
const BODY_LIGHT = "#F6D36B";
const BODY_MID = "#E9B441";
const BODY_DARK = "#C98A2C";
const WING_LIGHT = "#D99A2E";
const WING_DARK = "#BF7E22";
const CREAM = "#FFF1CF";
const CREAM_SHADE = "#E8D4A9";
const COMB = "#D8433B";
const BEAK = "#F0872D";
const BEAK_DARK = "#C9671B";
const TAIL_LIGHT = "#A97135";
const TAIL_MID = "#8A5A2B";
const TAIL_DARK = "#6A4220";
const EYE = "#241C14";
/** 剪影轮廓的占位色：实际颜色由 GameScene 的 source-in 冷灰覆盖。 */
const SILHOUETTE_COLOR = "#ffffff";

/**
 * 俯瞰视角的低多边形小鸡。
 *
 * 只在地图的干燥可行走地面上自由游荡；物理、贴墙滑动和地图边界全部复用 Entities。
 * 被子弹命中即死（一击必杀），由场景负责白气团和肉块掉落。
 */
export class Chicken extends Entities {
  /** 身体直径（世界像素）。造型会略微超出碰撞圆，但不会回写尺寸。 */
  static readonly SIZE = 22;
  /** 一击必杀：任何正伤害都直接打死；保留 health 接口供命中反馈和后续扩展使用。 */
  static readonly MAX_HEALTH = 1;

  private static readonly MIN_SPAWN_DISTANCE = 180;
  private static readonly MAX_SPAWN_DISTANCE = 1100;
  private static readonly MIN_SPACING = 70;
  private static readonly SPAWN_ATTEMPTS = 200;
  private static readonly MIN_SPEED = 30;
  private static readonly MAX_SPEED = 46;
  private static readonly DIRECTION_ATTEMPTS = 12;
  private static readonly IDLE_CHANCE = 0.34;
  private static readonly PECK_SECONDS = 2.6;
  /** 每走这么远报一次脚步；小鸡身长 22px，这个步幅下约每秒 3 步。 */
  private static readonly STEP_STRIDE = 13;
  /** 停下啄食时叫一声的概率，避免满地图叽喳。 */
  private static readonly CLUCK_CHANCE = 0.25;

  private readonly random: () => number;
  private readonly idleDirection = new Vector2();
  private readonly direction = new Vector2();
  private readonly peckPhase: number;
  private walking = false;
  private timer = 0;
  private age = 0;
  private health = Chicken.MAX_HEALTH;
  private alive = true;
  private stepDistance = 0;
  private onStepCallback?: (x: number, y: number) => void;
  private onCluckCallback?: (x: number, y: number) => void;

  constructor(x: number, y: number, random: () => number = Math.random) {
    super(x, y);
    this.random = random;
    this.setSize(Chicken.SIZE);
    this.setCollider({ type: "circle", radius: 0.5 });
    this.maxSpeed = Chicken.MIN_SPEED + random() * (Chicken.MAX_SPEED - Chicken.MIN_SPEED);
    // 起步和收尾都留一点时间，避免小鸡像鼠标光标一样瞬移。加速度必须让
    // 第一步就超过 Entities 的 1px/s 静止阈值，否则低速会被反复归零。
    this.accel = 240;
    this.decel = 400;
    this.rotationSpeed = 10;
    this.currentRotation = random() * Math.PI * 2;
    this.timer = random() * 1.2;
    this.peckPhase = random() * Chicken.PECK_SECONDS;
  }

  isAlive(): boolean {
    return this.alive;
  }

  getHealth(): number {
    return this.health;
  }

  getMaxHealth(): number {
    return Chicken.MAX_HEALTH;
  }

  /**
   * 受到子弹伤害。返回本次伤害是否击杀；已死亡时不再响应。
   * 死亡后由场景负责生成白色气团并移除实体。
   */
  takeDamage(amount: number): boolean {
    if (!this.alive || !Number.isFinite(amount) || amount <= 0) return false;
    this.health = Math.max(0, this.health - amount);
    if (this.health > 0) return false;
    this.alive = false;
    this.velocity.set(0, 0);
    return true;
  }

  /**
   * 子弹线段与身体圆的最早接触比例（0–1），未命中返回 null。
   * @param radius 子弹半径；命中半径为本体半径与子弹半径之和。
   */
  hitTestSegment(x0: number, y0: number, x1: number, y1: number, radius: number): number | null {
    if (!this.alive) return null;
    const cx = this.x + this.size / 2, cy = this.y + this.size / 2;
    const dx = x1 - x0, dy = y1 - y0;
    const fx = x0 - cx, fy = y0 - cy;
    const combined = this.size / 2 + Math.max(0, radius);
    const a = dx * dx + dy * dy;
    if (a <= 1e-12) return fx * fx + fy * fy <= combined * combined ? 0 : null;
    // 起点已经在命中圆内时立即接触，不能因为没有前向交点而漏判。
    if (fx * fx + fy * fy <= combined * combined) return 0;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - combined * combined;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const fraction = (-b - root) / (2 * a);
    return fraction >= 0 && fraction <= 1 ? fraction : null;
  }

  /**
   * 在出生点附近随机放置数只小鸡。
   *
   * 距离按 r^1.5 偏向近处，保证开局大概率能在迷雾范围内遇到；每个候选点都要求
   * 完整落在地图内、位于干燥的可行走地面，并与已有小鸡保持间距。找不到位置时
   * 少生成一只而不抛错。
   */
  static spawn(map: TileMap, count: number, center: { x: number; y: number }, random: () => number = Math.random): Chicken[] {
    if (!Number.isInteger(count) || count <= 0) return [];
    const chickens: Chicken[] = [];
    const half = Chicken.SIZE / 2;
    const mapWidth = map.width * map.tileSize;
    const mapHeight = map.height * map.tileSize;
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < Chicken.SPAWN_ATTEMPTS; attempt++) {
        const angle = random() * Math.PI * 2;
        const distance = Chicken.MIN_SPAWN_DISTANCE +
          Math.pow(random(), 1.5) * (Chicken.MAX_SPAWN_DISTANCE - Chicken.MIN_SPAWN_DISTANCE);
        const cx = center.x + Math.cos(angle) * distance;
        const cy = center.y + Math.sin(angle) * distance;
        const x = cx - half, y = cy - half;
        if (x < 0 || y < 0 || x + Chicken.SIZE > mapWidth || y + Chicken.SIZE > mapHeight) continue;
        const body = circleCollider(cx, cy, half);
        // 只放在干地：水域会降低速度因子，超深水甚至不可行走。
        if (!map.isShapeWalkable(body) || map.getShapeSpeedFactor(body) !== 1) continue;
        if (chickens.some(other => Math.hypot(other.x - x, other.y - y) < Chicken.MIN_SPACING)) continue;
        chickens.push(new Chicken(x, y, random));
        break;
      }
    }
    return chickens;
  }

  update(delta: number, input: Input, map?: TileMap): void {
    if (!this.alive || !map || !Number.isFinite(delta) || delta < 0) return;
    const startX = this.x, startY = this.y;
    this.age += delta;
    this.timer -= delta;
    if (this.timer <= 0) this.decide(map);
    super.update(delta, input, map);
    this.emitSteps(startX, startY);
    // 撞到墙或矿石后不要一直顶着，尽快换一个方向。
    if (this.walking && this.getCollisionContacts().length > 0) this.timer = Math.min(this.timer, 0.12);
  }

  /** 脚步声回调：每走约 13px 报一次世界坐标，音量与远近由场景决定。 */
  setOnStepCallback(callback: (x: number, y: number) => void): void {
    this.onStepCallback = callback;
  }

  /** 叫声回调：小鸡停下啄食时偶尔报一次坐标。 */
  setOnCluckCallback(callback: (x: number, y: number) => void): void {
    this.onCluckCallback = callback;
  }

  /** 按位移累积步幅；贴墙原地抖动或调试传送不该连响。 */
  private emitSteps(startX: number, startY: number): void {
    const callback = this.onStepCallback;
    if (!callback) return;
    const distance = Math.hypot(this.x - startX, this.y - startY);
    if (!Number.isFinite(distance) || distance < 1e-6 || distance > this.size * 3) { this.stepDistance = 0; return; }
    this.stepDistance += distance;
    while (this.stepDistance >= Chicken.STEP_STRIDE) {
      this.stepDistance -= Chicken.STEP_STRIDE;
      callback(this.x + this.size / 2, this.y + this.size / 2);
    }
  }

  /** AI 方向取代按键输入；朝向仍由 Entities 按速度方向自动旋转。 */
  protected getMoveDirection(_input: Input): Vector2 {
    return this.walking ? this.direction : this.idleDirection;
  }

  protected getLookDirection(_input: Input): Vector2 {
    return this.idleDirection;
  }

  private decide(map: TileMap): void {
    if (this.random() < Chicken.IDLE_CHANCE) {
      this.walking = false;
      this.timer = 0.7 + this.random() * 1.7;
      // 停下来啄食时偶尔叫一声；漫游中的小鸡不会一直叽喳。
      if (this.random() < Chicken.CLUCK_CHANCE) this.onCluckCallback?.(this.x + this.size / 2, this.y + this.size / 2);
      return;
    }

    const body = this.getCollider();
    const currentAngle = Math.atan2(this.direction.y, this.direction.x);
    for (let attempt = 0; attempt < Chicken.DIRECTION_ATTEMPTS; attempt++) {
      // 一半时间顺着当前方向轻微转弯，走起来更像在地面闲逛而不是随机弹射。
      const angle = this.direction.length() > 0 && this.random() < 0.5
        ? currentAngle + (this.random() - 0.5) * 1.6
        : this.random() * Math.PI * 2;
      const probe = 40 + this.random() * 18;
      const dx = Math.cos(angle) * probe, dy = Math.sin(angle) * probe;
      const hit = map.castShape(body, { x: dx, y: dy });
      const travel = hit ? Math.max(0, hit.fraction * probe - 0.5) : probe;
      if (travel < this.size) continue;

      const stepX = Math.cos(angle), stepY = Math.sin(angle);
      const end = circleCollider(body.pose.x + stepX * travel, body.pose.y + stepY * travel, this.size / 2);
      const middle = circleCollider(body.pose.x + stepX * travel * 0.5, body.pose.y + stepY * travel * 0.5, this.size / 2);
      if (!map.isShapeWalkable(end) || map.getShapeSpeedFactor(end) !== 1 || map.getShapeSpeedFactor(middle) !== 1) continue;

      this.direction.set(stepX, stepY);
      this.walking = true;
      // 不走到墙根再掉头：行走时间按安全距离截断。
      const walkTime = 0.7 + this.random() * 1.8;
      this.timer = Math.max(0.25, Math.min(walkTime, travel * 0.8 / this.maxSpeed));
      return;
    }

    this.walking = false;
    this.timer = 0.4 + this.random() * 0.8;
  }

  /**
   * 画面位置：单位层使用相机偏移，与金块、子弹和拾取物同一坐标系。
   * 多边形的坐标以身体尺寸为单位，不随呼吸或动画改变碰撞体。
   */
  draw(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    if (!this.alive) return;
    const x = this.x + this.size / 2 - offsetX;
    const y = this.y + this.size / 2 - offsetY;
    if (x < -60 || y < -60 || x > ctx.canvas.width + 60 || y > ctx.canvas.height + 60) return;

    const s = this.size;
    const speedRatio = Math.min(1, this.velocity.length() / Math.max(1, this.maxSpeed));
    const bob = Math.sin(this.age * 14) * 0.6 * speedRatio;
    const squash = Math.sin(this.age * 28) * 0.02 * speedRatio;
    const cycle = (this.age + this.peckPhase) % Chicken.PECK_SECONDS;
    const peck = !this.walking && this.velocity.length() < 5 && cycle < 0.32
      ? Math.sin((cycle / 0.32) * Math.PI)
      : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.currentRotation - Math.PI);

    ctx.translate(0, bob);
    ctx.scale(1 + squash, 1 - squash);

    // 尾羽先画，身体会盖住根部，只露出后面的三片羽毛。
    this.shape(ctx, [[-0.30, -0.10], [-0.72, -0.30], [-0.54, -0.04]], TAIL_MID);
    this.shape(ctx, [[-0.36, 0.00], [-0.80, 0.02], [-0.52, 0.12]], TAIL_LIGHT);
    this.shape(ctx, [[-0.30, 0.08], [-0.64, 0.28], [-0.44, 0.06]], TAIL_DARK);

    // 身体轮廓与三块平面色阶。
    this.shape(ctx, [
      [0.46, -0.02], [0.34, -0.26], [0.04, -0.34], [-0.30, -0.26],
      [-0.44, -0.06], [-0.34, 0.18], [0.02, 0.32], [0.34, 0.22],
    ], BODY_MID);
    this.shape(ctx, [
      [0.40, -0.10], [0.30, -0.27], [0.04, -0.33], [-0.28, -0.25], [-0.36, -0.12], [0.02, -0.05],
    ], BODY_LIGHT);
    this.shape(ctx, [
      [0.38, 0.08], [0.32, 0.21], [0.03, 0.30], [-0.30, 0.16], [0.00, 0.06],
    ], BODY_DARK);

    // 两侧翅膀用更深的三角块面，避免身体看起来是一整块圆饼。
    this.shape(ctx, [[0.12, -0.12], [-0.06, -0.28], [-0.26, -0.18], [-0.10, -0.06]], WING_LIGHT);
    this.shape(ctx, [[0.12, 0.12], [-0.06, 0.28], [-0.26, 0.18], [-0.10, 0.06]], WING_DARK);

    ctx.save();
    ctx.translate(peck * s * 0.14, peck * s * 0.05);

    // 头、脸颊暗面、鸡冠、喙、肉垂和两粒眼睛。
    this.shape(ctx, [
      [0.24, -0.16], [0.38, -0.22], [0.54, -0.14], [0.60, 0.00],
      [0.46, 0.17], [0.30, 0.13], [0.22, 0.00],
    ], CREAM);
    this.shape(ctx, [[0.44, 0.17], [0.60, 0.00], [0.48, 0.00], [0.38, 0.09]], CREAM_SHADE);

    this.shape(ctx, [[0.28, -0.14], [0.34, -0.31], [0.40, -0.16]], COMB);
    this.shape(ctx, [[0.40, -0.17], [0.46, -0.33], [0.53, -0.15]], COMB);
    this.shape(ctx, [[0.52, -0.14], [0.57, -0.25], [0.60, -0.06]], COMB);

    this.shape(ctx, [[0.51, 0.09], [0.61, 0.12], [0.54, 0.24]], COMB);
    this.shape(ctx, [[0.58, -0.07], [0.80, 0.00], [0.58, 0.07]], BEAK);
    this.shape(ctx, [[0.58, 0.00], [0.80, 0.00], [0.58, 0.07]], BEAK_DARK);

    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(0.50 * s, -0.10 * s, s * 0.045, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0.50 * s, 0.10 * s, s * 0.045, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  /**
   * 近身剪影专用轮廓：保留身体主体、头部、鸡冠与尾部朝向，
   * 但不画眼睛、喙、翅膀分区等身份细节。
   *
   * 与 draw() 共用同一套姿态/呼吸/啄食变换，位置与运动轨迹完全一致；
   * 只是纯渲染替代，不改变物理与碰撞。颜色由调用方 source-in 统一压成冷灰。
   */
  drawSilhouette(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0): void {
    if (!this.alive) return;
    const x = this.x + this.size / 2 - offsetX;
    const y = this.y + this.size / 2 - offsetY;
    if (x < -60 || y < -60 || x > ctx.canvas.width + 60 || y > ctx.canvas.height + 60) return;

    const s = this.size;
    const speedRatio = Math.min(1, this.velocity.length() / Math.max(1, this.maxSpeed));
    const bob = Math.sin(this.age * 14) * 0.6 * speedRatio;
    const squash = Math.sin(this.age * 28) * 0.02 * speedRatio;
    const cycle = (this.age + this.peckPhase) % Chicken.PECK_SECONDS;
    const peck = !this.walking && this.velocity.length() < 5 && cycle < 0.32
      ? Math.sin((cycle / 0.32) * Math.PI)
      : 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(this.currentRotation - Math.PI);
    ctx.translate(0, bob);
    ctx.scale(1 + squash, 1 - squash);

    // 尾部合成一个楔形：保留朝向与体量，去掉三片羽毛的锯齿细节。
    this.shape(ctx, [[-0.30, -0.12], [-0.80, 0.02], [-0.30, 0.26]], SILHOUETTE_COLOR);
    // 身体一块实心轮廓，和头部并集后就是可读的主体形状。
    this.shape(ctx, [
      [0.46, -0.02], [0.34, -0.26], [0.04, -0.34], [-0.30, -0.26],
      [-0.44, -0.06], [-0.34, 0.18], [0.02, 0.32], [0.34, 0.22],
    ], SILHOUETTE_COLOR);

    ctx.save();
    ctx.translate(peck * s * 0.14, peck * s * 0.05);
    this.shape(ctx, [
      [0.24, -0.16], [0.38, -0.24], [0.54, -0.14], [0.60, 0.00],
      [0.46, 0.17], [0.30, 0.13], [0.22, 0.00],
    ], SILHOUETTE_COLOR);
    // 鸡冠合并成一条锯齿顶边，保留“有头冠”的体量但不逐根复刻。
    this.shape(ctx, [
      [0.27, -0.14], [0.33, -0.32], [0.39, -0.16],
      [0.45, -0.33], [0.52, -0.14], [0.57, -0.25], [0.61, -0.05],
    ], SILHOUETTE_COLOR);
    ctx.restore();

    ctx.restore();
  }

  /**
   * 地面投影：所有小鸡的影子在身体之前统一绘制，并由场景裁剪掉墙壁/矿石顶面。
   * 影子沿远离光源的方向拉长；没有光源时退回脚下一小块接触阴影。
   */
  drawShadow(ctx: CanvasRenderingContext2D, offsetX = 0, offsetY = 0, light?: Point): void {
    if (!this.alive) return;
    const x = this.x + this.size / 2 - offsetX;
    const y = this.y + this.size / 2 - offsetY;
    if (x < -60 || y < -60 || x > ctx.canvas.width + 60 || y > ctx.canvas.height + 60) return;
    const s = this.size;
    const dx = light ? this.x + s / 2 - light.x : 1;
    const dy = light ? this.y + s / 2 - light.y : 1;
    const angle = Math.atan2(dy, dx);
    const reach = s * (1.05 + Math.min(1.5, Math.hypot(dx, dy) / 480));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(0, 0, 0, 0.52)";
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.54, s * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();

    const shade = ctx.createLinearGradient(0, 0, reach, 0);
    shade.addColorStop(0, "rgba(0, 0, 0, 0.66)");
    shade.addColorStop(0.5, "rgba(0, 0, 0, 0.34)");
    shade.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.moveTo(-s * 0.12, -s * 0.28);
    ctx.quadraticCurveTo(reach * 0.55, -s * 0.22, reach, -s * 0.02);
    ctx.lineTo(reach, s * 0.02);
    ctx.quadraticCurveTo(reach * 0.55, s * 0.22, -s * 0.12, s * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** 以身体尺寸为单位绘制一个平面多边形。 */
  private shape(ctx: CanvasRenderingContext2D, points: number[][], color: string): void {
    ctx.beginPath();
    points.forEach(([px, py], index) => {
      if (index === 0) ctx.moveTo(px * this.size, py * this.size);
      else ctx.lineTo(px * this.size, py * this.size);
    });
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
}
