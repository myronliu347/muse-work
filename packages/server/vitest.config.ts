import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // todoPluginScript.test.ts 会 spawn todo.mjs 子进程走真实 REST，虽已做
    // env 剥离隔离，但安全起见排除出默认全量测试；需要时单独跑：
    //   pnpm test:todo-script
    // 用 include 负向模式而非 exclude：exclude 对显式传入的文件路径也生效，
    // 会连单独运行一起挡掉；include 负向只影响全量收集，显式路径不受影响。
    include: ["tests/**/*.test.ts", "!tests/todoPluginScript.test.ts"],
  },
});
