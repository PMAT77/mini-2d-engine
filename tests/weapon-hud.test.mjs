import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const load = path => require(join(process.env.TEST_BUILD_DIR, path + '.js'));

const {
  WEAPON_LIST, getWeaponListLayout, getWeaponListRows, getWeaponRowLayout,
  measureWeaponAmmoColumn, getWeaponListMetrics, getBulletWidth,
  formatMagazine, formatReserve, estimateTextWidth, drawWeaponSilhouette,
  WeaponListHud,
} = load('ui/WeaponListHud');
const {
  WEAPON_HUD_SPRITES, getAmmoSpriteForView, getWeaponSpriteForView,
  spriteContentAspect, weaponHudAssets,
} = load('ui/WeaponHudAssets');
const {
  createBrushProfile, weaponBrushTextures, drawBrush, BRUSH_STATIONS,
} = load('ui/WeaponBrushTexture');
const { Player } = load('objects/Player');

const near = (a, b, epsilon = 1e-6, label = '') =>
  assert.ok(Math.abs(a - b) <= epsilon, `${label}${a} != ${b} (±${epsilon})`);

const pistolView = (patch = {}) => ({
  slot: 'secondary', name: '格洛克手枪', kind: 'firearm',
  magazineAmmo: 6, magazineSize: 6, chambered: true, reserveAmmo: null,
  isReloading: false, reloadMode: null, reloadProgress: 0, ...patch,
});
const smgView = (patch = {}) => ({
  slot: 'primary', name: '冲锋枪', kind: 'firearm',
  magazineAmmo: 30, magazineSize: 30, chambered: true, reserveAmmo: null,
  isReloading: false, reloadMode: null, reloadProgress: 0, ...patch,
});
const emptyView = (patch = {}) => ({
  slot: 'melee', name: '空手', kind: 'empty',
  magazineAmmo: 0, magazineSize: 0, chambered: false, reserveAmmo: null,
  isReloading: false, reloadMode: null, reloadProgress: 0, ...patch,
});
const knifeView = (patch = {}) => emptyView({ name: '小刀', kind: 'melee', ...patch });

const loadout = (activeSlot, patches = {}) => {
  const loadoutView = {
    activeSlot,
    primary: patches.primary ?? smgView(),
    secondary: patches.secondary ?? pistolView(),
    melee: patches.melee ?? emptyView(),
  };
  return loadoutView;
};

/** 逻辑像素下的估算宽度，与 HUD 内部的兜底估算一致。 */
const measureText = (text, font) => estimateTextWidth(text, font);

/** 记录所有 Canvas 调用的最小桩；用来验证绘制顺序、状态管理与回退。 */
function stubContext() {
  const saved = [];
  const calls = {
    texts: [], fills: 0, fillRects: [], roundRects: [], strokes: 0,
    saves: 0, restores: 0, drawImages: [], gradients: [], paths: 0,
    measureFonts: [], measureTexts: [], composites: [], alphas: [],
  };
  const stateKeys = [
    'fillStyle', 'strokeStyle', 'font', 'lineWidth', 'globalAlpha',
    'globalCompositeOperation', 'textAlign', 'textBaseline',
    'imageSmoothingEnabled', 'imageSmoothingQuality', 'lineCap', 'lineJoin',
  ];
  const ctx = {
    fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif',
    lineWidth: 1, globalAlpha: 1, globalCompositeOperation: 'source-over',
    textAlign: 'start', textBaseline: 'alphabetic',
    imageSmoothingEnabled: false, imageSmoothingQuality: 'low',
    lineCap: 'butt', lineJoin: 'miter',
    save() {
      calls.saves += 1;
      const snapshot = {};
      for (const key of stateKeys) snapshot[key] = ctx[key];
      saved.push(snapshot);
    },
    restore() {
      calls.restores += 1;
      const snapshot = saved.pop();
      if (snapshot) for (const key of stateKeys) ctx[key] = snapshot[key];
    },
    beginPath() { calls.paths += 1; },
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    bezierCurveTo() {},
    arc() {},
    arcTo() {},
    ellipse() {},
    rect() {},
    roundRect() { calls.roundRects.push([...arguments]); },
    fill() {
      calls.fills += 1;
      calls.alphas.push(ctx.globalAlpha);
      calls.composites.push(ctx.globalCompositeOperation);
    },
    stroke() { calls.strokes += 1; },
    fillRect(x, y, width, height) { calls.fillRects.push({ x, y, width, height }); },
    strokeRect() {},
    clearRect() {},
    fillText(text, x, y) {
      calls.texts.push({
        text: String(text), x, y, font: ctx.font, fill: ctx.fillStyle,
        alpha: ctx.globalAlpha, align: ctx.textAlign, baseline: ctx.textBaseline,
      });
    },
    measureText(text) {
      calls.measureFonts.push(ctx.font);
      calls.measureTexts.push(String(text));
      return { width: measureText(String(text), ctx.font) };
    },
    createLinearGradient(x0, y0, x1, y1) {
      const gradient = { kind: 'linear', x0, y0, x1, y1, stops: [] };
      gradient.addColorStop = (offset, color) => { gradient.stops.push([offset, color]); };
      calls.gradients.push(gradient);
      return gradient;
    },
    drawImage(...args) { calls.drawImages.push(args); },
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    resetTransform() {},
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
  };
  return { ctx, calls };
}

