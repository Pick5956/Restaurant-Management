"use client";

import Link from "next/link";
import { AlertTriangle, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import { createSingleFlight } from "@/src/lib/singleFlight";
import { can } from "@/src/lib/rbac";
import { getRestaurant, updateRestaurant, uploadRestaurantLogo, uploadRestaurantCover, uploadRestaurantPromptPayQR, deleteRestaurant } from "@/src/lib/restaurant";
import type { Restaurant } from "@/src/types/restaurant";
import { RESTAURANT_TYPES, getRestaurantTypeLabel } from "@/src/app/restaurants/restaurantWorkspaceUi";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { useDialogFocus } from "@/src/hooks/useDialogFocus";
import { restaurantRepository } from "@/src/app/repositories/restaurantRepository";
import { createSerialQueue } from "@/src/lib/serialQueue";
import { ACTION_WIDTH, FOCUS_RING, SettingsActionRow, SettingsButton, SettingsField, SettingsInput, SettingsItem, SettingsMediaRow, SettingsSelect, SettingsSkeleton, SettingsSwitch, SettingsTextArea, settingsButtonClass, SettingsGroup } from "../_components/SettingsPrimitives";
import {
  GEOFENCE_FIELDS,
  buildRestaurantPayload,
  expandFields,
  mergeSaved,
  normalizePhone,
  planCommit,
  toForm,
  type FormErrors,
  type FormField,
  type FormState,
} from "./restaurantSettingsForm";

/** Restaurant image fields that are uploaded one file at a time. */
type ImageField = "logo" | "cover_image" | "promptpay_qr_image";

/** Matches the motion-overlay-exit / motion-bottom-sheet-exit keyframes. */
const DIALOG_EXIT_MS = 180;

/** Long enough to read the steps for allowing location in the browser. */
const GEO_TOAST_MS = 9000;

export default function RestaurantSettingsPage() {
  const { activeMembership, refreshMemberships } = useAuth();
  const { language } = useLanguage();
  const [runUploadOnce] = useState(() => createSingleFlight());
  // Saves run one after another so two quick changes are both kept.
  const [enqueueSave] = useState(() => createSerialQueue());
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [form, setForm] = useState<FormState>(() => toForm(null, language));
  // What the server last confirmed. Each save starts from this, not from the
  // screen, so a half-typed value in another field is never sent along.
  const savedRef = useRef<FormState | null>(null);
  // The screen as of the last render, for saves that run after a blur.
  const formStateRef = useRef(form);
  const [errors, setErrors] = useState<FormErrors>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [locating, setLocating] = useState(false);
  const canManageRestaurant = can(activeMembership, "manage_restaurant_settings");
  const restaurantId = activeMembership?.restaurant_id;
  const { showToast } = useToast();
  const isOwner = activeMembership?.role?.name === "owner";
  useEffect(() => {
    formStateRef.current = form;
  });

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteModalClosing, setDeleteModalClosing] = useState(false);
  const [confirmRestaurantName, setConfirmRestaurantName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const deletePanelRef = useRef<HTMLFormElement>(null);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const deleteTitleId = useId();
  const deleteBodyId = useId();
  const confirmInputId = useId();
  const confirmErrorId = useId();

  const copy = language === "th"
    ? {
        title: "ข้อมูลร้านและการคิดเงิน",
        denied: "บัญชีนี้ยังไม่มีสิทธิ์จัดการการตั้งค่าร้าน",
        noRestaurant: "ยังไม่ได้เลือกร้าน",
        goRestaurants: "ไปหน้าเลือกร้าน",
        loading: "กำลังโหลดข้อมูลร้าน",
        loadError: "โหลดข้อมูลร้านไม่สำเร็จ",
        retry: "ลองอีกครั้ง",
        identity: "ข้อมูลร้าน",
        operations: "เวลาและโต๊ะ",
        billing: "การคิดเงิน",
        promptpay: "รับเงินผ่านพร้อมเพย์",
        qrOrdering: "สั่งอาหารผ่าน QR",
        upload: "อัปโหลด",
        replace: "เปลี่ยน",
        logo: "โลโก้ร้าน",
        noLogo: "ไม่มีโลโก้",
        coverImage: "รูปพื้นหลังร้าน",
        noCover: "ไม่มีรูปพื้นหลัง",
        name: "ชื่อร้าน",
        branch: "ชื่อสาขา",
        type: "ประเภทร้าน",
        phone: "เบอร์ร้าน",
        address: "ที่อยู่ร้าน",
        openTime: "เวลาเปิด",
        closeTime: "เวลาปิด",
        tableCount: "จำนวนโต๊ะตั้งต้น",
        service: "Service charge",
        vat: "VAT",
        promptpayName: "ชื่อบัญชีรับเงิน",
        promptpayQr: "QR Code รับเงิน",
        noQr: "ยังไม่มี QR",
        logoHint: "รูปที่แสดงบนใบเสร็จ หน้าสั่งอาหารของลูกค้า และรายชื่อร้าน ใช้ไฟล์ jpg, png หรือ webp ไม่เกิน 5MB",
        coverHint: "รูปพื้นหลังด้านบนของหน้าสั่งอาหารที่ลูกค้าเห็นเมื่อสแกน QR ถ้าไม่มีจะใช้ภาพตั้งต้น",
        nameHint: "ชื่อที่แสดงบนใบเสร็จ หน้าสั่งอาหาร และทุกหน้าของระบบ",
        branchHint: "ใช้แยกร้านที่มีหลายสาขา ถ้ามีร้านเดียวใช้สาขาหลักได้",
        phoneHint: "เบอร์ที่แสดงบนใบเสร็จให้ลูกค้าติดต่อร้าน",
        addressHint: "ที่อยู่ที่แสดงบนใบเสร็จ",
        openHint: "เวลาที่ร้านเปิดรับออเดอร์",
        closeHint: "เวลาที่ร้านปิดรับออเดอร์",
        tablesHint: "จำนวนโต๊ะตั้งต้นของร้าน ไม่ได้สร้างโต๊ะเพิ่มให้อัตโนมัติ",
        serviceHint: "บวกค่าบริการเข้าไปในบิล ค่าที่ใช้จะถูกบันทึกลงออเดอร์ตอนรับเงิน",
        serviceRateHint: "เปอร์เซ็นต์ค่าบริการ ตั้งได้ตั้งแต่ 0 ถึง 30",
        vatHint: "บวกภาษีมูลค่าเพิ่มเข้าไปในบิล ค่าที่ใช้จะถูกบันทึกลงออเดอร์ตอนรับเงิน",
        vatRateHint: "เปอร์เซ็นต์ VAT ตั้งได้ตั้งแต่ 0 ถึง 20",
        promptpayNameHint: "ชื่อบัญชีที่แสดงคู่กับ QR ตอนลูกค้าจ่ายเงิน",
        promptpayQrHint: "QR พร้อมเพย์ของร้านที่แสดงในหน้าชำระเงิน",
        geofenceHint: "กันคนถ่ายรูป QR ไปสั่งจากนอกร้าน ถ้าอ่านตำแหน่งลูกค้าไม่ได้ ออเดอร์จะรอพนักงานยืนยันแทนการถูกปฏิเสธ",
        radiusHint: "ระยะที่ลูกค้าสั่งได้นับจากพิกัดร้าน แนะนำ 100-200 เมตร เผื่อ GPS คลาดเคลื่อนในอาคาร",
        locateHint: "เติมพิกัดจากตำแหน่งของเครื่องนี้ กดตอนอยู่ที่ร้าน",
        noRestaurantHint: "เลือกร้านก่อน แล้วค่อยตั้งค่าข้อมูลร้าน",
        loadErrorHint: "ข้อมูลร้านยังโหลดไม่ขึ้น",
        deleteTitle: "ลบร้านอาหาร",
        deleteAction: "ลบร้าน",
        save: "บันทึกข้อมูลร้าน",
        saveError: "บันทึกข้อมูลร้านไม่สำเร็จ",
        uploadError: "อัปโหลดโลโก้ไม่สำเร็จ",
        uploadCoverError: "อัปโหลดรูปพื้นหลังไม่สำเร็จ",
        uploadQrError: "อัปโหลด QR ไม่สำเร็จ",
        uploadHint: "ใช้ไฟล์ jpg, png หรือ webp ไม่เกิน 5MB",
        validateName: "กรอกชื่อร้าน",
        validateBranch: "กรอกชื่อสาขา",
        validatePhone: "เบอร์โทรต้องมี 9-10 หลัก",
        validateOpen: "เวลาเปิดต้องอยู่ในรูปแบบ HH:mm",
        validateClose: "เวลาปิดต้องอยู่ในรูปแบบ HH:mm",
        validateTables: "จำนวนโต๊ะต้องอยู่ระหว่าง 1 ถึง 500",
        validateService: "ค่าบริการต้องอยู่ระหว่าง 0 ถึง 30%",
        validateVat: "VAT ต้องอยู่ระหว่าง 0 ถึง 20%",
        geofenceEnable: "ตรวจตำแหน่งลูกค้าก่อนสั่ง",
        latitude: "ละติจูด",
        longitude: "ลองจิจูด",
        radius: "รัศมีที่อนุญาต (เมตร)",
        useCurrentLocation: "ใช้ตำแหน่งปัจจุบัน",
        geoFailed: "ใช้ตำแหน่งปัจจุบันไม่ได้",
        geoUnsupported: "อุปกรณ์นี้ไม่รองรับการอ่านตำแหน่ง",
        geoInsecure: "เบราว์เซอร์บล็อกการอ่านตำแหน่งเพราะหน้านี้เปิดผ่านการเชื่อมต่อที่ไม่ปลอดภัย ให้เปิดผ่าน http://localhost:3000 หรือ https แล้วลองใหม่",
        geoDenied: "การเข้าถึงตำแหน่งถูกปฏิเสธ ไปที่ไอคอนหน้าเว็บ (แถบ URL) → การตั้งค่าเว็บไซต์ → ตำแหน่ง → อนุญาต แล้วลองใหม่",
        geoUnavailable: "อ่านตำแหน่งไม่ได้ในขณะนี้ ตรวจสอบว่าเปิด GPS/Location ของอุปกรณ์แล้ว",
        geoTimeout: "อ่านตำแหน่งหมดเวลา ลองใหม่อีกครั้ง หรือย้ายไปที่รับสัญญาณ GPS ได้ดีขึ้น",
        validateCoords: "กรอกพิกัดให้ถูกต้อง หรือกดใช้ตำแหน่งปัจจุบัน",
        validateRadius: "รัศมีต้องอยู่ระหว่าง 20 ถึง 5000 เมตร",
        dangerZone: "ลบร้าน",
        unnamed: "ไม่ระบุชื่อร้าน",
        deleteWarning: "การลบร้านอาหารจะลบข้อมูลโต๊ะ เมนู สมาชิก ออเดอร์ทั้งหมด และไม่สามารถกู้คืนได้อีก",
        confirmDeleteTitle: "ยืนยันการลบร้านอาหาร",
        confirmDeleteLabel: (name: string) => `พิมพ์ชื่อร้าน “${name}” เพื่อยืนยัน`,
        confirmDeleteBtn: "ลบร้านอาหาร",
        cancel: "ยกเลิก",
        close: "ปิด",
        deleted: "ลบร้านอาหารแล้ว",
        deleteError: "ลบร้านอาหารไม่สำเร็จ",
      }
    : {
        title: "Restaurant and billing",
        denied: "This account does not have permission to manage restaurant settings.",
        noRestaurant: "No restaurant selected",
        goRestaurants: "Go to restaurants",
        loading: "Loading restaurant details",
        loadError: "Could not load restaurant details",
        retry: "Try again",
        identity: "Restaurant profile",
        operations: "Hours and tables",
        billing: "Billing",
        promptpay: "PromptPay",
        qrOrdering: "QR ordering",
        upload: "Upload",
        replace: "Change",
        logo: "Restaurant logo",
        noLogo: "No logo",
        coverImage: "Cover image",
        noCover: "No cover image",
        name: "Restaurant name",
        branch: "Branch name",
        type: "Restaurant type",
        phone: "Restaurant phone",
        address: "Restaurant address",
        openTime: "Open time",
        closeTime: "Close time",
        tableCount: "Starting tables",
        service: "Service charge",
        vat: "VAT",
        promptpayName: "PromptPay account name",
        promptpayQr: "PromptPay QR code",
        noQr: "No QR yet",
        logoHint: "Shown on receipts, the customer ordering page and the restaurant list. Use a jpg, png or webp file up to 5MB.",
        coverHint: "The banner at the top of the ordering page customers see after scanning a QR code. Without one, a default image is used.",
        nameHint: "The name shown on receipts, the ordering page and every page of the system.",
        branchHint: "Tells branches of the same restaurant apart. With one location, Main branch is fine.",
        phoneHint: "The number printed on receipts for customers to reach the restaurant.",
        addressHint: "The address printed on receipts.",
        openHint: "When the restaurant starts taking orders.",
        closeHint: "When the restaurant stops taking orders.",
        tablesHint: "The restaurant's starting table count. It does not create tables automatically.",
        serviceHint: "Adds a service charge to the bill. The rate in use is recorded on the order when payment is taken.",
        serviceRateHint: "The service charge percentage, from 0 to 30.",
        vatHint: "Adds VAT to the bill. The rate in use is recorded on the order when payment is taken.",
        vatRateHint: "The VAT percentage, from 0 to 20.",
        promptpayNameHint: "The account name shown beside the QR code when a customer pays.",
        promptpayQrHint: "The restaurant's PromptPay QR code shown on the payment screen.",
        geofenceHint: "Stops someone who photographed a QR code from ordering off-site. If the customer's location cannot be read, the order waits for staff to confirm instead of being refused.",
        radiusHint: "How far from the restaurant a customer may order. 100-200 m allows for indoor GPS drift.",
        locateHint: "Fills in the coordinates from this device. Press it while at the restaurant.",
        noRestaurantHint: "Choose a restaurant first, then set it up here.",
        loadErrorHint: "The restaurant details have not loaded.",
        deleteTitle: "Delete restaurant",
        deleteAction: "Delete",
        save: "Save restaurant",
        saveError: "Could not save restaurant details.",
        uploadError: "Could not upload the logo.",
        uploadCoverError: "Could not upload the cover image.",
        uploadQrError: "Could not upload the QR code.",
        uploadHint: "Use a jpg, png or webp file up to 5MB.",
        validateName: "Enter the restaurant name.",
        validateBranch: "Enter the branch name.",
        validatePhone: "The phone number must be 9-10 digits.",
        validateOpen: "Open time must use HH:mm.",
        validateClose: "Close time must use HH:mm.",
        validateTables: "Table count must be between 1 and 500.",
        validateService: "Service charge must be between 0 and 30%.",
        validateVat: "VAT must be between 0 and 20%.",
        geofenceEnable: "Check the customer's location before ordering",
        latitude: "Latitude",
        longitude: "Longitude",
        radius: "Allowed radius (meters)",
        useCurrentLocation: "Use current location",
        geoFailed: "Could not use your location",
        geoUnsupported: "This device does not support location.",
        geoInsecure: "The browser blocked location because this page is served over an insecure connection. Open it via http://localhost:3000 or https, then try again.",
        geoDenied: "Location access was blocked. Click the site icon in the address bar → Site settings → Location → Allow, then try again.",
        geoUnavailable: "Location is unavailable right now. Make sure your device's GPS/Location is turned on.",
        geoTimeout: "Reading location timed out. Try again or move somewhere with a better GPS signal.",
        validateCoords: "Enter valid coordinates, or use the current location.",
        validateRadius: "Radius must be between 20 and 5000 meters.",
        dangerZone: "Delete restaurant",
        unnamed: "Unnamed restaurant",
        deleteWarning: "Deleting this restaurant permanently removes all tables, menus, members and orders. This cannot be undone.",
        confirmDeleteTitle: "Delete this restaurant?",
        confirmDeleteLabel: (name: string) => `Type “${name}” to confirm`,
        confirmDeleteBtn: "Delete restaurant",
        cancel: "Cancel",
        close: "Close",
        deleted: "Restaurant deleted.",
        deleteError: "Could not delete the restaurant.",
      };

  // Saving and uploading report through the global toast, where the person is
  // looking, never as a panel stacked into the form.
  const notifyError = useCallback(
    (title: string, message?: string, duration?: number) => showToast({ title, message, tone: "error", duration }),
    [showToast],
  );

  const closeDeleteModal = useCallback(() => {
    if (deleting || deleteModalClosing) return;
    setDeleteModalClosing(true);
    window.setTimeout(() => {
      setDeleteModalOpen(false);
      setDeleteModalClosing(false);
      setConfirmRestaurantName("");
    }, DIALOG_EXIT_MS);
  }, [deleteModalClosing, deleting]);
  const deleteBackdrop = useBackdropClose(closeDeleteModal);
  // Modal until the sheet has finished leaving, not just until it starts to:
  // releasing on close would hand focus back to the delete button while the
  // closing timer is still pending, and pressing it again then would have that
  // timer shut the dialog it had just reopened.
  useDialogFocus({
    open: deleteModalOpen,
    containerRef: deletePanelRef,
    onEscape: closeDeleteModal,
    initialFocusRef: confirmInputRef,
  });

  const handleDeleteRestaurant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!restaurantId || !isOwner || deleting || deleteModalClosing) return;
    if (confirmRestaurantName !== restaurant?.name) return;

    setDeleting(true);
    try {
      await deleteRestaurant(restaurantId);
      restaurantRepository.clearActiveId();
      showToast({ title: copy.deleted, tone: "success" });
      window.location.href = "/restaurants";
    } catch {
      // The app's own words, never the API's. The dialog stays open with the
      // name still typed, so trying again is one press.
      notifyError(copy.deleteError);
    } finally {
      setDeleting(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadTimer = window.setTimeout(() => {
      if (!restaurantId || !canManageRestaurant) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadFailed(false);
      getRestaurant(restaurantId)
        .then((res) => {
          if (!active) return;
          const loaded = toForm(res.data, language);
          savedRef.current = loaded;
          setRestaurant(res.data);
          setForm(loaded);
          setErrors({});
        })
        .catch(() => {
          if (active) setLoadFailed(true);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
    };
  }, [canManageRestaurant, language, loadAttempt, restaurantId]);

  const setField = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  // A failed location read is the outcome of pressing the button, so it goes
  // to the toast. Most of the reasons are a set of steps to follow, so they
  // stay up longer than the default.
  const notifyGeoFailure = (reason: string) => notifyError(copy.geoFailed, reason, GEO_TOAST_MS);

  // Fills the geofence coordinates from the device the owner is standing on,
  // so they can just open this page at the restaurant and tap once.
  const useCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      notifyGeoFailure(copy.geoUnsupported);
      return;
    }
    // Geolocation only runs in a secure context (https, or http://localhost).
    // Served over a plain-HTTP LAN origin (e.g. http://192.168.x.x:3000) the
    // browser blocks it silently and never shows the permission prompt, so name
    // that cause instead of the generic "please allow" message.
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      notifyGeoFailure(copy.geoInsecure);
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setErrors((current) => ({ ...current, latitude: undefined }));
        setLocating(false);
        commit(["latitude", "longitude"], {
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        });
      },
      (error) => {
        notifyGeoFailure(
          error.code === error.POSITION_UNAVAILABLE ? copy.geoUnavailable
            : error.code === error.TIMEOUT ? copy.geoTimeout
              : copy.geoDenied,
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  /**
   * Saves one setting the moment it is changed - there is no save button, as
   * on the reference settings page. Controls that pick a value (switch, list,
   * time) pass it in `override` and save at once; typed fields save when they
   * lose focus. `fields` decides what is taken from the screen: the location
   * check always travels as its four controls together.
   */
  const commit = (fields: FormField[], override: Partial<FormState> = {}) => {
    if (Object.keys(override).length) {
      formStateRef.current = { ...formStateRef.current, ...override };
      setForm((current) => ({ ...current, ...override }));
    }
    void enqueueSave(async () => {
      const saved = savedRef.current;
      if (!saved || !restaurantId) return;
      const plan = planCommit(saved, formStateRef.current, fields, copy);
      if (plan.kind === "unchanged") return;
      if (plan.kind === "invalid") {
        setErrors((current) => ({ ...current, ...plan.errors }));
        return;
      }
      const { candidate } = plan;
      try {
        const res = await updateRestaurant(restaurantId, buildRestaurantPayload(candidate, saved.slug));
        const next = toForm(res.data.restaurant, language);
        savedRef.current = next;
        setRestaurant(res.data.restaurant);
        setForm((current) => mergeSaved(current, next, fields));
        setErrors((current) => {
          const cleared = { ...current };
          for (const field of expandFields(fields)) delete cleared[field as keyof FormErrors];
          return cleared;
        });
        // The restaurant list and switcher show the name and branch.
        if (candidate.name !== saved.name || candidate.branch_name !== saved.branch_name) await refreshMemberships();
      } catch {
        // Put the control back to what is actually saved, so the screen never
        // shows a value the server does not have.
        setForm((current) => mergeSaved(current, saved, fields));
        notifyError(copy.saveError);
      }
    });
  };

  /** A switch saves as soon as it is flipped. */
  const commitSwitch = (field: "service_charge_enabled" | "vat_enabled" | "geofence_enabled", value: boolean) => {
    setErrors((current) => ({ ...current, latitude: undefined, order_radius_meters: undefined }));
    commit([field], { [field]: value });
  };

  // Logo, cover and PromptPay QR uploads only differ by endpoint, the field they
  // write back, and which busy flag they toggle.
  const createImageUpload = (
    field: ImageField,
    upload: (id: number, file: File) => Promise<{ data: { restaurant: Restaurant } }>,
    setBusy: (busy: boolean) => void,
    errorText: string,
  ) => async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !restaurantId) return;
    await runUploadOnce(async () => {
      setBusy(true);
      try {
        const res = await upload(restaurantId, file);
        const value = res.data.restaurant[field] ?? "";
        // The upload is saved already; the next setting's save builds on it.
        if (savedRef.current) savedRef.current = { ...savedRef.current, [field]: value };
        setForm((current) => ({ ...current, [field]: value }));
        setRestaurant((current) => (current ? { ...current, [field]: value } : current));
        await refreshMemberships();
      } catch {
        notifyError(errorText, copy.uploadHint);
      } finally {
        setBusy(false);
      }
    });
  };

  const uploadLogo = createImageUpload("logo", uploadRestaurantLogo, setUploading, copy.uploadError);
  const uploadCover = createImageUpload("cover_image", uploadRestaurantCover, setUploadingCover, copy.uploadCoverError);
  const uploadQr = createImageUpload("promptpay_qr_image", uploadRestaurantPromptPayQR, setUploadingQr, copy.uploadQrError);

  if (!canManageRestaurant) {
    return <PermissionDenied title={copy.denied} />;
  }

  if (!restaurantId) {
    return (
      <SettingsItem title={copy.noRestaurant} description={copy.noRestaurantHint}>
        <Link href="/restaurants" className={settingsButtonClass("primary", ACTION_WIDTH)}>{copy.goRestaurants}</Link>
      </SettingsItem>
    );
  }

  if (loading) {
    return <SettingsSkeleton label={copy.loading} rows={4} />;
  }

  if (loadFailed) {
    return (
      <SettingsActionRow title={copy.loadError} description={copy.loadErrorHint} variant="primary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
        {copy.retry}
      </SettingsActionRow>
    );
  }

  const deleteNameMatches = Boolean(restaurant?.name) && confirmRestaurantName === restaurant?.name;

  return (
    <>
      <div>
        <SettingsGroup id="identity" title={copy.identity}>
        <SettingsMediaRow
          title={copy.logo}
          description={copy.logoHint}
          imageSrc={form.logo}
          imageAlt={form.name || copy.logo}
          emptyLabel={copy.noLogo}
          uploadLabel={copy.upload}
          replaceLabel={copy.replace}
          busy={uploading}
          onFile={uploadLogo}
        />
        <SettingsMediaRow
          title={copy.coverImage}
          description={copy.coverHint}
          imageSrc={form.cover_image}
          imageAlt={form.name || copy.coverImage}
          emptyLabel={copy.noCover}
          shape="wide"
          uploadLabel={copy.upload}
          replaceLabel={copy.replace}
          busy={uploadingCover}
          onFile={uploadCover}
        />
        <SettingsField label={copy.name} description={copy.nameHint} value={form.name} onChange={(value) => setField("name", value)} onCommit={() => commit(["name"])} error={errors.name} />
        <SettingsField label={copy.branch} description={copy.branchHint} value={form.branch_name} onChange={(value) => setField("branch_name", value)} onCommit={() => commit(["branch_name"])} error={errors.branch_name} />
        <SettingsSelect
          label={copy.type}
          value={form.restaurant_type}
          onChange={(value) => commit(["restaurant_type"], { restaurant_type: value })}
          options={RESTAURANT_TYPES.map((item) => ({ value: item, label: getRestaurantTypeLabel(item, language) }))}
        />
        <SettingsField label={copy.phone} description={copy.phoneHint} value={form.phone} onChange={(value) => setField("phone", normalizePhone(value))} onCommit={() => commit(["phone"])} error={errors.phone} inputMode="tel" autoComplete="tel" />
        <SettingsTextArea label={copy.address} description={copy.addressHint} value={form.address} onChange={(value) => setField("address", value)} onCommit={() => commit(["address"])} />
        </SettingsGroup>
        <SettingsGroup id="operations" title={copy.operations}>
        <SettingsField label={copy.openTime} description={copy.openHint} type="time" value={form.open_time} onChange={(value) => commit(["open_time"], { open_time: value })} error={errors.open_time} />
        <SettingsField label={copy.closeTime} description={copy.closeHint} type="time" value={form.close_time} onChange={(value) => commit(["close_time"], { close_time: value })} error={errors.close_time} />
        <SettingsField label={copy.tableCount} description={copy.tablesHint} value={form.table_count} onChange={(value) => setField("table_count", value)} onCommit={() => commit(["table_count"])} error={errors.table_count} inputMode="numeric" />
        </SettingsGroup>
        <SettingsGroup id="billing" title={copy.billing}>
        <SettingsSwitch label={copy.service} description={copy.serviceHint} checked={form.service_charge_enabled} onChange={(value) => commitSwitch("service_charge_enabled", value)} />
        <SettingsField label={`${copy.service} (%)`} description={copy.serviceRateHint} value={form.service_charge_rate} onChange={(value) => setField("service_charge_rate", value)} onCommit={() => commit(["service_charge_rate"])} error={errors.service_charge_rate} inputMode="decimal" />
        <SettingsSwitch label={copy.vat} description={copy.vatHint} checked={form.vat_enabled} onChange={(value) => commitSwitch("vat_enabled", value)} />
        <SettingsField label={`${copy.vat} (%)`} description={copy.vatRateHint} value={form.vat_rate} onChange={(value) => setField("vat_rate", value)} onCommit={() => commit(["vat_rate"])} error={errors.vat_rate} inputMode="decimal" />
        </SettingsGroup>
        <SettingsGroup id="promptpay" title={copy.promptpay}>
        <SettingsField label={copy.promptpayName} description={copy.promptpayNameHint} value={form.promptpay_name} onChange={(value) => setField("promptpay_name", value)} onCommit={() => commit(["promptpay_name"])} />
        <SettingsMediaRow
          title={copy.promptpayQr}
          description={copy.promptpayQrHint}
          imageSrc={form.promptpay_qr_image}
          imageAlt={copy.promptpayQr}
          emptyLabel={copy.noQr}
          fit="contain"
          uploadLabel={copy.upload}
          replaceLabel={copy.replace}
          busy={uploadingQr}
          onFile={uploadQr}
        />
        </SettingsGroup>
        <SettingsGroup id="qr" title={copy.qrOrdering}>
        {/* Turning the check on with no coordinates yet cannot be saved: the
            switch stays on here, the missing value is said under its field,
            and the check saves once the coordinates are in. */}
        <SettingsSwitch label={copy.geofenceEnable} description={copy.geofenceHint} checked={form.geofence_enabled} onChange={(value) => commitSwitch("geofence_enabled", value)} />
        {form.geofence_enabled ? (
          <>
            <SettingsField label={copy.latitude} value={form.latitude} onChange={(value) => setField("latitude", value)} onCommit={() => commit(GEOFENCE_FIELDS)} error={errors.latitude} inputMode="decimal" placeholder="13.736717" />
            <SettingsField label={copy.longitude} value={form.longitude} onChange={(value) => setField("longitude", value)} onCommit={() => commit(GEOFENCE_FIELDS)} inputMode="decimal" placeholder="100.523186" />
            <SettingsField label={copy.radius} description={copy.radiusHint} value={form.order_radius_meters} onChange={(value) => setField("order_radius_meters", value)} onCommit={() => commit(GEOFENCE_FIELDS)} error={errors.order_radius_meters} inputMode="numeric" />
            <SettingsActionRow title={copy.useCurrentLocation} description={copy.locateHint} loading={locating} onClick={useCurrentLocation}>
              {copy.useCurrentLocation}
            </SettingsActionRow>
          </>
        ) : null}
        </SettingsGroup>
      </div>

      {/* Only the owner can delete a restaurant, so nobody else is shown the
          control at all. */}
      {isOwner ? (
        <SettingsGroup id="delete" title={copy.dangerZone}>
        <SettingsActionRow
          title={copy.deleteTitle}
          description={copy.deleteWarning}
          variant="danger-secondary"
          aria-label={`${copy.deleteAction} ${restaurant?.name?.trim() || copy.unnamed}`}
          onClick={() => {
            setDeleteModalClosing(false);
            setDeleteModalOpen(true);
          }}
        >
          {copy.deleteAction}
        </SettingsActionRow>
        </SettingsGroup>
      ) : null}

      {deleteModalOpen && (
        <div
          {...deleteBackdrop}
          className={`${deleteModalClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-gray-950/45 px-3 pb-3 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-0`}
        >
          <form
            ref={deletePanelRef}
            onSubmit={handleDeleteRestaurant}
            role="dialog"
            aria-modal="true"
            aria-labelledby={deleteTitleId}
            aria-describedby={deleteBodyId}
            className={`${deleteModalClosing ? "motion-bottom-sheet-exit" : "motion-bottom-sheet"} flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-900`}
          >
            <div className="flex items-start gap-3 border-b border-gray-200 px-4 py-4 dark:border-gray-800">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                <AlertTriangle aria-hidden="true" className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id={deleteTitleId} className="text-[15px] font-semibold text-gray-950 dark:text-white">{copy.confirmDeleteTitle}</h2>
                <p id={deleteBodyId} className="mt-1 text-[13px] leading-5 text-gray-600 dark:text-gray-400">{copy.deleteWarning}</p>
              </div>
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={deleting}
                aria-label={copy.close}
                className={`-mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-md text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white sm:h-10 sm:w-10 ${FOCUS_RING}`}
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto px-4 py-4">
              <label htmlFor={confirmInputId} className="mb-2 block text-[14px] text-gray-950 dark:text-white">
                {copy.confirmDeleteLabel(restaurant?.name ?? "")}
              </label>
              <SettingsInput
                id={confirmInputId}
                errorId={confirmErrorId}
                inputRef={confirmInputRef}
                value={confirmRestaurantName}
                onChange={setConfirmRestaurantName}
                autoComplete="off"
                fullWidth
              />
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-800 sm:flex-row sm:justify-end">
              <SettingsButton onClick={closeDeleteModal} disabled={deleting}>{copy.cancel}</SettingsButton>
              <SettingsButton type="submit" variant="danger" loading={deleting} disabled={!deleteNameMatches}>
                {copy.confirmDeleteBtn}
              </SettingsButton>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
