# 配置参考

游戏的可调参数按域分成三个 JSON 文件，放在 `public/configs/`，修改后刷新页面生效。开发版与打包版都读取这三个文件；游戏不监听文件变化、不自动热更新。

| 文件 | 域 | 内容 |
| --- | --- | --- |
| `playerConfig.json` | 角色 | 碰撞、血量、移动、疾跑、翻滚、动画、武器、弹道、水体阻力、界面反馈 |
| `graphicsConfig.json` | 画面 | 相机缩放、环境光、地形弱光、角色微光、手电筒、三层视野遮蔽、legacy 战争迷雾 |
| `audioConfig.json` | 音效 | 总音量、枪声、换弹、脚步、涉水、拾取、手电开关、小鸡 |

配置加载器会缓存当前页面内已获取的文件。所有分组和字段均可省略；画面与音效文件只需写想覆盖的字段，其余自动取默认值。角色配置省略字段时使用玩家类的默认值。未知分组、未知字段、错误类型、越界数值或未知颜色都会让整份文件加载失败，验证通过后才会应用，避免只更新一部分参数。

## 角色配置

`playerConfig.json` 是完整示例，字段与默认值如下。

| 分组 | 字段 | 默认值 | 含义 |
| --- | --- | --- | --- |
| base | size | 49 | 主体直径；默认碰撞半径为 size / 2，不随外观和呼吸变化 |
| base | maxHealth | 100 | 血量上限；修改上限时保留当前血量比例 |
| base | maxSpeed | 200 | 最大移动速度，像素/秒，可为 0 |
| base | accel | 4000 | 旧配置兼容字段，不再控制玩家移动，调试面板不提供 |
| base | decel | 1200 | 旧配置兼容字段，不再控制玩家移动，调试面板不提供 |
| base | nonlinearFactor | 0.5 | 旧配置兼容字段，可为 0，不再控制玩家移动，调试面板不提供 |
| base | rotationSpeed | 12.5664 | 身体最大旋转速度，弧度/秒，同时控制右键瞄准转身 |
| base | rotationStrategy | auto | 身体转向策略；auto 最短路径，cw 顺时针，ccw 逆时针 |
| movement | startSpeedRatio | 0 | 起步速度比例，默认 0 从静止连续加速；范围 0–1 |
| movement | startupDuration | 0.08 | smoothstep 起步时长，秒；0 表示立即满速 |
| movement | turnDamping | 0.012 | 转向阻尼的时间常数，秒；0 表示即时转向，反向始终立即响应 |
| movement | stopDuration | 0.2 | 松键后的最大收尾时长，秒；实际不超过本次连续按键时长，以 smoothstep 曲线先缓减速再收住，设 0 恢复立即停步 |
| sprint | speedMultiplier | 1.6 | 疾跑倍率，必须大于 1，与移速道具及地形相乘 |
| sprint | rampDuration | 0.16 | 从常速升至疾跑速度的时长，秒；使用 smoothstep 曲线，0 表示立即提速 |
| sprint | maxStamina | 100 | 体力上限 |
| sprint | drainPerSecond | 25 | 实际疾跑移动时每秒消耗的体力 |
| sprint | regenPerSecond | 35 | 非疾跑时每秒恢复的体力 |
| sprint | regenDelay | 0.6 | 最后一次消耗到开始恢复的间隔，秒，可为 0 |
| sprint | restartThreshold | 0.15 | 耗尽后的恢复门槛，范围大于 0 且不超过 1；还须松开过 Shift |
| roll | duration | 0.3 | 空格翻滚的动作时长，秒；期间方向锁定 |
| roll | speedMultiplier | 3 | 翻滚峰值速度相对基础移速的倍率，必须大于 1 |
| roll | cooldown | 0.4 | 翻滚动作结束后的冷却时间，秒，可为 0 |
| roll | staminaCost | 20 | 每次翻滚消耗的体力，可为 0 |
| animation | breathingAmplitude | 3 | 待机呼吸幅度，百分比，可为 0 |
| animation | breathingSpeed | 2 | 待机呼吸速度，可为 0 |
| animation | runSwayAmplitude | 2.5 | 跑步摇摆幅度，占 size 的百分比，可为 0；未瞄准时双手前后摆动、头部轻微摇摆，瞄准时仅头部摇摆 |
| animation | runSwaySpeed | 10 | 基础移速下的摇摆角速度，弧度/秒，可为 0；按实际移速缩放 |
| shooting | fireRate | 0.2 | 每发之间的间隔，秒/发，越小射速越高 |
| shooting | damage | 10 | 基础子弹攻击力，与伤害道具增益叠加 |
| shooting | aimTurnDuration | 已停用 | 旧配置兼容字段，须为非负有限数，不再参与运行，调试面板不提供 |
| shooting | aimContinuityWindow | 已停用 | 旧配置兼容字段，须为正有限数，不再参与运行，调试面板不提供 |
| shooting | bulletSpeed | 2600 | 子弹速度，像素/秒 |
| shooting | maxRange | 1000 | 最大飞行距离，世界像素；每格 50 像素 |
| shooting | spreadHorizontal | 0.6 | 基础水平散布半角，度，可为 0 |
| shooting | spreadVertical | 0.4 | 基础垂直散布半角，度，可为 0 |
| shooting | maxSpreadHorizontal | 3 | 满强度水平半角，度，可为 0，不小于基础值 |
| shooting | maxSpreadVertical | 2 | 满强度垂直半角，度，可为 0，不小于基础值 |
| shooting | recoilPerShot | 0.18 | 每发成功射击增加的散布强度，范围 0–1 |
| shooting | recoilRecoveryDelay | 0.25 | 最后一次成功射击后开始恢复的延迟，秒，可为 0 |
| shooting | recoilRecoveryDuration | 0.8 | 从满强度线性恢复至零的时长，秒 |
| bulletWaterDrag | shallow | 0.4 | 浅水中每秒扣除的发射速度比例，可为 0 |
| bulletWaterDrag | water | 0.8 | 普通水中每秒扣除的发射速度比例，可为 0 |
| bulletWaterDrag | deep | 1.6 | 深水中每秒扣除的发射速度比例，可为 0 |
| bulletWaterDrag | ultraDeep | 3.2 | 极深水中每秒扣除的发射速度比例，可为 0 |
| shooting | magazineSize | 6 | 副武器格洛克手枪的弹匣容量，不含膛内那一发；必须是正整数，开局弹匣与膛内都装满 |
| shooting | reloadDuration | 1.4 | 副武器格洛克手枪的换弹时长，秒；换弹结束时补满弹匣与膛内那一发 |
| shooting | knockbackImpulse | 280 | 副武器命中单位时施加的击退冲量，可为 0（不击退）；实际位移还取决于目标质量与抗性 |
| primaryShooting | damage | 16 | 主武器冲锋枪的基础子弹攻击力，与伤害道具增益叠加 |
| primaryShooting | fireRate | 0.075 | 主武器冲锋枪每发之间的间隔，秒/发，越小射速越高 |
| primaryShooting | bulletSpeed | 2800 | 主武器冲锋枪的子弹速度，像素/秒 |
| primaryShooting | magazineSize | 30 | 主武器冲锋枪的弹匣容量，不含膛内那一发；必须是正整数 |
| primaryShooting | reloadDuration | 2 | 主武器冲锋枪的换弹时长，秒 |
| primaryShooting | knockbackImpulse | 200 | 主武器冲锋枪命中单位时施加的击退冲量，可为 0（不击退） |
| ui | fadeSpeed | 5 | 换弹进度圆环的淡入淡出速度 |

