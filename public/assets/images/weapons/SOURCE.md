# 武器贴图库

`public/assets/images/weapons/` 收录 9 张武器与弹药 PNG：7 把枪的侧视图、2 枚弹药剪影。文件不是原始素材的逐字节副本——原始图是 1254×1254 的方形画布，四周留着大片透明边距，这里统一裁掉了边距并等比缩放，处理过程见下文「处理流程」。

设计参考图在 [`docs/images/weapon-select-reference.png`](../../../../docs/images/weapon-select-reference.png)，只描述武器选择界面的目标视觉，不是运行期素材。

## 来源与许可

素材来自本地目录 `C:\Users\Administrator\Pictures\枪械素材\`，共 10 个文件：7 张枪械（`格洛克.png`、`左轮.png`、`冲锋枪.png`、`无标题.png`、`步枪1.png`、`w.png`、`狙击枪.png`）、2 张弹药裁切图（`ammo-pistol-original-pixel-crop.png`、`ammo-rifle-original-pixel-crop.png`）和 1 张参考图（`参考图.png`）。

这个目录没有 README、授权文件、作者署名或下载记录，PNG 里也没有来源元数据。因此：

- 作者、出处和许可条款都未知，`manifest.json` 中记为 `"license": "unknown"`、`"licenseStatus": "unverified"`。
- 当前收录按本地素材整理对待；对外发布或商业发布前，需要确认来源与授权，或换成许可明确的素材。
- 如果之后补到来源，请同时更新 `manifest.json` 的 `source` 字段和本文件的这一节。

本文件不是授权声明。

## 目录结构

```text
public/assets/images/weapons/
├── pistol-glock.png      手枪，格洛克式聚合物枪身
├── pistol-revolver.png   手枪，左轮
├── smg-tactical.png      冲锋枪，前握把 + 红点镜
├── smg-classic.png       冲锋枪，MP5 式护木
├── rifle-assault.png     步枪，AK 式
├── shotgun-pump.png      霰弹枪，泵动
├── sniper-bolt.png       狙击枪，栓动 + 高倍镜
├── ammo-pistol-round.png 手枪弹，圆头
├── ammo-rifle-round.png  步枪弹，尖头
├── manifest.json         清单
└── SOURCE.md             本文件
```

## 分类

| 类别 id | 文件前缀 | 数量 | 用途 |
| --- | --- | --- | --- |
| `pistols` | `pistol-` | 2 | 副武器槽：聚合物枪身与转轮两种布局 |
| `smgs` | `smg-` | 2 | 主武器槽：战术型与经典型 |
| `rifles` | `rifle-` | 1 | 长枪管突击步枪 |
| `shotguns` | `shotgun-` | 1 | 泵动霰弹枪 |
| `snipers` | `sniper-` | 1 | 栓动狙击枪 |
| `ammo` | `ammo-` | 2 | HUD 余弹指示 |

## 命名与映射

原始文件名混用了中文名（`格洛克.png`、`狙击枪.png`）、无语义的占位名（`w.png`、`无标题.png`）和导入时留下的英文名（`ammo-pistol-original-pixel-crop.png`）。这里统一改成 `<类别>-<型号>.png` 的英文短名：类别与 `manifest.json` 的 `categories` 对应，型号描述造型而不是猜品牌。原始文件名保留在 `manifest.json` 的 `source` 字段和下表里，便于回溯。

`alphaBbox` 是 Pillow `getbbox()` 的结果 `[x0, y0, x1, y1]`，原点在左上角，右下为开区间。

| 文件 | 原文件 | 类别 | 说明 | 尺寸 | alphaBbox | 字节 |
| --- | --- | --- | --- | --- | --- | --- |
| `pistol-glock.png` | `格洛克.png` | 手枪 | 格洛克式聚合物手枪 | 512×316 | 74,282–1212,984 | 112,961 |
| `pistol-revolver.png` | `左轮.png` | 手枪 | 左轮手枪 | 512×286 | 47,324–1226,982 | 93,370 |
| `smg-tactical.png` | `冲锋枪.png` | 冲锋枪 | 战术冲锋枪（前握把 + 红点镜） | 512×229 | 37,377–1219,906 | 82,833 |
| `smg-classic.png` | `无标题.png` | 冲锋枪 | 经典冲锋枪（MP5 式护木） | 512×225 | 38,376–1216,893 | 75,497 |
| `rifle-assault.png` | `步枪1.png` | 步枪 | 突击步枪（AK 式） | 512×175 | 49,485–1207,880 | 60,696 |
| `shotgun-pump.png` | `w.png` | 霰弹枪 | 泵动霰弹枪 | 512×133 | 61,512–1195,807 | 46,614 |
| `sniper-bolt.png` | `狙击枪.png` | 狙击枪 | 栓动狙击枪 | 512×131 | 43,491–1219,793 | 52,568 |
| `ammo-pistol-round.png` | `ammo-pistol-original-pixel-crop.png` | 弹药 | 手枪弹（圆头） | 161×414 | 11,11–172,425 | 39,798 |
| `ammo-rifle-round.png` | `ammo-rifle-original-pixel-crop.png` | 弹药 | 步枪弹（尖头） | 148×642 | 11,10–159,652 | 50,085 |

合计 614,422 字节。

## 规格

- 9 张全部为 RGBA 8 位、透明背景 PNG。
- 枪械统一长边 512：奶油白枪身 `#F1E9DE`～`#F7EFE2`，深灰枪件 `#21211F`～`#636262`，瞄具与少量细节用薄荷绿 `#8FCEA8` 点缀。
- 弹药是近乎纯白的剪影 `#F4F8FA`，只有极淡的描边区分形状，**在浅色背景上几乎不可见**。
- 枪械长宽比差别很大：霰弹枪 3.85:1、狙击枪 3.91:1，手枪 1.62:1、1.79:1。

