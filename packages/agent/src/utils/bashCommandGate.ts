import type { Container } from "./container.js";
import type { BashCommandGate } from "./markdownParser.js";
import type { PermissionManager } from "../managers/permissionManager.js";
import type { PermissionMode } from "../types/permissions.js";
import { BASH_TOOL_NAME } from "../constants/tools.js";

/**
 * Build the gate that judges commands injected from skill / custom-command
 * bodies (`!`cmd`` and ```! blocks).
 *
 * It delegates to the same PermissionManager, effective mode and rule sources
 * the Bash tool uses. No permission callback is passed: injected commands run
 * while a skill or command is being loaded, before the model is involved, so
 * there is no tool call to attach an interactive prompt to. An unmatched
 * command is denied rather than silently executed.
 *
 * Returns undefined when no permission manager is registered, which leaves
 * injected commands ungated.
 */
export function createBashCommandGate(
  container: Container,
): BashCommandGate | undefined {
  if (!container.has("PermissionManager")) return undefined;

  const permissionManager =
    container.get<PermissionManager>("PermissionManager");
  if (!permissionManager) return undefined;

  const sessionMode = container.has("PermissionMode")
    ? container.get<PermissionMode>("PermissionMode")
    : undefined;
  const effectiveMode = permissionManager.getCurrentEffectiveMode(sessionMode);

  return {
    check: async (command, workdir) => {
      const decision = await permissionManager.checkPermission(
        permissionManager.createContext(
          BASH_TOOL_NAME,
          effectiveMode,
          undefined,
          {
            command,
            workdir,
          },
        ),
      );
      return decision.behavior === "allow"
        ? { behavior: "allow" }
        : { behavior: "deny", message: decision.message };
    },
  };
}
