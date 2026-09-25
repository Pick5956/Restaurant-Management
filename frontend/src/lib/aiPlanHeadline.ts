import type { AIActionPlanItem } from "@/src/types/ai";

// The one line the confirm bar leads with (แบบ B, chosen 25 ก.ย. 2569): what
// the item does, in the fewest words that still carry its numbers.
//
//   a new ingredient      → "เพิ่มขิง 50 กิโลกรัม"
//   a value that moves    → "หมูสับ 5,000 → 7,000 กรัม"
//   anything else         → "ค่าไฟ · บันทึกรายจ่าย 3200 บาท…" (Go's own sentence)
//
// The figures are Go's; this only picks which of them to show.
export function planItemHeadline(item: AIActionPlanItem): string {
  const setup = item.setup;
  if (setup?.unit) {
    return `เพิ่ม${item.title} ${setup.stock.toLocaleString("th-TH", { maximumFractionDigits: 2 })} ${setup.unit}`;
  }
  if (item.from && item.to) {
    return `${item.title} ${item.from} → ${item.to}${item.value_unit ? ` ${item.value_unit}` : ""}`;
  }
  return `${item.title} · ${item.change}${item.unit ? ` ${item.unit}` : ""}`;
}
