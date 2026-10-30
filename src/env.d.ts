/**
 * 由 `vite.config.ts` 的 `define` 在编译期注入：开发服务器为 `true`，生产构建为 `false`。
 *
 * 之所以不用 `import.meta.env.DEV`：`scripts/test.mjs` 会用 `tsc --module CommonJS`
 * 编译 `src`，而 `import.meta` 在 CommonJS 模块里是编译错误。`__DEV__` 在 Node 单测
 * 产物里不会被读取（GameScene 只在浏览器里实例化），运行时按“未定义即非开发环境”处理。
 */
declare const __DEV__: boolean;