function drawHud(loadoutView, width = 1100, height = 800, hud = new WeaponListHud()) {
  const { ctx, calls } = stubContext();
  hud.draw(ctx, loadoutView, width, height);
  return { ctx, calls, hud, status: hud.getLastStatus() };
}

const unionAmmoBox = status => status.rows.map(row => row.ammoBox).filter(Boolean);

test('主武器/副武器上下顺序跟随手持槽位', () => {
  assert.deepEqual(getWeaponListRows(loadout('secondary')).map(view => view.slot), ['secondary', 'primary']);
  assert.deepEqual(getWeaponListRows(loadout('primary')).map(view => view.slot), ['primary', 'secondary']);

  const secondary = drawHud(loadout('secondary')).status;
  assert.equal(secondary.rows.length, 2);
  assert.equal(secondary.rows[0].slot, 'secondary');
  assert.equal(secondary.rows[1].slot, 'primary');
  assert.equal(secondary.rows[0].active, true);
  assert.equal(secondary.rows[1].active, false);
  assert.equal(secondary.mode, 'firearms');

  const primary = drawHud(loadout('primary')).status;
  assert.equal(primary.rows[0].slot, 'primary');
  assert.equal(primary.rows[1].slot, 'secondary');
  assert.equal(primary.rows[0].active, true);
});

test('空手只显示一行且没有弹药信息', () => {
  const { status, calls } = drawHud(loadout('melee', { melee: knifeView() }));
  assert.equal(status.rows.length, 1);
  assert.equal(status.rows[0].slot, 'melee');
  assert.equal(status.mode, 'melee');
  assert.equal(status.rows[0].ammoBox, null);

  const layout = getWeaponListLayout(1100, 800);
  near(status.rows[0].rect.y, layout.area.y, 1e-6, '单行沿用第一行位置: ');
  assert.ok(
    status.rows[0].rect.y + status.rows[0].rect.height <= layout.area.y + layout.area.height,
    '单行不能超出列表区域',
  );

  const rowLayout = getWeaponRowLayout(knifeView(), status.rows[0].rect, {
    bulletCount: 0, bulletHeight: 0, bulletGap: 0, bulletRight: 0, bulletBlockWidth: 0,
    magazineRight: 0, magazineSlotWidth: 0, slashLeft: 0, slashWidth: 0, reserveRight: 0,
    reserveSlotWidth: 0, gunRightX: status.rows[0].rect.x + 200, hasAmmo: false,
  }, layout.metrics);
  assert.deepEqual(rowLayout.bullets, []);
  // 空手只画矢量拳头，不会画任何弹药图标或数字。
  assert.equal(calls.texts.length, 0);
});

