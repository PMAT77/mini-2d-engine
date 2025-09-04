/**
 * 将颜色与白色混合，创建高亮效果
 * @param color 原始颜色（HEX格式）
 * @param intensity 混合强度（0-1）
 * @returns 混合后的颜色（rgba格式）
 */
export function blendColorWithWhite(color: string, intensity: number): string {
    // 解析HEX颜色值
    const hex = color.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // 计算与白色的混合颜色
    // 混合公式: 目标颜色 = 原始颜色 * (1 - 强度) + 白色 * 强度
    const blendedR = Math.round(r * (1 - intensity) + 255 * intensity);
    const blendedG = Math.round(g * (1 - intensity) + 255 * intensity);
    const blendedB = Math.round(b * (1 - intensity) + 255 * intensity);

    // 返回rgba格式的颜色
    return `rgba(${blendedR}, ${blendedG}, ${blendedB}, 1)`;
}