## 处理流程

原始枪械图是 1254×1254 的方形画布，枪身只占中间一条横带（`alphaBbox` 的 y 范围大约 280～990）。如果直接当贴图用，既浪费显存，也没法按枪口对齐布局。脚本 `tmp/import-weapon-assets.py` 做了三件事：

1. **alpha 归一化**：α≤8 归 0，α≥248 归 255。源图里枪身有大量像素是 α=253/254，不处理的话叠在深色 HUD 上会整体发灰，边缘还会出现细碎的半透明噪点。
2. **按 alpha 边界裁切**：去掉四周 30～100 px 的透明边距，得到 `trimmedSize`。
3. **等比缩放**：枪械长边缩到 512（Lanczos）；弹药保持原始像素尺寸不重采样，否则像素网格会被插值糊掉。

绘制内容没有改动：没有换色、没有重绘轮廓、没有锐化。原始 1254×1254 图仍在 `Pictures/枪械素材`，需要更大尺寸时重跑脚本即可（`manifest.json` 里的 `alphaBbox` 与 `scale` 足以反推原图坐标）。

## 相对长度陷阱

源图每一张都把枪画满画布，所以**尺寸之间没有真实的长短关系**：狙击枪裁完是 1176×302，手枪是 1138×702，两者都被缩到 512 宽之后，画在屏幕上会一样长。要表现「狙击枪更长、手枪更短」，只能在 HUD 侧按 `aspect` 或每把枪单独的显示高度来调，素材本身给不出这个信息。

## 运行时现状

- 素材尚未接入运行时，没有任何代码引用 `public/assets/images/weapons/`。
- 当前右侧武器列表（`src/ui/WeaponListHud.ts:138` 起）和背挂/腰挂武器（`src/objects/WeaponVisuals.ts`）都是 Canvas 矢量绘制，没有加载位图。
- `src/core/AssetLoader.ts` 的加载器可以加载图片，但运行时还没有注册任何图片资源。

## 接入建议

- 枪械按**高度**缩放，不要按宽度拉满；握把与枪托下沿对齐同一条基线，枪口方向朝右。
- 弹药是像素画：绘制时关掉 `imageSmoothingEnabled`，或者用整数倍缩放，否则边缘会发虚。
- 弹药需要深色底、投影或一圈描边，否则浅色界面上看不见。
- 如果要换武器配色，优先在离屏 canvas 上按 alpha 乘色，不要直接改 PNG——原图只有一档，改坏了得重跑脚本。
- 许可未确认前，不要把贴图用于对外发布的构建。

## manifest 字段

| 字段 | 说明 |
| --- | --- |
| `name`、`version`、`kind` | 素材库名、版本、类型 `sprite` |
| `generatedAt` | 生成日期 |
| `source` | 来源目录、许可状态与原始格式；作者与许可当前未知 |
| `format` | PNG、RGBA、位深、尺寸、背景、色板与外观说明 |
| `naming`、`url` | 仓库路径与运行时 URL 模板 |
| `total`、`categories` | 总数与六类统计 |
| `processing` | 导入脚本路径、处理步骤与「哪些没改」 |
| `geometry` | 缩放与对齐建议 |
| `reference` | 设计参考图路径 |
| `sprites` | 每张图的 `file`、`source`、`category`、`label`、尺寸、`aspect`、`sourceSize`、`alphaBbox`、`trimmedSize`、`scale`、字节数、SHA-256 与色板 |
| `notes` | 使用时的注意事项 |

## 维护

- 不要手改 PNG。需要增删时，改 `tmp/import-weapon-assets.py` 的 `SPRITES` 映射后重跑，再跑 `tmp/write-weapons-manifest.py` 重建 `manifest.json`；两个脚本都在 git 忽略的 `tmp/` 下，不会进仓库。
- 新增文件沿用 `<类别>-<型号>.png`，类别要么已有，要么同时补进 `manifest.json` 的 `categories` 和本文件的分类表。
- 换图时注意别把 `ammo` 加进缩放流程，那两张要保持原始像素尺寸。