test('布局在不同屏幕尺寸下都落在画布内且不产生负尺寸', () => {
  const sizes = [[1920, 1080], [1366, 768], [1100, 800], [1280, 720], [800, 600], [640, 360], [320, 200]];
  for (const [width, height] of sizes) {
    const layout = getWeaponListLayout(width, height);
    const label = `${width}x${height}: `;
    assert.ok(layout.area.width > 0, `${label}area.width > 0`);
    assert.ok(layout.area.height > 0, `${label}area.height > 0`);
    near(layout.area.x + layout.area.width, width - WEAPON_LIST.rightMargin, 1e-6, `${label}右边距: `);
    near(layout.topRow.height, layout.metrics.rowHeight, 1e-6, `${label}行高: `);
    near(
      layout.bottomRow.y - layout.topRow.y,
      layout.metrics.rowHeight + layout.metrics.rowGap,
      1e-6,
      `${label}行距: `,
    );
    near(layout.area.y + layout.area.height / 2, height / 2, 1e-6, `${label}垂直居中: `);
    assert.ok(layout.area.x >= 0, `${label}area.x >= 0`);
    assert.ok(layout.area.y >= 0, `${label}area.y >= 0`);
    assert.ok(layout.area.x + layout.area.width <= width, `${label}水平不越界`);
    assert.ok(layout.area.y + layout.area.height <= height, `${label}垂直不越界`);

    const { status } = drawHud(loadout('secondary'), width, height);
    for (const row of status.rows) {
      const content = getWeaponRowLayout(row.view, row.rect, measureColumn(row.rect, layout.metrics, row.view), layout.metrics);
      for (const rect of [row.rect, content.brushRect, content.gunRect, ...content.bullets]) {
        assert.ok(rect.width >= 0 && rect.height >= 0, `${label}无负尺寸`);
        assert.ok(rect.x >= -1e-6, `${label}内容不越过左缘`);
        assert.ok(rect.x + rect.width <= width + 1e-6, `${label}内容不越过右缘`);
      }
    }
  }
});

function measureColumn(rowOrRect, metrics, view) {
  const right = rowOrRect.x + rowOrRect.width;
  return measureWeaponAmmoColumn(right, metrics, measureText, [{
    reserve: formatReserve(view),
    magazine: formatMagazine(view),
    bulletWidth: getBulletWidth(view, metrics),
  }]);
}

test('极小窗口下不出现负尺寸或负数宽度', () => {
  for (const [width, height] of [[320, 200], [200, 120], [100, 20], [0, 0]]) {
    const layout = getWeaponListLayout(width, height);
    const label = `${width}x${height}: `;
    assert.ok(layout.area.width >= 0 && layout.area.height >= 0, `${label}区域非负`);
    assert.ok(layout.area.x >= 0 && layout.area.y >= 0, `${label}原点非负`);
    assert.ok(layout.topRow.width >= 0 && layout.topRow.height >= 0, `${label}行非负`);
    assert.ok(layout.metrics.scale > 0, `${label}缩放为正`);
    const { status } = drawHud(loadout('primary'), width, height);
    for (const row of status.rows) {
      for (const rect of [row.brushRect, row.gunRect]) {
        assert.ok(rect.width >= 0 && rect.height >= 0, `${label}笔刷/枪械矩形非负`);
      }
    }
  }
});

test('备用弹药为 null 时显示 ∞，有限时显示真实数字', () => {
  const infinite = drawHud(loadout('secondary'));
  const reserveTexts = infinite.calls.texts.filter(text => text.text === '∞');
  assert.equal(reserveTexts.length, 2, '两把枪都是无限备弹，各画一个 ∞');
  assert.equal(infinite.calls.texts.filter(text => text.text === '/').length, 2, '每行一个斜杠');
  assert.ok(infinite.calls.texts.some(text => text.text === '6'), '应画弹匣余弹');

  const finite = drawHud(loadout('secondary', { secondary: pistolView({ reserveAmmo: 120 }) }));
  const finiteTexts = finite.calls.texts.filter(text => text.text === '120');
  assert.equal(finiteTexts.length, 1);
  assert.equal(formatReserve(pistolView({ reserveAmmo: 45 })), '45');
  assert.equal(formatReserve(pistolView({ reserveAmmo: 0 })), '0');
  assert.equal(formatReserve(pistolView({ reserveAmmo: null })), '∞');
  assert.equal(formatReserve(emptyView()), null);

  // 弹药列两行共用，数字变宽也不会压到枪械。
  for (const [reserve, magazine] of [[null, 30], [120, 30], [0, 0], [999, 120]]) {
    const views = loadout('primary', {
      primary: smgView({ reserveAmmo: reserve, magazineAmmo: magazine }),
      secondary: pistolView({ reserveAmmo: reserve, magazineAmmo: magazine }),
    });
    const layout = getWeaponListLayout(1100, 800);
    const { status } = drawHud(views);
    const column = measureWeaponAmmoColumn(
      layout.area.x + layout.area.width,
      layout.metrics,
      measureText,
      status.rows.map(row => ({
        reserve: formatReserve(row.view),
        magazine: formatMagazine(row.view),
        bulletWidth: getBulletWidth(row.view, layout.metrics),
      })),
    );
    // 读数顺序是「弹匣余弹 / 备用弹药」，所以自右向左依次是
    // 三枚子弹 → 备用弹药 → 斜杠 → 弹匣余弹 → 枪械。
    const reserveWidth = measureText(formatReserve(views.primary), layout.metrics.reserveFont);
    assert.ok(
      column.magazineLeft >= column.gunRightX,
      `弹匣数字压到枪械区域: ${reserve} / ${magazine}`,
    );
    assert.ok(
      column.magazineRight <= column.slashLeft - layout.metrics.slashGap + 1e-6,
      '斜杠不能压到弹匣数字',
    );
    assert.ok(
      column.slashRight <= column.reserveLeft - layout.metrics.reserveGap + 1e-6,
      '备用弹药不能压到斜杠',
    );
    assert.ok(
      column.reserveLeft + reserveWidth <= column.reserveRight + 1e-6,
      '备用弹药不能溢出自己的槽位',
    );
    assert.ok(column.reserveRight <= column.bulletRight - column.bulletBlockWidth + 1e-6);
  }
});

