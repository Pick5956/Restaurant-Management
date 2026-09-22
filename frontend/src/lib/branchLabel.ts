/**
 * The branch line under a restaurant's name: "สาขา" and the branch. Branch names
 * usually carry the word already (the default is "สาขาหลัก"), so it is added
 * only when missing; a restaurant with no branch set says so rather than
 * leaving the line blank.
 */
export function branchLabel(branch: string | null | undefined, language: "th" | "en"): string {
  const name = (branch ?? "").trim();
  if (language === "th") {
    if (!name) return "ไม่ระบุสาขา";
    return name.startsWith("สาขา") ? name : `สาขา${name}`;
  }
  if (!name) return "No branch set";
  return /\bbranch$/i.test(name) || name.startsWith("สาขา") ? name : `${name} branch`;
}
