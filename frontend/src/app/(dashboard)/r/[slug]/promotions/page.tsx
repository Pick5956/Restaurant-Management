"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { listCategories, listMenuItems } from "@/src/lib/menu";
import { listPromotions, setPromotionActive, type Promotion } from "@/src/lib/promotion";
import { createRequestGeneration } from "@/src/lib/requestGeneration";
import type { Category, MenuItem } from "@/src/types/menu";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import OperationalPageShell from "@/src/components/shared/OperationalPageShell";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import { Skeleton } from "@/src/components/shared/Skeleton";
import PromotionDialog from "./PromotionDialog";
import PromotionList from "./PromotionList";
import { promotionCopy } from "./promotionCopy";
import { emptyPromotionForm, promotionToForm, type PromotionForm, type PromotionNames } from "./promotionRules";

// Running/off-hours can flip while the page sits open; a minute is the
// smallest step any schedule has.
const CLOCK_TICK_MS = 60_000;

type PageData = {
  restaurantId: number | null;
  promotions: Promotion[];
  menus: MenuItem[];
  categories: Category[];
};

const EMPTY_DATA: PageData = { restaurantId: null, promotions: [], menus: [], categories: [] };

export default function PromotionsPage() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const restaurantId = activeMembership?.restaurant_id ?? null;
  const canManage = can(activeMembership, "manage_promotions");
  const copy = useMemo(() => promotionCopy(language), [language]);

  const [data, setData] = useState<PageData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [requests] = useState(createRequestGeneration);
  const [reloadTick, setReloadTick] = useState(0);
  const [editing, setEditing] = useState<{ restaurantId: number | null; form: PromotionForm } | null>(null);
  const [switching, setSwitching] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());

  const scoped = canManage && data.restaurantId === restaurantId ? data : EMPTY_DATA;
  const dialog = editing && editing.restaurantId === restaurantId ? editing : null;

  const names = useMemo<PromotionNames>(() => {
    const menus = new Map(scoped.menus.map((menu) => [menu.ID, menu.name]));
    const categories = new Map(scoped.categories.map((category) => [category.ID, category.name]));
    return { menu: (id) => menus.get(id), category: (id) => categories.get(id) };
  }, [scoped.categories, scoped.menus]);

  const load = useCallback(async () => {
    const requestedRestaurantId = restaurantId;
    if (!canManage || requestedRestaurantId === null) {
      requests.invalidate();
      setData(EMPTY_DATA);
      setLoading(false);
      return;
    }
    const requestGeneration = requests.begin();
    setLoading(true);
    setLoadFailed(false);
    try {
      const [promotions, categories, menus] = await Promise.all([listPromotions(), listCategories(), listMenuItems()]);
      if (!requests.isCurrent(requestGeneration)) return;
      setData({
        restaurantId: requestedRestaurantId,
        promotions: promotions.data.promotions ?? [],
        categories: categories.data.categories ?? [],
        menus: menus.data.menu_items ?? [],
      });
    } catch {
      if (!requests.isCurrent(requestGeneration)) return;
      setLoadFailed(true);
    } finally {
      if (requests.isCurrent(requestGeneration)) setLoading(false);
    }
  }, [canManage, requests, restaurantId]);

  useEffect(() => {
    void reloadTick;
    void load();
    return () => requests.invalidate();
  }, [load, reloadTick, requests]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (!canManage) return <PermissionDenied title={copy.denied} />;

  const replacePromotion = (promotion: Promotion) =>
    setData((current) =>
      current.restaurantId === restaurantId
        ? { ...current, promotions: current.promotions.map((item) => (item.ID === promotion.ID ? promotion : item)) }
        : current,
    );

  const toggle = async (promotion: Promotion) => {
    if (switching !== null) return;
    const next = !promotion.is_active;
    setSwitching(promotion.ID);
    replacePromotion({ ...promotion, is_active: next });
    try {
      const response = await setPromotionActive(promotion.ID, next);
      replacePromotion(response.data.promotion);
      showToast({ title: next ? copy.turnedOn : copy.turnedOff });
    } catch {
      replacePromotion(promotion);
      showToast({ title: copy.toggleError, tone: "error" });
    } finally {
      setSwitching(null);
    }
  };

  const saved = (promotion: Promotion, created: boolean) => {
    setData((current) =>
      current.restaurantId === restaurantId
        ? {
            ...current,
            promotions: created
              ? [promotion, ...current.promotions]
              : current.promotions.map((item) => (item.ID === promotion.ID ? promotion : item)),
          }
        : current,
    );
    setEditing(null);
  };

  const deleted = (promotionId: number) => {
    setData((current) =>
      current.restaurantId === restaurantId
        ? { ...current, promotions: current.promotions.filter((item) => item.ID !== promotionId) }
        : current,
    );
    setEditing(null);
  };

  const addButton = (
    <button
      type="button"
      onClick={() => setEditing({ restaurantId, form: emptyPromotionForm() })}
      disabled={loading && scoped.restaurantId === null}
      className="ui-press inline-flex h-9 items-center gap-2 rounded-xl bg-orange-700 px-3 text-[12px] font-semibold text-white shadow-(--dashboard-control-shadow) hover:bg-orange-800 disabled:opacity-50 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {copy.add}
    </button>
  );

  return (
    <OperationalPageShell eyebrow={copy.eyebrow} title={copy.title} hideHeaderText actions={addButton}>
      <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        {loading && scoped.restaurantId === null ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-16" />)}
          </div>
        ) : loadFailed && scoped.restaurantId === null ? (
          <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
            <p className="text-[14px] text-gray-600 dark:text-gray-300">{copy.loadError}</p>
            <button
              type="button"
              onClick={() => setReloadTick((tick) => tick + 1)}
              className="ui-press h-9 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              {copy.retry}
            </button>
          </div>
        ) : scoped.promotions.length === 0 ? (
          <p className="px-4 py-14 text-center text-[14px] text-gray-500 dark:text-gray-400">{copy.empty}</p>
        ) : (
          <PromotionList
            promotions={scoped.promotions}
            names={names}
            copy={copy}
            language={language}
            now={now}
            switching={switching}
            onEdit={(promotion) => setEditing({ restaurantId, form: promotionToForm(promotion) })}
            onToggle={(promotion) => void toggle(promotion)}
          />
        )}
      </div>

      {dialog ? (
        <PromotionDialog
          key={dialog.form.id ?? "new"}
          initial={dialog.form}
          menus={scoped.menus}
          categories={scoped.categories}
          names={names}
          copy={copy}
          language={language}
          onClose={() => setEditing(null)}
          onSaved={saved}
          onDeleted={deleted}
        />
      ) : null}
    </OperationalPageShell>
  );
}