test('弹匣数字只显示 magazineAmmo，不把 chambered 加进来', () => {
  const view = pistolView({ magazineAmmo: 5, chambered: true, magazineSize: 6 });
  assert.equal(formatMagazine(view), '5');
  const { calls } = drawHud(loadout('secondary', { secondary: view }));
  const numbers = calls.texts.filter(text => text.text === '5');
  assert.equal(numbers.length, 1);
  assert.ok(!calls.texts.some(text => text.text === '6'), '不得把膛内那一发算进弹匣');

  const empty = drawHud(loadout('secondary', { secondary: pistolView({ magazineAmmo: 0, chambered: true }) }));
  assert.ok(empty.calls.texts.some(text => text.text === '0'), '空弹匣显示 0');
});

test('字号、文本宽度与基线对齐符合新规范', () => {
  const metrics = getWeaponListMetrics(1);
  assert.match(metrics.magFont, /34px/);
  assert.match(metrics.reserveFont, /17px/);
  assert.match(metrics.slashFont, /18px/);
  assert.ok(estimateTextWidth('∞', metrics.reserveFont) > 0);
  assert.ok(
    estimateTextWidth('120', metrics.reserveFont) > estimateTextWidth('45', metrics.reserveFont),
    '三位数应比两位数宽',
  );
  assert.ok(
    estimateTextWidth('0', metrics.magFont) > estimateTextWidth('0', metrics.reserveFont),
    '弹匣字号必须明显大于备用弹药',
  );

  const { calls, status } = drawHud(loadout('secondary'));
  // 通过 measureText 量过真实文本，没有硬编码字符串宽度。
  assert.ok(calls.measureTexts.includes('∞'));
  assert.ok(calls.measureTexts.includes('00'));
  const layout = getWeaponListLayout(1100, 800);
  const rowMetrics = layout.metrics;
  const row = status.rows.find(item => item.active);
  const expectedBaseline = row.rect.y + row.rect.height / 2
    + rowMetrics.magFontSize * rowMetrics.baselineRatio;
  const ammoTexts = calls.texts.filter(text => Math.abs(text.y - expectedBaseline) < 1e-6);
  assert.deepEqual(ammoTexts.map(text => text.text), ['6', '/', '∞']);
  for (const text of ammoTexts) {
    assert.equal(text.baseline, 'alphabetic');
  }
  // 数字整体在行内垂直居中：字形中心与行中心偏差很小。
  const capCenter = expectedBaseline - rowMetrics.magFontSize * 0.35;
  near(capCenter, row.rect.y + row.rect.height / 2, 1.5, '大数字视觉中心: ');

  const mag = ammoTexts.find(text => text.text === '6');
  const slash = ammoTexts.find(text => text.text === '/');
  const reserve = ammoTexts.find(text => text.text === '∞');
  assert.equal(mag.align, 'right');
  assert.equal(slash.align, 'left');
  assert.equal(reserve.align, 'left');
  assert.ok(mag.x < slash.x, '弹匣余弹应在斜杠左侧');
  assert.ok(slash.x < reserve.x, '备用弹药应在斜杠右侧');
  const fontPx = font => Number(/ (\d+(?:\.\d+)?)px/.exec(font)[1]);
  near(fontPx(mag.font), Math.round(rowMetrics.magFontSize * 10) / 10, 1e-9, '弹匣字号: ');
  near(fontPx(reserve.font), Math.round(rowMetrics.reserveFontSize * 10) / 10, 1e-9, '备弹字号: ');
  assert.ok(rowMetrics.magFontSize > rowMetrics.reserveFontSize * 1.8, '弹匣字号应接近备弹字号两倍');

  const column = measureWeaponAmmoColumn(
    layout.area.x + layout.area.width, layout.metrics, measureText,
    [
      { reserve: '∞', magazine: '30', bulletWidth: getBulletWidth(smgView(), layout.metrics) },
      { reserve: '∞', magazine: '6', bulletWidth: getBulletWidth(pistolView(), layout.metrics) },
    ],
  );
  near(reserve.x, column.reserveLeft, 1e-6, '∞ 左对齐到备用弹药槽左缘: ');
  near(slash.x, column.slashLeft, 1e-6, '斜杠落在斜杠槽左缘: ');
  near(mag.x, column.magazineRight, 1e-6, '弹匣数字右对齐: ');
  assert.ok(column.slashRight <= column.reserveLeft - layout.metrics.reserveGap + 1e-6);
  assert.ok(
    column.magazineLeft >= column.gunRightX,
    '弹药列整体不越过枪械锚点',
  );
});