除表中标明可为 0 的字段外，数值必须是大于 0 的有限数。旋转策略只能是 `cw`、`ccw` 或 `auto`；散布角必须小于 45 度；最大散布不得小于基础散布；弹匣容量必须是整数。

`shooting` 中的 damage、fireRate、bulletSpeed、magazineSize、reloadDuration、knockbackImpulse 对应副武器格洛克手枪；`primaryShooting` 的六项同名字段对应主武器冲锋枪。子弹散布、射程、后坐力等参数由 `shooting` 共享。`knockbackImpulse` 在开火瞬间快照进子弹，命中后实际施加的位移只由这次真实命中、武器冲量与目标自身的质量／抗性／上限决定，与准星落在目标身上还是目标后方无关。免疫位移的目标（`immuneToDisplacement`）不会移动，但仍会播放一次由冲量决定的受击姿态。

## 画面配置

`graphicsConfig.json` 中所有字段都可省略。

| 分组 | 字段 | 默认值 | 含义 |
| --- | --- | --- | --- |
| camera | zoom | 0.85 | 相机缩放；视口世界尺寸 = 渲染尺寸 ÷ zoom，范围 0.5–2 |
| ambient | color | #D6E2F0 | 全屏环境光颜色，#RRGGBB |
| ambient | intensity | 0.35 | 环境光强度，0–2 |
| terrainLight | color | #B4C8E0 | 左上地形弱光颜色 |
| terrainLight | intensity | 0.06 | 地形弱光强度，0–2 |
| terrainLight | shadowScale | 0.4 | 地形光阴影长度 = 地块尺寸（50 像素）× 该值，0–2 |
| terrainLight | softnessScale | 0.04 | 阴影柔边 = 地块尺寸 × 该值，0–2 |
| playerLight | color | #FFF4E8 | 脚边微光颜色 |
| playerLight | radius | 100 | 微光半径，像素，0–2000；0 关闭 |
| playerLight | intensity | 0.5 | 微光强度，0–2；0 关闭 |
| playerLight | sourceRadius | 8 | 光源自身半径，0–500 |
| flashlight | color | #FFF4E8 | 手电筒颜色 |
| flashlight | range | 400 | 手电筒距离，像素，1–2000 |
| flashlight | angle | 120 | 扇形总张角，度，1–180；内部换算成弧度 |
| flashlight | intensity | 0.8 | 手电筒强度，0–2 |
| flashlight | softness | 0.35 | 锥形边缘柔度，0–0.5 |
| flashlight | innerRadius | 30 | 近身内圈半径，0–1000 |
| flashlight | innerFade | 16 | 内圈淡出宽度，0.1–1000 |
| fog | range | 400 | legacy 模式单位可见半径，1–2000；同步到玩家的视野范围，三层模式不读取 |
| fog | feather | 120 | legacy 模式迷雾边缘柔化宽度，0–1000 |
| visibility | maskScale | 0.5 | 三层遮蔽层相对世界画布的线性分辨率，0.25–1；0.5 即宽高各一半 |
| visibility | memoryBrightness | 0.12 | 探索记忆地形的整体亮度，0–1 |
| visibility | edgeFeather | 20 | 近身/照明孔洞边缘柔化，世界像素，0–64 |
| visibility | outlineContrast | 0.06 | 未探索地形轮廓相对未知底色的对比度，0–0.5 |

