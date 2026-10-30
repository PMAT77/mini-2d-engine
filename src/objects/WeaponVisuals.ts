import type { WeaponKind, WeaponSlot } from "./Weapon";

const DARK = "#1d2b31";
const MID = "#3c525b";
const LIGHT = "#6f8a93";

/** 局部坐标 +x 为面朝方向、+y 为右手侧；尺寸都按玩家 size 缩放。 */
function pistol(ctx: CanvasRenderingContext2D, s: number): void {
  const u = s / 100;
  ctx.fillStyle = DARK;
  ctx.strokeStyle = MID;
  ctx.lineWidth = 1 * u;
  // 套筒
  ctx.beginPath(); ctx.rect(-4 * u, -1.4 * u, 34 * u, 6 * u); ctx.fill(); ctx.stroke();
  // 枪管
  ctx.fillStyle = LIGHT;
  ctx.fillRect(30 * u, -0.9 * u, 6 * u, 3.4 * u);
  // 握把（向后下倾斜）
  ctx.save(); ctx.translate(2 * u, 4 * u); ctx.rotate(0.28);
  ctx.fillStyle = DARK; ctx.beginPath(); ctx.rect(-3 * u, 0, 8 * u, 15 * u); ctx.fill(); ctx.stroke();
  ctx.restore();
  // 扳机护圈
  ctx.strokeStyle = MID; ctx.beginPath();
  ctx.arc(12 * u, 6.5 * u, 4 * u, 0.1, Math.PI - 0.4); ctx.stroke();
  // 套筒上的高光
  ctx.fillStyle = LIGHT; ctx.fillRect(1 * u, -1.2 * u, 18 * u, 1 * u);
}

function smg(ctx: CanvasRenderingContext2D, s: number): void {
  const u = s / 100;
  ctx.fillStyle = DARK;
  ctx.strokeStyle = MID;
  ctx.lineWidth = 1 * u;
  // 枪托
  ctx.fillRect(-30 * u, -1 * u, 12 * u, 4 * u);
  // 机匣
  ctx.beginPath(); ctx.rect(-20 * u, -3 * u, 42 * u, 8 * u); ctx.fill(); ctx.stroke();
  // 枪管
  ctx.fillStyle = LIGHT; ctx.fillRect(22 * u, -1.6 * u, 14 * u, 3.2 * u);
  // 弹匣（略向前弯）
  ctx.fillStyle = MID; ctx.save(); ctx.translate(2 * u, 5 * u); ctx.rotate(-0.12);
  ctx.beginPath(); ctx.rect(-3 * u, 0, 8 * u, 16 * u); ctx.fill(); ctx.restore();
  // 握把
  ctx.fillStyle = DARK; ctx.save(); ctx.translate(-14 * u, 5 * u); ctx.rotate(0.3);
  ctx.beginPath(); ctx.rect(-3 * u, 0, 7 * u, 13 * u); ctx.fill(); ctx.restore();
  // 顶部导轨高光
  ctx.fillStyle = LIGHT; ctx.fillRect(-16 * u, -2.8 * u, 34 * u, 1 * u);
  // 准星
  ctx.fillRect(18 * u, -5 * u, 2 * u, 2.4 * u);
}

function knife(ctx: CanvasRenderingContext2D, s: number): void {
  const u = s / 100;
  // 柄
  ctx.fillStyle = DARK; ctx.fillRect(-18 * u, -2 * u, 12 * u, 4 * u);
  // 护手
  ctx.fillStyle = MID; ctx.fillRect(-7 * u, -4.5 * u, 3 * u, 9 * u);
  // 刀身
  ctx.beginPath(); ctx.moveTo(-4 * u, -3 * u); ctx.lineTo(18 * u, -0.8 * u);
  ctx.lineTo(24 * u, 0); ctx.lineTo(-4 * u, 2.6 * u); ctx.closePath();
  ctx.fillStyle = LIGHT; ctx.fill();
  ctx.strokeStyle = "#c8dde2"; ctx.lineWidth = 0.8 * u; ctx.stroke();
}

/** 未拿在手上的武器：主武器斜背在背后，副武器挂在右腰。 */
export function drawStowedWeapons(ctx: CanvasRenderingContext2D, size: number, activeSlot: WeaponSlot): void {
  const s = size;
  ctx.save();
  ctx.globalAlpha = 0.92;
  if (activeSlot !== "primary") {
    // 主武器：斜挎在背上，枪身横过身体，两端从头两侧露出。
    ctx.save();
    ctx.translate(-s * 0.08, 0);
    ctx.rotate(-0.55);
    smg(ctx, s * 1.25);
    ctx.restore();
  }
  if (activeSlot !== "secondary") {
    // 副武器：挂在右腰，枪口朝后下方。
    ctx.save();
    ctx.translate(-s * 0.18, s * 0.38);
    ctx.rotate(0.55);
    pistol(ctx, s * 0.9);
    ctx.restore();
  }
  ctx.restore();
}

