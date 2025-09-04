# Mini 2D Engine

一个基于 Canvas 的轻量级 2D 游戏引擎，使用 TypeScript 开发，提供完整的游戏开发框架，包括渲染系统、场景管理、输入处理、物理系统和状态机等核心功能。

## 🚀 技术栈

- 编程语言 : TypeScript
- 构建工具 : Vite
- 渲染技术 : Canvas 2D API
- 开发环境 : 支持现代浏览器

## 📁 项目结构

项目采用模块化架构设计，清晰分离了游戏核心系统、对象系统、地图系统和场景管理等组件。

```
├── src/
│   ├── core/         # 核心系统（游戏循环、渲染、场景管理等）
│   ├── map/          # 地图系统（瓦片地图、地形生成等）
│   ├── math/         # 数学工具库（向量运算等）
│   ├── objects/      # 游戏对象系统（玩家、实体、子弹等）
│   ├── scenes/       # 场景实现（菜单、游戏场景、加载场景等）
│   ├── status/       # 状态机系统（玩家状态管理）
│   └── main.ts       # 游戏入口文件
├── public/assets/    # 游戏资源（图片等）
├── index.html        # 主HTML文件
└── vite.config.ts    # Vite配置文件
```

## ✨ 核心功能

### 🎮 游戏核心系统

- 游戏循环 : 基于 requestAnimationFrame 实现的高性能游戏主循环
- 时间管理 : 基于 delta time 的帧率无关更新系统
- 场景管理 : 支持多场景切换和过渡动画效果
- 输入处理 : 键盘输入检测和管理

### 🎨 渲染系统

- Canvas 渲染 : 基于 Canvas 2D API 的高效渲染器
- 高 DPI 支持 : 自动处理不同设备像素比的显示问题
- 相机系统 : 支持跟随目标、死区控制和震动效果

### 🗺️ 地图系统

- 瓦片地图 : 可配置的网格地图系统
- 地形生成 : 基于概率和噪声的随机地形生成
- 碰撞检测 : 精确的矩形碰撞检测算法
- 可破坏地形 : 支持瓦片血量和破坏效果

### 🕹️ 游戏对象系统

- 对象继承体系 : 基于抽象类的游戏对象层次结构
- 实体系统 : 支持移动、旋转和动画的实体类
- 玩家控制系统 : 支持移动、射击和状态管理的玩家类
- 物理运动 : 支持加速度、减速度和非线性运动

### 🧠 状态管理

- 状态机 : 灵活的状态管理系统
- 玩家状态 : 支持待机、移动和射击等多种状态
- 动画控制 : 基于状态的动画效果管理

## 🚀 快速开始

### 安装依赖

```Bash
npm install
```

### 开发模式

```Bash
npm run dev
```

### 构建项目

```Bash
npm run build
```

### 预览构建结果

```Bash
npm run preview
```

## 📖 如何使用

1. 创建游戏实例

```Typescript
import { Game } from "./core/Game";

// 获取HTML中的canvas元素
const canvas = document.querySelector("canvas")!;

// 创建游戏实例
export const game = new Game(canvas);

// 启动游戏
game.start();
```

2. 创建和管理场景

```Typescript
import { MenuScene } from "./scenes/MenuScene";
import { GameScene } from "./scenes/GameScene";

// 创建场景
const menuScene = new MenuScene();
const gameScene = new GameScene();

// 切换场景（带过渡效果）
game.sceneManager.changeScene(gameScene, 0.5);
```

3. 定义自定义实体

```Typescript
import { Entities } from "./objects/Entities";
import { Vector2 } from "./math/Vector2";
import { Input } from "./core/Input";

class CustomEntity extends Entities {
  // 实现抽象方法
  protected getMoveDirection(input: Input): Vector2 {
    const dir = new Vector2();
    // 实现移动逻辑
    return dir;
  }

  protected getLookDirection(input: Input): Vector2 {
    const dir = new Vector2();
    // 实现朝向逻辑
    return dir;
  }
}
```

4. 使用瓦片地图

```Typescript
import { TileMap } from "./map/TileMap";

// 创建100x100的瓦片地图
const map = new TileMap(100, 100);

// 检查碰撞
const isColliding = map.isCollidingRect(x, y, width, height);

// 获取随机可行走位置
const spawnPosition = map.getRandomWalkablePosition(size);
```

## 🎯 主要类和接口

核心类

- Game: 游戏主类，协调各系统工作
- Renderer: 渲染器，负责 Canvas 绘制
- SceneManager: 场景管理器，处理场景切换
- Input: 输入系统，管理用户输入

游戏对象

- GameObject: 游戏对象基类
- Bullet: 子弹类

地图系统

- TileMap: 瓦片地图类
- TileType: 瓦片类型定义

状态管理

- StateMachine: 状态机类
- State: 状态接口

🛠️ 开发说明

- 代码使用 TypeScript 编写，确保类型安全
- 遵循 ES6 模块系统规范
- 采用面向对象设计模式，强调继承和多态
- 支持现代浏览器特性

## 📝 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request 来改进这个引擎！