颜色必须写成 `#RRGGBB`，大小写均可，加载后统一为大写。修改 `playerLight`、`flashlight` 会立即作用于跟随角色的真实光源；`fog.range` 只影响 legacy 对照模式的迷雾半径与玩家视野范围；`camera.zoom` 改变后视口和相机取景同步重算。

默认模式是三层视野；`visibility` 只控制它的遮蔽层表现，不改变感知半径、辨识阈值和探索记忆规则。这些玩法参数属于 `src/vision/VisionRules.ts`，不写入 `graphicsConfig.json`，也不由 F2 画质面板暴露。`fog` 只服务开发对照的 legacy 模式（启动时显式带 `?vision=legacy`）；三层模式不使用旧的圆形迷雾裁剪，画面 Tab 里也不会显示战争迷雾分组。

## 音效配置

`audioConfig.json` 中所有音量都是 0–1 的倍率，最终音量 = 采样音量 × 总音量 × 场景音量。

| 分组 | 字段 | 默认值 | 含义 |
| --- | --- | --- | --- |
| （根） | master | 1 | 总音量倍率，0–1 |
| weapon | secondaryVolume | 0.6 | 副武器格洛克手枪开火 |
| weapon | primaryVolume | 0.55 | 主武器冲锋枪开火 |
| weapon | reloadVolume | 0.5 | 换弹与装填 |
| footsteps | waterVolume | 0.45 | 涉水循环 |
| footsteps | dryVolume | 0.45 | 干地脚步循环 |
| pickups | goldVolume | 0.4 | 黄金拾取 |
| pickups | meatVolume | 0.5 | 肉块拾取 |
| flashlight | switchVolume | 0.5 | G 键开关手电 |
| chicken | stepVolume | 0.25 | 小鸡脚步 |
| chicken | cluckVolume | 0.25 | 小鸡叫 |
| chicken | range | 450 | 小鸡声音衰减距离，世界像素，0–5000 |
| chicken | minAttenuation | 0.08 | 超过衰减距离后的最低音量，0–1 |

一次性音效在播放时读取当前倍率；循环音与逐帧衰减的小鸡叫声在下一帧跟随新音量。

## 碰撞形状

玩家主体固定为居中圆形。可选顶层 `collider` 分组省略时使用半径 `0.5`；以 `base.size` 为一单位，默认物理半径为 24.5 像素。`center` 可省略，提供时必须为 `[0,0]`。

圆形：`"collider": {"type":"circle","radius":0.5,"center":[0,0]}`，`center` 可省略。

玩家配置不接受多边形、复合体或偏心圆；半径必须为正有限数值。非法形状会使整个配置加载失败，应用主体尺寸后重新检查出生位置。引擎其他实体仍可通过 `Entities.setCollider()` 设置凹多边形及复合形状，在碰撞验收页中可切换查看。

## 行为说明

