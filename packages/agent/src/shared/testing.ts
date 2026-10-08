import { resetSharedLiveConfigForTests } from "./sharedLiveConfig.js";
import { resetSharedSkillCatalogForTests } from "./sharedSkillCatalog.js";

export async function resetSharedCatalogsForTests(): Promise<void> {
  await resetSharedSkillCatalogForTests();
  await resetSharedLiveConfigForTests();
}
