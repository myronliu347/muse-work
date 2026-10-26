import { spawn } from "node:child_process";
import { SkillMarketError } from "./errors.js";

export function cloneGitHubRepo(repoUrl: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", "--depth", "1", repoUrl, dest], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new SkillMarketError("仓库克隆失败", 502));
    }, 60_000);
    child.on("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        new SkillMarketError(
          error.code === "ENOENT" ? "本机没有 git" : "仓库克隆失败",
          502,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new SkillMarketError("仓库克隆失败", 502));
    });
  });
}
