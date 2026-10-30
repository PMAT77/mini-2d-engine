# Keyboard & Mouse 图标素材

本目录是键鼠提示图标库，共 124 个图标，每个图标提供 64 与 128 两档像素高度。用途是把 HUD 里的“按 W 移动”“按 F2 打开调试”一类文字提示换成键帽图形。

当前运行时仍全部使用文字提示，本目录只完成素材整理，尚未接入绘制代码。

## 来源与许可

- 素材包：MengGe's Game UI Icons v1.0.0，子集 `Keyboard&Mouse_Icons`
- 作者：MengGe（menggekkd）
- 上游：<https://github.com/menggekkd/mengge_game_ui_icons>
- 许可：[CC BY-ND 4.0](https://creativecommons.org/licenses/by-nd/4.0/)（署名—禁止演绎）

许可要求：

- 允许原样复制、分发和商用，必须署名。
- 不允许分发改编版本，包括裁剪、缩放后另存、改色和重绘。
- 本目录的 248 个 PNG 与上游逐字节一致。需要其他尺寸时，在绘制阶段用 `drawImage` 缩放，不要另存改过的图片。

游戏内署名建议放在制作人员名单或关于页：

> Keyboard & Mouse icons from MengGe's Game UI Icons v1.0.0 by MengGe (menggekkd), licensed under CC BY-ND 4.0. Source: https://github.com/menggekkd/mengge_game_ui_icons

上游说明的配色为 `#EEEEEE`、`#EEEEEE4D`、`#0F0F0F`，图标字体为 MiSans。上游的 4K 预览图没有复制进来，避免随构建产物一起分发。

## 目录结构

```text
public/assets/images/ui/keyboard-mouse/
├── 64/          124 个 PNG，高 64 px
├── 128/         124 个 PNG，高 128 px
├── manifest.json
└── SOURCE.md
```

两档文件名相同，按显示尺寸选用；`64` 档是 `128` 档的 0.5 倍。Vite 会把 `public/` 原样复制到构建产物，运行时路径为 `/assets/images/ui/keyboard-mouse/<size>/<文件名>.png`。

## 图标分类

| 分类 | 数量 | 内容 |
| --- | --- | --- |
| `letters` | 26 | A–Z 字母键 |
| `digits` | 10 | 0–9 数字键 |
| `digits-shift` | 10 | 数字键的上档符号，文件名带 `_Cape`，如 `Keyboard_5_Cape.png` 是 `%` |
| `numpad` | 6 | 小键盘的除号、乘号、减号、加号、小数点和 Numlock |
| `function` | 13 | F1–F12 与 Fn |
| `punctuation` | 11 | 标点键，键帽同时印上下两个字形，如 `, <`、`. >`、`/ ?` |
| `modifiers` | 10 | 左/右 Ctrl、Shift、Alt，Win，macOS 的 Command、Control、Option |
| `editing` | 8 | Backspace、Delete、Insert、Enter、Tab、Space、Caps Lock、Esc |
| `navigation` | 4 | Home、End、PageUp、PageDown |
| `arrows` | 12 | 4 个单键箭头字形，8 个方向键簇的按下高亮 |
| `mouse` | 11 | 鼠标移动、滚轮和 5 个按键 |
| `device` | 3 | 键盘与鼠标整机图形，含一个小尺寸鼠标 |

方向键分两类，容易混淆：

- `Keyboard_Arrow_Up.png` 等 4 个文件是带箭头的单键键帽。
- `Keyboard_Arrows*.png` 是四键簇的键位高亮，只有深浅两档键帽，没有箭头字形。`Keyboard_Arrows` 是四键全暗的基础态，`Keyboard_Arrows_All` 是四键全亮，其余是单键或双键高亮。

## 尺寸与几何

- 128 档全部 128 px 高，64 档全部 64 px 高。
- 宽度按真实键位比例，不是正方形。128 档的宽键如下：
  - 256 px：Enter、Space、PageUp、PageDown
  - 218 px：Tab
  - 188 px：左/右 Ctrl、Shift、Alt
  - 180 px：Home
  - 138 px：Backspace、Caps Lock、Delete、Insert、Esc、End、小键盘 Numlock
- 其余图标为 128×128。绘制时按原始宽高比缩放，把宽键拉成正方形会变形。

## 与运行时按键的对应

下表是当前代码里的实际绑定，接入图标时可以直接按它取图。

| 操作 | 当前按键 | 可用图标 |
| --- | --- | --- |
| 移动 | W／A／S／D | `Keyboard_W`、`Keyboard_A`、`Keyboard_S`、`Keyboard_D` |
| 疾跑 | Shift | `Keyboard_Shift_L` |
| 翻滚 | Space | `Keyboard_Space` |
| 切枪 | Q／E | `Keyboard_Q`、`Keyboard_E` |
| 收枪 | C | `Keyboard_C` |
| 换弹 | R | `Keyboard_R` |
| 手电开关 | G | `Keyboard_G` |
| 调试面板 | F2 | `Keyboard_F2` |
| 唤出系统鼠标 | Esc | `Keyboard_Esc` |
| 射击 | 鼠标左键 | `Mouse_Key_1_Left` |
| 转向 / 瞄准 | 鼠标右键 | `Mouse_Key_2_Right` |
| 瞄准位置 | 鼠标移动 | `Mouse_Move` |

绑定出处：`src/objects/Player.ts:327-330`（WASD）、`src/objects/Player.ts:412`（Shift）、`src/scenes/GameScene.ts:1136`（G）、`src/scenes/GameScene.ts:1146`（R）、`src/scenes/GameScene.ts:1151-1162`（Q／E／C／Space）、`src/scenes/GameScene.ts:1673`（左右键）。

键帽本身是浅灰 `#EEEEEE` 实心加黑色字形，适合深色界面。HUD 在浅色地形上使用时，需要另画底衬，不要修改图标文件。

## 清单字段

`manifest.json` 供运行时和工具读取，字段如下。

| 字段 | 说明 |
| --- | --- |
| `name`、`version` | 素材库名与版本，当前为 `keyboard-mouse-icons` 1.0.0 |
| `source` | 素材包、作者、上游地址、许可与署名文字 |
| `format` | PNG、RGBA、8 bit、透明背景与配色 |
| `naming`、`url` | 文件路径规则，分别给出仓库路径和运行时路径 |
| `sizes`、`total` | 两档尺寸名与图标总数 |
| `geometry` | 统一高度与宽键说明 |
| `notes` | 使用注意事项 |
| `categories` | 12 个分类的 id、中文名、说明与数量 |
| `icons` | 每个图标的名称、分类、标签、中文说明与 `sizes` |
| `icons[].sizes` | 按 `64`／`128` 给出宽、高、字节数和 SHA-256 |

## 更新方法

上游发布新版本时，按同样的目录结构替换，保持“文件名不变、字节不变”的原则。替换后重新生成 `manifest.json`，并核对两档文件的 SHA-256 与上游一致。

如果需要新的像素尺寸，不要在图像软件里导出，直接在绘制时缩放。这样既不会产生改编版本，也不会让图标库出现第三档尺寸。