鼠标左键单发／按住连射，右键按住时抬臂并按原有速度转身，松开恢复移动朝向。左键独立射击时首帧抬臂，不改变身体朝向；右键本身不消耗弹药。默认手持副武器格洛克手枪（6 发弹匣加膛内 1 发），主武器冲锋枪为 30 发加膛内 1 发；Q／E 在主副武器间切换，C 收起枪械切换为空手，再按 C 或 Q／E 拔枪。两把枪各自保留弹药与换弹进度，换弹中切走时进度留在原枪上。打空后默认不自动换弹，需按 R 换弹（调试面板可勾选“打空自动换弹”，默认关闭），耗时分别由 `shooting.reloadDuration` 与 `primaryShooting.reloadDuration` 决定；换弹中开火会先打断换弹、清空进度再消耗一发，备弹无限，每次换弹结束都补满当前这把枪。子弹从右手末端发射，冻结鼠标世界坐标并加上水平、垂直独立随机偏移，偏差与距离成比例；到达偏移落点或从手端飞满最大射程后消散。连射增大散布，停火后恢复，准星间距同步变化，准星中心仍固定在鼠标处。散布角度必须小于 45 度，四项散布均设为 0 可关闭随机偏移。飞行距离按实际位移计算，不随弹速增益或水体阻力改变；身体到手端及后续弹道均检查第一个障碍，不能隔墙伤害目标。`Player.update` 的可选第四参数为 `{ target: { x, y }, fire, face }`；`shootAt(target, damage?, map?)` 接收世界落点。方向辅助方法 `shoot(direction, damage?, map?)` 沿指定方向使用最大射程，并共用散布、弹药及碰撞处理；直接调用时传入地图以检查出生路径。

`Player.getVisionState()` 返回独立的只读快照 `{ x, y, direction, range }`，`direction` 使用弧度，`range` 使用世界像素。锥形手电筒的默认张角 120°、距离 400、强度 0.8 均由 `graphicsConfig.json` 的 `flashlight` 分组配置，可在画面 Tab 实时调整；右键只改变身体朝向，不改变手电筒的距离和角度。legacy 对照模式的战争迷雾半径取自 `fog.range`（默认 400），外缘柔化取 `fog.feather`；运行时通过 `Player.getVisionRange()` / `setVisionRange(value)` 读写。默认三层模式不使用这组参数：近身半径、观察距离、辨识阈值与探索间隔由 `src/vision/VisionRules.ts` 提供，手电与微光只影响照明强度。

地图每格为 50 像素；将角色尺寸调大可能无法通过狭窄通道，极端尺寸可能找不到出生位置。移动和旋转检查中间姿态，子弹检测整段路径；运动求解预算耗尽时停止在最后合法位置。

水域根据圆形主体覆盖比例渐进缓速，半身入水时速度系数为 0.75，全身入水时为 0.5。皮肤、武器及装饰不参与碰撞、缓速或拾取检测。呼吸仅在绘制时缩放图片，动画放大或缩小时主体半径始终不变。跑步摇摆同样只参与绘制：正常持械时双手交替随步伐前后摆动，头部只做幅度更小的左右晃动；瞄准抬臂时仅保留头部摇摆。行走与奔跑共用同一套动作，幅度按实际移速缩放，撞墙或站立时停止，主体碰撞范围不变。

玩家默认从静止起步，80 毫秒内以 smoothstep 曲线平滑加速至 200 像素/秒，起止加速度均为 0，并带轻微方向阻尼，转向不损失速度、不重置起步，反向立即响应。`turnDamping` 默认 0.012 秒，可调为 0 关闭，或小幅提高来试手感。松键后以 smoothstep 曲线收尾，时长取本次连续按键时长与 `stopDuration`（默认 0.2 秒）的较小值；短按不会触发完整惯性，持续移动后常速满速收尾滑行约 20 像素。重新输入立即接管并重新计算本次按键时长，收尾仍受碰撞和地形约束、不扣体力。设为 0 可恢复立即停步。提高 `startupDuration` 会延长加速过程；提高 `startSpeedRatio` 会恢复非零起步速度。旧 `accel`、`decel`、`nonlinearFactor` 仍可读取，但不再参与玩家移动。

按 Shift 后用 `rampDuration`（默认 0.16 秒）从常速平滑升到疾跑速度，转向和反向不重置升速过程。松开 Shift 立即回到常速，再次按下会重新升速；升速期间正常消耗体力。默认满体力可疾跑 4 秒，恢复延迟结束后从空到满约 2.9 秒。耗尽后持续按住 Shift 不会自动续跑；站立和完全受阻时不扣体力，滑墙移动时正常扣除。修改体力上限会保留剩余体力比例；`getMaxSpeed()` 返回含道具增益的基础最大速度，疾跑倍率独立计算。可通过 `getStamina()`、`getMaxStamina()`、`getIsSprinting()` 查询当前状态。

