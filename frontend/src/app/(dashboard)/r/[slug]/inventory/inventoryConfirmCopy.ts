import { formatAdaptiveNumber as formatNumber, formatCurrency } from "@/src/lib/format";
import type { Ingredient, IngredientInput } from "@/src/types/ingredient";
import { formatExpiryDate, storageLabel } from "./inventoryExpiryUtils";

/**
 * The words for "are you sure?" before anything in the inventory is saved. Each
 * one says what is about to change, in real numbers — "ราคา ฿0.15/กรัม →
 * ฿0.18/กรัม" — so the check is worth reading rather than a reflex tap. The web
 * page and the phone screens both read from here, so they ask the same thing.
 */

type Lang = "th" | "en";
type PackShape = Pick<IngredientInput, "unit" | "pack_unit" | "pack_size" | "case_unit" | "case_size">;

const price = (value: number, unit: string, lang: Lang) => `${formatCurrency(value, lang, 4)}/${unit}`;
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function packText(item: PackShape, lang: Lang): string {
  if (!item.pack_unit) return lang === "th" ? "ไม่มี" : "none";
  const pack = `${item.pack_unit}${lang === "th" ? "ละ" : " of"} ${formatNumber(item.pack_size ?? 0, lang)} ${item.unit}`;
  if (!item.case_unit) return pack;
  return `${pack} · ${item.case_unit}${lang === "th" ? "ละ" : " of"} ${formatNumber(item.case_size ?? 0, lang)} ${item.pack_unit}`;
}

/** Every field an edit changes, one "ชื่อ เก่า → ใหม่" line each; empty when nothing did. */
export function ingredientChanges(
  before: Ingredient,
  after: IngredientInput,
  categoryName: (id: number) => string,
  lang: Lang,
): string[] {
  const th = lang === "th";
  const lines: string[] = [];
  const name = after.name.trim();
  if (name !== before.name) lines.push(`${th ? "ชื่อ" : "Name"} ${before.name} → ${name}`);
  const fromCategory = before.category_id ?? 0;
  const toCategory = after.category_id ?? 0;
  if (fromCategory !== toCategory) {
    lines.push(`${th ? "หมวด" : "Category"} ${categoryName(fromCategory)} → ${categoryName(toCategory)}`);
  }
  if (after.unit !== before.unit) lines.push(`${th ? "หน่วย" : "Unit"} ${before.unit} → ${after.unit}`);
  const fromStorage = before.storage_type ?? "room_temp";
  const toStorage = after.storage_type ?? fromStorage;
  if (toStorage !== fromStorage) {
    lines.push(`${th ? "การเก็บ" : "Storage"} ${storageLabel(fromStorage, lang)} → ${storageLabel(toStorage, lang)}`);
  }
  const fromPack = packText(before, lang);
  const toPack = packText(after, lang);
  if (fromPack !== toPack) lines.push(`${th ? "บรรจุภัณฑ์" : "Pack"} ${fromPack} → ${toPack}`);
  if (!same(before.cost_per_unit, after.cost_per_unit)) {
    lines.push(`${th ? "ราคา" : "Price"} ${price(before.cost_per_unit, before.unit, lang)} → ${price(after.cost_per_unit, after.unit, lang)}`);
  }
  const fromPercent = before.min_percent ?? 0;
  const toPercent = after.min_percent ?? fromPercent;
  if (!same(before.min_stock, after.min_stock) || fromPercent !== toPercent) {
    const percent = toPercent > 0 || fromPercent > 0 ? ` (${fromPercent}% → ${toPercent}%)` : "";
    lines.push(
      `${th ? "แจ้งเตือนเมื่อต่ำกว่า" : "Warn below"} ${formatNumber(before.min_stock, lang)} → ${formatNumber(after.min_stock, lang)} ${after.unit}${percent}`,
    );
  }
  return lines;
}

