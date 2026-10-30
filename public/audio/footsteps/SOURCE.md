# 脚步音效素材库（Footsteps Volume 02）

本目录在原有的 `dry.wav`／`water.wav` 两段循环游戏音效之外，收进了一套按表面分类的单次脚步采样，供后续按地形切换脚步、增加随机变化时直接取用。旧版 `wet.wav`（整理前名为 `step-mud.wav`）保留作素材参考，运行时不再加载；出水后直接恢复干地脚步。

## 来源与授权

- 音效包：The Sound Guild — FREE PACK: Footsteps Volume 02
- 作者：The Sound Guild
- 获取地址：<https://the-sound-guild.kit.com/21f8045c4f>
- 授权：作者以免费包形式发布，随包说明只提出可选的署名请求（“P.S: If you can credit me in your project it would be amazing!”），未附加其他使用限制。建议在游戏致谢中署名 The Sound Guild。
- 整理日期：2026-10-30

## 目录结构

```
public/audio/footsteps/
├── dry.wav / water.wav             # 现有循环音效，未改动
├── wet.wav                         # 旧版单步采样，保留作参考
├── manifest.json                   # 素材清单：来源、规格、逐文件时长与电平
├── SOURCE.md                       # 本文件
├── boots/01.wav … 07.wav           # 皮靴
├── deep/01.wav … 07.wav
├── grass/01.wav … 07.wav
├── grass-alt/01.wav … 07.wav
├── heel/01.wav … 06.wav
├── metal/01.wav … 07.wav
├── mud/01.wav … 07.wav
├── naked-feet-deep/01.wav … 06.wav
├── sand/01.wav … 08.wav
├── sandals/01.wav … 08.wav
├── shoe/01.wav … 05.wav
├── shoe-street/01.wav … 09.wav
├── sneakers/01.wav … 08.wav
├── soft-surface/01.wav … 06.wav
└── wood/01.wav … 05.wav
```

| 目录 | 表面 | 段数 | 用途提示 |
| --- | --- | ---: | --- |
| `boots` | 皮靴 | 7 | 硬质皮靴踩硬地，适合石板、室内地面 |
| `deep` | 厚重脚步 | 7 | 低沉厚重的脚步，适合体型大或负重的角色 |
| `grass` | 草地 | 7 | 户外植被地面 |
| `grass-alt` | 草地（备选） | 7 | 另一组草地录音，与 `grass` 混用可增加变化 |
| `heel` | 高跟鞋 | 6 | 女性角色或硬地走廊 |
| `metal` | 金属地面 | 7 | 铁板、矿道、通风管 |
| `mud` | 泥地 | 7 | 潮湿或雨后的地面 |
| `naked-feet-deep` | 赤脚 | 6 | 不穿鞋的角色 |
| `sand` | 沙地 | 8 | 沙滩与沙漠 |
| `sandals` | 凉鞋 | 8 | 夏季或沙地场景 |
| `shoe` | 皮鞋 | 5 | 城镇街道 |
| `shoe-street` | 皮鞋·街道 | 9 | 带户外环境感的街道 |
| `sneakers` | 运动鞋 | 8 | 现代场景 |
| `soft-surface` | 柔软表面 | 6 | 地毯一类的室内地面 |
| `wood` | 木地板 | 5 | 木屋与栈道 |

## 命名与来源对应

文件名只写用途、不重复分类名，与 `public/audio` 其余目录一致；表面名放在目录上，目录内用两位编号。编号沿用源包文件名末尾的序号，例如 `grass/03.wav` 对应源包 `Foostep_Grass_03.wav`（源包这一组把 “Footstep” 拼成了 “Foostep”）。逐文件的原始文件名、时长与电平见 [manifest.json](manifest.json)。

## 采样规格与电平

- 全部为 44.1 kHz、16 bit、立体声的单次采样（one-shot），时长 0.217–0.475 秒。
- 文件与源包逐字节一致，导入时做了 MD5 校验，没有裁剪、归一化或转码。
- 峰值 −26.7～−7.4 dBFS（中位数 −15.1 dBFS），RMS −45.9～−28.2 dBFS（中位数 −37.4 dBFS）。现有 `dry.wav` 为峰值 0 dBFS、RMS −30.8 dBFS，所以直接用同一档音量播放会明显偏轻：按峰值补偿约 7–27 dB，或统一补约 15 dB 后再按表面微调。

## 与现有游戏音效的关系

- `dry.wav`（4.035 秒的砖地行走）和 `water.wav`（5.0 秒的涉水行走）都是整段循环采样，这批素材全部是单次脚步，不能直接替换，需要改成按步点触发、每次随机取变体的播放方式，否则会把循环截成碎片。
- `wet.wav` 是旧版单步采样（整理前名为 `step-mud.wav`），保留作素材参考，不再被运行时加载。
- 当前 `GameScene` 只引用 `dry`／`water` 两段循环；出水后立即恢复干地脚步，不再播放单独的湿身单步。这批素材的其余表面尚未接入运行时，清单里的 `hint` 字段可以作为按地形选样时的参考。

## manifest.json 字段

| 字段 | 说明 |
| --- | --- |
| `name`／`version`／`generatedAt` | 素材库标识、版本与生成日期 |
| `source` | 音效包名称、作者、获取地址、署名请求与原始格式 |
| `format` | 容器、采样率、声道数、位深 |
| `naming` | 文件命名规则 |
| `kind` | `one-shot`，即单次采样 |
| `notes` | 使用注意事项 |
| `surfaces[]` | 每个表面的 `id`、中文名 `label`、用途提示 `hint`、目录 `path`、段数 `count` |
| `surfaces[].files[]` | 文件名 `file`、源文件名 `source`、时长 `duration`、峰值 `peakDbfs`、RMS `rmsDbfs` |
