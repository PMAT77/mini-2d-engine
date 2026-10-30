import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // 玩法模式与调试开关只在开发构建开放。编译期注入常量，避免运行时通过 URL
  // 或控制台改写 `import.meta.env`；单测用 CommonJS 编译源码，因此使用 `__DEV__`
  // 标识符而不是 `import.meta.env`（后者在 CJS 下无法编译）。
  define: {
    __DEV__: JSON.stringify(command === "serve"),
  },
  server: {
    open: false,
    // Editors write atomic temp folders into tests/; watching them crashes the Windows watcher.
    watch: { ignored: ["**/tests/**", "**/tmp/**"] }
  },
}));
