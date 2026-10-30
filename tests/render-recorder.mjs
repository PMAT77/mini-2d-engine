/**
 * Canvas 调用录制器：给“旧绘制路径”和“新命令列表路径”各录一遍，
 * 用来证明两条路径发出的 Canvas 调用序列、参数与样式完全一致。
 *
 * 只实现角色渲染器 / WeaponVisuals 用到的子集；不追求通用 Canvas mock。
 */

export function createRecordingContext() {
  const ops = [];
  let gradientSeq = 0;

  function record(op) { ops.push(op); }

  function makeGradient(kind, args) {
    const id = gradientSeq++;
    record({ op: "createGradient", kind, id, args });
    return {
      __gradientId: id,
      addColorStop(offset, color) {
        record({ op: "addColorStop", gradient: id, offset, color });
      },
    };
  }

  const ctx = {
    save() { record({ op: "save" }); },
    restore() { record({ op: "restore" }); },
    translate(x, y) { record({ op: "translate", args: [x, y] }); },
    rotate(radians) { record({ op: "rotate", args: [radians] }); },
    scale(x, y) { record({ op: "scale", args: [x, y] }); },
    beginPath() { record({ op: "beginPath" }); },
    moveTo(x, y) { record({ op: "moveTo", args: [x, y] }); },
    lineTo(x, y) { record({ op: "lineTo", args: [x, y] }); },
    arc(x, y, radius, startAngle, endAngle) {
      record({ op: "arc", args: [x, y, radius, startAngle, endAngle] });
    },
    ellipse(x, y, rx, ry, rotation, startAngle, endAngle) {
      record({ op: "ellipse", args: [x, y, rx, ry, rotation, startAngle, endAngle] });
    },
    rect(x, y, width, height) { record({ op: "rect", args: [x, y, width, height] }); },
    fillRect(x, y, width, height) { record({ op: "fillRect", args: [x, y, width, height] }); },
    closePath() { record({ op: "closePath" }); },
    quadraticCurveTo(cpx, cpy, x, y) { record({ op: "quadraticCurveTo", args: [cpx, cpy, x, y] }); },
    bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
      record({ op: "bezierCurveTo", args: [cp1x, cp1y, cp2x, cp2y, x, y] });
    },
    fill() { record({ op: "fill" }); },
    stroke() { record({ op: "stroke" }); },
    clearRect(x, y, width, height) { record({ op: "clearRect", args: [x, y, width, height] }); },
    drawImage(...args) { record({ op: "drawImage", args }); },
    createLinearGradient(x0, y0, x1, y1) {
      return makeGradient("linear", [x0, y0, x1, y1]);
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      return makeGradient("radial", [x0, y0, r0, x1, y1, r1]);
    },
  };

  for (const property of ["globalAlpha", "fillStyle", "strokeStyle", "lineWidth", "lineCap"]) {
    let current = property === "globalAlpha" || property === "lineWidth" ? 1 : property === "lineCap" ? "butt" : "#000000";
    Object.defineProperty(ctx, property, {
      get() { return current; },
      set(value) {
        const normalized = value && typeof value === "object" && "__gradientId" in value
          ? { gradient: value.__gradientId }
          : value;
        record({ op: "set", property, value: normalized });
        current = value;
      },
    });
  }

  return { ctx, ops };
}

function isNumber(value) { return typeof value === "number"; }

function compareValue(actual, expected, path, tolerance) {
  if (isNumber(expected)) {
    if (!isNumber(actual) || Math.abs(actual - expected) > tolerance) {
      throw new Error(`${path}: expected ${expected}, got ${actual} (tolerance ${tolerance})`);
    }
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) {
      throw new Error(`${path}: array shape mismatch (${JSON.stringify(actual)} vs ${JSON.stringify(expected)})`);
    }
    for (let i = 0; i < expected.length; i++) compareValue(actual[i], expected[i], `${path}[${i}]`, tolerance);
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object") throw new Error(`${path}: expected object`);
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of keys) compareValue(actual[key], expected[key], `${path}.${key}`, tolerance);
    return;
  }
  if (actual !== expected) throw new Error(`${path}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** 断言两份录制完全相同；数字按 tolerance 比较，字符串/样式精确比较。 */
export function assertRecordingsEqual(actualOps, expectedOps, tolerance = 1e-6) {
  if (actualOps.length !== expectedOps.length) {
    const index = Math.min(actualOps.length, expectedOps.length);
    throw new Error(`recording length mismatch: ${actualOps.length} vs ${expectedOps.length}; first extra op at ${index}: `
      + JSON.stringify(actualOps.slice(index, index + 3)) + " vs " + JSON.stringify(expectedOps.slice(index, index + 3)));
  }
  for (let i = 0; i < expectedOps.length; i++) {
    compareValue(actualOps[i], expectedOps[i], `ops[${i}]`, tolerance);
  }
}
