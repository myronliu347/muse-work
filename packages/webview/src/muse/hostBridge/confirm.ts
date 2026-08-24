import {
  confirmationTypeForTool,
  postToWebview,
  resolveToolInput,
} from "./utils.js";
import type { PendingPermission } from "./utils.js";
import type { BridgeCtx } from "./ctx.js";

export type ConfirmationResponseMsg = {
  confirmationId?: string;
  approved?: boolean;
  decision?:
    | string
    | {
        behavior?: "allow" | "deny";
        message?: string;
        newPermissionMode?: string;
        newPermissionRule?: string;
      };
};

export interface ConfirmModule {
  handleConfirmationResponse: (msg: ConfirmationResponseMsg) => Promise<void>;
  showPermissionConfirmation: (pending: PendingPermission) => void;
  clearPendingPermission: (id: string) => void;
}

export function createConfirmModule(ctx: BridgeCtx): ConfirmModule {
  const showPermissionConfirmation = (pending: PendingPermission) => {
    postToWebview({
      command: "showConfirmation",
      confirmationId: pending.permissionId,
      toolName: pending.toolName,
      confirmationType: confirmationTypeForTool(pending.toolName),
      toolInput: resolveToolInput(pending),
      planContent: pending.planContent,
      suggestedPrefix: pending.suggestedPrefix,
      hidePersistentOption: pending.hidePersistentOption,
      permissionMode: pending.permissionMode,
    });
  };

  const clearPendingPermission = (id: string) => {
    if (!ctx.pendingPermissions.has(id)) return;
    ctx.pendingPermissions.delete(id);
    ctx.patchTreeSession(id, { waitingConfirmation: false });
  };

  async function handleConfirmationResponse(
    msg: ConfirmationResponseMsg,
  ): Promise<void> {
    if (!ctx.sessionId || !msg.confirmationId) return;
    const sid = ctx.sessionId;

    let behavior: "allow" | "deny" = "allow";
    let message: string | undefined;
    let newPermissionMode: string | undefined;
    let newPermissionRule: string | undefined;

    if (msg.approved === false) {
      behavior = "deny";
      message = "Denied by user";
    }

    if (typeof msg.decision === "string") {
      if (msg.decision === "deny" || msg.decision === "reject") {
        behavior = "deny";
        message = message ?? "Denied by user";
      } else if (msg.decision === "allow") {
        behavior = "allow";
      }
    } else if (msg.decision && typeof msg.decision === "object") {
      if (msg.decision.behavior === "deny" || msg.decision.behavior === "allow") {
        behavior = msg.decision.behavior;
      }
      if (typeof msg.decision.message === "string") {
        message = msg.decision.message;
      } else if (behavior === "deny") {
        message = message ?? "Denied by user";
      }
      if (typeof msg.decision.newPermissionMode === "string") {
        newPermissionMode = msg.decision.newPermissionMode;
      }
      if (typeof msg.decision.newPermissionRule === "string") {
        newPermissionRule = msg.decision.newPermissionRule;
      }
    }

    try {
      await ctx.api.respondPermission(sid, msg.confirmationId, {
        behavior,
        message,
        newPermissionMode,
        newPermissionRule,
      });
      clearPendingPermission(sid);
    } catch (err) {
      postToWebview({
        command: "updateErrorBlock",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    handleConfirmationResponse,
    showPermissionConfirmation,
    clearPendingPermission,
  };
}
