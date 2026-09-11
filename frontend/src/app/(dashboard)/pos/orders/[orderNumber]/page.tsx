"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useParams, useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, MapPin, Minus, Plus, Printer, ReceiptText, Search, ShoppingBasket, UtensilsCrossed, WalletCards, X } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { apiErrorMessage } from "@/src/lib/apiErrors";
import { MENU_CARD_GRID_CLASS, MENU_CARD_SHELL_CLASS } from "@/src/lib/menuGrid";
import { menuCategoryIds, menuOptionLimits } from "@/src/lib/menuUtils";
import { groupOrderItems, type OrderItemGroup } from "@/src/lib/orderItemGroups";
import { canCloseEmptyTableOrder } from "@/src/lib/orderNavigation";
import { printThermalReceipt } from "@/src/lib/thermalReceiptPrint";
import { can } from "@/src/lib/rbac";
import { addOrderItem, closeEmptyTableOrder, deleteOrderItem, getOrder, getOrderBill, payOrder, sendOrderToKitchen, updateOrderItem, updateOrderItemStatus, voidOrderItemUnits } from "@/src/lib/order";
import { listCategories, listMenuItems } from "@/src/lib/menu";
import type { Category, MenuItem } from "@/src/types/menu";
import type { Bill, Order, OrderItem, OrderPayment } from "@/src/types/order";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import { Skeleton } from "@/src/components/shared/Skeleton";
import { useConfirm, useToast } from "@/src/components/shared/FeedbackProvider";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import RealtimeConnectionNotice from "@/src/components/shared/RealtimeConnectionNotice";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { useOrderEvents } from "@/src/hooks/useOrderEvents";
import { useVisiblePolling } from "@/src/hooks/useVisiblePolling";
import ThermalReceipt from "@/src/components/orders/ThermalReceipt";

const terminalStatuses = ["completed", "cancelled"];

function orderLocationLabel(order: Order, language: "th" | "en") {
  if (order.order_type === "takeaway") {
    const base = language === "th" ? "กลับบ้าน" : "Takeaway";
    return order.customer_name?.trim() ? `${base} · ${order.customer_name.trim()}` : base;
  }
  return order.table?.display_label || order.table?.table_number || (order.table_id ? String(order.table_id) : "-");
}

function itemFulfillmentType(item: OrderItem) {
  return item.fulfillment_type === "takeaway" ? "takeaway" : "dine_in";
}

function fulfillmentLabel(value: "dine_in" | "takeaway", language: "th" | "en") {
  if (value === "takeaway") return language === "th" ? "กลับบ้าน" : "Takeaway";
  return language === "th" ? "ทานที่ร้าน" : "Dine-in";
}

type FulfillmentSection = {
  key: "dine_in" | "takeaway";
  groups: OrderItemGroup[];
  quantity: number;
  subtotal: number;
};

function fulfillmentSections(groups: OrderItemGroup[]): FulfillmentSection[] {
  return (["dine_in", "takeaway"] as const)
    .map((key) => {
      const sectionGroups = groups.filter((group) => itemFulfillmentType(group.firstItem) === key);
      return {
        key,
        groups: sectionGroups,
        quantity: sectionGroups.reduce((sum, group) => sum + group.quantity, 0),
        subtotal: sectionGroups.reduce((sum, group) => sum + group.subtotal, 0),
      };
    })
    .filter((section) => section.groups.length > 0);
}