/** 拿在手里的武器；空手时不画。 */
export function drawHeldWeapon(ctx: CanvasRenderingContext2D, size: number, kind: WeaponKind,
  slot: WeaponSlot, hand: { x: number; y: number }): void {
  if (kind === "empty") return;
  ctx.save();
  ctx.translate(hand.x - size * 0.02, hand.y + size * 0.015);
  if (kind === "melee") {
    ctx.rotate(-0.15);
    knife(ctx, size * 0.8);
  } else if (slot === "primary") {
    smg(ctx, size);
  } else {
    pistol(ctx, size);
  }
  ctx.restore();
}

/** 0–1 的确定性伪随机：同一个 seed 每帧画出同一团火，换一发就换一个形状。 */
function flashNoise(seed: number, salt: number): number {
  const v = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * 枪口火焰。局部坐标 +x 朝前、原点在枪口，调用方负责平移到枪口并按朝向旋转。
 * intensity 0–1 控制大小与亮度；seed 每发不同，让连发时形状和长短会闪。
 * 用 lighter 叠加：火焰是光，画在光照合成之后才不会被环境光压暗。
 */
export function drawMuzzleFlame(ctx: CanvasRenderingContext2D, size: number,
  intensity: number, seed: number): void {
  const t = Math.max(0, Math.min(1, intensity));
  if (t <= 0.001) return;
  const u = size / 100;
  const a = flashNoise(seed, 1), b = flashNoise(seed, 2), c = flashNoise(seed, 3), d = flashNoise(seed, 4);
  const scale = 0.7 + 0.5 * t;
  const originX = 2 * u;
  const length = (26 + 14 * a) * u * scale;
  const halfHeight = (5 + 3 * b) * u * scale;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // 1) 枪口光晕：短暂照亮手部周围的空气。
  const glowR = (26 + 12 * t) * u * (0.85 + 0.3 * b);
  const glow = ctx.createRadialGradient(originX, 0, 0, originX, 0, glowR);
  glow.addColorStop(0, `rgba(255, 244, 200, ${0.55 * t})`);
  glow.addColorStop(0.45, `rgba(255, 190, 90, ${0.32 * t})`);
  glow.addColorStop(1, "rgba(255, 130, 40, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(originX, 0, glowR, 0, Math.PI * 2); ctx.fill();

  // 2) 两侧短舌：左右不对称，避免每发都是同一个图案。
  for (const [side, jitter] of [[-1, c], [1, d]] as const) {
    const sideLen = length * (0.35 + 0.3 * jitter);
    ctx.save();
    ctx.translate(originX, side * halfHeight * 0.5);
    ctx.rotate(side * (0.45 + 0.25 * jitter));
    ctx.globalAlpha = 0.55 * t;
    ctx.fillStyle = "#ff9a35";
    ctx.beginPath();
    ctx.moveTo(0, -halfHeight * 0.55);
    ctx.quadraticCurveTo(sideLen * 0.55, -halfHeight * 0.5, sideLen, 0);
    ctx.quadraticCurveTo(sideLen * 0.5, halfHeight * 0.6, 0, halfHeight * 0.55);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // 3) 主火焰：前尖后圆的泪滴状，尖端带一点随机上下摆。
  const tipY = (c - 0.5) * halfHeight * 0.7;
  const flame = ctx.createLinearGradient(originX, 0, originX + length, 0);
  flame.addColorStop(0, `rgba(255, 252, 235, ${0.95 * t})`);
  flame.addColorStop(0.3, `rgba(255, 225, 130, ${0.9 * t})`);
  flame.addColorStop(0.65, `rgba(255, 150, 55, ${0.75 * t})`);
  flame.addColorStop(1, "rgba(240, 100, 29, 0)");
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(originX - 2 * u, -halfHeight * 0.4);
  ctx.bezierCurveTo(originX + length * 0.22, -halfHeight, originX + length * 0.72,
    -halfHeight * 0.55, originX + length, tipY);
  ctx.bezierCurveTo(originX + length * 0.72, halfHeight * 0.55, originX + length * 0.22,
    halfHeight, originX - 2 * u, halfHeight * 0.4);
  ctx.closePath(); ctx.fill();

  // 4) 火舌尖芒。
  ctx.strokeStyle = `rgba(255, 236, 170, ${0.7 * t})`;
  ctx.lineWidth = 1.2 * u;
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i++) {
    const n = flashNoise(seed, 5 + i);
    const angle = (i - 1) * 0.55 + (n - 0.5) * 0.5;
    const spark = length * (0.45 + 0.25 * n);
    ctx.beginPath();
    ctx.moveTo(originX + 2 * u, 0);
    ctx.lineTo(originX + Math.cos(angle) * spark, Math.sin(angle) * spark);
    ctx.stroke();
  }

  // 5) 枪口白热核心。
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(255, 248, 220, ${0.9 * t})`;
  ctx.beginPath(); ctx.ellipse(originX, 0, 4 * u, 3 * u, 0, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}
