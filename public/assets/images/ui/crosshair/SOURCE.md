# 准星与命中反馈图标库

`public/assets/images/ui/crosshair/` 收录 CrosshairFreePack 的 20 张 PNG，按用途分为准星、命中提示、击杀图标、护甲与防护四类。文件是原始图片的逐字节副本，只改了文件名，并补了 `manifest.json`。

## 来源与许可

素材来自本地压缩包 `D:\Temp\crosshairfreepack.zip`，解压目录为 `CrosshairFreePack/`，共 20 张 PNG，文件时间集中在 2025-05-16 至 2025-06-18。

这个包没有附带 README、LICENSE、作者署名或下载地址；zip 注释为空，PNG 内只有 sRGB 色彩配置，没有来源元数据，文件也没有 Windows 的 `Zone.Identifier` 下载记录。因此：

- 作者、主页和许可条款都未知，`manifest.json` 中记为 `"license": "unknown"`、`"licenseStatus": "unverified"`。
- 包名里的 “Free” 只是目录名，不构成授权声明。
- 当前收录是本地素材整理；在公开发布或商业发布前，需要向素材提供方确认授权，或者换成许可明确的素材。
- 如果之后补到来源，请同时更新 `manifest.json` 的 `source` 字段和本文件的这一节。

本文件不是授权声明。

## 目录结构

```text
public/assets/images/ui/crosshair/
├── armor-01.png … armor-04.png       护甲与防护，4 张
├── crosshair-01.png … crosshair-09.png  准星，9 张
├── hitmarker-01.png … hitmarker-04.png  命中提示，4 张
├── kill-icon-01.png … kill-icon-03.png  击杀图标，3 张
└── manifest.json                     清单
```

## 分类

| 类别 id | 文件前缀 | 数量 | 用途 |
| --- | --- | --- | --- |
| `crosshairs` | `crosshair-` | 9 | 不同武器与瞄具风格的准星 |
| `hitmarkers` | `hitmarker-` | 4 | 命中反馈，适合短时缩放或淡出 |
| `kill-icons` | `kill-icon-` | 3 | 击杀反馈，适合在 HUD 中央弹出 |
| `armor` | `armor-` | 4 | 背心、头盔、爆头与盾牌指示 |

## 命名与映射

原始文件名是 `T_CH001.png` 这类不表意的编号。这里按 `<类型>-<两位编号>.png` 重命名，编号沿用原序号；原始文件名保留在 `manifest.json` 的 `source` 字段和下表里，便于回溯。

`alphaBbox` 是有效像素范围的闭区间 `x0,y0–x1,y1`，原点在左上角。

| 文件 | 原文件 | 类别 | 说明 | alphaBbox | 字节 |
| --- | --- | --- | --- | --- | --- |
| `crosshair-01.png` | `T_CH001.png` | 准星 | 四臂圆头准星 | 0,0–255,255 | 14,598 |
| `crosshair-02.png` | `T_CH002.png` | 准星 | 圆环刻度准星 | 3,7–248,249 | 30,839 |
| `crosshair-03.png` | `T_CH003.png` | 准星 | 双侧括弧准星 | 6,101–251,158 | 7,282 |
| `crosshair-04.png` | `T_CH004.png` | 准星 | 三点式准星 | 6,87–251,219 | 5,505 |
| `crosshair-05.png` | `T_CH005.png` | 准星 | 菱形四箭头准星 | 6,6–251,250 | 20,467 |
| `crosshair-06.png` | `T_CH006.png` | 准星 | 单箭头准星 | 6,65–250,190 | 15,608 |
| `crosshair-07.png` | `T_CH007.png` | 准星 | 环形三角准星 | 6,6–251,245 | 20,940 |
| `crosshair-08.png` | `T_CH008.png` | 准星 | 大括弧点准星 | 6,42–251,215 | 18,637 |
| `crosshair-09.png` | `T_CH009.png` | 准星 | 箭头组合准星 | 6,81–251,204 | 14,466 |
| `hitmarker-01.png` | `T_HM_001.png` | 命中提示 | 三向三角命中提示 | 6,15–251,236 | 16,388 |
| `hitmarker-02.png` | `T_HM_002.png` | 命中提示 | X 形命中提示 | 6,6–250,250 | 21,513 |
| `hitmarker-03.png` | `T_HM_003.png` | 命中提示 | 双横线命中提示 | 6,113–250,140 | 5,396 |
| `hitmarker-04.png` | `T_HM_004.png` | 命中提示 | 双竖线命中提示 | 118,6–138,250 | 6,527 |
| `kill-icon-01.png` | `T_KI_001.png` | 击杀图标 | 正面骷髅 | 22,0–235,255 | 28,957 |
| `kill-icon-02.png` | `T_KI_002.png` | 击杀图标 | 骷髅与交叉骨 | 0,35–255,221 | 33,795 |
| `kill-icon-03.png` | `T_KI_003.png` | 击杀图标 | 圆骷髅 | 0,3–255,253 | 29,559 |
| `armor-01.png` | `T_AH001.png` | 护甲与防护 | 战术背心 | 26,3–230,253 | 24,089 |
| `armor-02.png` | `T_AH002.png` | 护甲与防护 | 防弹头盔 | 0,0–255,255 | 17,995 |
| `armor-03.png` | `T_AH003.png` | 护甲与防护 | 头盔与脑部 | 12,0–243,255 | 37,893 |
| `armor-04.png` | `T_AH004.png` | 护甲与防护 | 盾牌 | 20,0–238,255 | 31,366 |

