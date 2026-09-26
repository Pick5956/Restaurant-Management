"use client";

import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, Camera, Clock, ImagePlus, MapPin, QrCode, Receipt, Trash2, Wallet, X } from "lucide-react";
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
import { MobileInput, MobileLabel, MobilePills, MobileSection, MobileStepper, MobileSwitchTile, billPreview, useSettingsPhone } from "../_components/SettingsMobileKit";

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
  // Phone look (SettingsMobileKit): its own file inputs, and whether a rate is
  // being typed rather than picked from the pills.
  const phone = useSettingsPhone();
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const qrInputRef = useRef<HTMLInputElement>(null);
  const typeSelectId = useId();
  const [customRate, setCustomRate] = useState<Record<"service_charge_rate" | "vat_rate", boolean>>({ service_charge_rate: false, vat_rate: false });
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

  const deleteModal = deleteModalOpen && (
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
      );

  if (phone) {
    const th = language === "th";
    const serviceRate = Number(form.service_charge_rate);
    const vatRate = Number(form.vat_rate);
    const preview = billPreview(100, form.service_charge_enabled, serviceRate, form.vat_enabled, vatRate);
    const money = (value: number) => value.toLocaleString(th ? "th-TH" : "en-US", { maximumFractionDigits: 2 });
    const tables = Math.min(500, Math.max(1, Number(form.table_count) || 1));
    // A rate is a pill when it is one of the usual ones, and typed otherwise.
    const ratePills = (field: "service_charge_rate" | "vat_rate", presets: string[]) => {
      const current = String(Number(form[field]));
      const custom = !presets.includes(current);
      return (
        <>
          <MobilePills
            label={field === "vat_rate" ? copy.vat : copy.service}
            value={custom || customRate[field] ? "custom" : current}
            onChange={(next) => {
              if (next === "custom") {
                setCustomRate((open) => ({ ...open, [field]: true }));
                return;
              }
              setCustomRate((open) => ({ ...open, [field]: false }));
              commit([field], { [field]: next });
            }}
            options={[...presets.map((rate) => ({ value: rate, label: `${rate}%` })), { value: "custom", label: th ? "อื่น ๆ" : "Other" }]}
          />
          {custom || customRate[field] ? (
            <MobileInput
              className="mb-0 mt-3"
              label={th ? "อัตรา" : "Rate"}
              value={form[field]}
              suffix="%"
              inputMode="decimal"
              onChange={(value) => setField(field, value)}
              onCommit={() => commit([field])}
              error={errors[field]}
            />
          ) : null}
        </>
      );
    };
    const cover = (
      <div>
        <input ref={coverInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadCover} tabIndex={-1} />
        <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadLogo} tabIndex={-1} />
        <div className="relative h-[120px] bg-gradient-to-br from-orange-200 to-orange-300 dark:from-orange-900/60 dark:to-orange-800/40">
          {form.cover_image ? <Image src={form.cover_image} alt="" fill unoptimized className="object-cover" /> : null}
          <button
            type="button"
            disabled={uploadingCover}
            onClick={() => coverInputRef.current?.click()}
            className={`ui-press absolute right-3 top-3 inline-flex min-h-[32px] items-center gap-1.5 rounded-full bg-white/90 px-3 text-[12px] font-semibold text-gray-800 disabled:opacity-60 ${FOCUS_RING}`}
          >
            <Camera aria-hidden="true" className="h-3.5 w-3.5" />
            {uploadingCover ? "…" : th ? "เปลี่ยนภาพปก" : "Change cover"}
          </button>
          <button
            type="button"
            disabled={uploading}
            onClick={() => logoInputRef.current?.click()}
            aria-label={`${form.logo ? copy.replace : copy.upload} ${copy.logo}`}
            className="absolute -bottom-7 left-4 flex h-16 w-16 items-center justify-center overflow-hidden rounded-[18px] border-[3px] border-(--inv-surface) bg-(--inv-surface) text-[11px] text-(--inv-muted) shadow-md disabled:opacity-60"
          >
            {form.logo ? <Image src={form.logo} alt="" width={64} height={64} unoptimized className="h-full w-full object-cover" /> : copy.logo}
          </button>
        </div>
        <div className="px-4 pb-1 pt-9">
          <h2 className="truncate text-[18px] font-bold text-(--inv-heading)">{form.name || copy.unnamed}</h2>
          <p className="truncate text-[12.5px] text-(--inv-muted)">
            {[getRestaurantTypeLabel(form.restaurant_type, language), form.branch_name].filter(Boolean).join(" · ")}
          </p>
        </div>
      </div>
    );
    return (
      <>
        <div className="flex flex-col gap-4">
          <MobileSection id="identity" title={copy.identity} keywords={[copy.logo, copy.coverImage, copy.name, copy.branch, copy.type, copy.phone, copy.address].join(" ")} hero={cover}>
            <div className="pt-3">
              <MobileInput label={copy.name} value={form.name} onChange={(value) => setField("name", value)} onCommit={() => commit(["name"])} error={errors.name} />
              <div className="grid grid-cols-2 gap-2.5">
                <MobileInput label={copy.branch} value={form.branch_name} onChange={(value) => setField("branch_name", value)} onCommit={() => commit(["branch_name"])} error={errors.branch_name} />
                <div className="mb-3">
                  <MobileLabel htmlFor={typeSelectId}>{copy.type}</MobileLabel>
                  <select
                    id={typeSelectId}
                    value={form.restaurant_type}
                    onChange={(event) => commit(["restaurant_type"], { restaurant_type: event.target.value })}
                    className="h-12 w-full min-w-0 rounded-[14px] bg-(--inv-canvas) px-3 text-[16px] text-(--inv-heading) outline-none focus:ring-2 focus:ring-(--inv-action)/30"
                  >
                    {RESTAURANT_TYPES.map((item) => (
                      <option key={item} value={item}>{getRestaurantTypeLabel(item, language)}</option>
                    ))}
                  </select>
                </div>
              </div>
              <MobileInput label={copy.phone} value={form.phone} placeholder="0x-xxx-xxxx" onChange={(value) => setField("phone", normalizePhone(value))} onCommit={() => commit(["phone"])} error={errors.phone} inputMode="tel" autoComplete="tel" />
              <MobileInput className="mb-0" label={copy.address} value={form.address} placeholder={copy.addressHint} multiline onChange={(value) => setField("address", value)} onCommit={() => commit(["address"])} />
            </div>
          </MobileSection>

          <MobileSection
            id="operations"
            title={copy.operations}
            summary={form.open_time && form.close_time ? `${th ? "เปิดรับออเดอร์" : "Open"} ${form.open_time} – ${form.close_time}` : copy.openHint}
            icon={Clock}
            tone="bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300"
            keywords={[copy.openTime, copy.closeTime, copy.tableCount].join(" ")}
          >
            <div className="mb-3.5 flex items-center gap-2.5">
              {(["open_time", "close_time"] as const).map((field) => (
                <label key={field} className="flex-1 rounded-2xl bg-(--inv-canvas) px-3.5 py-2.5">
                  <span className="block text-[12px] text-(--inv-muted)">{field === "open_time" ? copy.openTime : copy.closeTime}</span>
                  <input
                    type="time"
                    value={form[field]}
                    onChange={(event) => commit([field], { [field]: event.target.value })}
                    className="w-full bg-transparent text-[24px] font-bold tabular-nums text-(--inv-heading) outline-none"
                    aria-label={field === "open_time" ? copy.openTime : copy.closeTime}
                  />
                </label>
              ))}
            </div>
            {errors.open_time || errors.close_time ? <p className="-mt-2 mb-2 text-[12px] text-red-600">{errors.open_time || errors.close_time}</p> : null}
            <MobileStepper
              label={copy.tableCount}
              value={tables}
              min={1}
              max={500}
              onChange={(next) => commit(["table_count"], { table_count: String(next) })}
            />
            <p className="mt-2 ml-0.5 text-[12px] leading-[17px] text-(--inv-muted)">{copy.tablesHint}</p>
          </MobileSection>

          <MobileSection
            id="billing"
            title={copy.billing}
            summary={`Service ${form.service_charge_enabled ? `${form.service_charge_rate}%` : th ? "ปิด" : "off"} · VAT ${form.vat_enabled ? `${form.vat_rate}%` : th ? "ปิด" : "off"}`}
            icon={Receipt}
            tone="bg-(--inv-ok-soft) text-(--inv-ok)"
            keywords={[copy.service, copy.vat].join(" ")}
          >
            <MobileSwitchTile title={copy.service} hint={form.service_charge_enabled ? undefined : copy.serviceHint} checked={form.service_charge_enabled} onChange={(value) => commitSwitch("service_charge_enabled", value)}>
              {form.service_charge_enabled ? ratePills("service_charge_rate", ["5", "10", "15"]) : null}
            </MobileSwitchTile>
            <MobileSwitchTile title={copy.vat} hint={form.vat_enabled ? undefined : copy.vatHint} checked={form.vat_enabled} onChange={(value) => commitSwitch("vat_enabled", value)}>
              {form.vat_enabled ? ratePills("vat_rate", ["7"]) : null}
            </MobileSwitchTile>
            <div className="rounded-2xl border border-dashed border-(--inv-surface-strong) px-3.5 py-2.5 text-[13px] text-(--inv-body)">
              <p className="mb-1 text-[11.5px] font-semibold text-(--inv-muted)">{th ? "ตัวอย่างบิล 100 บาท" : "A 100-baht bill"}</p>
              <p className="flex justify-between"><span>{th ? "อาหาร" : "Food"}</span><span className="tabular-nums">100</span></p>
              {preview.service ? <p className="flex justify-between"><span>Service {form.service_charge_rate}%</span><span className="tabular-nums">{money(preview.service)}</span></p> : null}
              {preview.vat ? <p className="flex justify-between"><span>VAT {form.vat_rate}%</span><span className="tabular-nums">{money(preview.vat)}</span></p> : null}
              <p className="mt-1 flex justify-between border-t border-(--inv-hairline) pt-1 font-bold text-(--inv-heading)">
                <span>{th ? "ลูกค้าจ่าย" : "Guest pays"}</span><span className="tabular-nums">{money(preview.total)} {th ? "บาท" : "THB"}</span>
              </p>
            </div>
          </MobileSection>

          <MobileSection
            id="promptpay"
            title={copy.promptpay}
            summary={form.promptpay_qr_image ? (th ? "มี QR แล้ว · ลูกค้าเห็นตอนจ่าย" : "QR set") : th ? "ยังไม่มี QR" : "No QR yet"}
            icon={Wallet}
            tone="bg-violet-100 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300"
            keywords={[copy.promptpayName, copy.promptpayQr].join(" ")}
          >
            <input ref={qrInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={uploadQr} tabIndex={-1} />
            <div className="flex items-end gap-3.5">
              <button
                type="button"
                disabled={uploadingQr}
                onClick={() => qrInputRef.current?.click()}
                aria-label={`${form.promptpay_qr_image ? copy.replace : copy.upload} ${copy.promptpayQr}`}
                className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-(--inv-surface-strong) text-center text-[12px] leading-4 text-(--inv-faint) disabled:opacity-60"
              >
                {form.promptpay_qr_image ? (
                  <Image src={form.promptpay_qr_image} alt="" width={96} height={96} unoptimized className="h-full w-full object-contain" />
                ) : (
                  <span className="flex flex-col items-center gap-1"><ImagePlus aria-hidden="true" className="h-5 w-5" />{th ? "อัปโหลด QR" : "Upload QR"}</span>
                )}
              </button>
              <MobileInput className="mb-0 flex-1" label={copy.promptpayName} value={form.promptpay_name} onChange={(value) => setField("promptpay_name", value)} onCommit={() => commit(["promptpay_name"])} />
            </div>
          </MobileSection>

          <MobileSection
            id="qr"
            title={copy.qrOrdering}
            summary={form.geofence_enabled ? `${th ? "ตรวจตำแหน่ง · รัศมี" : "Location check ·"} ${form.order_radius_meters || "—"} ${th ? "ม." : "m"}` : th ? "กันคนถ่าย QR ไปสั่งจากนอกร้าน" : copy.geofenceHint}
            icon={QrCode}
            tone="bg-(--inv-low-soft) text-amber-700 dark:text-amber-300"
            keywords={[copy.geofenceEnable, copy.latitude, copy.longitude, copy.radius].join(" ")}
          >
            <MobileSwitchTile title={copy.geofenceEnable} checked={form.geofence_enabled} onChange={(value) => commitSwitch("geofence_enabled", value)} />
            {form.geofence_enabled ? (
              <>
                <div
                  aria-hidden="true"
                  className="relative mb-3 h-[120px] rounded-2xl bg-[radial-gradient(circle_at_50%_55%,rgba(197,60,0,.22)_0_38px,rgba(197,60,0,.08)_39px_58px,var(--inv-canvas)_59px)]"
                >
                  <span className="absolute left-1/2 top-[55%] h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-(--inv-action)" />
                  <span className="absolute bottom-2 right-2.5 rounded-full bg-(--inv-surface) px-2.5 py-0.5 text-[12px] font-semibold text-(--inv-heading)">
                    {th ? "รัศมี" : "Radius"} {form.order_radius_meters || "—"} {th ? "ม." : "m"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={useCurrentLocation}
                  disabled={locating}
                  className={`ui-press mb-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[14px] bg-(--inv-action-soft) text-[14px] font-semibold text-(--inv-action) disabled:opacity-60 ${FOCUS_RING}`}
                >
                  <MapPin aria-hidden="true" className="h-4 w-4" />
                  {locating ? "…" : copy.useCurrentLocation}
                </button>
                <div className="grid grid-cols-2 gap-2.5">
                  <MobileInput label={copy.latitude} value={form.latitude} placeholder="13.736717" inputMode="decimal" onChange={(value) => setField("latitude", value)} onCommit={() => commit(GEOFENCE_FIELDS)} error={errors.latitude} />
                  <MobileInput label={copy.longitude} value={form.longitude} placeholder="100.523186" inputMode="decimal" onChange={(value) => setField("longitude", value)} onCommit={() => commit(GEOFENCE_FIELDS)} />
                </div>
                <MobileInput className="mb-0" label={copy.radius} value={form.order_radius_meters} suffix={th ? "ม." : "m"} inputMode="numeric" onChange={(value) => setField("order_radius_meters", value)} onCommit={() => commit(GEOFENCE_FIELDS)} error={errors.order_radius_meters} />
              </>
            ) : null}
          </MobileSection>

          {isOwner ? (
            <MobileSection id="delete" title={copy.deleteTitle} summary={copy.deleteWarning} icon={Trash2} tone="bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400" danger>
              <button
                type="button"
                onClick={() => {
                  setDeleteModalClosing(false);
                  setDeleteModalOpen(true);
                }}
                aria-label={`${copy.deleteAction} ${restaurant?.name?.trim() || copy.unnamed}`}
                className={`ui-press flex min-h-[44px] w-full items-center justify-center rounded-[14px] border border-red-200 bg-(--inv-surface) text-[15px] font-semibold text-red-600 dark:border-red-900/60 dark:text-red-400 ${FOCUS_RING}`}
              >
                {copy.deleteAction}
              </button>
            </MobileSection>
          ) : null}
        </div>
        {deleteModal}
      </>
    );
  }


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

      {deleteModal}
    </>
  );
}
