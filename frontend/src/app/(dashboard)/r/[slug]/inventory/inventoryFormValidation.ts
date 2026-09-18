/**
 * What the ingredient forms check before anything is sent. The server checks
 * the same things and more, but its answers arrive after a round trip, in
 * English, as one line at the bottom of the form — so the obvious mistakes are
 * caught here, in Thai, under the field that has them.
 *
 * One module for the web form and the phone form, so the two cannot drift.
 */

export type IngredientField = "name" | "packSize" | "caseSize" | "stock" | "cost";
export type IngredientFieldErrors = Partial<Record<IngredientField, string>>;

/** The server's limit on an ingredient name (entity.Ingredient.Name size:160). */
export const MAX_NAME_LENGTH = 160;

export function normalName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("th");
}

/** Typed but not a number, or below zero. An empty box is not an error. */
export function isBadAmount(text: string | number | undefined | null): boolean {
  if (text === undefined || text === null) return false;
  const raw = String(text).trim();
  if (raw === "") return false;
  const value = Number(raw);
  return !Number.isFinite(value) || value < 0;
}

function copy(lang: "th" | "en") {
  return lang === "th"
    ? {
        nameRequired: "กรอกชื่อวัตถุดิบ",
        nameTooLong: `ชื่อยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร`,
        nameTaken: (name: string) => `มี "${name}" ในคลังแล้ว ใช้ชื่ออื่นหรือแก้ตัวเดิมแทน`,
        packSize: (pack: string) => `ใส่ว่า 1 ${pack} มีเท่าไหร่ (มากกว่า 0)`,
        caseSize: (kase: string) => `ใส่ว่า 1 ${kase} มีกี่ชิ้นย่อย (มากกว่า 0)`,
        stock: "จำนวนต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป",
        cost: "ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป",
        dupInBatch: "ชื่อซ้ำกับแถวอื่นในชุดนี้",
      }
    : {
        nameRequired: "Enter a name",
        nameTooLong: `Name is longer than ${MAX_NAME_LENGTH} characters`,
        nameTaken: (name: string) => `"${name}" is already in the inventory`,
        packSize: (pack: string) => `Enter how much 1 ${pack} holds (above 0)`,
        caseSize: (kase: string) => `Enter how many packs 1 ${kase} holds (above 0)`,
        stock: "Quantity must be a number, 0 or more",
        cost: "Price must be a number, 0 or more",
        dupInBatch: "Same name as another row in this batch",
      };
}

export function validateIngredientForm(
  input: {
    name: string;
    /** Every ingredient name already in the restaurant. */
    existingNames: string[];
    /** The name being edited, which may of course stay as it is. */
    ownName?: string;
    packUnit: string;
    packSize: string | number;
    caseUnit: string;
    caseSize: string | number;
    stockText: string;
    costText: string;
    creating: boolean;
  },
  lang: "th" | "en",
): IngredientFieldErrors {
  const text = copy(lang);
  const errors: IngredientFieldErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = text.nameRequired;
  else if ([...name].length > MAX_NAME_LENGTH) errors.name = text.nameTooLong;
  else {
    const mine = input.ownName ? normalName(input.ownName) : null;
    const wanted = normalName(name);
    if (wanted !== mine && input.existingNames.some((existing) => normalName(existing) === wanted)) {
      errors.name = text.nameTaken(name);
    }
  }
  if (input.packUnit) {
    const size = Number(input.packSize);
    if (!Number.isFinite(size) || size <= 0) errors.packSize = text.packSize(input.packUnit);
    if (input.caseUnit) {
      const kase = Number(input.caseSize);
      if (!Number.isFinite(kase) || kase <= 0) errors.caseSize = text.caseSize(input.caseUnit);
    }
  }
  if (input.creating && isBadAmount(input.stockText)) errors.stock = text.stock;
  if (isBadAmount(input.costText)) errors.cost = text.cost;
  return errors;
}