test('主副武器与弹药的素材映射正确', () => {
  assert.equal(getWeaponSpriteForView(smgView()), 'smgTactical');
  assert.equal(getWeaponSpriteForView(pistolView()), 'pistolGlock');
  assert.equal(getWeaponSpriteForView(emptyView()), null);
  assert.equal(getWeaponSpriteForView(knifeView()), null);
  assert.equal(getAmmoSpriteForView(smgView()), 'ammoRifle');
  assert.equal(getAmmoSpriteForView(pistolView()), 'ammoPistol');
  assert.equal(getAmmoSpriteForView(knifeView()), null);

  assert.equal(WEAPON_HUD_SPRITES.smgTactical.url, '/assets/images/weapons/smg-tactical.png');
  assert.equal(WEAPON_HUD_SPRITES.pistolGlock.url, '/assets/images/weapons/pistol-glock.png');
  assert.equal(WEAPON_HUD_SPRITES.ammoRifle.url, '/assets/images/weapons/ammo-rifle-round.png');
  assert.equal(WEAPON_HUD_SPRITES.ammoPistol.url, '/assets/images/weapons/ammo-pistol-round.png');

  // 弹药图有大面积透明边距，宽高比必须按可见内容算，不能按整张画布算。
  const rifle = spriteContentAspect(WEAPON_HUD_SPRITES.ammoRifle);
  const pistol = spriteContentAspect(WEAPON_HUD_SPRITES.ammoPistol);
  near(rifle, 369 / 1511, 1e-6, '步枪弹可见宽高比: ');
  near(pistol, 484 / 1234, 1e-6, '手枪弹可见宽高比: ');
  assert.ok(pistol > rifle, '手枪弹比步枪弹更宽扁');

  const metrics = getWeaponListMetrics(1);
  const rifleWidth = getBulletWidth(smgView(), metrics);
  const pistolWidth = getBulletWidth(pistolView(), metrics);
  near(rifleWidth, metrics.bulletHeight * rifle, 1e-6);
  assert.ok(pistolWidth > rifleWidth);
});

test('空手不显示子弹图标', () => {
  const layout = getWeaponListLayout(1100, 800);
  const meleeRow = layout.topRow;
  const column = measureWeaponAmmoColumn(
    layout.area.x + layout.area.width, layout.metrics, measureText, [],
  );
  const content = getWeaponRowLayout(emptyView(), meleeRow, column, layout.metrics);
  assert.equal(content.bullets.length, 0);
  assert.equal(content.ammoBox, null);

  const { calls } = drawHud(loadout('melee'));
  assert.equal(calls.drawImages.length, 0, '空手没有任何图片绘制');
  assert.equal(calls.texts.length, 0, '空手不显示弹药数字');
});

test('缺少图片时矢量回退正常，且不会重复创建图片', () => {
  const { calls } = drawHud(loadout('primary'));
  assert.equal(calls.drawImages.length, 0, '无 DOM 时应走矢量回退');
  assert.ok(calls.fills > 0, '枪械剪影需要填充');
  assert.ok(calls.roundRects.length > 0, '矢量枪械/拳头使用 roundRect 绘制局部');
  // 右侧没有旧的高亮竖线：只有 roundRect 形状与字形，没有 2px 竖条。
  assert.ok(
    !calls.fillRects.some(rect => rect.width === 2 && rect.height > 20),
    '不应再出现左侧 2px 高亮线',
  );

  const before = weaponHudAssets.stats().imageBuilds;
  drawHud(loadout('primary'));
  drawHud(loadout('secondary'));
  assert.equal(weaponHudAssets.stats().imageBuilds, before, '同一资源只创建一次 Image');
});