按空格向当前移动方向翻滚；没有移动输入时朝身体正面（`currentRotation − π`）。动作默认 0.3 秒，峰值速度为 3 倍基础移速，速度按 1−t² 衰减，总位移约 120 像素；翻滚方向在起滚瞬间锁定，途中反向输入不会改变方向，仍正常受碰撞与地形减速约束。起滚立即打断疾跑并扣除 20 点体力，同时把恢复延迟重置为 0.6 秒，动作期间不恢复体力；体力不足 20 时按空格无效，也不进入冷却。从起滚开始到动作与 0.4 秒冷却都结束前不能再次翻滚，默认最多每 0.7 秒一次，满体力可连滚 5 次。翻滚期间不能开火、不抬枪、不生成脚印，换弹与切枪照常；动画只做绕身体左右轴的前后翻与收身，不影响碰撞半径和子弹判定。动作结束后不保留滑行惯性。调试面板的“翻滚”分组可实时调整时长、倍率、冷却与体力消耗。

降低 `fireRate` 会提高射速，扩大 `magazineSize` 会增加连续射击发数，缩短 `reloadDuration` 会加快换弹；副武器改 `shooting`，主武器改 `primaryShooting`。这些参数用于手感与平衡调节，不应作为渲染性能优化手段。

生命值默认 100，副武器基础子弹伤害默认 10、主武器默认 16，分别通过 `base.maxHealth`、`shooting.damage` 与 `primaryShooting.damage` 配置。省略字段的旧文件继续使用默认值。

## 游戏内调试

进入游戏后，点击右上角“调试 · F2”或按 F2 打开居中的调试弹窗；按 Escape、点击遮罩或右上角“关闭”收起。开发版及打包版都提供入口。弹窗分三个 Tab：

- **角色**：生命、攻击、弹道散布、移动、体力、翻滚、弹药与换弹、子弹水体阻力、体型与动画、界面反馈。
- **画面**：相机缩放、环境光与地形光、角色微光、锥形手电筒、三层视野遮蔽；旧版战争迷雾只在 legacy 模式显示。
- **音效**：总音量、武器、脚步、拾取与开关、小鸡。

游戏在弹窗打开时继续运行；焦点限制在弹窗内，角色按键被屏蔽，关闭弹窗或点击游戏画面后恢复控制。Tab 支持鼠标点击与左右方向键／Home／End 切换。弹窗关闭时按 Escape 可唤出／收起系统鼠标；唤出期间准星隐藏、瞄准与开火暂停，再次按 Escape 恢复。

每个数值字段同时提供滑条与数值框：拖动滑条会立即应用数值，数值框保留精确输入，按回车或失焦应用，错误值会显示提示且不改变属性。颜色使用取色器；转向策略与“R 键行为”使用下拉。面板射速单位为“发/秒”，配置文件仍为“秒/发”；例如界面 5 发/秒对应 `fireRate: 0.2`。水体阻力界面单位为“发射速度 %/秒”，界面 40 对应配置 `0.4`；手电筒张角界面使用度，配置文件同样使用度。角色字段 id 形如 `base.maxSpeed`、`shooting.damage`，画面与音效字段 id 带域前缀，如 `graphics.flashlight.range`、`audio.master`；滑条另有 `data-debug-slider` 标记。

“攻击”和“弹药与换弹”分组按当前手持的枪提供攻击力、射速、子弹速度、弹匣容量与换弹时长，空手时回落到上一把枪；“弹道散布”分组调节水平／垂直基础半角、连射最大半角、每发累积强度和恢复时序。“子弹水体阻力”分组独立调节四档水深的减速强度，数值越小阻力越弱，0 关闭该水深的阻力。

“恢复初始参数”恢复本次场景加载后的三个配置域，并回满血量、体力与弹匣，关闭“打空自动换弹”，不移除道具增益。调试改动仅在当前页面运行中生效，不写回 JSON，刷新页面后还原。

面板的全部控件由 `src/ui/debugSchema.ts` 的声明表生成，数值控件必须带 `min`、`max` 与 `step`（滑条边界与数值校验共用）。新增可调配置时，除了在 JSON 默认值与解析器中登记字段，还要在 `debugSchema.ts` 添加控件描述；`tests/config-sync.test.mjs` 会比对配置默认值与控件集合，漏加、缺少上限或重复会直接失败。
