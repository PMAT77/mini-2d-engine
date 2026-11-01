# 丧尸系统实施记录

## 阶段 0：冻结基线

- 工作分支：`codex/mouse-aim-shooting`。
- 基线 HEAD：`4354ed688bb0fb37d94cd3b31024c86129397fe5`，实施前工作区干净。
- 保留原始基线之后的四项浏览器测试修复。
- 前期审查实测：511 项 Node 测试、类型检查、生产构建通过；浏览器与性能未在前期审查中执行。
- 本机环境：Windows / PowerShell；外部 Playwright 位于 `D:\SDK\nvm\v24.19.0\node_modules\playwright`，缓存 Chromium 位于用户 LocalAppData，游戏不增加运行时依赖。
- 最终验证及每阶段 SHA、实际浏览器结果记入 `zombie-system-test-report.md`。
