"use client";

import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/src/lib/format";
import type { Ingredient, IngredientCategory } from "@/src/types/ingredient";
import { categoryUsage, type useInventoryData } from "./useInventoryData";
import {
  BottomSheet,
  PrimaryButton,
  ScreenNav,
  TAP,
  inputBase,
} from "./primitives";

type Actions = ReturnType<typeof useInventoryData>["actions"];

export default function CategoriesScreen({
  lang,
  categories,
  ingredients,
  onBack,
  actions,
}: {
  lang: "th" | "en";
  categories: IngredientCategory[];
  ingredients: Ingredient[];
  onBack: () => void;
  actions: Actions;
}) {
  const copy = useMemo(
    () =>
      lang === "th"
        ? {
            title: "จัดการหมวดหมู่",
            items: "รายการ",
            rename: "เปลี่ยนชื่อหมวด",
            renameNote: "เปลี่ยนชื่อแล้ววัตถุดิบทุกตัวในหมวดนี้ย้ายตามทันที",
            save: "บันทึก",
            addTitle: "เพิ่มหมวดหมู่",
            addPlaceholder: "ชื่อหมวดใหม่",
            add: "เพิ่ม",
            duplicate: "มีหมวดชื่อนี้อยู่แล้ว",
            blocked: (n: number) => `ลบไม่ได้ ยังมีวัตถุดิบ ${n} รายการอยู่ในหมวดนี้`,
            empty: "ยังไม่มีหมวดหมู่",
            failed: "ทำรายการไม่สำเร็จ",
          }
        : {
            title: "Manage categories",
            items: "items",
            rename: "Rename category",
            renameNote: "Renaming moves every ingredient in it at once",
            save: "Save",
            addTitle: "Add category",
            addPlaceholder: "New category name",
            add: "Add",
            duplicate: "A category with that name already exists",
            blocked: (n: number) => `Cannot delete — ${n} ingredients still use it`,
            empty: "No categories yet",
            failed: "That did not go through",
          },
    [lang],
  );

  const usage = useMemo(() => categoryUsage(ingredients), [ingredients]);
  const [renaming, setRenaming] = useState<IngredientCategory | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const nameTaken = (value: string, exceptId = 0) =>
    categories.some(
      (category) =>
        category.ID !== exceptId && category.name.trim().toLowerCase() === value.trim().toLowerCase(),
    );

  async function submitRename() {
    if (!renaming || !draft.trim()) return;
    if (nameTaken(draft, renaming.ID)) {
      setError(copy.duplicate);
      return;
    }
    setBusy(true);
    try {
      await actions.renameCategory(renaming.ID, draft.trim());
      setRenaming(null);
      setError("");
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  async function submitAdd() {
    if (!newName.trim()) return;
    if (nameTaken(newName)) {
      setError(copy.duplicate);
      return;
    }
    setBusy(true);
    try {
      await actions.createCategory(newName.trim());
      setNewName("");
      setAdding(false);
      setError("");
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  async function remove(category: IngredientCategory) {
    setBusy(true);
    try {
      await actions.removeCategory(category.ID);
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-inventory-mobile className="min-h-dvh bg-(--inv-canvas) text-(--inv-body) pb-10">
      <ScreenNav title={copy.title} onBack={onBack} />

      <div className="px-4 pt-4">
        {categories.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-(--inv-faint)">{copy.empty}</p>
        ) : (
          <div className="overflow-hidden rounded-(--inv-radius-lg) border border-(--inv-hairline) bg-(--inv-surface)">
            {categories.map((category, index) => {
              const stats = usage.get(category.ID) ?? { count: 0, value: 0 };
              const locked = stats.count > 0;
              return (
                <div
                  key={category.ID}
                  className={`flex items-center gap-2 px-3 py-2.5 ${
                    index > 0 ? "border-t border-(--inv-hairline)" : ""
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-medium text-(--inv-heading)">
                      {category.name}
                    </p>
                    <p className="truncate text-[11px] tabular-nums text-(--inv-faint)">
                      {stats.count} {copy.items} · {formatCurrency(stats.value, lang)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={copy.rename}
                    onClick={() => {
                      setRenaming(category);
                      setDraft(category.name);
                      setError("");
                    }}
                    className={`ui-press flex h-11 w-11 shrink-0 items-center justify-center rounded-(--inv-radius) text-(--inv-muted) ${TAP}`}
                  >
                    <Pencil className="h-5 w-5" strokeWidth={2} />
                  </button>
                  <button
                    type="button"
                    aria-label={locked ? copy.blocked(stats.count) : "ลบ"}
                    title={locked ? copy.blocked(stats.count) : undefined}
                    disabled={locked || busy}
                    onClick={() => remove(category)}
                    className={`ui-press flex h-11 w-11 shrink-0 items-center justify-center rounded-(--inv-radius) text-(--inv-out) disabled:opacity-30 ${TAP}`}
                  >
                    <Trash2 className="h-5 w-5" strokeWidth={2} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => {
            setAdding(true);
            setError("");
          }}
          className={`ui-press mt-3 flex w-full items-center justify-center gap-2 rounded-(--inv-radius-lg) border border-dashed border-(--inv-hairline) bg-(--inv-surface) text-[15px] font-semibold text-(--inv-action) ${TAP}`}
          style={{ minHeight: 52 }}
        >
          <Plus className="h-5 w-5" strokeWidth={2} />
          {copy.addTitle}
        </button>

        {error && <p className="mt-3 px-1 text-[13px] text-(--inv-out)">{error}</p>}
      </div>

      <BottomSheet
        open={renaming !== null}
        title={copy.rename}
        onClose={() => setRenaming(null)}
        footer={
          <PrimaryButton onClick={submitRename} disabled={busy || !draft.trim()}>
            {copy.save}
          </PrimaryButton>
        }
      >
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className={`${inputBase} h-[52px] border-(--inv-hairline)`}
        />
        <p className="mt-2 text-[11px] leading-snug text-(--inv-faint)">{copy.renameNote}</p>
        {error && <p className="mt-2 text-[13px] text-(--inv-out)">{error}</p>}
      </BottomSheet>

      <BottomSheet
        open={adding}
        title={copy.addTitle}
        onClose={() => setAdding(false)}
        footer={
          <PrimaryButton onClick={submitAdd} disabled={busy || !newName.trim()}>
            {copy.add}
          </PrimaryButton>
        }
      >
        <input
          type="text"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder={copy.addPlaceholder}
          className={`${inputBase} h-[52px] border-(--inv-hairline)`}
        />
        {error && <p className="mt-2 text-[13px] text-(--inv-out)">{error}</p>}
      </BottomSheet>
    </div>
  );
}