test('图片加载失败时不抛异常并保持矢量回退', async () => {
  weaponHudAssets.reset();
  class FailingImage {
    constructor() { this.decoding = ''; }
    set src(_value) { queueMicrotask(() => this.onerror && this.onerror()); }
  }
  const hadImage = Object.prototype.hasOwnProperty.call(globalThis, 'Image');
  globalThis.Image = FailingImage;
  try {
    weaponHudAssets.preload(['smgTactical', 'pistolGlock', 'ammoRifle', 'ammoPistol']);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(weaponHudAssets.getStatus('smgTactical'), 'failed');
    assert.equal(weaponHudAssets.getImage('smgTactical'), null);
    assert.equal(weaponHudAssets.isSettled(['smgTactical', 'pistolGlock', 'ammoRifle', 'ammoPistol']), true);
    const { calls } = drawHud(loadout('primary'));
    assert.ok(calls.fills > 0);
    assert.equal(calls.drawImages.length, 0);
  } finally {
    if (hadImage) globalThis.Image = undefined;
    else delete globalThis.Image;
    weaponHudAssets.reset();
  }
});

test('离屏笔刷缓存复用同一份轮廓', () => {
  const first = weaponBrushTextures.getProfile(0x1234, 0);
  const builds = weaponBrushTextures.stats().profileBuilds;
  const second = weaponBrushTextures.getProfile(0x1234, 0);
  assert.equal(second, first, '同种子同变体应命中缓存');
  assert.equal(weaponBrushTextures.stats().profileBuilds, builds, '不应重复生成轮廓');

  const hud = new WeaponListHud();
  drawHud(loadout('primary'), 1100, 800, hud);
  const afterFirst = weaponBrushTextures.stats().profileBuilds;
  drawHud(loadout('primary'), 1100, 800, hud);
  assert.equal(weaponBrushTextures.stats().profileBuilds, afterFirst, '每帧不应重建笔刷轮廓');
});

test('固定参数生成的笔刷完全确定', () => {
  const a = createBrushProfile(0x5eed1e, 0);
  const b = createBrushProfile(0x5eed1e, 0);
  const c = createBrushProfile(0x5eed1e, 1);
  const d = createBrushProfile(0x5eed1f, 0);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.notDeepEqual(a, d);

  assert.equal(a.top.length, BRUSH_STATIONS);
  assert.equal(a.bottom.length, BRUSH_STATIONS);
  const minTop = Math.min(...a.top.map(point => point.y));
  const maxBottom = Math.max(...a.bottom.map(point => point.y));
  assert.ok(maxBottom > minTop, '上下缘不能交叉');
  // 两端收笔：中间比两端厚。
  const mid = Math.floor(BRUSH_STATIONS / 2);
  const thickness = index => a.bottom[index].y - a.top[index].y;
  assert.ok(thickness(mid) > thickness(0));
  assert.ok(thickness(mid) > thickness(BRUSH_STATIONS - 1));
  assert.ok(a.streaks.length > 0);
  assert.ok(a.streaks.some(streak => streak.kind === 'erase'), '需要有干刷缺口');
  assert.ok(a.streaks.some(streak => streak.kind === 'ink'), '需要有积墨墨芯');
});

test('绘制不在每帧重复分配资源或布局', () => {
  const hud = new WeaponListHud();
  const first = drawHud(loadout('secondary'), 1100, 800, hud);
  const brushBuilds = weaponBrushTextures.stats().profileBuilds;
  const imageBuilds = weaponHudAssets.stats().imageBuilds;
  const second = drawHud(loadout('secondary'), 1100, 800, hud);
  assert.equal(weaponBrushTextures.stats().profileBuilds, brushBuilds);
  assert.equal(weaponHudAssets.stats().imageBuilds, imageBuilds);
  // 同样的输入必须得到同样的几何结果：布局没有随机抖动。
  assert.deepEqual(first.status.rows.map(row => row.rect), second.status.rows.map(row => row.rect));
  assert.deepEqual(first.status.rows.map(row => row.brushRect), second.status.rows.map(row => row.brushRect));
  assert.deepEqual(first.status.rows.map(row => row.gunRect), second.status.rows.map(row => row.gunRect));
});