/** What a new ingredient goes in with: ยอดเริ่มต้น 5 แพ็ก · ราคา ฿0.15/กรัม · แช่เย็น · หมดอายุ 1 ต.ค. 69 */
export function newIngredientSummary(input: IngredientInput, lang: Lang): string {
  const th = lang === "th";
  return [
    input.stock > 0
      ? `${th ? "ยอดเริ่มต้น" : "Opening"} ${formatNumber(input.stock, lang)} ${input.stock_unit || input.unit}`
      : th
        ? "ยังไม่มีสต๊อก"
        : "No stock yet",
    input.cost_per_unit > 0 ? `${th ? "ราคา" : "price"} ${price(input.cost_per_unit, input.unit, lang)}` : null,
    storageLabel(input.storage_type ?? "room_temp", lang),
    input.expires_at ? `${th ? "หมดอายุ" : "expires"} ${formatExpiryDate(input.expires_at, lang)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function confirmCopy(lang: Lang) {
  const th = lang === "th";
  return {
    cancel: th ? "กลับไปแก้" : "Go back",
    save: th ? "บันทึก" : "Save",
    editTitle: (name: string) => (th ? `บันทึกการแก้ไข ${name}?` : `Save changes to ${name}?`),
    addTitle: (name: string) => (th ? `เพิ่ม ${name} เข้าคลัง?` : `Add ${name} to inventory?`),
    add: th ? "เพิ่มเข้าคลัง" : "Add",
    bulkTitle: (count: number) => (th ? `เพิ่ม ${count} รายการเข้าคลัง?` : `Add ${count} ingredients?`),
    restockTitle: (name: string, amount: string, unit: string) =>
      th ? `เติม ${name} ${amount} ${unit}?` : `Restock ${amount} ${unit} of ${name}?`,
    restock: th ? "เติมสต๊อก" : "Restock",
    stockLine: (from: string, to: string, unit: string) =>
      th ? `คงเหลือ ${from} → ${to} ${unit}` : `On hand ${from} → ${to} ${unit}`,
    paidLine: (amount: string) => (th ? `จ่าย ${amount}` : `paid ${amount}`),
    expiresLine: (date: string) => (th ? `หมดอายุ ${date}` : `expires ${date}`),
    countTitle: (name: string) => (th ? `ตั้งยอด ${name} ใหม่?` : `Set ${name} to a new count?`),
    count: th ? "ตั้งยอด" : "Set count",
    batchTitle: (mode: "in" | "adjust", count: number) =>
      mode === "in"
        ? th
          ? `เติมสต๊อก ${count} รายการ?`
          : `Restock ${count} ingredients?`
        : th
          ? `ตั้งยอดใหม่ ${count} รายการ?`
          : `Set ${count} new counts?`,
    lotTitle: th ? "เปลี่ยนวันหมดอายุ?" : "Change the expiry date?",
    lotLine: (amount: string, unit: string, from: string, to: string) =>
      th ? `ล็อต ${amount} ${unit}: ${from} → ${to}` : `Lot of ${amount} ${unit}: ${from} → ${to}`,
    noDate: th ? "ไม่ระบุ" : "none",
    categoryAddTitle: (name: string) => (th ? `เพิ่มหมวด “${name}”?` : `Add the category “${name}”?`),
    categoryAddBody: th ? "หมวดใหม่จะเลือกได้ทันทีตอนเพิ่มหรือแก้วัตถุดิบ" : "It can be picked straight away for any ingredient.",
    categoryRenameTitle: th ? "เปลี่ยนชื่อหมวด?" : "Rename the category?",
    categoryRenameBody: (from: string, to: string, used: number) =>
      th
        ? `${from} → ${to}${used > 0 ? ` · วัตถุดิบ ${used} รายการในหมวดนี้จะเห็นชื่อใหม่` : ""}`
        : `${from} → ${to}${used > 0 ? ` · ${used} ingredients in it show the new name` : ""}`,
  };
}
