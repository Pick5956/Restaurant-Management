"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Download, KeyRound } from "lucide-react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { bulkCreateTables, createTableTag, createTableZone, deleteTable, deleteTableTag, deleteTableZone, listTableTags, listTables, listTableZones, moveTableZone, regenerateTableCustomerToken, updateTable, updateTableTag, updateTableZone } from "@/src/lib/table";
import { createSingleFlight } from "@/src/lib/singleFlight";
import type { RestaurantTable, RestaurantTableInput, TableTag, TableTagInput, TableZone, TableZoneInput } from "@/src/types/table";
import { Skeleton } from "@/src/components/shared/Skeleton";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import { useConfirm, useToast } from "@/src/components/shared/FeedbackProvider";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import {
  createQrMatrix,
  qrMatrixPath,
  qrMatrixToPngBlob,
  qrViewBoxSize,
} from "@/src/lib/qr";
import {
  emptyTableForm,
  emptyTagForm,
  emptyZoneForm,
  safeQrFileName,
  statusMeta,
  tableAccentClass,
  tableStatusEditorState,
  tableStatusPillClass,
  tagBadgeClass,
} from "./tablesPageUtils";

export default function TablesPage() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const canManage = can(activeMembership, "manage_table");
  const canView = canManage || can(activeMembership, "view_tables");
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [zones, setZones] = useState<TableZone[]>([]);
  const [tags, setTags] = useState<TableTag[]>([]);
  const [zoneFilter, setZoneFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [editingTable, setEditingTable] = useState<RestaurantTable | null>(null);
  const [tableForm, setTableForm] = useState<RestaurantTableInput>(emptyTableForm);
  const [tableDrawerOpen, setTableDrawerOpen] = useState(false);
  const [tableDrawerClosing, setTableDrawerClosing] = useState(false);
  const [bulkCount, setBulkCount] = useState(1);
  const [zoneForm, setZoneForm] = useState<TableZoneInput>(emptyZoneForm);
  const [editingZone, setEditingZone] = useState<TableZone | null>(null);
  const [zoneManagerOpen, setZoneManagerOpen] = useState(false);
  const [tagForm, setTagForm] = useState<TableTagInput>(emptyTagForm);
  const [editingTag, setEditingTag] = useState<TableTag | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "table"; table: RestaurantTable } | { type: "zone"; zone: TableZone } | { type: "tag"; tag: TableTag } | null>(null);
  const [deleteClosing, setDeleteClosing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingQr, setDownloadingQr] = useState(false);
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const saveOnceRef = useRef(createSingleFlight());
  const deleteOnceRef = useRef(createSingleFlight());
  const qrOnceRef = useRef(createSingleFlight());
  // The toolbar is a fixed bar under the mobile top bar; this reserves the exact
  // space it takes so the table grid doesn't slide underneath it. On lg the bar is
  // a sticky element in normal flow (see [data-shell-sticky] in globals.css), so
  // the spacer is hidden there and no measurement is needed.
  const stickyToolbarRef = useRef<HTMLDivElement>(null);
  const [stickyToolbarHeight, setStickyToolbarHeight] = useState(0);

  const copy = language === "th"
    ? {
        denied: "ไม่มีสิทธิ์ดูผังโต๊ะ",
        eyebrow: "Tables",
        title: "ผังโต๊ะ",
        subtitleManage: "จัดโซน เลขโต๊ะ และคุณสมบัติโต๊ะสำหรับร้านทุกขนาด",
        subtitleView: "ดูสถานะโต๊ะและโซนแบบ read-only",
        total: "โต๊ะทั้งหมด",
        occupied: "ใช้งาน",
        reserved: "จอง",
        inactive: "ปิดใช้งาน",
        zones: "โซน",
        allZones: "ทุกโซน",
        noZone: "ไม่มีโซน",
        allTags: "ทุก tag",
        seats: "ที่นั่ง",
        edit: "แก้ไข",
        delete: "ลบ",
        createTable: "เพิ่มโต๊ะ",
        saveTable: "บันทึกโต๊ะ",
        tableEditor: "ตั้งค่าโต๊ะ",
        autoNumber: "เลขโต๊ะออกให้อัตโนมัติ",
        zone: "โซน",
        tags: "Tags",
        capacity: "จำนวนที่นั่ง",
        status: "สถานะ",
        lifecycleStatusHelp: "สถานะนี้เปลี่ยนจากขั้นตอนการจองหรือออเดอร์เท่านั้น",
        bulkCreate: "สร้างโต๊ะเป็นชุด",
        count: "จำนวนโต๊ะ",
        preview: "ตัวอย่างเลข",
        createBatch: "สร้างชุดโต๊ะ",
        zoneManager: "จัดการโซน",
        tagManager: "จัดการ tags",
        zoneName: "ชื่อโซน",
        prefix: "ตัวอักษรนำหน้าเลขโต๊ะ (ไม่บังคับ)",
        prefixPlaceholder: "เช่น R สำหรับริมน้ำ",
        prefixHelp: "ถ้าใส่ R ระบบจะสร้างเลขโต๊ะเป็น R01, R02 ตอนเพิ่มโต๊ะเป็นชุด",
        displayOrder: "ลำดับ",
        active: "เปิดใช้งาน",
        addZone: "เพิ่มโซน",
        saveZone: "บันทึกโซน",
        moveUp: "เลื่อนขึ้น",
        moveDown: "เลื่อนลง",
        orderUpdated: "อัปเดตลำดับแล้ว",
        tagName: "ชื่อ tag",
        color: "สี",
        addTag: "เพิ่ม tag",
        saveTag: "บันทึก tag",
        cancel: "ยกเลิก",
        emptyTitle: "ยังไม่มีโต๊ะ",
        emptyManage: "สร้างโต๊ะเป็นชุดเพื่อให้ระบบออกเลขให้อัตโนมัติ",
        emptyView: "เจ้าของร้านยังไม่ได้ตั้งค่าโต๊ะ",
        confirmDeleteTitle: "ยืนยันการลบ",
        confirmDeleteBody: "ต้องการลบรายการนี้ใช่ไหม?",
        loadError: "โหลดข้อมูลผังโต๊ะไม่สำเร็จ",
        saveError: "บันทึกข้อมูลไม่สำเร็จ",
        deleteError: "ลบข้อมูลไม่สำเร็จ",
        requiredName: "กรอกชื่อก่อนบันทึก",
        tableCreated: "เพิ่มโต๊ะแล้ว",
        tableUpdated: "อัปเดตโต๊ะแล้ว",
        batchCreated: "สร้างชุดโต๊ะแล้ว",
        zoneCreated: "เพิ่มโซนแล้ว",
        zoneUpdated: "อัปเดตโซนแล้ว",
        tagCreated: "เพิ่ม tag แล้ว",
        tagUpdated: "อัปเดต tag แล้ว",
        itemDeleted: "ลบข้อมูลแล้ว",
        confirmBatchTitle: "สร้างโต๊ะเป็นชุด?",
        confirmBatchBody: "ระบบจะเพิ่มโต๊ะหลายรายการตามจำนวนที่ตั้งไว้และอัปเดตผังโต๊ะทันที",
        confirmBatch: "ยืนยันสร้างโต๊ะ",
        qrOrder: "QR สั่งอาหาร",
        qrHint: "ให้ลูกค้าสแกนเพื่อเปิดเมนูโต๊ะนี้และส่งออเดอร์เข้าครัวโดยไม่ต้องล็อกอิน",
        copyLink: "คัดลอกลิงก์",
        openCustomerMenu: "เปิดหน้าเมนูลูกค้า",
        downloadQr: "โหลด QR",
        customerLinkCopied: "คัดลอกลิงก์สั่งอาหารแล้ว",
        qrDownloaded: "ดาวน์โหลด QR แล้ว",
        qrDownloadError: "ดาวน์โหลด QR ไม่สำเร็จ",
        qrLoading: "กำลังโหลด QR",
        qrImageError: "โหลด QR ไม่สำเร็จ",
        regenerateQr: "สร้าง QR ใหม่",
        regenerateQrTitle: "สร้าง QR โต๊ะนี้ใหม่?",
        regenerateQrBody: "ลิงก์และ QR เดิมจะใช้ไม่ได้ทันที ลูกค้าที่เปิดจาก QR เก่าจะต้องสแกน QR ใหม่",
        regenerateQrConfirm: "สร้าง QR ใหม่",
        qrRegenerated: "สร้าง QR ใหม่แล้ว",
      }
    : {
        denied: "You do not have permission to view tables.",
        eyebrow: "Tables",
        title: "Table layout",
        subtitleManage: "Manage zones, automatic table numbering, and table attributes.",
        subtitleView: "View table status and zones in read-only mode.",
        total: "Total tables",
        occupied: "Occupied",
        reserved: "Reserved",
        inactive: "Inactive",
        zones: "Zones",
        allZones: "All zones",
        noZone: "No zone",
        allTags: "All tags",
        seats: "seats",
        edit: "Edit",
        delete: "Delete",
        createTable: "Add table",
        saveTable: "Save table",
        tableEditor: "Table settings",
        autoNumber: "Table number is generated automatically",
        zone: "Zone",
        tags: "Tags",
        capacity: "Seats",
        status: "Status",
        lifecycleStatusHelp: "This status changes only through the reservation or order workflow.",
        bulkCreate: "Bulk create tables",
        count: "Table count",
        preview: "Number preview",
        createBatch: "Create tables",
        zoneManager: "Manage zones",
        tagManager: "Manage tags",
        zoneName: "Zone name",
        prefix: "Table number letters (optional)",
        prefixPlaceholder: "e.g. R for riverside",
        prefixHelp: "If you enter R, bulk-created tables become R01, R02.",
        displayOrder: "Display order",
        active: "Active",
        addZone: "Add zone",
        saveZone: "Save zone",
        moveUp: "Move up",
        moveDown: "Move down",
        orderUpdated: "Order updated",
        tagName: "Tag name",
        color: "Color",
        addTag: "Add tag",
        saveTag: "Save tag",
        cancel: "Cancel",
        emptyTitle: "No tables yet",
        emptyManage: "Bulk create tables and let the system number them automatically.",
        emptyView: "The owner has not configured tables yet.",
        confirmDeleteTitle: "Confirm delete",
        confirmDeleteBody: "Delete this item?",
        loadError: "Could not load table layout.",
        saveError: "Could not save data.",
        deleteError: "Could not delete data.",
        requiredName: "Enter a name before saving.",
        tableCreated: "Table added",
        tableUpdated: "Table updated",
        batchCreated: "Tables created",
        zoneCreated: "Zone added",
        zoneUpdated: "Zone updated",
        tagCreated: "Tag added",
        tagUpdated: "Tag updated",
        itemDeleted: "Item deleted",
        confirmBatchTitle: "Create tables in bulk?",
        confirmBatchBody: "The system will add multiple tables and update the layout immediately.",
        confirmBatch: "Create tables",
        qrOrder: "Ordering QR",
        qrHint: "Guests scan this table QR to open the menu and send orders to the kitchen without login.",
        copyLink: "Copy link",
        openCustomerMenu: "Open guest menu",
        downloadQr: "Download QR",
        customerLinkCopied: "Ordering link copied",
        qrDownloaded: "QR downloaded",
        qrDownloadError: "Could not download QR",
        qrLoading: "Loading QR",
        qrImageError: "Could not load QR",
        regenerateQr: "Regenerate QR",
        regenerateQrTitle: "Regenerate this table QR?",
        regenerateQrBody: "The old link and QR code will stop working immediately. Guests using the old QR must scan the new one.",
        regenerateQrConfirm: "Regenerate QR",
        qrRegenerated: "QR regenerated",
      };

  const STATUS = statusMeta(language);

  const refresh = async () => {
    if (!canView) return;
    setLoading(true);
    setError("");
    try {
      const [tableRes, zoneRes, tagRes] = await Promise.all([listTables(), listTableZones(), listTableTags()]);
      setTables(tableRes.data.tables ?? []);
      setZones(zoneRes.data.zones ?? []);
      setTags(tagRes.data.tags ?? []);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(loadTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canView, language]);

  // Track the fixed toolbar's height so the mobile spacer matches it exactly,
  // even as the toolbar wraps to a different number of rows across breakpoints.
  useEffect(() => {
    const node = stickyToolbarRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const measure = () => setStickyToolbarHeight(node.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [canView, canManage]);

  const sortedZones = useMemo(
    () => [...zones].sort((a, b) => (a.display_order - b.display_order) || (a.ID - b.ID)),
    [zones],
  );
  const sortedTags = useMemo(
    () => [...tags].sort((a, b) => (a.display_order - b.display_order) || (a.ID - b.ID)),
    [tags],
  );
  const activeZones = sortedZones;
  const activeTags = sortedTags;
  // Restaurants created without zones show no zone chrome at all; the "No zone"
  // label only makes sense once at least one zone exists to contrast against.
  const hasAnyZone = zones.length > 0;
  const filteredTables = useMemo(() => {
    return tables.filter((table) => {
      const zoneMatch = zoneFilter === "all" || (zoneFilter === "none" ? !table.zone_id : table.zone_id === Number(zoneFilter));
      const tagMatch = tagFilter === "all" || table.tags?.some((tag) => tag.ID === Number(tagFilter));
      return zoneMatch && tagMatch;
    });
  }, [tagFilter, tables, zoneFilter]);
  const occupiedCount = tables.filter((table) => table.status === "occupied").length;
  const inactiveCount = tables.filter((table) => table.status === "inactive").length;
  const tableEditorStatus = tableStatusEditorState(tableForm.status);
  const bulkPreview = useMemo(() => {
    const count = Math.max(1, Number(bulkCount) || 1);
    const zone = activeZones.find((item) => item.ID === tableForm.zone_id);
    const existing = tables.filter((table) => tableForm.zone_id ? table.zone_id === tableForm.zone_id : !table.zone_id);
    const next = Math.max(0, ...existing.map((table) => table.sequence_number || 0)) + 1;
    const label = (sequence: number) => zone ? `${zone.prefix || "Z"}${String(sequence).padStart(2, "0")}` : `T${sequence}`;
    return count === 1 ? label(next) : `${label(next)}-${label(next + count - 1)}`;
  }, [activeZones, bulkCount, tableForm.zone_id, tables]);
  const customerOrderLink = useMemo(() => {
    if (!editingTable?.customer_token || typeof window === "undefined") return "";
    return `${window.location.origin}/customer/t/${editingTable.customer_token}`;
  }, [editingTable]);
  const customerOrderQr = useMemo(() => {
    if (!customerOrderLink) return null;
    try {
      const matrix = createQrMatrix(customerOrderLink);
      return {
        matrix,
        path: qrMatrixPath(matrix),
        viewBoxSize: qrViewBoxSize(matrix),
      };
    } catch {
      return null;
    }
  }, [customerOrderLink]);

  const toggleTableTag = (id: number) => setTableForm((current) => ({ ...current, tag_ids: current.tag_ids?.includes(id) ? current.tag_ids.filter((item) => item !== id) : [...(current.tag_ids ?? []), id] }));

  const startEditTable = (table: RestaurantTable) => {
    setEditingTable(table);
    setFormError("");
    setTableForm({ zone_id: table.zone_id ?? null, capacity: table.capacity, status: table.status, tag_ids: table.tags?.map((tag) => tag.ID) ?? [] });
    setTableDrawerClosing(false);
    setTableDrawerOpen(true);
  };

  const startCreateTable = () => {
    setEditingTable(null);
    setFormError("");
    setTableForm(emptyTableForm);
    setBulkCount(1);
    setTableDrawerClosing(false);
    setTableDrawerOpen(true);
  };

  const closeTableDrawer = () => {
    if (tableDrawerClosing) return;
    setTableDrawerClosing(true);
    window.setTimeout(() => {
      setTableDrawerOpen(false);
      setTableDrawerClosing(false);
      setEditingTable(null);
      setTableForm(emptyTableForm);
      setFormError("");
    }, 180);
  };

  const saveTable = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage) return;
    await saveOnceRef.current(async () => {
      setSubmitting(true);
      setError("");
      setFormError("");
      try {
        if (editingTable) {
          const originalZone = editingTable.zone_id ?? null;
          const nextZone = tableForm.zone_id ?? null;
          let updated: RestaurantTable;
          if (originalZone !== nextZone) {
            updated = (await moveTableZone(editingTable.ID, { zone_id: nextZone })).data;
          } else {
            updated = editingTable;
          }
          updated = (await updateTable(editingTable.ID, { ...tableForm, zone_id: updated.zone_id ?? null, capacity: Number(tableForm.capacity) || 2 })).data;
          setTables((current) => current.map((table) => table.ID === updated.ID ? updated : table));
          showToast({ title: copy.tableUpdated });
        } else {
          const count = Math.max(1, Number(bulkCount) || 1);
          const res = await bulkCreateTables({ ...tableForm, count, capacity: Number(tableForm.capacity) || 2 });
          setTables(res.data.tables ?? []);
          showToast({ title: count > 1 ? copy.batchCreated : copy.tableCreated });
        }
        closeTableDrawer();
      } catch {
        setFormError(copy.saveError);
      } finally {
        setSubmitting(false);
      }
    });
  };

  const saveZone = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!zoneForm.name.trim()) {
      setFormError(copy.requiredName);
      return;
    }
    await saveOnceRef.current(async () => {
      setSubmitting(true);
      setFormError("");
      try {
        const nextDisplayOrder = editingZone
          ? Number(zoneForm.display_order) || editingZone.display_order
          : Math.max(0, ...zones.map((zone) => zone.display_order || 0)) + 1;
        const payload = { ...zoneForm, name: zoneForm.name.trim(), prefix: zoneForm.prefix?.trim().toUpperCase(), display_order: nextDisplayOrder, is_active: true };
        const res = editingZone ? await updateTableZone(editingZone.ID, payload) : await createTableZone(payload);
        setZones((current) => editingZone ? current.map((zone) => zone.ID === res.data.ID ? res.data : zone) : [...current, res.data]);
        if (editingZone) {
          setTables((current) => current.map((table) => {
            if (table.zone_id !== res.data.ID) return table;
            const nextLabel = res.data.prefix
              ? `${res.data.prefix}${String(table.sequence_number).padStart(2, "0")}`
              : `Z${String(table.sequence_number).padStart(2, "0")}`;
            return {
              ...table,
              table_number: nextLabel,
              display_label: nextLabel,
              zone: res.data.name,
              table_zone: res.data,
            };
          }));
        }
        showToast({ title: editingZone ? copy.zoneUpdated : copy.zoneCreated });
        setEditingZone(null);
        setZoneForm(emptyZoneForm);
      } catch {
        setFormError(copy.saveError);
      } finally {
        setSubmitting(false);
      }
    });
  };

  const moveZoneOrder = async (zoneID: number, direction: -1 | 1) => {
    const currentIndex = sortedZones.findIndex((zone) => zone.ID === zoneID);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sortedZones.length) return;

    const reordered = [...sortedZones];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    const normalized = reordered.map((zone, index) => ({ ...zone, display_order: index + 1 }));
    const previousZones = zones;

    setSubmitting(true);
    setFormError("");
    setZones(normalized);
    if (editingZone) {
      const currentEditingZone = normalized.find((zone) => zone.ID === editingZone.ID);
      if (currentEditingZone) {
        setEditingZone(currentEditingZone);
        setZoneForm((current) => ({ ...current, display_order: currentEditingZone.display_order }));
      }
    }

    try {
      await Promise.all(normalized.map((zone) => updateTableZone(zone.ID, {
        name: zone.name,
        prefix: zone.prefix,
        display_order: zone.display_order,
        is_active: true,
      })));
      showToast({ title: copy.orderUpdated });
    } catch {
      setZones(previousZones);
      setFormError(copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const saveTag = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!tagForm.name.trim()) {
      setFormError(copy.requiredName);
      return;
    }
    await saveOnceRef.current(async () => {
      setSubmitting(true);
      setFormError("");
      try {
        const nextDisplayOrder = editingTag
          ? Number(tagForm.display_order) || editingTag.display_order
          : Math.max(0, ...tags.map((tag) => tag.display_order || 0)) + 1;
        const payload = { ...tagForm, name: tagForm.name.trim(), color: "gray" as const, display_order: nextDisplayOrder, is_active: true };
        const res = editingTag ? await updateTableTag(editingTag.ID, payload) : await createTableTag(payload);
        setTags((current) => editingTag ? current.map((tag) => tag.ID === res.data.ID ? res.data : tag) : [...current, res.data]);
        if (editingTag) {
          setTables((current) => current.map((table) => ({
            ...table,
            tags: table.tags?.map((tag) => tag.ID === res.data.ID ? { ...tag, ...res.data } : tag) ?? table.tags,
          })));
        }
        showToast({ title: editingTag ? copy.tagUpdated : copy.tagCreated });
        setEditingTag(null);
        setTagForm(emptyTagForm);
      } catch {
        setFormError(copy.saveError);
      } finally {
        setSubmitting(false);
      }
    });
  };

  const moveTagOrder = async (tagID: number, direction: -1 | 1) => {
    const currentIndex = sortedTags.findIndex((tag) => tag.ID === tagID);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= sortedTags.length) return;

    const reordered = [...sortedTags];
    [reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]];
    const normalized = reordered.map((tag, index) => ({ ...tag, display_order: index + 1 }));
    const previousTags = tags;

    setSubmitting(true);
    setFormError("");
    setTags(normalized);
    if (editingTag) {
      const currentEditingTag = normalized.find((tag) => tag.ID === editingTag.ID);
      if (currentEditingTag) {
        setEditingTag(currentEditingTag);
        setTagForm((current) => ({ ...current, display_order: currentEditingTag.display_order }));
      }
    }

    try {
      await Promise.all(normalized.map((tag) => updateTableTag(tag.ID, {
        name: tag.name,
        color: tag.color,
        display_order: tag.display_order,
        is_active: true,
      })));
      setTables((current) => current.map((table) => ({
        ...table,
        tags: table.tags
          ?.map((tableTag) => normalized.find((tag) => tag.ID === tableTag.ID) ?? tableTag)
          .sort((a, b) => (a.display_order - b.display_order) || (a.ID - b.ID)) ?? table.tags,
      })));
      showToast({ title: copy.orderUpdated });
    } catch {
      setTags(previousTags);
      setFormError(copy.saveError);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleZoneEdit = (zone: TableZone) => {
    setFormError("");
    if (editingZone?.ID === zone.ID) {
      setEditingZone(null);
      setZoneForm(emptyZoneForm);
      return;
    }
    setEditingZone(zone);
    setZoneForm({ name: zone.name, prefix: zone.prefix, display_order: zone.display_order, is_active: true });
  };

  const toggleTagEdit = (tag: TableTag) => {
    setFormError("");
    if (editingTag?.ID === tag.ID) {
      setEditingTag(null);
      setTagForm(emptyTagForm);
      return;
    }
    setEditingTag(tag);
    setTagForm({ name: tag.name, color: "gray", display_order: tag.display_order, is_active: true });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteOnceRef.current(async () => {
      setSubmitting(true);
      setError("");
      try {
        if (deleteTarget.type === "table") {
          await deleteTable(deleteTarget.table.ID);
          setTables((current) => current.filter((table) => table.ID !== deleteTarget.table.ID));
          closeTableDrawer();
        }
        if (deleteTarget.type === "zone") {
          await deleteTableZone(deleteTarget.zone.ID);
          setZones((current) => current.filter((zone) => zone.ID !== deleteTarget.zone.ID));
          if (editingZone?.ID === deleteTarget.zone.ID) {
            setEditingZone(null);
            setZoneForm(emptyZoneForm);
          }
        }
        if (deleteTarget.type === "tag") {
          await deleteTableTag(deleteTarget.tag.ID);
          setTags((current) => current.filter((tag) => tag.ID !== deleteTarget.tag.ID));
          setTables((current) => current.map((table) => ({
            ...table,
            tags: table.tags?.filter((tag) => tag.ID !== deleteTarget.tag.ID) ?? table.tags,
          })));
          if (editingTag?.ID === deleteTarget.tag.ID) {
            setEditingTag(null);
            setTagForm(emptyTagForm);
          }
        }
        showToast({ title: copy.itemDeleted });
        closeDeleteModal();
      } catch {
        setError(copy.deleteError);
      } finally {
        setSubmitting(false);
      }
    });
  };

  const closeDeleteModal = () => {
    if (deleteClosing) return;
    setDeleteClosing(true);
    window.setTimeout(() => {
      setDeleteTarget(null);
      setDeleteClosing(false);
    }, 180);
  };
  const tableDrawerBackdrop = useBackdropClose(closeTableDrawer);
  const deleteBackdrop = useBackdropClose(closeDeleteModal);

  if (!canView) return <PermissionDenied title={copy.denied} />;

  const copyCustomerOrderLink = async () => {
    if (!customerOrderLink) return;
    await navigator.clipboard.writeText(customerOrderLink);
    showToast({ title: copy.customerLinkCopied });
  };

  const downloadCustomerQr = async () => {
    if (!editingTable || !customerOrderQr) return;
    setDownloadingQr(true);
    try {
      const blob = await qrMatrixToPngBlob(customerOrderQr.matrix);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = safeQrFileName(editingTable.display_label || editingTable.table_number || String(editingTable.ID));
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      showToast({ title: copy.qrDownloaded });
    } catch {
      showToast({ title: copy.qrDownloadError, tone: "error" });
    } finally {
      setDownloadingQr(false);
    }
  };

  const regenerateCustomerQr = async () => {
    if (!editingTable || !canManage) return;
    const confirmed = await confirm({
      title: copy.regenerateQrTitle,
      message: copy.regenerateQrBody,
      confirmLabel: copy.regenerateQrConfirm,
      cancelLabel: copy.cancel,
      tone: "warning",
    });
    if (!confirmed) return;
    await qrOnceRef.current(async () => {
      setSubmitting(true);
      setError("");
      try {
        const updated = (await regenerateTableCustomerToken(editingTable.ID)).data;
        setEditingTable(updated);
        setTables((current) => current.map((table) => table.ID === updated.ID ? updated : table));
        showToast({ title: copy.qrRegenerated });
      } catch {
        setError(copy.saveError);
      } finally {
        setSubmitting(false);
      }
    });
  };

  return (
    <>
      <div
        data-shell-sticky=""
        ref={stickyToolbarRef}
        className="fixed inset-x-0 top-14 z-20 bg-slate-100/95 backdrop-blur dark:bg-gray-950/95 transition-[left] duration-300 ease-in-out lg:inset-auto"
      >
        <h1 className="sr-only">{copy.title}</h1>
        <div className="px-4 py-2 sm:px-6 lg:px-8 lg:pb-2 lg:pt-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
              {hasAnyZone && (
                <div className="w-full sm:w-52">
                  <ThemedSelect triggerClassName="rounded-xl shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)]" aria-label={copy.allZones} value={zoneFilter} onChange={setZoneFilter} options={[{ value: "all", label: copy.allZones }, { value: "none", label: copy.noZone }, ...activeZones.map((zone) => ({ value: String(zone.ID), label: zone.name }))]} />
                </div>
              )}
              <div className="w-full sm:w-52">
                <ThemedSelect triggerClassName="rounded-xl shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)]" aria-label={copy.allTags} value={tagFilter} onChange={setTagFilter} options={[{ value: "all", label: copy.allTags }, ...activeTags.map((tag) => ({ value: String(tag.ID), label: tag.name }))]} />
              </div>
            </div>
            {canManage ? (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <button type="button" onClick={() => setZoneManagerOpen(true)} className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-700 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">{copy.zoneManager}</button>
                <button type="button" onClick={() => setTagManagerOpen(true)} className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-700 shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800">{copy.tagManager}</button>
                <button type="button" onClick={startCreateTable} className="h-9 rounded-xl bg-orange-700 px-3 text-[12px] font-semibold text-white shadow-[0_0_2px_rgba(15,23,42,0.04),0_0_16px_rgba(15,23,42,0.06)] dark:shadow-[0_0_2px_rgba(0,0,0,0.25),0_0_16px_rgba(0,0,0,0.35)] hover:bg-orange-800 dark:bg-orange-700 dark:text-white">+ {copy.createTable}</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="lg:hidden" style={{ height: stickyToolbarHeight }} />
      <div className="min-h-dvh bg-slate-100 px-4 py-4 text-gray-900 dark:bg-gray-950 dark:text-gray-100 sm:px-6 lg:px-8 lg:py-6">
        {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">{error}</div>}

        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[{ label: copy.total, value: tables.length }, { label: copy.occupied, value: occupiedCount }, { label: copy.inactive, value: inactiveCount }, { label: copy.zones, value: zones.length }].map((item) => (
            <div key={item.label} className="rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
              <p className="text-[11px] text-gray-500">{item.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{item.value}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4">
          <section className="space-y-4">

          {loading ? (
            <div className="grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
              {Array.from({ length: 8 }).map((_, index) => <Skeleton key={index} className="h-[118px]" />)}
            </div>
          ) : filteredTables.length ? (
            <div className="grid auto-rows-fr grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-7">
              {filteredTables.map((table) => {
                const shownTags = table.tags?.slice(0, 2) ?? [];
                const extraTags = Math.max((table.tags?.length ?? 0) - shownTags.length, 0);

                return (
                  <button
                    key={table.ID}
                    type="button"
                    disabled={!canManage}
                    onClick={() => startEditTable(table)}
                    className={`group relative flex min-h-[118px] overflow-hidden rounded-md border border-gray-200 bg-white text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-[transform,box-shadow,border-color] dark:border-gray-800 dark:bg-gray-800 ${canManage ? "ui-press hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md dark:hover:border-gray-700 dark:hover:bg-gray-800" : ""}`}
                  >
                    <span className={`w-1.5 shrink-0 ${tableAccentClass(table.status)}`} />
                    <div className="flex min-w-0 flex-1 flex-col px-3 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="truncate text-[22px] font-semibold leading-none tracking-tight text-gray-950 dark:text-white">{table.display_label || table.table_number}</h2>
                          <p className="mt-2 truncate text-[12px] font-medium text-gray-500 dark:text-gray-400">{hasAnyZone ? `${table.table_zone?.name || table.zone || copy.noZone} · ` : ""}{table.capacity} {copy.seats}</p>
                        </div>
                        <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold leading-none ${tableStatusPillClass(table.status)}`}>{STATUS[table.status].label}</span>
                      </div>
                      <div className="mt-auto">
                        <div className="flex min-h-[22px] flex-wrap items-start gap-1 overflow-hidden">
                          {shownTags.map((tag) => <span key={tag.ID} className={`rounded-[4px] px-2 py-0.5 text-[10px] font-extrabold leading-4 tracking-[0.01em] ${tagBadgeClass}`}>{tag.name}</span>)}
                          {extraTags > 0 ? <span className="rounded-[4px] border-2 border-gray-950 bg-white px-2 py-0.5 text-[10px] font-extrabold leading-4 text-gray-950 dark:border-white dark:bg-gray-900 dark:text-white">+{extraTags}</span> : null}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-gray-200 bg-white px-4 py-10 text-center dark:border-gray-800 dark:bg-gray-900">
              <p className="text-[14px] font-semibold">{copy.emptyTitle}</p>
              <p className="mt-1 text-[12px] text-gray-500">{canManage ? copy.emptyManage : copy.emptyView}</p>
            </div>
          )}
        </section>

      </div>

      {tableDrawerOpen && canManage && (
        <>
          <button type="button" aria-label={copy.cancel} {...tableDrawerBackdrop} className={`${tableDrawerClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-30 cursor-default bg-gray-950/45 backdrop-blur-sm`} />
          <form onSubmit={saveTable} className={`${tableDrawerClosing ? "motion-drawer-exit" : "motion-drawer"} fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900`}>
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{copy.tableEditor}</p>
                <h2 className="mt-0.5 text-[15px] font-semibold text-gray-900 dark:text-white">{editingTable ? copy.saveTable : copy.createTable}</h2>
                <p className="mt-1 text-[11px] text-gray-500">{editingTable ? `${copy.autoNumber}: ${editingTable.display_label || editingTable.table_number}` : copy.autoNumber}</p>
              </div>
              <button type="button" onClick={closeTableDrawer} className="h-8 w-8 rounded-md text-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200">×</button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                <div className="rounded-md border border-gray-200 dark:border-gray-800">
                  <div className="border-b border-gray-200 px-3 py-2 dark:border-gray-800">
                    <span className="text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.tableEditor}</span>
                  </div>
                  <div className="space-y-3 p-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.zone}</span>
                      <ThemedSelect value={tableForm.zone_id ? String(tableForm.zone_id) : "none"} onChange={(next) => setTableForm((current) => ({ ...current, zone_id: next === "none" ? null : Number(next) }))} options={[{ value: "none", label: copy.noZone }, ...activeZones.map((zone) => ({ value: String(zone.ID), label: `${zone.name}${zone.prefix ? ` (${zone.prefix})` : ""}` }))]} />
                    </label>
                    <div className={`grid gap-3 ${editingTable ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                      {!editingTable && (
                        <label className="block">
                          <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.count}</span>
                          <input type="number" min={1} max={200} value={bulkCount} onChange={(event) => setBulkCount(Number(event.target.value) || 1)} className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800" aria-label={copy.count} />
                        </label>
                      )}
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.capacity}</span>
                        <input type="number" min={1} max={50} value={tableForm.capacity} onChange={(event) => setTableForm((current) => ({ ...current, capacity: Number(event.target.value) || 2 }))} className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800" aria-label={copy.capacity} />
                      </label>
                      <label className="block">
                        <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.status}</span>
                        <span className="flex h-10 items-center justify-between gap-3 rounded-md border border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-800">
                          <span className={`truncate rounded-md px-2 py-1 text-[12px] font-semibold leading-none ${tableStatusPillClass(tableEditorStatus.status)}`}>
                            {STATUS[tableEditorStatus.status].label}
                          </span>
                          {!tableEditorStatus.isLifecycleManaged && (
                            <input
                              type="checkbox"
                              checked={tableEditorStatus.isActive}
                              onChange={(event) => setTableForm((current) => ({ ...current, status: event.target.checked ? "free" : "inactive" }))}
                              className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-gray-200 transition-[background-color] checked:bg-gray-900 before:block before:h-5 before:w-5 before:rounded-full before:bg-white before:shadow-sm before:transition-transform checked:before:translate-x-4 dark:bg-gray-700 dark:checked:bg-white dark:checked:before:bg-gray-900"
                              aria-label={copy.status}
                            />
                          )}
                        </span>
                        {tableEditorStatus.isLifecycleManaged && (
                          <span className="mt-1.5 block text-[11px] leading-4 text-gray-500 dark:text-gray-400">
                            {copy.lifecycleStatusHelp}
                          </span>
                        )}
                      </label>
                    </div>
                    {!editingTable && (
                      <p className="rounded-md border border-gray-200 px-3 py-2 text-[12px] text-gray-500 dark:border-gray-800">
                        {copy.preview}: <span className="font-mono font-semibold text-gray-900 dark:text-white">{bulkPreview}</span>
                      </p>
                    )}
                    <div>
                      <p className="mb-1.5 text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.tags}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {activeTags.map((tag) => (
                          <button key={tag.ID} type="button" onClick={() => toggleTableTag(tag.ID)} className={`rounded-[4px] px-2 py-1 text-[11px] font-bold ${tableForm.tag_ids?.includes(tag.ID) ? tagBadgeClass : "border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"}`}>{tag.name}</button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {editingTable && customerOrderLink && (
                  <div className="relative rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/40">
                    <button
                      type="button"
                      onClick={regenerateCustomerQr}
                      disabled={submitting}
                      aria-label={copy.regenerateQr}
                      title={copy.regenerateQr}
                      className="ui-press absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-red-600 shadow-sm transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-900 dark:text-red-300 dark:hover:border-red-900/60 dark:hover:bg-red-900/20 dark:hover:text-red-200"
                    >
                      <KeyRound className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <div className="grid grid-cols-[96px_1fr] gap-3">
                      <div className="relative h-24 w-24 overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-700">
                        {customerOrderQr ? (
                          <svg
                            viewBox={`0 0 ${customerOrderQr.viewBoxSize} ${customerOrderQr.viewBoxSize}`}
                            role="img"
                            aria-label={copy.qrOrder}
                            shapeRendering="crispEdges"
                            className="h-full w-full"
                          >
                            <rect width="100%" height="100%" fill="#ffffff" />
                            <path d={customerOrderQr.path} fill="#000000" />
                          </svg>
                        ) : (
                          <div role="alert" className="absolute inset-0 flex items-center justify-center bg-white p-2 text-center text-[10px] font-medium leading-4 text-red-600">
                            {copy.qrImageError}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 pr-9">
                        <p className="text-[13px] font-semibold text-gray-900 dark:text-white">{copy.qrOrder}</p>
                        <p className="mt-1 text-[11px] leading-5 text-gray-500 dark:text-gray-400">{copy.qrHint}</p>
                        <p className="mt-1 truncate font-mono text-[10px] text-gray-500">{customerOrderLink}</p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={copyCustomerOrderLink} className="h-9 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">{copy.copyLink}</button>
                      <button type="button" onClick={downloadCustomerQr} disabled={downloadingQr || !customerOrderQr} className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-gray-200 bg-white px-2 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800">
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        {copy.downloadQr}
                      </button>
                      <a href={customerOrderLink} target="_blank" rel="noreferrer" className="col-span-2 flex h-9 items-center justify-center rounded-md bg-orange-700 px-2 text-center text-[11px] font-semibold text-white hover:bg-orange-800 dark:bg-orange-700 dark:text-white">{copy.openCustomerMenu}</a>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 border-t border-gray-200 p-4 dark:border-gray-800">
              {editingTable && <button type="button" onClick={() => setDeleteTarget({ type: "table", table: editingTable })} className="h-10 w-full rounded-md border border-red-200 text-[13px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-300 dark:hover:bg-red-900/20">{copy.delete}</button>}
              <button disabled={submitting} className="ui-press h-10 w-full rounded-md bg-orange-700 text-[13px] font-semibold text-white disabled:opacity-60 dark:bg-orange-700 dark:text-white">{editingTable ? copy.saveTable : copy.createTable}</button>
              {formError && <p className="text-[11px] font-medium text-red-600 dark:text-red-300">{formError}</p>}
            </div>
          </form>
        </>
      )}

      {zoneManagerOpen && (
        <ManagerModal title={copy.zoneManager} onClose={() => setZoneManagerOpen(false)}>
          <div className="space-y-2">
            {sortedZones.map((zone, index) => (
              <ManagerRow
                key={zone.ID}
                title={`${zone.name}${zone.prefix ? ` (${zone.prefix})` : ""}`}
                muted={false}
                selected={editingZone?.ID === zone.ID}
                onToggle={() => toggleZoneEdit(zone)}
                onDelete={() => setDeleteTarget({ type: "zone", zone })}
                onMoveUp={() => void moveZoneOrder(zone.ID, -1)}
                onMoveDown={() => void moveZoneOrder(zone.ID, 1)}
                moveUpDisabled={submitting || index === 0}
                moveDownDisabled={submitting || index === sortedZones.length - 1}
                copy={copy}
              />
            ))}
          </div>
          <form onSubmit={saveZone} className="mt-4 space-y-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <input value={zoneForm.name} onChange={(event) => setZoneForm((current) => ({ ...current, name: event.target.value }))} placeholder={copy.zoneName} className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-800" />
            <div className="grid gap-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.prefix}</span>
                <input value={zoneForm.prefix} onChange={(event) => setZoneForm((current) => ({ ...current, prefix: event.target.value }))} placeholder={copy.prefixPlaceholder} className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-800" />
                <span className="mt-1 block text-[11px] leading-4 text-gray-500 dark:text-gray-400">{copy.prefixHelp}</span>
              </label>
            </div>
            <button disabled={submitting} className="h-10 w-full rounded-md bg-orange-700 text-[13px] font-semibold text-white disabled:opacity-60 dark:bg-orange-700 dark:text-white">{editingZone ? copy.saveZone : copy.addZone}</button>
          </form>
        </ManagerModal>
      )}

      {tagManagerOpen && (
        <ManagerModal title={copy.tagManager} onClose={() => setTagManagerOpen(false)}>
          <div className="space-y-2">
            {sortedTags.map((tag, index) => (
              <ManagerRow
                key={tag.ID}
                title={tag.name}
                muted={false}
                badgeClass={tagBadgeClass}
                selected={editingTag?.ID === tag.ID}
                onToggle={() => toggleTagEdit(tag)}
                onDelete={() => setDeleteTarget({ type: "tag", tag })}
                onMoveUp={() => void moveTagOrder(tag.ID, -1)}
                onMoveDown={() => void moveTagOrder(tag.ID, 1)}
                moveUpDisabled={submitting || index === 0}
                moveDownDisabled={submitting || index === sortedTags.length - 1}
                copy={copy}
              />
            ))}
          </div>
          <form onSubmit={saveTag} className="mt-4 space-y-2 border-t border-gray-200 pt-4 dark:border-gray-800">
            <input value={tagForm.name} onChange={(event) => setTagForm((current) => ({ ...current, name: event.target.value }))} placeholder={copy.tagName} className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] dark:border-gray-700 dark:bg-gray-800" />
            <button disabled={submitting} className="h-10 w-full rounded-md bg-orange-700 text-[13px] font-semibold text-white disabled:opacity-60 dark:bg-orange-700 dark:text-white">{editingTag ? copy.saveTag : copy.addTag}</button>
          </form>
        </ManagerModal>
      )}

      {deleteTarget && (
        <div {...deleteBackdrop} className={`${deleteClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-end justify-center bg-gray-950/45 px-3 pb-3 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-0`}>
          <div className={`${deleteClosing ? "motion-bottom-sheet-exit" : "motion-bottom-sheet"} w-full max-w-sm rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900`}>
            <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">{copy.confirmDeleteTitle}</h2>
              <p className="mt-1 text-[12px] text-gray-500 dark:text-gray-400">{copy.confirmDeleteBody}</p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3">
              <button type="button" onClick={closeDeleteModal} className="h-9 rounded-md border border-gray-200 px-3 text-[12px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">{copy.cancel}</button>
              <button type="button" onClick={confirmDelete} disabled={submitting} className="h-9 rounded-md border border-red-200 px-3 text-[12px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-900/50 dark:text-red-300 dark:hover:bg-red-900/20">{copy.delete}</button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}

function ManagerModal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 180);
  };
  const backdrop = useBackdropClose(close);

  return (
    <div {...backdrop} className={`${closing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-end justify-center bg-gray-950/45 px-3 pb-3 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-0`}>
      <div className={`${closing ? "motion-bottom-sheet-exit" : "motion-bottom-sheet"} max-h-[86vh] w-full max-w-md overflow-auto rounded-md border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900`}>
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button type="button" onClick={close} className="h-8 w-8 rounded-md text-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200">×</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function ManagerRow({
  title,
  muted,
  badgeClass,
  selected,
  onToggle,
  onDelete,
  onMoveUp,
  onMoveDown,
  moveUpDisabled,
  moveDownDisabled,
  copy,
}: {
  title: string;
  muted?: boolean;
  badgeClass?: string;
  selected?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  moveUpDisabled?: boolean;
  moveDownDisabled?: boolean;
  copy: Record<string, string>;
}) {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onToggle();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onToggle}
      onKeyDown={handleKeyDown}
      className={`grid cursor-pointer grid-cols-[1fr_auto] items-center gap-2 rounded-md border px-3 py-2 outline-none transition-[background-color,border-color,box-shadow] ${
        selected
          ? "border-gray-950 bg-orange-50/70 shadow-[inset_3px_0_0_#f97316] dark:border-white/80 dark:bg-orange-950/20"
          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/60"
      }`}
    >
      <p className={`truncate text-[13px] font-medium ${muted ? "text-gray-500 line-through" : badgeClass ? `w-fit rounded-[4px] px-2 py-1 ${badgeClass}` : "text-gray-900 dark:text-white"}`}>{title}</p>
      <div className="flex gap-1">
        {onMoveUp && onMoveDown ? (
          <span className="flex overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
            <button
              type="button"
              disabled={moveUpDisabled}
              aria-label={copy.moveUp}
              title={copy.moveUp}
              onClick={(event) => {
                event.stopPropagation();
                onMoveUp();
              }}
              className="grid h-8 w-8 place-items-center text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ChevronUp className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              disabled={moveDownDisabled}
              aria-label={copy.moveDown}
              title={copy.moveDown}
              onClick={(event) => {
                event.stopPropagation();
                onMoveDown();
              }}
              className="grid h-8 w-8 place-items-center border-l border-gray-200 text-gray-500 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
          </span>
        ) : null}
        <button type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }} className="h-8 rounded-md px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20">{copy.delete}</button>
      </div>
    </div>
  );
}