test('ctx.save() 与 ctx.restore() 严格配对', () => {
  for (const activeSlot of ['secondary', 'primary', 'melee']) {
    const { calls } = drawHud(loadout(activeSlot));
    assert.equal(calls.saves, calls.restores, `${activeSlot} 行: save/restore 不配对`);
    assert.ok(calls.saves > 0);
  }
  // 笔刷回退路径同样要配对。
  const { ctx, calls } = stubContext();
  drawBrush(ctx, { x: 0, y: 0, width: 200, height: 70 }, { alpha: 0.6, dpr: 1 });
  assert.equal(calls.saves, calls.restores);
  assert.equal(ctx.globalAlpha, 1, '笔刷不能把透明度泄漏给后续 HUD');
  assert.equal(ctx.globalCompositeOperation, 'source-over');
});

test('getLastStatus 保留旧字段并补齐新视觉字段', () => {
  const { status } = drawHud(loadout('secondary'));
  assert.equal(typeof status.activeSlot, 'string');
  assert.ok(['firearms', 'melee'].includes(status.mode));
  assert.equal(typeof status.swapProgress, 'number');
  assert.equal(status.rows.length, 2);
  for (const row of status.rows) {
    assert.equal(typeof row.slot, 'string');
    assert.equal(typeof row.view, 'object');
    assert.equal(typeof row.view.magazineAmmo, 'number');
    assert.equal(typeof row.rect.x, 'number');
    assert.equal(typeof row.active, 'boolean');
    assert.equal(typeof row.highlight, 'number');
    assert.ok(row.highlight >= 0 && row.highlight <= 1);
    assert.ok(row.brushRect.width >= 0);
    assert.ok(row.gunRect.width >= 0);
    assert.ok(row.ammoBox === null || row.ammoBox.width >= 0);
  }
  // 当前武器亮度高于另一把。
  const active = status.rows.find(row => row.active);
  const inactive = status.rows.find(row => !row.active);
  assert.ok(active.highlight >= inactive.highlight);
});

test('切枪动画起点、中点、终点与快速反向都连续', () => {
  const hud = new WeaponListHud();
  hud.update(1 / 60, loadout('secondary'));
  const settle = drawHud(loadout('secondary'), 1100, 800, hud).status;
  near(settle.swapProgress, 1, 1e-9, '初始为稳定态: ');

  hud.update(0, loadout('primary'));
  const start = drawHud(loadout('primary'), 1100, 800, hud).status;
  near(start.swapProgress, 0, 1e-9, '切枪第一帧进度为 0: ');
  // 第一帧就要用新顺序，且旧顺序的行从对面出发：新上方的行仍在下方。
  assert.equal(start.rows[0].slot, 'secondary', '物理最上方仍是被挤下去的那把枪');
  const layout = getWeaponListLayout(1100, 800);
  near(
    start.rows.find(row => row.slot === 'primary').rect.y,
    layout.bottomRow.y,
    1e-6,
    '新选中行从下方开始: ',
  );

  hud.update(WEAPON_LIST.swapSeconds * 0.6, loadout('primary'));
  const mid = drawHud(loadout('primary'), 1100, 800, hud).status;
  const progress = mid.swapProgress;
  assert.ok(progress > 0.5 && progress < 1, '中点进度应在 (0.5, 1) 之间');
  const eased = progress * progress * (3 - 2 * progress);
  const yBySlot = status => Object.fromEntries(status.rows.map(item => [item.slot, item.rect.y]));
  near(
    yBySlot(mid).primary,
    layout.bottomRow.y + (layout.topRow.y - layout.bottomRow.y) * eased,
    1e-6,
    '中点行位置: ',
  );

  // 动画未结束就反向切枪：位置必须连续，不能瞬移回起点。
  hud.update(0, loadout('secondary'));
  const reversed = drawHud(loadout('secondary'), 1100, 800, hud).status;
  assert.ok(reversed.swapProgress < progress, '反向后进度应镜像回退');
  near(yBySlot(reversed).primary, yBySlot(mid).primary, 1e-6, '反向切枪不能瞬移: ');
  near(yBySlot(reversed).secondary, yBySlot(mid).secondary, 1e-6, '反向切枪不能瞬移: ');

  // 跑完之后回到稳定态，顺序与 y 坐标都规整。
  for (let step = 0; step < 60; step += 1) hud.update(1 / 60, loadout('secondary'));
  const settled = drawHud(loadout('secondary'), 1100, 800, hud).status;
  near(settled.swapProgress, 1, 1e-9, '最终回到稳定态: ');
  assert.equal(settled.rows[0].slot, 'secondary');
  near(settled.rows[0].rect.y, layout.topRow.y, 1e-6, '稳定后回到顶部: ');
  assert.ok(settled.rows[0].highlight > 0.99);
  assert.ok(settled.rows[1].highlight < 0.01);
});