## 规格

- 20 张全部为 256×256、RGBA 8 位、透明背景，合计 401,820 字节。
- 图形只有白色不透明填充与半透明黑色描边、投影，色板为 `#FFFFFF` 和 `#000000`。深色背景上偏白，浅色背景上会看到灰色轮廓。
- `alphaBbox` 差别很大：`crosshair-03` 只占中间一条横带，`crosshair-01` 和 `armor-02` 则顶到四条边。缩放到 HUD 时建议按 bbox 居中，不要假设四周留白一致。
- 只有一档 256 px，没有 @2x 或小尺寸版；HUD 常用的 24–48 px 由运行时缩小，开启图像平滑。

## 运行时现状

- 指针启用时系统光标被隐藏，见 `src/core/Input.ts:91`； Esc 可以切换光标可见性，见 `src/scenes/GameScene.ts:156-158`。
- 当前没有独立的图片准星层。`src/objects/WeaponVisuals.ts:48` 里注释为“准星”的绘制，是手枪贴图上的一个小点，不是玩家准星。
- `src/core/AssetLoader.ts` 里的加载器可以加载图片，但运行时还没有注册任何图片资源；HUD 仍用文字提示。
- 这 20 张图尚未接入运行时，也没有被任何代码引用。

## 接入建议

- 准星：在屏幕坐标系里按指针位置绘制，用 `alphaBbox` 的中心对齐指针，避免不同图形的视觉中心偏移。
- 命中提示与击杀图标：适合 0.1 秒左右的缩放加淡出动画，绘制在 HUD 层，不要跟随世界相机。
- 这些图是白色单色图，若要换色，优先在离屏 canvas 上按 alpha 着色，不要直接改原图。
- 许可未确认前，不要把图标用于对外发布的构建。

## manifest 字段

| 字段 | 说明 |
| --- | --- |
| `name`、`version`、`kind` | 素材库名、版本、类型 `ui-icon` |
| `generatedAt` | 生成日期 |
| `source.pack`、`source.archive` | 包名与本地压缩包名 |
| `source.author`、`source.url`、`source.license` | 作者、主页、许可；当前未知 |
| `source.licenseStatus` | 许可状态，当前为 `unverified` |
| `format` | PNG、RGBA、位深、尺寸、背景、色板与外观说明 |
| `naming`、`url` | 仓库路径与运行时 URL 模板 |
| `total`、`categories` | 总数与四类统计 |
| `icons` | 每张图的 `file`、`source`、`category`、`label`、尺寸、`alphaBbox`、字节数与 SHA-256 |
| `notes` | 使用时的注意事项 |

## 维护

- 不要手改 PNG。需要增删时，更新 `tmp/import-crosshair.py` 里的 `ICONS` 映射后重新运行；脚本会重建目录、逐字节校验并重写 `manifest.json`。
- `tmp/` 被 git 忽略，脚本不会进仓库；脚本丢失时按 `manifest.json` 的字段手工维护。
- 新增文件沿用 `<类型>-<两位编号>.png`，不要和现有编号冲突。
- 如果补到作者与许可信息，更新 `manifest.json` 的 `source` 字段和本文件的“来源与许可”一节。