export function hasFieldErrors(errors: IngredientFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/**
 * Per-row problems in a bulk add, null for a row that is fine or blank. A name
 * already in the inventory, a name repeated inside the batch, and a negative
 * or non-numeric quantity or price all stop the save.
 */
export function validateBulkRows(
  rows: { name: string; quantity: string | number; price: string | number }[],
  existingNames: string[],
  lang: "th" | "en",
): (string | null)[] {
  const text = copy(lang);
  const existing = new Set(existingNames.map(normalName));
  const seen = new Map<string, number>();
  rows.forEach((row) => {
    const key = normalName(row.name);
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
  });
  return rows.map((row) => {
    const name = row.name.trim();
    if (!name) return null;
    const key = normalName(name);
    if ([...name].length > MAX_NAME_LENGTH) return text.nameTooLong;
    if (existing.has(key)) return text.nameTaken(name);
    if ((seen.get(key) ?? 0) > 1) return text.dupInBatch;
    if (isBadAmount(row.quantity)) return text.stock;
    if (isBadAmount(row.price)) return text.cost;
    return null;
  });
}

/**
 * The server answers in English. The ones a person can act on are said in
 * Thai with what to do about it; anything else passes through untouched so a
 * real fault is still visible.
 */
export function inventoryErrorMessage(raw: string | undefined | null, lang: "th" | "en", fallback?: string): string {
  const message = (raw ?? "").trim();
  if (!message) return fallback ?? (lang === "th" ? "ทำรายการไม่สำเร็จ" : "That did not go through");
  if (lang === "en") return message;
  const known: Record<string, string> = {
    "ingredient is used by a menu recipe": "ลบไม่ได้ วัตถุดิบนี้อยู่ในสูตรเมนู เอาออกจากสูตรก่อน",
    "cannot change stock units while ingredient is used by a menu recipe":
      "เปลี่ยนหน่วยไม่ได้ วัตถุดิบนี้อยู่ในสูตรเมนูอยู่",
    "category is in use by ingredients": "ลบหมวดไม่ได้ ยังมีวัตถุดิบอยู่ในหมวดนี้",
    "not enough stock": "จ่ายออกเกินที่มีอยู่",
    "quantity must be greater than zero": "จำนวนต้องมากกว่า 0",
    "ingredient name is required": "กรอกชื่อวัตถุดิบ",
    "ingredient name is too long": `ชื่อยาวเกิน ${MAX_NAME_LENGTH} ตัวอักษร`,
    "unit is required": "เลือกหน่วยก่อน",
    "stock must be zero or greater": "จำนวนต้องเป็น 0 ขึ้นไป",
    "cost per unit must be zero or greater": "ราคาต้องเป็น 0 ขึ้นไป",
    "pack size must be greater than zero": "ขนาดบรรจุต้องมากกว่า 0",
    "case size must be greater than zero": "จำนวนในหน่วยใหญ่ต้องมากกว่า 0",
    "purchase unit must differ from the stock unit": "หน่วยซื้อต้องไม่ซ้ำกับหน่วยสต็อก",
    "purchase unit already converts to the stock unit":
      "หน่วยซื้อนี้แปลงกับหน่วยสต็อกได้อยู่แล้ว เลือกภาชนะอื่น",
    "case unit must differ from the pack unit": "หน่วยใหญ่ต้องไม่ซ้ำกับหน่วยซื้อ",
    "stock unit cannot be converted to the ingredient unit": "หน่วยที่เลือกแปลงเป็นหน่วยสต็อกไม่ได้",
    "ingredient not found": "ไม่พบวัตถุดิบนี้ อาจถูกลบไปแล้ว",
    "ingredient category not found": "ไม่พบหมวดนี้ อาจถูกลบไปแล้ว",
    "category name is required": "กรอกชื่อหมวด",
    "resulting stock is too large": "จำนวนมากเกินไป",
    "stock value is too large": "จำนวนมากเกินไป",
    "lot not found or already empty": "ล็อตนี้หมดหรือถูกทิ้งไปแล้ว",
    "nothing left to discard": "ล็อตนี้ไม่มีของเหลือให้ทิ้ง",
  };
  return known[message] ?? message;
}