test('空中切枪：空手不放子弹，切回枪械恢复上次武器', () => {
  const player = new Player();
  player.switchWeapon('primary');
  assert.equal(player.getActiveWeaponSlot(), 'primary');
  player.toggleMelee();
  const unarmed = player.getWeaponLoadoutView();
  assert.equal(unarmed.activeSlot, 'melee');
  const rows = getWeaponListRows(unarmed);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'empty');

  player.toggleMelee();
  assert.equal(player.getActiveWeaponSlot(), 'primary', '返回枪械后恢复上次武器');
});

test('枪械右端统一锚点，手枪笔刷自然更短', () => {
  const { status } = drawHud(loadout('secondary'));
  const [top, bottom] = status.rows;
  near(
    top.gunRect.x + top.gunRect.width,
    bottom.gunRect.x + bottom.gunRect.width,
    1e-6,
    '两把枪右缘对齐: ',
  );
  assert.ok(top.brushRect.x > bottom.brushRect.x, '手枪行的笔刷应该从更靠右的位置开始');
  assert.ok(top.brushRect.width < bottom.brushRect.width);
  near(
    top.brushRect.x + top.brushRect.width,
    bottom.brushRect.x + bottom.brushRect.width,
    1e-6,
    '笔刷右边界统一: ',
  );
  // 笔刷必须完整覆盖枪械的可见范围，不能裁掉枪口或握把。
  for (const row of status.rows) {
    assert.ok(row.brushRect.x <= row.gunRect.x + 1e-6);
    assert.ok(row.gunRect.x + row.gunRect.width <= row.brushRect.x + row.brushRect.width + 1e-6);
  }
  // 枪械高度落在 60～76 逻辑像素区间。
  for (const row of status.rows) {
    assert.ok(row.gunRect.height >= 58 && row.gunRect.height <= 78, `枪械高度 ${row.gunRect.height}`);
  }
});

test('三枚子弹位置固定、数量与余弹无关', () => {
  const layouts = [0, 5, 30, 999].map(magazine => {
    const layout = getWeaponListLayout(1100, 800);
    const column = measureWeaponAmmoColumn(
      layout.area.x + layout.area.width, layout.metrics, measureText,
      [{ reserve: '∞', magazine: String(magazine), bulletWidth: getBulletWidth(smgView(), layout.metrics) }],
    );
    return { column, content: getWeaponRowLayout(smgView({ magazineAmmo: magazine }), layout.topRow, column, layout.metrics) };
  });
  const bullets = layouts[0].content.bullets;
  assert.equal(bullets.length, WEAPON_LIST.bulletCount);
  for (const item of layouts) {
    assert.equal(item.content.bullets.length, WEAPON_LIST.bulletCount);
    assert.deepEqual(item.content.bullets, bullets, '子弹位置不随余弹变化');
  }
  // 三枚同款、等距、贴右。
  for (let index = 1; index < bullets.length; index += 1) {
    near(bullets[index].x - bullets[index - 1].x, bullets[0].width + layouts[0].column.bulletGap, 1e-6);
    near(bullets[index].width, bullets[0].width, 1e-6);
  }
  near(
    bullets[bullets.length - 1].x + bullets[bullets.length - 1].width,
    layouts[0].column.bulletRight,
    1e-6,
    '子弹整体贴右: ',
  );
});

test('drawWeaponSilhouette 仍然可以独立绘制（回退方案保留）', () => {
  const { ctx, calls } = stubContext();
  drawWeaponSilhouette(ctx, knifeView(), { x: 0, y: 0, width: 60, height: 40 }, '#ffffff');
  assert.ok(calls.strokes > 0 || calls.fills > 0);
  const empty = stubContext();
  drawWeaponSilhouette(empty.ctx, emptyView(), { x: 0, y: 0, width: 60, height: 40 }, '#ffffff');
  assert.ok(empty.calls.roundRects.length > 0, '拳头仍用 roundRect 绘制');
});
