import { defineConfig } from "vite";

export default defineConfig({
  server: {
    open: false,
    // Editors write atomic temp folders into tests/; watching them crashes the Windows watcher.
    watch: { ignored: ["**/tests/**", "**/tmp/**"] }
  },
});
