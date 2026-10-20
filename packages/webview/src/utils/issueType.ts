export const ISSUE_TYPES = [
  { id: "bug", label: "Bug" },
  { id: "feature", label: "Feature" },
  { id: "research", label: "调研" },
  { id: "analysis", label: "分析" },
  { id: "review", label: "检查" },
  { id: "work", label: "兜底" },
] as const;

export type IssueTypeId = (typeof ISSUE_TYPES)[number]["id"];

export function issueTypeMeta(type: string | undefined) {
  return ISSUE_TYPES.find((item) => item.id === type) ?? ISSUE_TYPES[5];
}