export default function PosOrderDetailPage() {
  const params = useParams<{ orderNumber: string }>();
  const router = useRouter();
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const canTake = can(activeMembership, "take_order");
  const canPay = can(activeMembership, "take_payment");
  const orderNumber = params.orderNumber?.toUpperCase() ?? "";
  const [order, setOrder] = useState<Order | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categoryId, setCategoryId] = useState<number | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedMenu, setSelectedMenu] = useState<MenuItem | null>(null);
  const [selectedMenuClosing, setSelectedMenuClosing] = useState(false);

  const [selectedOptionIds, setSelectedOptionIds] = useState<number[]>([]);
  const [selectedFulfillment, setSelectedFulfillment] = useState<"dine_in" | "takeaway">("dine_in");
  const [billViewOpen, setBillViewOpen] = useState(false);
  const [billViewClosing, setBillViewClosing] = useState(false);
  const [orderSummaryOpen, setOrderSummaryOpen] = useState(false);
  const [orderSummaryClosing, setOrderSummaryClosing] = useState(false);
  const [currentRoundOpen, setCurrentRoundOpen] = useState(false);
  const [currentRoundClosing, setCurrentRoundClosing] = useState(false);

  const [bill, setBill] = useState<Bill | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "promptpay_qr">("cash");
  const [paymentComplete, setPaymentComplete] = useState(false);
  const [lastPayment, setLastPayment] = useState<OrderPayment | null>(null);
  const [billEditMode, setBillEditMode] = useState(false);
  const [billAddOpen, setBillAddOpen] = useState(false);
  const [billCancelTarget, setBillCancelTarget] = useState<OrderItemGroup | null>(null);
  const [billCancelReason, setBillCancelReason] = useState("");
  // "line" voids the whole group; "unit" voids a single unit (from the stepper).
  const [billCancelMode, setBillCancelMode] = useState<"line" | "unit">("line");

  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const actionInFlightRef = useRef(false);

  const copy = language === "th"
    ? {
      denied: "ไม่มีสิทธิ์รับออเดอร์",
      back: "กลับไปเลือกโต๊ะ",
      search: "ค้นหาเมนู",
      all: "ทั้งหมด",
      category: "หมวดหมู่",
      tableLabel: "โต๊ะ",
      orderLabel: "ออเดอร์",
      itemsLabel: "รายการ",
      add: "เพิ่ม",
      options: "ตัวเลือก",
      requiredOption: "ต้องเลือก",
      chooseRequiredOptions: "เลือกตัวเลือกให้ครบก่อนเพิ่มรายการ",
      quantity: "จำนวน",
      note: "หมายเหตุ",
      pending: "รอส่งครัว",
      cooking: "ครัวกำลังทำ",
      ready: "เสร็จแล้ว",
      served: "เสร็จแล้ว",
      sent_to_kitchen: "ส่งเข้าครัว",
      open: "เปิดอยู่",
      completed: "ปิดแล้ว",
      cancelled: "ยกเลิก",
      cart: "รายการในออเดอร์",
      emptyCart: "ยังไม่มีรายการ",
      sendKitchen: "ส่งเข้าครัว",
      close: "ออกบิล / รับเงิน",
      bill: "บิล",
      service: "Service charge",
      vat: "VAT",
      grandTotal: "ยอดสุทธิ",
      cash: "เงินสด",
      qr: "QR PromptPay",
      print: "พิมพ์บิล",
      confirmPayment: "ยืนยันรับเงิน",
      paymentMethod: "วิธีรับเงิน",
      allItems: "รายการทั้งหมด",
      editItems: "แก้ไขรายการ",
      doneEditing: "เสร็จสิ้น",
      addServed: "เพิ่มรายการ (เสิร์ฟแล้ว)",
      backToBill: "กลับไปที่บิล",
      requiresOptions: "ต้องเลือกตัวเลือก — เพิ่มจากหน้าสั่งอาหาร",
      addServedHint: "แตะเมนูเพื่อเพิ่มเป็น “เสิร์ฟแล้ว” ทีละ 1",
      cancelItemTitle: "ยกเลิกรายการนี้?",
      cancelItemReason: "เหตุผลที่ยกเลิก",
      cancelItemPlaceholder: "เช่น พนักงานกดสั่งเกิน",
      confirmCancelItem: "ยืนยันยกเลิก",
      keepItemBtn: "เก็บไว้",
      reasonRequired: "กรุณาระบุเหตุผล",
      itemCancelledToast: "ยกเลิกรายการแล้ว",
      itemAddedToast: "เพิ่มรายการแล้ว",
      voidUnitTitle: "ยกเลิก 1 หน่วย?",
      voidUnitDescription: (name: string) => `ยกเลิก 1 หน่วยของ “${name}” (ต้องระบุเหตุผลเพื่อเก็บประวัติ)`,
      decreaseQty: "ลดจำนวน",
      increaseQty: "เพิ่มจำนวน",
      notServed: "ยังไม่เสิร์ฟ",
      undeliveredWarn: "มีรายการที่ยังไม่ได้เสิร์ฟ — ยกเลิก (ครัวทำไม่ทัน) หรือรอครัวก่อนชำระเงิน",
      closeEmptyTable: "ปิดโต๊ะ",
      closeEmptyTableTitle: "ปิดโต๊ะที่เปิดผิด?",
      closeEmptyTableBody: "โต๊ะนี้ยังไม่มีรายการอาหาร ระบบจะไม่บันทึกออเดอร์ว่างนี้ (ไม่ขึ้นในประวัติ) และเปลี่ยนโต๊ะกลับเป็นว่าง",
      keepTableOpen: "เปิดโต๊ะไว้",
      tableClosed: "ปิดโต๊ะแล้ว",
      remove: "ลบ",
      total: "ยอดรวม",
      loadError: "โหลดออเดอร์ไม่สำเร็จ",
      saveError: "ทำรายการไม่สำเร็จ",
      noMenu: "ยังไม่มีเมนู",
      soldOut: "หมด",
      lowStockLeft: "เหลือ",
      servingUnit: "ที่",
      leftToast: (n: number, name: string) => `${name} เหลืออีก ${n} ที่`,
      soldOutToast: (name: string) => `${name} หมดแล้ว`,
    }
    : {
      denied: "You do not have permission to take orders.",
      back: "Back to tables",
      search: "Search menu",
      all: "All",
      category: "Category",
      tableLabel: "Table",
      orderLabel: "Order",
      itemsLabel: "Items",
      add: "Add",
      options: "Options",
      requiredOption: "Required",
      chooseRequiredOptions: "Choose required options before adding.",
      quantity: "Qty",
      note: "Note",
      pending: "Pending",
      cooking: "Cooking",
      ready: "Done",
      served: "Done",
      sent_to_kitchen: "Sent",
      open: "Open",
      completed: "Completed",
      cancelled: "Cancelled",
      cart: "Order items",
      emptyCart: "No items yet",
      sendKitchen: "Send to Kitchen",
      close: "Bill / Pay",
      bill: "Bill",
      service: "Service charge",
      vat: "VAT",
      grandTotal: "Grand total",
      cash: "Cash",
      qr: "QR PromptPay",
      print: "Print bill",
      confirmPayment: "Confirm payment",
      paymentMethod: "Payment method",
      allItems: "All items",
      editItems: "Edit items",
      doneEditing: "Done",
      addServed: "Add item (served)",
      backToBill: "Back to bill",
      requiresOptions: "Needs options — add from ordering screen",
      addServedHint: "Tap a menu item to add it as “served” (one each)",
      cancelItemTitle: "Void this item?",
      cancelItemReason: "Reason for voiding",
      cancelItemPlaceholder: "e.g. staff over-ordered",
      confirmCancelItem: "Void item",
      keepItemBtn: "Keep",
      reasonRequired: "Enter a reason",
      itemCancelledToast: "Item voided",
      itemAddedToast: "Item added",
      voidUnitTitle: "Void one unit?",
      voidUnitDescription: (name: string) => `Void 1 unit of “${name}” (reason required for the record)`,
      decreaseQty: "Decrease quantity",
      increaseQty: "Increase quantity",
      notServed: "Not served",
      undeliveredWarn: "Some items haven't been served — void them (kitchen too slow) or wait before payment.",
      closeEmptyTable: "Close table",
      closeEmptyTableTitle: "Close this table opened by mistake?",
      closeEmptyTableBody: "This table has no items. The empty order won't be recorded (it won't appear in the archive) and the table becomes available again.",
      keepTableOpen: "Keep table open",
      tableClosed: "Table closed",
      remove: "Remove",
      total: "Total",
      loadError: "Could not load order.",
      saveError: "Could not complete the action.",
      noMenu: "No menu items.",
      soldOut: "Sold out",
      lowStockLeft: "Only",
      servingUnit: "left",
      leftToast: (n: number, name: string) => `Only ${n} left for ${name}`,
      soldOutToast: (name: string) => `${name} is sold out`,
    };

  const paidToastTitle = language === "th" ? "รับเงินเรียบร้อยแล้ว" : "Payment recorded";
  const receiptCopy = language === "th"
    ? {
      printReceipt: "พิมพ์ใบเสร็จให้ลูกค้า",
      paymentComplete: "รับเงินเรียบร้อย",
      paymentCompleteHint: "พิมพ์ใบเสร็จส่งมอบให้ลูกค้าได้เลย",
    }
    : {
      printReceipt: "Print customer receipt",
      paymentComplete: "Payment recorded",
      paymentCompleteHint: "Print the receipt and hand it to the customer.",
    };
  const orderSummaryCopy = language === "th"
    ? {
      title: "สรุปคำสั่งซื้อ",
      empty: "ยังไม่มีรายการในคำสั่งซื้อนี้",
      close: "ปิด",
    }
    : {
      title: "Order summary",
      empty: "There are no items in this order.",
      close: "Close",
    };
  const currentRoundCopy = language === "th"
    ? {
      title: "รายการรอบนี้",
      basket: "ตะกร้า",
      open: "ดูรายการรอบนี้",
      empty: "ยังไม่มีรายการรอส่งเข้าครัว",
      close: "ปิด",
    }
    : {
      title: "Current round",
      basket: "Cart",
      open: "Review current round",
      empty: "No items are waiting to be sent to the kitchen.",
      close: "Close",
    };

  const fulfillmentTitle = language === "th" ? "รูปแบบรายการ" : "Item type";
  const dineInItemLabel = fulfillmentLabel("dine_in", language);
  const takeawayItemLabel = fulfillmentLabel("takeaway", language);
  const optionLimitLabel = (selected: number, minSelect: number, maxSelect: number) => {
    if (maxSelect <= 1) return selected ? (language === "th" ? "เลือกแล้ว" : "Selected") : (language === "th" ? "เลือก 1 อย่าง" : "Choose 1");
    const range = minSelect > 0 && minSelect !== maxSelect ? `${minSelect}-${maxSelect}` : String(maxSelect);
    return language === "th" ? `เลือก ${selected}/${range}` : `${selected}/${range} selected`;
  };
  const isTerminal = order ? terminalStatuses.includes(order.status) : true;
  const pendingItems = useMemo(() => (order?.items ?? []).filter((item) => item.status === "pending"), [order?.items]);
  const pendingItemCount = pendingItems.reduce((sum, item) => sum + item.quantity, 0);
  const pendingGroupedOrderItems = useMemo(() => groupOrderItems(pendingItems), [pendingItems]);
  const pendingFulfillmentSections = useMemo(() => fulfillmentSections(pendingGroupedOrderItems), [pendingGroupedOrderItems]);
  const activeOrderItems = useMemo(() => (order?.items ?? []).filter((item) => item.status !== "cancelled"), [order?.items]);
  const orderSummaryGroups = useMemo(() => groupOrderItems(activeOrderItems), [activeOrderItems]);
  const orderSummarySections = useMemo(() => fulfillmentSections(orderSummaryGroups), [orderSummaryGroups]);
  const pendingFulfillmentSummary = useMemo(() => ({
    quantity: pendingFulfillmentSections.reduce((sum, section) => sum + section.quantity, 0),
    subtotal: pendingFulfillmentSections.reduce((sum, section) => sum + section.subtotal, 0),
  }), [pendingFulfillmentSections]);
  const showCurrentRoundAction = pendingItemCount > 0 && !isTerminal;
  const menuOrderQuantities = useMemo(() => {
    const quantities = new Map<number, number>();
    for (const item of order?.items ?? []) {
      if (item.status !== "pending") continue;
      quantities.set(item.menu_id, (quantities.get(item.menu_id) ?? 0) + item.quantity);
    }
    return quantities;
  }, [order?.items]);
  const menuImageById = useMemo(() => new Map(menuItems.map((item) => [item.ID, item.image_url])), [menuItems]);
  const orderItemImageUrl = (item: OrderItem) => item.menu?.image_url || menuImageById.get(item.menu_id) || "/menu-placeholder-v2.webp";

  const filteredMenu = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (categoryId !== "all" && !menuCategoryIds(item).includes(categoryId)) return false;
      if (keyword && !item.name.toLowerCase().includes(keyword)) return false;
      // Sold-out items stay in the grid (shown as "sold out"); they are not filtered out.
      return true;
    });
  }, [categoryId, menuItems, search]);
  const categoryOptions = useMemo(() => [
    { value: "all", label: copy.all },
    ...categories.map((category) => ({ value: String(category.ID), label: category.name })),
  ], [categories, copy.all]);
  const selectedOptionsTotal = selectedMenu?.option_groups?.reduce((sum, group) => {
    const selected = (group.options ?? []).filter((option) => selectedOptionIds.includes(option.ID));
    return sum + selected.reduce((optionSum, option) => optionSum + option.price_delta, 0);
  }, 0) ?? 0;
  const requiredOptionsMissing = Boolean(selectedMenu?.option_groups?.some((group) => {
    if (!group.is_active) return false;
    const { minSelect } = menuOptionLimits(group);
    if (minSelect <= 0) return false;
    const selectedCount = (group.options ?? []).filter((option) => option.is_active && selectedOptionIds.includes(option.ID)).length;
    return selectedCount < minSelect;
  }));

  const openMenuPicker = (item: MenuItem) => {
    const defaultOptionIds = (item.option_groups ?? []).flatMap((group) => {
      const { maxSelect } = menuOptionLimits(group);
      return (group.options ?? [])
        .filter((option) => option.is_active && option.is_default)
        .slice(0, maxSelect)
        .map((option) => option.ID);
    });
    setSelectedMenuClosing(false);
    setSelectedMenu(item);
    setSelectedOptionIds(defaultOptionIds);
    setSelectedFulfillment(order?.order_type === "takeaway" ? "takeaway" : "dine_in");
    setQuantity(1);
    setNote("");
  };

  const closeMenuPicker = () => {
    if (selectedMenuClosing) return;
    setSelectedMenuClosing(true);
    window.setTimeout(() => {
      setSelectedMenu(null);
      setSelectedOptionIds([]);
      setSelectedFulfillment(order?.order_type === "takeaway" ? "takeaway" : "dine_in");
      setSelectedMenuClosing(false);
    }, 180);
  };

  const openOrderSummary = () => {
    setOrderSummaryClosing(false);
    setOrderSummaryOpen(true);
  };
  const closeOrderSummary = () => {
    if (orderSummaryClosing) return;
    setOrderSummaryClosing(true);
    window.setTimeout(() => {
      setOrderSummaryOpen(false);
      setOrderSummaryClosing(false);
    }, 180);
  };
  const openCurrentRound = () => {
    setCurrentRoundClosing(false);
    setCurrentRoundOpen(true);
  };
  const closeCurrentRound = () => {
    if (currentRoundClosing) return;
    setCurrentRoundClosing(true);
    window.setTimeout(() => {
      setCurrentRoundOpen(false);
      setCurrentRoundClosing(false);
    }, 180);
  };
  const menuPickerBackdrop = useBackdropClose(closeMenuPicker);
  const closeBillModal = () => {
    if (billViewClosing) return;
    setBillViewClosing(true);
    window.setTimeout(() => {
      setBillViewOpen(false);
      setBill(null);
      setPaymentComplete(false);
      setLastPayment(null);
      setBillViewClosing(false);
      setBillEditMode(false);
      setBillAddOpen(false);
      setBillCancelTarget(null);
      setBillCancelReason("");
    }, 180);
  };
  const paymentBackdrop = useBackdropClose(closeBillModal);
  const orderSummaryBackdrop = useBackdropClose(closeOrderSummary);
  const currentRoundBackdrop = useBackdropClose(closeCurrentRound);
  const modalScrollLocked = Boolean(selectedMenu || billViewOpen || orderSummaryOpen || currentRoundOpen);

  const toggleOption = (groupOptionIds: number[], optionId: number, minSelect: number, maxSelect: number) => {
    setSelectedOptionIds((current) => {
      const selectedInGroup = current.filter((id) => groupOptionIds.includes(id));
      const withoutGroup = current.filter((id) => !groupOptionIds.includes(id));
      if (selectedInGroup.includes(optionId)) {
        if (selectedInGroup.length <= minSelect) return current;
        return [...withoutGroup, ...selectedInGroup.filter((id) => id !== optionId)];
      }
      if (maxSelect <= 1) return [...withoutGroup, optionId];
      if (selectedInGroup.length >= maxSelect) return current;
      return [...withoutGroup, ...selectedInGroup, optionId];
    });
  };

  const load = async ({ background = false }: { background?: boolean } = {}) => {
    if (!canTake || !orderNumber) return;
    if (background && actionInFlightRef.current) return;
    if (!background) {
      setLoading(true);
      setError("");
    }
    try {
      const [orderRes, categoryRes, menuRes] = await Promise.all([getOrder(orderNumber), listCategories(), listMenuItems()]);
      if (background && actionInFlightRef.current) return;
      setOrder(orderRes.data);
      setCategories(categoryRes.data.categories.filter((category) => category.is_active));
      setMenuItems(menuRes.data.menu_items);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(loadTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canTake, orderNumber, order?.status]);
  const realtimeStatus = useOrderEvents(() => load({ background: true }), {
    enabled: canTake && Boolean(orderNumber) && !Boolean(order && terminalStatuses.includes(order.status)),
    restaurantId: activeMembership?.restaurant_id,
    eventFilter: { kind: "order", orderId: order?.ID },
  });
  useVisiblePolling(() => load({ background: true }), {
    enabled: canTake && Boolean(orderNumber) && !Boolean(order && terminalStatuses.includes(order.status)),
    intervalMs: 60_000,
    runImmediately: false,
  });

  useEffect(() => {
    if (!modalScrollLocked) return;

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const scrollKeys = new Set(["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);
    const isInsideModalScroll = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest("[data-pos-modal-scroll]"));
    const restoreScroll = () => {
      if (window.scrollX !== scrollX || window.scrollY !== scrollY) window.scrollTo(scrollX, scrollY);
    };
    const preventOutsideScroll = (event: WheelEvent | TouchEvent) => {
      if (!isInsideModalScroll(event.target)) event.preventDefault();
    };
    const preventOutsideKeyScroll = (event: KeyboardEvent) => {
      if (scrollKeys.has(event.key) && !isInsideModalScroll(event.target)) event.preventDefault();
    };

    window.addEventListener("scroll", restoreScroll, { passive: true });
    document.addEventListener("wheel", preventOutsideScroll, { capture: true, passive: false });
    document.addEventListener("touchmove", preventOutsideScroll, { capture: true, passive: false });
    document.addEventListener("keydown", preventOutsideKeyScroll, { capture: true });

    return () => {
      window.removeEventListener("scroll", restoreScroll);
      document.removeEventListener("wheel", preventOutsideScroll, { capture: true });
      document.removeEventListener("touchmove", preventOutsideScroll, { capture: true });
      document.removeEventListener("keydown", preventOutsideKeyScroll, { capture: true });
      window.scrollTo(scrollX, scrollY);
    };
  }, [modalScrollLocked]);

  // The backend rejects an over-order with "only N left for <menu>" or
  // "<menu> is sold out" (ensureMenuCapacity). Surface those as a warning toast
  // with a localized message instead of the inline error banner, using the menu
  // name we already know on the client (so we never parse Thai names out of the
  // English backend string). Returns true when it handled the error as a toast.
  const notifyCapacityError = (error: unknown, menuName: string): boolean => {
    const raw = apiErrorMessage(error);
    if (!raw) return false;
    const leftMatch = raw.match(/only\s+(\d+)\s+left/i);
    if (leftMatch) {
      showToast({ tone: "warning", title: copy.leftToast(Number(leftMatch[1]), menuName) });
      return true;
    }
    if (/sold out/i.test(raw)) {
      showToast({ tone: "warning", title: copy.soldOutToast(menuName) });
      return true;
    }
    return false;
  };

  const runAction = async (action: () => Promise<Order>, options?: { capacityMenuName?: string }) => {
    setSubmitting(true);
    actionInFlightRef.current = true;
    setError("");
    try {
      const next = await action();
      setOrder(next);
    } catch (error) {
      const capacityName = options?.capacityMenuName;
      // A capacity rejection becomes a toast; anything else stays in the inline banner.
      if (!capacityName || !notifyCapacityError(error, capacityName)) {
        setError(apiErrorMessage(error) || copy.saveError);
      }
    } finally {
      actionInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const addSelectedMenu = async () => {
    if (!selectedMenu || !order) return;
    if (requiredOptionsMissing) {
      setError(copy.chooseRequiredOptions);
      return;
    }
    await runAction(async () => {
      const res = await addOrderItem(order.ID, { menu_id: selectedMenu.ID, quantity, note, fulfillment_type: selectedFulfillment, selected_option_ids: selectedOptionIds });
      closeMenuPicker();
      setQuantity(1);
      setNote("");
      setSelectedFulfillment(order.order_type === "takeaway" ? "takeaway" : "dine_in");
      return res.data;
    }, { capacityMenuName: selectedMenu.name });
  };

  const requestCloseEmptyTable = async () => {
    if (!order || !canCloseEmptyTableOrder(order)) return;
    const confirmed = await confirm({
      title: copy.closeEmptyTableTitle,
      message: copy.closeEmptyTableBody,
      confirmLabel: copy.closeEmptyTable,
      cancelLabel: copy.keepTableOpen,
      tone: "warning",
    });
    if (!confirmed) return;

    setSubmitting(true);
    actionInFlightRef.current = true;
    setError("");
    try {
      await closeEmptyTableOrder(order.ID);
      showToast({ title: copy.tableClosed });
      router.replace("/pos/tables");
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      actionInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const sendToKitchen = async () => {
    if (!order || pendingItemCount === 0) return;
    await runAction(async () => {
      const res = await sendOrderToKitchen(order.ID);
      showToast({ title: language === "th" ? "ส่งเข้าครัวแล้ว" : "Sent to kitchen" });
      closeCurrentRound();
      return res.data;
    });
  };

  const adjustPendingGroup = async (group: OrderItemGroup, delta: -1 | 1) => {
    if (!order || !group.pendingItems.length) return;
    const item = group.pendingItems[0];
    // Only a quantity increase can exceed capacity; a decrease never does.
    await runAction(async () => {
      if (delta < 0 && item.quantity === 1) {
        return (await deleteOrderItem(order.ID, item.ID)).data;
      }
      return (await updateOrderItem(order.ID, item.ID, {
        quantity: item.quantity + delta,
        note: item.note,
      })).data;
    }, delta > 0 ? { capacityMenuName: item.menu_name } : undefined);
  };

  const renderOrderItemGroup = (group: OrderItemGroup, variant: "card" | "row" = "card", allowQuantityAdjustment = true) => {
    const item = group.firstItem;
    const canAdjustQuantity = allowQuantityAdjustment && group.pendingItems.length === group.items.length;

    return (
      <div key={group.key} className={variant === "row" ? "bg-white px-3 py-3.5 dark:bg-gray-900 sm:px-4" : "rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900"}>
        <div className={variant === "row" ? "grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto]" : "grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"}>
          {variant === "row" ? (
            <div
              role="img"
              aria-label={`${language === "th" ? "รูปเมนู" : "Menu image"} ${item.menu_name}`}
              className="h-14 w-14 shrink-0 rounded-md bg-transparent bg-contain bg-center bg-no-repeat sm:h-16 sm:w-16"
              style={{ backgroundImage: `url(${orderItemImageUrl(item)})` }}
            />
          ) : null}
          <div className="min-w-0">
            <p className="min-w-0 text-[14px] font-semibold text-gray-900 dark:text-white">{item.menu_name}</p>
            {item.selected_options?.length ? <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-gray-400">{item.selected_options.map((option) => `${option.group_name}: ${option.option_name}`).join(" · ")}</p> : null}
            {item.note ? <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{item.note}</p> : null}
          </div>
          <div className={variant === "row" ? `flex shrink-0 justify-end text-right ${canAdjustQuantity ? "flex-col items-end gap-2" : "items-baseline gap-2"}` : "flex flex-wrap items-center gap-2 sm:justify-end"}>
            <p data-order-price className={`${variant === "row" ? "" : "mr-auto sm:mr-0"} font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-white`}>฿{group.subtotal.toLocaleString()}</p>
            {canAdjustQuantity ? (
              <div className="inline-grid grid-cols-[2.25rem_2.5rem_2.25rem] overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                <button type="button" disabled={submitting} onClick={() => { void adjustPendingGroup(group, -1); }} aria-label={group.quantity === 1 ? (language === "th" ? "ลบรายการ" : "Remove item") : (language === "th" ? "ลดจำนวน" : "Decrease quantity")} className="ui-press inline-flex h-9 items-center justify-center border-r border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Minus className="h-4 w-4" aria-hidden="true" /></button>
                <span className="inline-flex h-9 items-center justify-center font-mono text-[13px] font-semibold tabular-nums text-gray-900 dark:text-white">{group.quantity}</span>
                <button type="button" disabled={submitting} onClick={() => { void adjustPendingGroup(group, 1); }} aria-label={language === "th" ? "เพิ่มจำนวน" : "Increase quantity"} className="ui-press inline-flex h-9 items-center justify-center border-l border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Plus className="h-4 w-4" aria-hidden="true" /></button>
              </div>
            ) : <span className="font-mono text-[12px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">x{group.quantity}</span>}
          </div>
        </div>
      </div>
    );
  };
  const renderFlatFulfillmentSection = (section: FulfillmentSection, showLabel: boolean, allowQuantityAdjustment: boolean) => (
    <section key={section.key}>
      {showLabel ? <div className="border-y border-gray-100 bg-gray-50 px-4 py-2 text-[12px] font-semibold text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200">{fulfillmentLabel(section.key, language)}</div> : null}
      <div className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900">
        {section.groups.map((group) => renderOrderItemGroup(group, "row", allowQuantityAdjustment))}
      </div>
    </section>
  );

  const loadBill = async () => {
    if (!order) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await getOrderBill(order.ID);
      const latestPayment = res.data.payments.at(-1) ?? null;
      setBill(res.data);
      setPaymentMethod(latestPayment?.method ?? "cash");
      setPaymentComplete(res.data.payment_status === "paid");
      setLastPayment(latestPayment);
      setBillViewClosing(false);
      setBillViewOpen(true);
      // If the kitchen is still working on some items (e.g. it ran too long and
      // the guest wants to leave), open straight into edit mode so the cashier
      // can void the undelivered lines before charging for what was served.
      const undelivered = res.data.items.filter((it) => it.status === "pending" || it.status === "cooking").length;
      setBillEditMode(undelivered > 0);
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const hasRequiredOptions = (item: MenuItem) =>
    (item.option_groups ?? []).some((group) => menuOptionLimits(group).minSelect > 0);

  // Re-fetch the bill (and refresh the order in the background) after an in-bill
  // edit so the totals and item list stay in sync without reopening the modal.
  const reloadBill = async () => {
    if (!order) return;
    try {
      const res = await getOrderBill(order.ID);
      setBill(res.data);
      setPaymentComplete(res.data.payment_status === "paid");
      setLastPayment(res.data.payments.at(-1) ?? null);
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
    }
  };

  const addServedItem = async (item: MenuItem) => {
    if (!order || submitting || hasRequiredOptions(item)) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await addOrderItem(order.ID, {
        menu_id: item.ID,
        quantity: 1,
        serve_immediately: true,
        fulfillment_type: order.order_type === "takeaway" ? "takeaway" : "dine_in",
      });
      setOrder(response.data);
      await reloadBill();
      showToast({ title: copy.itemAddedToast });
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  // A bill group can be all pending (not yet sent to kitchen) or already
  // served/cooking. Pending lines are edited freely; served lines can only be
  // voided (with a reason), so the stepper routes decreases accordingly.
  const isPendingOnlyGroup = (group: OrderItemGroup) =>
    group.items.length > 0 && group.items.every((it) => it.status === "pending");

  const adjustBillPendingGroup = async (group: OrderItemGroup, delta: -1 | 1) => {
    if (!order || submitting) return;
    const item = group.pendingItems[0] ?? group.firstItem;
    setSubmitting(true);
    setError("");
    try {
      if (delta < 0 && item.quantity === 1) {
        await deleteOrderItem(order.ID, item.ID);
      } else {
        await updateOrderItem(order.ID, item.ID, { quantity: item.quantity + delta, note: item.note });
      }
      await reloadBill();
      void load({ background: true });
    } catch (error) {
      if (!(delta > 0 && notifyCapacityError(error, item.menu_name))) {
        setError(apiErrorMessage(error) || copy.saveError);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const addServedUnit = async (group: OrderItemGroup) => {
    if (!order || submitting) return;
    const item = group.firstItem;
    setSubmitting(true);
    setError("");
    try {
      const response = await addOrderItem(order.ID, {
        menu_id: item.menu_id,
        quantity: 1,
        note: item.note,
        serve_immediately: true,
        fulfillment_type: item.fulfillment_type ?? (order.order_type === "takeaway" ? "takeaway" : "dine_in"),
        selected_option_ids: item.selected_options?.map((option) => option.menu_option_id) ?? [],
      });
      setOrder(response.data);
      await reloadBill();
      showToast({ title: copy.itemAddedToast });
    } catch (error) {
      if (!notifyCapacityError(error, item.menu_name)) {
        setError(apiErrorMessage(error) || copy.saveError);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const decreaseBillGroup = (group: OrderItemGroup) => {
    if (submitting) return;
    if (isPendingOnlyGroup(group)) {
      void adjustBillPendingGroup(group, -1);
      return;
    }
    // Removing a served/cooking unit at checkout is a void — capture a reason.
    setError("");
    setBillCancelReason("");
    setBillCancelMode("unit");
    setBillCancelTarget(group);
  };

  const increaseBillGroup = (group: OrderItemGroup) => {
    if (submitting) return;
    if (isPendingOnlyGroup(group)) {
      void adjustBillPendingGroup(group, 1);
      return;
    }
    void addServedUnit(group);
  };

  const confirmCancelBillItem = async () => {
    if (!order || !billCancelTarget || submitting) return;
    const reason = billCancelReason.trim();
    if (!reason) {
      setError(copy.reasonRequired);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (billCancelMode === "unit") {
        await voidOrderItemUnits(order.ID, billCancelTarget.firstItem.ID, 1, reason);
      } else {
        const targets = billCancelTarget.items.filter((it) => it.status !== "cancelled");
        for (const target of targets) {
          await updateOrderItemStatus(order.ID, target.ID, "cancelled", reason);
        }
      }
      setBillCancelTarget(null);
      setBillCancelReason("");
      setBillCancelMode("line");
      await reloadBill();
      void load({ background: true });
      showToast({ title: copy.itemCancelledToast });
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const confirmPayment = async () => {
    if (!order || !bill) return;
    setSubmitting(true);
    actionInFlightRef.current = true;
    setError("");
    try {
      await payOrder(order.ID, {
        method: paymentMethod,
        received_amount: bill.grand_total,
      });
      showToast({ title: paidToastTitle });
      // Payment is done: drop this order page from history and return to the
      // floor. The receipt can still be reprinted from the order archive.
      router.replace("/pos/tables");
    } catch (error) {
      setError(apiErrorMessage(error) || copy.saveError);
      actionInFlightRef.current = false;
      setSubmitting(false);
    }
  };

  const orderItemCount = activeOrderItems.reduce((sum, item) => sum + item.quantity, 0);
  const canCloseTable = order ? canCloseEmptyTableOrder(order) : false;





  const posHeaderSpacerClass = error ? "h-[152px] lg:hidden" : "h-[102px] lg:hidden";

  if (!canTake) return <PermissionDenied title={copy.denied} />;

  return (
    <div className={`min-h-dvh w-full bg-slate-100 text-gray-900 dark:bg-gray-950 dark:text-gray-100 ${showCurrentRoundAction ? "pb-24" : "pb-6"}`}>
      <div data-shell-sticky="" className="fixed inset-x-0 top-14 z-20 bg-slate-100/95 backdrop-blur dark:bg-gray-950/95 transition-[left] duration-300 ease-in-out lg:inset-auto">
        <div className="px-4 py-2 sm:px-6 lg:px-8">
          <div className="grid w-full gap-1.5 lg:h-[var(--dashboard-shell-row)] lg:min-h-[var(--dashboard-shell-row)] lg:grid-cols-[2.5rem_minmax(10rem,20rem)_minmax(8rem,10rem)_minmax(0,1fr)_auto] lg:items-center">
          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-1.5 lg:contents">
            <button type="button" onClick={() => router.push("/pos/tables")} aria-label={copy.back} title={copy.back} className="ui-press inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white text-gray-600 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] transition-[border-color,background-color] hover:border-[#d6dbe2] hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-[#2c3848] dark:hover:bg-gray-800 lg:order-1">
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            {order && (
              <div className="flex min-w-0 items-center justify-start gap-1.5 lg:order-5">
                <button type="button" onClick={openOrderSummary} aria-label={orderSummaryCopy.title} aria-haspopup="dialog" className="ui-press flex h-10 min-w-0 flex-[0_1_auto] items-center overflow-hidden rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white text-left text-[13px] font-semibold text-gray-700 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] transition-[border-color,background-color] hover:border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-200 dark:hover:border-[#2c3848] dark:hover:bg-gray-800">
                  <span className="flex min-w-0 items-center gap-1.5 px-2">
                    <MapPin className="h-3.5 w-3.5 shrink-0 text-orange-500" aria-hidden="true" />
                    <span className="hidden xl:inline">{copy.tableLabel}</span>
                    <span className="truncate">{orderLocationLabel(order, language)}</span>
                  </span>
                  <span className="h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
                  <span className="flex min-w-0 items-center gap-1.5 px-2">
                    <ReceiptText className="h-3.5 w-3.5 shrink-0 text-gray-500" aria-hidden="true" />
                    <span className="hidden xl:inline">{copy.orderLabel}</span>
                    <span className="truncate">{order.order_number}</span>
                  </span>
                  <span className="h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-800" aria-hidden="true" />
                  <span className="flex shrink-0 items-center gap-1.5 px-2">
                    <UtensilsCrossed className="h-3.5 w-3.5 text-gray-500" aria-hidden="true" />
                    <span className="font-mono tabular-nums">{orderItemCount}</span>
                    <span>{copy.itemsLabel}</span>
                  </span>
                </button>
                {canCloseTable ? (
                  <button type="button" disabled={submitting} onClick={() => { void requestCloseEmptyTable(); }} className="ui-press h-10 shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 text-[13px] font-semibold text-red-700 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] transition-[border-color,background-color,opacity] hover:border-red-300 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:border-red-800 dark:hover:bg-red-950/50">
                    {copy.closeEmptyTable}
                  </button>
                ) : null}
                {pendingItemCount === 0 && !isTerminal && activeOrderItems.length > 0 ? (
                  <button type="button" disabled={submitting} onClick={() => { void loadBill(); }} className="ui-press inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-orange-700 px-3 text-[13px] font-semibold text-white shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] transition-[background-color,opacity] hover:bg-orange-800 disabled:opacity-50 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800">
                    <WalletCards className="h-4 w-4" aria-hidden="true" />
                    {copy.close}
                  </button>
                ) : null}
              </div>
            )}
          </div>
          {order && (
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(7.5rem,10rem)] gap-1.5 lg:contents">
              <div className="relative min-w-0 lg:order-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" aria-hidden="true" />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} aria-label={copy.search} className="h-10 w-full min-w-0 rounded-xl border border-[color:var(--dashboard-shell-border)] bg-white pl-7 pr-3 text-[15px] outline-none focus:border-orange-500 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] placeholder:text-[15px] dark:bg-gray-800" />
              </div>
              <ThemedSelect
                aria-label={copy.category}
                className="lg:order-3"
                triggerClassName="rounded-xl shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)]"
                value={categoryId === "all" ? "all" : String(categoryId)}
                onChange={(next) => setCategoryId(next === "all" ? "all" : Number(next))}
                options={categoryOptions}
              />
            </div>
          )}
          <div aria-hidden="true" className="hidden lg:order-4 lg:block" />
          </div>
        </div>
        {error ? (
          <div className="w-full px-4 py-2 sm:px-6 lg:px-8">
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</div>
          </div>
        ) : null}
      </div>
      <div aria-hidden="true" className={posHeaderSpacerClass} />

      {realtimeStatus === "reconnecting" ? (
        <div className="px-3 pt-3 sm:px-4 lg:px-5">
          <RealtimeConnectionNotice language={language} status={realtimeStatus} />
        </div>
      ) : null}

      {loading && !order ? (
        <div className="grid gap-4 px-3 py-4 sm:px-4 lg:px-5">
          <Skeleton className="h-[520px]" />
        </div>
      ) : order ? (
        // ── Menu grid (normal order-taking mode) ─────────────────────────────
        <div className="w-full px-4 py-3 sm:px-6 lg:px-8">
          <section className="min-w-0">
            <div className={MENU_CARD_GRID_CLASS}>
              {filteredMenu.length ? filteredMenu.map((item) => {
                const orderedQuantity = menuOrderQuantities.get(item.ID) ?? 0;
                // remaining_servings === 0 means the queue already claimed the last
                // portion, so block ordering even before the kitchen cooks it.
                const soldOut = !item.is_available || item.remaining_servings === 0;
                const lowStock = !soldOut && typeof item.remaining_servings === "number" && item.remaining_servings > 0 && item.remaining_servings <= 10;

                return (
                  <button key={item.ID} type="button" disabled={isTerminal || submitting || soldOut} onClick={() => openMenuPicker(item)} className={`ui-press ${MENU_CARD_SHELL_CLASS} disabled:cursor-not-allowed disabled:opacity-50 sm:hover:-translate-y-0.5`}>
                    {soldOut ? (
                      <span className="absolute left-2 top-2 z-10 rounded-md bg-gray-900/85 px-2 py-1 text-[11px] font-semibold text-white shadow-md dark:bg-gray-100/90 dark:text-gray-900">
                        {copy.soldOut}
                      </span>
                    ) : lowStock ? (
                      <span className="absolute left-2 top-2 z-10 rounded-md bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white shadow-md dark:bg-amber-400 dark:text-gray-950">
                        {copy.lowStockLeft} {item.remaining_servings} {copy.servingUnit}
                      </span>
                    ) : null}
                    {orderedQuantity > 0 && (
                      <span className="absolute right-2 top-2 z-10 rounded-md bg-orange-500 px-2 py-1 text-[11px] font-semibold text-white shadow-md shadow-orange-950/10 dark:bg-orange-400 dark:text-orange-950 dark:shadow-black/30">
                        x{orderedQuantity}
                      </span>
                    )}
                    <div
                      className="aspect-square w-full shrink-0 bg-transparent bg-cover bg-center"
                      style={{ backgroundImage: `url(${item.image_url || "/menu-placeholder-v2.webp"})` }}
                      aria-label={item.image_url ? `${language === "th" ? "รูปเมนู" : "Menu image"} ${item.name}` : undefined}
                    />
                    <div className="flex min-w-0 flex-1 flex-col p-3">
                      <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{item.name}</p>
                      <p className="mt-0.5 font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-white">฿{item.price.toLocaleString()}</p>
                    </div>
                  </button>
                );
              }) : (
                <div className="col-span-full px-4 py-12 text-center text-[13px] text-gray-500">{copy.noMenu}</div>
              )}
            </div>
          </section>

        </div>
      ) : null}



      {showCurrentRoundAction ? (
        <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+1.5rem)] z-30 lg:left-[calc(var(--sidebar-w)+0.75rem)]">
          <button
            type="button"
            onClick={openCurrentRound}
            disabled={submitting}
            aria-label={currentRoundCopy.open}
            aria-haspopup="dialog"
              className="ui-press mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-4 rounded-lg border border-orange-800 bg-orange-700 px-4 text-white shadow-md transition-[border-color,background-color,color,opacity] hover:bg-orange-800 disabled:opacity-50 dark:border-orange-600 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-600"
          >
            <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
              <ShoppingBasket className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="truncate">{currentRoundCopy.basket} · <span className="font-mono tabular-nums">{pendingItemCount}</span> {copy.itemsLabel}</span>
            </span>
            <span className="shrink-0 font-mono text-[17px] font-semibold tabular-nums">฿{pendingFulfillmentSummary.subtotal.toLocaleString()}</span>
          </button>
        </div>
      ) : null}

      {selectedMenu && (
        <div {...menuPickerBackdrop} className={`${selectedMenuClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-sm sm:p-4`}>
          <div className={`${selectedMenuClosing ? "motion-dialog-exit" : "motion-dialog"} flex max-h-[calc(100vh-1.5rem)] w-full max-w-sm flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900 sm:max-h-[calc(100vh-2rem)]`}>
            <div className="relative aspect-square w-full rounded-t-md bg-transparent bg-cover bg-center" style={{ backgroundImage: `url(${selectedMenu.image_url || "/menu-placeholder-v2.webp"})` }}>
              <button type="button" aria-label={language === "th" ? "ปิด" : "Close"} onClick={closeMenuPicker} className="ui-press absolute left-3 top-3 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/70 bg-white/95 text-gray-700 shadow-md shadow-gray-950/15 hover:bg-white dark:border-gray-700 dark:bg-gray-900/90 dark:text-gray-200 dark:shadow-black/30">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                <h2 className="min-w-0 text-[15px] font-semibold text-gray-900 dark:text-white">{selectedMenu.name}</h2>
                <p className="shrink-0 text-right font-mono text-[16px] font-semibold tabular-nums">฿{(selectedMenu.price + selectedOptionsTotal).toLocaleString()}</p>
              </div>
            </div>
            <div data-pos-modal-scroll className="space-y-3 overflow-y-auto p-4">
              {selectedMenu.option_groups?.length ? (
                <div className="space-y-3">
                  {selectedMenu.option_groups.filter((group) => group.is_active).map((group) => {
                    const options = (group.options ?? []).filter((option) => option.is_active);
                    const { minSelect, maxSelect } = menuOptionLimits(group);
                    const selectedCount = options.filter((option) => selectedOptionIds.includes(option.ID)).length;
                    return (
                      <div key={group.ID}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium text-gray-700 dark:text-gray-300">{group.name}</span>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                              {optionLimitLabel(selectedCount, minSelect, maxSelect)}
                            </span>
                            {group.required && <span className="rounded-md bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700 dark:bg-orange-900/20 dark:text-orange-300">{copy.requiredOption}</span>}
                          </div>
                        </div>
                        <div className="grid gap-2">
                          {options.map((option) => {
                            const selected = selectedOptionIds.includes(option.ID);
                            const limitReached = maxSelect > 1 && selectedCount >= maxSelect && !selected;
                            return (
                              <button key={option.ID} type="button" disabled={limitReached} aria-pressed={selected} onClick={() => toggleOption(options.map((current) => current.ID), option.ID, minSelect, maxSelect)} className={`grid min-h-10 grid-cols-[1fr_auto] items-center gap-2 rounded-md border px-3 text-left text-[12px] disabled:cursor-not-allowed disabled:opacity-50 ${selected ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900" : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"}`}>
                                <span>{option.name}</span>
                                <span className="font-mono tabular-nums">{option.price_delta ? `+฿${option.price_delta.toLocaleString()}` : ""}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.quantity}</span>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQuantity((current) => Math.max(1, current - 1))} className="h-10 w-10 rounded-md border border-gray-200 text-lg font-semibold dark:border-gray-800">-</button>
                  <input type="number" min={1} value={quantity} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} className="h-10 min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-3 text-center text-[13px] dark:border-gray-700 dark:bg-gray-800" />
                  <button type="button" onClick={() => setQuantity((current) => current + 1)} className="h-10 w-10 rounded-md border border-gray-200 text-lg font-semibold dark:border-gray-800">+</button>
                </div>
              </label>
              <div>
                <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{fulfillmentTitle}</span>
                <div className="grid grid-cols-2 gap-2">
                  {(["dine_in", "takeaway"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSelectedFulfillment(value)}
                      className={`h-10 rounded-md border px-3 text-[12px] font-semibold transition-colors ${selectedFulfillment === value
                          ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                          : "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
                        }`}
                    >
                      {value === "takeaway" ? takeawayItemLabel : dineInItemLabel}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.note}</span>
                <textarea value={note} onChange={(event) => setNote(event.target.value)} className="min-h-20 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[13px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800" />
              </label>
            </div>
            <div className="border-t border-gray-200 px-4 py-3 dark:border-gray-800">
              <button type="button" disabled={submitting || requiredOptionsMissing} onClick={addSelectedMenu} className="ui-press h-11 w-full rounded-md bg-orange-700 px-3 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:opacity-50 dark:bg-orange-700 dark:text-white">
                {copy.add}
              </button>
            </div>
          </div>
        </div>
      )}
      {orderSummaryOpen && order && (
        <div {...orderSummaryBackdrop} className={`${orderSummaryClosing ? "motion-overlay-exit" : "motion-overlay"} fixed left-0 top-0 z-50 h-dvh w-dvw max-w-full bg-gray-950/55`}>
            <div role="dialog" aria-modal="true" aria-labelledby="order-summary-title" className={`${orderSummaryClosing ? "motion-dialog-exit" : "motion-dialog"} absolute inset-3 m-auto flex h-fit max-h-[calc(100dvh-1.5rem)] w-[calc(100dvw-1.5rem)] max-w-3xl flex-col overflow-hidden rounded-md bg-transparent shadow-lg shadow-black/20 sm:max-h-[calc(100dvh-2rem)]`}>
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-sky-800 bg-sky-700 pl-4 pr-2.5 dark:border-sky-600 dark:bg-sky-700 sm:pl-5">
                <h2 id="order-summary-title" className="truncate text-[16px] font-semibold text-white">{orderSummaryCopy.title}</h2>
                <button
                  type="button"
                  onClick={closeOrderSummary}
                  aria-label={orderSummaryCopy.close}
                  title={orderSummaryCopy.close}
                  className="ui-press inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] text-white focus-visible:outline-none dark:text-white"
                >
                  <X className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
                </button>
              </div>
              <div data-pos-modal-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white dark:bg-gray-900">
                {orderSummaryGroups.length
                  ? orderSummarySections.map((section) => renderFlatFulfillmentSection(
                    section,
                    orderSummarySections.length > 1 || section.key === "takeaway" || order.order_type === "takeaway",
                    false,
                  ))
                  : <p className="px-4 py-12 text-center text-[13px] text-gray-500">{orderSummaryCopy.empty}</p>}
              </div>
              <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3.5 dark:border-gray-800 dark:bg-gray-900 sm:px-5">
                <div className="flex min-w-0 items-baseline justify-end gap-2 text-right">
                  <p className="text-[12px] font-semibold text-gray-500 dark:text-gray-400">{copy.total}</p>
                  <p className="font-mono text-[20px] font-extrabold tabular-nums text-gray-950 dark:text-white">฿{order.total_amount.toLocaleString()}</p>
                </div>
              </div>
          </div>
        </div>
      )}
      {currentRoundOpen && order && (
        <div {...currentRoundBackdrop} className={`${currentRoundClosing ? "motion-overlay-exit" : "motion-overlay"} fixed left-0 top-0 z-50 h-dvh w-dvw max-w-full bg-gray-950/55`}>
            <div role="dialog" aria-modal="true" aria-labelledby="current-round-title" className={`${currentRoundClosing ? "motion-dialog-exit" : "motion-dialog"} absolute inset-3 m-auto flex h-fit max-h-[calc(100dvh-1.5rem)] w-[calc(100dvw-1.5rem)] max-w-3xl flex-col overflow-hidden rounded-md bg-transparent shadow-lg shadow-black/20 sm:max-h-[calc(100dvh-2rem)]`}>
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-orange-800 bg-orange-700 pl-4 pr-2.5 dark:border-orange-600 dark:bg-orange-700 sm:pl-5">
                <h2 id="current-round-title" className="truncate text-[16px] font-semibold text-white">{currentRoundCopy.title}</h2>
                <button
                  type="button"
                  onClick={closeCurrentRound}
                  aria-label={currentRoundCopy.close}
                  title={currentRoundCopy.close}
                  className="ui-press inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[2px] text-white focus-visible:outline-none dark:text-white"
                >
                  <X className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
                </button>
              </div>
              <div data-pos-modal-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-white dark:bg-gray-900">
                {pendingGroupedOrderItems.length
                  ? pendingFulfillmentSections.map((section) => renderFlatFulfillmentSection(
                    section,
                    pendingFulfillmentSections.length > 1 || section.key === "takeaway" || order.order_type === "takeaway",
                    true,
                  ))
                  : <p className="px-4 py-12 text-center text-[13px] text-gray-500">{currentRoundCopy.empty}</p>}
              </div>
              <div className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 sm:px-5">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{copy.total}</p>
                    <p className="font-mono text-[18px] font-extrabold tabular-nums text-gray-950 dark:text-white">฿{pendingFulfillmentSummary.subtotal.toLocaleString()}</p>
                  </div>
                  <button type="button" disabled={submitting || isTerminal || pendingItemCount === 0} onClick={() => { void sendToKitchen(); }} className="ui-press inline-flex h-10 items-center gap-2 rounded-lg border border-orange-800 bg-orange-700 px-4 text-[13px] font-semibold text-white transition-[border-color,background-color,opacity] hover:bg-orange-800 disabled:opacity-50 dark:border-orange-600 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-600">
                    <span>{copy.sendKitchen}</span>
                    <ArrowRight className="h-4 w-4 shrink-0" strokeWidth={2.25} aria-hidden="true" />
                  </button>
                </div>
              </div>
          </div>
        </div>
      )}
      {billViewOpen && bill && (() => {
        const billGroups = groupOrderItems(bill.items.filter((it) => it.status !== "cancelled"));
        const billSections = fulfillmentSections(billGroups);
        const billItemCount = billGroups.reduce((sum, group) => sum + group.quantity, 0);
        const billUndelivered = bill.items.filter((it) => it.status === "pending" || it.status === "cooking").length;

        const renderBillGroup = (group: OrderItemGroup) => {
          const item = group.firstItem;
          return (
            <div data-bill-item key={group.key} className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
              <div className="grid grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[4rem_minmax(0,1fr)_auto]">
                <div
                  role="img"
                  aria-label={`${language === "th" ? "รูปเมนู" : "Menu image"} ${item.menu_name}`}
                  className="h-14 w-14 shrink-0 rounded-md bg-transparent bg-contain bg-center bg-no-repeat sm:h-16 sm:w-16"
                  style={{ backgroundImage: `url(${orderItemImageUrl(item)})` }}
                />
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-gray-900 dark:text-white">
                    {item.menu_name}
                    {group.items.some((entry) => entry.status === "pending" || entry.status === "cooking") ? (
                      <span data-screen-only className="ml-2 inline-flex items-center rounded-md bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{copy.notServed}</span>
                    ) : null}
                  </p>
                  {item.selected_options?.length ? <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400">{item.selected_options.map((option) => `${option.group_name}: ${option.option_name}`).join(" · ")}</p> : null}
                  {item.note ? <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{item.note}</p> : null}
                </div>
                <div className="text-right">
                  <p className="font-mono text-[15px] font-semibold tabular-nums text-gray-900 dark:text-white">฿{group.subtotal.toLocaleString()}</p>
                  <p className="mt-0.5 font-mono text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">x{group.quantity}</p>
                </div>
              </div>
              {billEditMode ? (
                <div data-screen-only className="mt-2 flex items-center justify-between gap-2 border-t border-dashed border-gray-200 pt-2 dark:border-gray-800">
                  <div className="inline-grid grid-cols-[2.5rem_2.75rem_2.5rem] overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
                    <button type="button" disabled={submitting} onClick={() => decreaseBillGroup(group)} aria-label={copy.decreaseQty} className="ui-press inline-flex h-9 items-center justify-center border-r border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Minus className="h-4 w-4" aria-hidden="true" /></button>
                    <span className="inline-flex h-9 items-center justify-center font-mono text-[13px] font-semibold tabular-nums text-gray-900 dark:text-white">{group.quantity}</span>
                    <button type="button" disabled={submitting} onClick={() => increaseBillGroup(group)} aria-label={copy.increaseQty} className="ui-press inline-flex h-9 items-center justify-center border-l border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"><Plus className="h-4 w-4" aria-hidden="true" /></button>
                  </div>
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => { setError(""); setBillCancelReason(""); setBillCancelMode("line"); setBillCancelTarget(group); }}
                    className="ui-press inline-flex h-8 items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 text-[12px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300 dark:hover:bg-red-950/50"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                    {copy.cancelled}
                  </button>
                </div>
              ) : null}
            </div>
          );
        };

        return (
          <div data-print-overlay {...paymentBackdrop} className={`${billViewClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-sm sm:p-4`}>
            <style jsx global>{`
              @media print {
                #print-bill { position: static !important; width: 48mm !important; margin: 0 auto !important; padding: 3mm 0 !important; color: #111827; background: white; display: block !important; height: auto !important; max-height: none !important; overflow: visible !important; transform: none !important; }
                #print-bill [data-receipt-scroll] { overflow: visible !important; }
                #print-bill [data-receipt-section] { display: block !important; }
                #print-bill .dark\\:text-white, #print-bill .dark\\:text-gray-300, #print-bill .dark\\:text-gray-500 { color: #111827 !important; }
                #print-bill .dark\\:bg-gray-950 { background: #fff !important; }
                #print-bill .dark\\:border-gray-800 { border-color: #d1d5db !important; }
                #print-bill [data-screen-only] { display: none !important; }
                #print-bill [data-screen-receipt] { display: none !important; }
                #print-bill [data-print-only] { display: block !important; }
                #print-bill [data-bill-item] { border: 0 !important; border-bottom: 1px solid #e5e7eb !important; border-radius: 0 !important; padding: 2mm 0 !important; }
              }
            `}</style>
            <div data-print-dialog role="dialog" aria-modal="true" aria-labelledby="bill-view-title" className={`${billViewClosing ? "motion-dialog-exit" : "motion-dialog"} flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-md border border-gray-200 bg-slate-50 shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-900 sm:max-h-[calc(100vh-2rem)]`}>
              <div id="print-bill" className="flex min-h-0 flex-1 flex-col">
                <div data-screen-receipt className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900 sm:px-5">
                  <div data-screen-only className="min-w-0">
                    <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">{orderLocationLabel(bill.order, language)} · {bill.order.order_number}</p>
                    <h2 id="bill-view-title" className="mt-0.5 text-[16px] font-semibold text-gray-950 dark:text-white">{copy.close}</h2>
                  </div>
                  <div data-print-only className="hidden">
                    <h2 className="text-[16px] font-semibold text-gray-900">{copy.bill} #{bill.order.order_number}</h2>
                    <p className="mt-0.5 text-[12px] text-gray-600">{orderLocationLabel(bill.order, language)}</p>
                  </div>
                  <div data-screen-only className="flex shrink-0 items-center gap-2">
                    {!paymentComplete && canTake ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => { setBillEditMode((value) => !value); setBillAddOpen(false); setBillCancelTarget(null); setError(""); }}
                        className={`ui-press h-9 rounded-md border px-3 text-[12px] font-semibold disabled:opacity-50 ${billEditMode ? "border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"}`}
                      >
                        {billEditMode ? copy.doneEditing : copy.editItems}
                      </button>
                    ) : null}
                    <button type="button" onClick={closeBillModal} className="ui-press h-9 shrink-0 rounded-md border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-600 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">{orderSummaryCopy.close}</button>
                  </div>
                </div>
                <div data-screen-receipt data-receipt-scroll data-pos-modal-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
                  {billAddOpen ? (
                    <section data-screen-only className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white">{copy.addServed}</h3>
                        <button type="button" onClick={() => setBillAddOpen(false)} className="ui-press h-8 shrink-0 rounded-md border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">{copy.backToBill}</button>
                      </div>
                      <p className="mb-2 text-[11px] text-gray-500 dark:text-gray-400">{copy.addServedHint}</p>
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder={copy.search}
                        className="mb-2 h-9 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-orange-500 dark:border-gray-800 dark:bg-gray-800"
                      />
                      <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1">
                        {categoryOptions.map((option) => {
                          const active = option.value === "all" ? categoryId === "all" : String(categoryId) === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => setCategoryId(option.value === "all" ? "all" : Number(option.value))}
                              className={`h-8 shrink-0 rounded-md border px-3 text-[12px] font-semibold ${active ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/30 dark:text-orange-300" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"}`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {filteredMenu.map((menu) => {
                          const needsOptions = hasRequiredOptions(menu);
                          const disabled = submitting || !menu.is_available || menu.remaining_servings === 0 || needsOptions;
                          return (
                            <button
                              key={menu.ID}
                              type="button"
                              disabled={disabled}
                              onClick={() => { void addServedItem(menu); }}
                              className="ui-press flex flex-col overflow-hidden rounded-md border border-gray-200 bg-white text-left transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900"
                            >
                              <div role="img" aria-hidden="true" className="aspect-square w-full bg-transparent bg-cover bg-center" style={{ backgroundImage: `url(${menu.image_url || "/menu-placeholder-v2.webp"})` }} />
                              <div className="min-w-0 p-2">
                                <p className="truncate text-[12px] font-semibold text-gray-900 dark:text-white">{menu.name}</p>
                                <p className="font-mono text-[11px] text-gray-500 dark:text-gray-400">฿{menu.price.toLocaleString()}</p>
                                {needsOptions ? <p className="mt-0.5 text-[10px] leading-tight text-amber-600 dark:text-amber-400">{copy.requiresOptions}</p> : null}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ) : (
                    <section className="rounded-md border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-[13px] font-semibold text-gray-900 dark:text-white">{copy.allItems}</h3>
                        <p className="font-mono text-[12px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">{billItemCount} {language === "th" ? "รายการ" : "items"}</p>
                      </div>
                      <div className="space-y-3">
                        {billSections.map((section) => (
                          <div data-receipt-section key={section.key} className="space-y-2">
                            {billSections.length > 1 || section.key === "takeaway" || bill.order.order_type === "takeaway" ? <p className="px-1 text-[12px] font-semibold text-gray-700 dark:text-gray-200">{fulfillmentLabel(section.key, language)}</p> : null}
                            <div className="space-y-2">
                              {section.groups.map(renderBillGroup)}
                            </div>
                          </div>
                        ))}
                      </div>
                      {billEditMode ? (
                        <button
                          data-screen-only
                          type="button"
                          disabled={submitting}
                          onClick={() => { setSearch(""); setCategoryId("all"); setBillAddOpen(true); }}
                          className="ui-press mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-orange-300 bg-orange-50 text-[13px] font-semibold text-orange-700 hover:bg-orange-100 disabled:opacity-50 dark:border-orange-800 dark:bg-orange-950/25 dark:text-orange-300 dark:hover:bg-orange-950/40"
                        >
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          {copy.addServed}
                        </button>
                      ) : null}
                    </section>
                  )}
                </div>
                <div data-screen-receipt className="shrink-0 border-t border-gray-200 bg-white px-4 py-3 text-[12px] dark:border-gray-800 dark:bg-gray-900 sm:px-5">
                  <div className="space-y-1.5 text-gray-600 dark:text-gray-300">
                    <div className="flex justify-between gap-4"><span>{copy.total}</span><span className="font-mono tabular-nums text-gray-900 dark:text-white">฿{bill.total_amount.toLocaleString()}</span></div>
                    {bill.service_charge_enabled || bill.service_charge_amount > 0 ? (
                      <div className="flex justify-between gap-4"><span>{copy.service} {bill.service_charge_enabled ? `${bill.service_charge_rate}%` : ""}</span><span className="font-mono tabular-nums text-gray-900 dark:text-white">฿{bill.service_charge_amount.toLocaleString()}</span></div>
                    ) : null}
                    {bill.vat_enabled || bill.vat_amount > 0 ? (
                      <div className="flex justify-between gap-4"><span>{copy.vat} {bill.vat_enabled ? `${bill.vat_rate}%` : ""}</span><span className="font-mono tabular-nums text-gray-900 dark:text-white">฿{bill.vat_amount.toLocaleString()}</span></div>
                    ) : null}
                    <div className="mt-2 flex items-end justify-between gap-4 border-t border-gray-200 pt-2.5 dark:border-gray-800">
                      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{copy.grandTotal}</span>
                      <span className="font-mono text-[20px] font-extrabold tabular-nums text-gray-950 dark:text-white">฿{bill.grand_total.toLocaleString()}</span>
                    </div>
                    {paymentComplete && lastPayment ? (
                      <div className="mt-2 space-y-1.5 border-t border-dashed border-gray-300 pt-2.5 dark:border-gray-700">
                        <div className="flex justify-between gap-4"><span>{copy.paymentMethod}</span><span className="font-semibold text-gray-900 dark:text-white">{lastPayment.method === "cash" ? copy.cash : copy.qr}</span></div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <ThermalReceipt bill={bill} language={language} locationLabel={orderLocationLabel(bill.order, language)} restaurant={activeMembership?.restaurant} />
              </div>

              {!paymentComplete ? (
                <div className="shrink-0 space-y-3 border-t border-gray-200 bg-slate-50 p-3 dark:border-gray-800 dark:bg-gray-900 sm:px-4">
                  {billUndelivered > 0 ? (
                    <div data-screen-only className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{copy.undeliveredWarn}</span>
                    </div>
                  ) : null}
                  <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-300">{copy.paymentMethod}</p>
                    <div className="grid w-full min-w-0 grid-cols-2 gap-1 rounded-md border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900 sm:w-auto sm:min-w-[220px]">
                      <button type="button" onClick={() => setPaymentMethod("cash")} className={`h-9 rounded-[4px] px-3 text-[12px] font-semibold ${paymentMethod === "cash" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"}`}>{copy.cash}</button>
                      <button type="button" onClick={() => setPaymentMethod("promptpay_qr")} className={`h-9 rounded-[4px] px-3 text-[12px] font-semibold ${paymentMethod === "promptpay_qr" ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900" : "text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"}`}>{copy.qr}</button>
                    </div>
                  </div>
                  {paymentMethod === "promptpay_qr" ? (
                    <div className="rounded-md border border-gray-200 bg-white p-3 text-center dark:border-gray-800 dark:bg-gray-900">
                      {bill.promptpay_qr_image ? <Image src={bill.promptpay_qr_image} alt="PromptPay QR" width={176} height={176} unoptimized className="mx-auto h-44 w-44 rounded-md object-contain" /> : <div className="mx-auto flex h-44 w-44 items-center justify-center rounded-md bg-gray-100 text-[12px] text-gray-500 dark:bg-gray-800">No QR</div>}
                      <p className="mt-2 text-[13px] font-semibold text-gray-900 dark:text-white">{bill.promptpay_name || copy.qr}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900">
                {paymentComplete ? (
                  <div className="mr-auto flex min-w-0 items-center gap-2 text-[12px] text-emerald-700 dark:text-emerald-400">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span><strong>{receiptCopy.paymentComplete}</strong><span className="hidden sm:inline"> · {receiptCopy.paymentCompleteHint}</span></span>
                  </div>
                ) : null}
                <button type="button" onClick={() => printThermalReceipt("print-bill")} className={paymentComplete ? "ui-press inline-flex h-10 items-center gap-2 rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white hover:bg-orange-800 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800" : "h-10 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-orange-700"}>{paymentComplete ? <><Printer className="h-4 w-4" aria-hidden="true" />{receiptCopy.printReceipt}</> : copy.print}</button>
                {!paymentComplete ? <button type="button" disabled={submitting || !canPay || billUndelivered > 0} onClick={confirmPayment} className="ui-press h-10 rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-orange-700 dark:text-white">{copy.confirmPayment}</button> : null}
              </div>
            </div>
          </div>
        );
      })()}

      {billCancelTarget ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/50 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="bill-cancel-title" className="w-full max-w-sm rounded-md border border-gray-200 bg-white p-4 shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-900">
            <h2 id="bill-cancel-title" className="text-[15px] font-semibold text-gray-950 dark:text-white">{billCancelMode === "unit" ? copy.voidUnitTitle : copy.cancelItemTitle}</h2>
            <p className="mt-1 text-[13px] text-gray-600 dark:text-gray-400">{billCancelMode === "unit" ? copy.voidUnitDescription(billCancelTarget.firstItem.menu_name) : `${billCancelTarget.firstItem.menu_name} · x${billCancelTarget.quantity}`}</p>
            <label htmlFor="bill-cancel-reason" className="mt-3 block text-[12px] font-semibold text-gray-700 dark:text-gray-300">{copy.cancelItemReason}</label>
            <textarea
              id="bill-cancel-reason"
              value={billCancelReason}
              onChange={(event) => { setBillCancelReason(event.target.value); if (error) setError(""); }}
              rows={3}
              maxLength={500}
              placeholder={copy.cancelItemPlaceholder}
              autoFocus
              className="mt-1.5 w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-[13px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" disabled={submitting} onClick={() => { setBillCancelTarget(null); setBillCancelReason(""); setBillCancelMode("line"); }} className="h-10 rounded-md border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">{copy.keepItemBtn}</button>
              <button type="button" disabled={submitting || !billCancelReason.trim()} onClick={() => { void confirmCancelBillItem(); }} className="h-10 rounded-md bg-red-600 px-3 text-[13px] font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400">{copy.confirmCancelItem}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
