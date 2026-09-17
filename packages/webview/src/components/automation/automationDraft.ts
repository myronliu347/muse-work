import type { MuseAutomation } from "../../muse/apiClient";

export const NEW_AUTOMATION_ID = "__new__";

export function isNewAutomation(id: string): boolean {
  return id === NEW_AUTOMATION_ID;
}

export function blankAutomation(): MuseAutomation {
  return {
    id: NEW_AUTOMATION_ID,
    name: "",
    description: "",
    enabled: false,
    prompt: "",
    workdir: "",
    permission: "workspace",
    triggers: [],
    createdAt: 0,
    updatedAt: 0,
  };
}
