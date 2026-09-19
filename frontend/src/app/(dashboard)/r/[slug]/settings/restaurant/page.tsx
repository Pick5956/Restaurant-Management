"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import { createSingleFlight } from "@/src/lib/singleFlight";
import { can } from "@/src/lib/rbac";
import { getRestaurant, updateRestaurant, uploadRestaurantLogo, uploadRestaurantCover, uploadRestaurantPromptPayQR, deleteRestaurant } from "@/src/lib/restaurant";
import type { Restaurant } from "@/src/types/restaurant";
import { RESTAURANT_TYPES, getRestaurantTypeLabel } from "@/src/app/restaurants/restaurantWorkspaceUi";
import { Field, SettingsPanel, SettingsShell, TextAreaField } from "../_components/SettingsPrimitives";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { restaurantRepository } from "@/src/app/repositories/restaurantRepository";
import RestaurantSlugField, { useRestaurantSlugStatus } from "@/src/components/shared/RestaurantSlugField";
import { apiErrorCode } from "@/src/lib/apiErrors";
import { isValidRestaurantSlug, restaurantHref } from "@/src/lib/restaurantPath";

type FormState = {
  name: string;
  slug: string;
  branch_name: string;
  restaurant_type: string;
  phone: string;
  address: string;
  open_time: string;
  close_time: string;
  table_count: string;
  logo: string;
  cover_image: string;
  service_charge_enabled: boolean;
  service_charge_rate: string;
  vat_enabled: boolean;
  vat_rate: string;
  promptpay_name: string;
  promptpay_qr_image: string;
  geofence_enabled: boolean;
  latitude: string;
  longitude: string;
  order_radius_meters: string;
};

type FormErrors = Partial<Record<"name" | "slug" | "branch_name" | "phone" | "open_time" | "close_time" | "table_count" | "service_charge_rate" | "vat_rate" | "latitude" | "order_radius_meters", string>>;

/** Restaurant image fields that are uploaded one file at a time. */
type ImageField = "logo" | "cover_image" | "promptpay_qr_image";

// Thai numbers are 9 digits (landline) or 10 (mobile), so keep digits only and
// stop the input at 10 instead of letting it grow past a real phone number.
const PHONE_MAX_DIGITS = 10;

function normalizePhone(value: string) {
  return value.replace(/\D/g, "").slice(0, PHONE_MAX_DIGITS);
}

function validateTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function toForm(restaurant?: Partial<Restaurant> | null, language: "th" | "en" = "th"): FormState {
  return {
    name: restaurant?.name ?? "",
    slug: restaurant?.slug ?? "",
    branch_name: restaurant?.branch_name?.trim() || (language === "th" ? "สาขาหลัก" : "Main branch"),
    restaurant_type: restaurant?.restaurant_type?.trim() || RESTAURANT_TYPES[0],
    phone: normalizePhone(restaurant?.phone ?? ""),
    address: restaurant?.address ?? "",
    open_time: restaurant?.open_time || "17:00",
    close_time: restaurant?.close_time || "00:00",
    table_count: restaurant?.table_count ? String(restaurant.table_count) : "12",
    logo: restaurant?.logo ?? "",
    cover_image: restaurant?.cover_image ?? "",
    service_charge_enabled: Boolean(restaurant?.service_charge_enabled),
    service_charge_rate: String(restaurant?.service_charge_rate ?? 10),
    vat_enabled: Boolean(restaurant?.vat_enabled),
    vat_rate: String(restaurant?.vat_rate ?? 7),
    promptpay_name: restaurant?.promptpay_name ?? "",
    promptpay_qr_image: restaurant?.promptpay_qr_image ?? "",
    geofence_enabled: Boolean(restaurant?.order_radius_meters && restaurant.latitude != null && restaurant.longitude != null),
    latitude: restaurant?.latitude != null ? String(restaurant.latitude) : "",
    longitude: restaurant?.longitude != null ? String(restaurant.longitude) : "",
    order_radius_meters: restaurant?.order_radius_meters ? String(restaurant.order_radius_meters) : "150",
  };
}

export default function RestaurantSettingsPage() {
  const { activeMembership, refreshMemberships } = useAuth();
  const { language } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverFileInputRef = useRef<HTMLInputElement>(null);
  const qrFileInputRef = useRef<HTMLInputElement>(null);
  const saveOnceRef = useRef(createSingleFlight());
  const [runUploadOnce] = useState(() => createSingleFlight());
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [form, setForm] = useState<FormState>(() => toForm(null, language));
  const [errors, setErrors] = useState<FormErrors>({});
  // Bumped when the opening time is done, which opens the closing-time wheel.
  const [closeTimeSignal, setCloseTimeSignal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingQr, setUploadingQr] = useState(false);
  const [locating, setLocating] = useState(false);
  const canManageRestaurant = can(activeMembership, "manage_restaurant_settings");
  const restaurantId = activeMembership?.restaurant_id;
  const { showToast } = useToast();
  const slugStatus = useRestaurantSlugStatus(form.slug, { restaurantId, savedSlug: restaurant?.slug });
  const isOwner = activeMembership?.role?.name === "owner";

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteModalClosing, setDeleteModalClosing] = useState(false);
  const [confirmRestaurantName, setConfirmRestaurantName] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const closeDeleteModal = () => {
    if (deleting || deleteModalClosing) return;
    setDeleteModalClosing(true);
    window.setTimeout(() => {
      setDeleteModalOpen(false);
      setDeleteModalClosing(false);
      setConfirmRestaurantName("");
      setDeleteError("");
    }, 180);
  };
  const deleteBackdrop = useBackdropClose(closeDeleteModal);

  const handleDeleteRestaurant = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!restaurantId || !isOwner || deleting) return;
    if (confirmRestaurantName !== restaurant?.name) {
      setDeleteError(language === "th" ? "ชื่อร้านอาหารไม่ถูกต้อง" : "Incorrect restaurant name");
      return;
    }

    setDeleting(true);
    setDeleteError("");
    try {
      await deleteRestaurant(restaurantId);
      restaurantRepository.clearActiveId();
      showToast({ title: language === "th" ? "ลบร้านอาหารสำเร็จแล้ว" : "Restaurant successfully deleted" });
      window.location.href = "/restaurants";
    } catch (err: unknown) {
      const errorResponse = err as { response?: { data?: { error?: string } } };
      const errMsg = errorResponse.response?.data?.error || (language === "th" ? "เกิดข้อผิดพลาดในการลบร้านอาหาร" : "An error occurred while deleting the restaurant");
      setDeleteError(errMsg);
    } finally {
      setDeleting(false);
    }
  };

  const copy = language === "th"
    ? {
        eyebrow: "Restaurant",
        title: "ข้อมูลร้านและการคิดเงิน",
        subtitle: "ตั้งค่าข้อมูลร้านที่มีผลกับบิลและการทำงานหน้าร้าน สำหรับบัญชีที่ได้รับสิทธิ์",
        back: "ตั้งค่า",
        denied: "บัญชีนี้ยังไม่มีสิทธิ์จัดการการตั้งค่าร้าน",
        loading: "กำลังโหลดข้อมูลร้าน...",
        noRestaurant: "ยังไม่มีร้านที่เลือกอยู่",
        goRestaurants: "ไปหน้าเลือกร้าน",
        identity: "ข้อมูลร้าน",
        identityHint: "ข้อมูลนี้ใช้แสดงในระบบและใช้กับใบเสร็จ",
        operations: "เวลาและจำนวนโต๊ะ",
        operationsHint: "ตั้งค่าเริ่มต้นของร้าน ไม่ได้สร้างโต๊ะเพิ่มอัตโนมัติ",
        billing: "การคิดเงิน",
        billingHint: "ค่าจะถูก snapshot ลงออเดอร์ตอนยืนยันรับเงิน",
        logo: "โลโก้ร้าน",
        upload: "อัปโหลดโลโก้",
        uploading: "กำลังอัปโหลด...",
        noLogo: "ไม่มีโลโก้",
        coverImage: "รูปภาพพื้นหลังร้าน",
        uploadCover: "อัปโหลดรูปพื้นหลัง",
        uploadingCover: "กำลังอัปโหลดรูปพื้นหลัง...",
        noCover: "ไม่มีรูปพื้นหลัง (ใช้ภาพตั้งต้น)",
        name: "ชื่อร้าน",
        slug: "ลิงก์ร้าน",
        slugTaken: "มีร้านใช้ชื่อนี้แล้ว",
        slugInvalid: "ใช้ a–z, 0–9 และ - ได้ 3–40 ตัว และต้องมีตัวอักษร",
        branch: "ชื่อสาขา",
        branchHelp: "ถ้ามีร้านเดียวใช้สาขาหลักได้",
        type: "ประเภทร้าน",
        phone: "เบอร์ร้าน",
        address: "ที่อยู่ร้าน",
        openTime: "เวลาเปิด",
        closeTime: "เวลาปิด",
        tableCount: "จำนวนโต๊ะตั้งต้น",
        service: "Service charge",
        serviceHelp: "เช่น 10%",
        vat: "VAT",
        vatHelp: "เช่น 7%",
        promptpayName: "ชื่อบัญชีรับเงิน",
        promptpayQr: "QR Code รับเงิน (PromptPay)",
        uploadQr: "อัปโหลด QR",
        uploadingQr: "กำลังอัปโหลด QR...",
        noQr: "ยังไม่มี QR",
        save: "บันทึกข้อมูลร้าน",
        saving: "กำลังบันทึก...",
        saved: "บันทึกข้อมูลร้านแล้ว",
        saveError: "บันทึกข้อมูลร้านไม่สำเร็จ",
        logoUploaded: "อัปโหลดโลโก้แล้ว",
        coverUploaded: "อัปโหลดรูปพื้นหลังแล้ว",
        qrUploaded: "อัปโหลด QR รับเงินแล้ว",
        uploadError: "อัปโหลดโลโก้ไม่สำเร็จ",
        uploadCoverError: "อัปโหลดรูปพื้นหลังไม่สำเร็จ",
        uploadQrError: "อัปโหลด QR ไม่สำเร็จ",
        validateName: "กรุณากรอกชื่อร้าน",
        validateBranch: "กรุณากรอกชื่อสาขา",
        validatePhone: "เบอร์โทรต้องมี 9-10 หลัก",
        validateOpen: "เวลาเปิดต้องอยู่ในรูปแบบ HH:mm",
        validateClose: "เวลาปิดต้องอยู่ในรูปแบบ HH:mm",
        validateTables: "จำนวนโต๊ะต้องอยู่ระหว่าง 1 ถึง 500",
        geofenceTitle: "ตรวจสอบตำแหน่งก่อนสั่งผ่าน QR",
        geofenceHint: "ป้องกันการถ่าย QR Code ไปสั่งจากนอกร้าน",
        geofenceEnable: "เปิดใช้งานการตรวจตำแหน่ง",
        latitude: "ละติจูด",
        longitude: "ลองจิจูด",
        radius: "รัศมีที่อนุญาต (เมตร)",
        radiusHelp: "แนะนำ 100-200 เมตร เผื่อความคลาดเคลื่อนของ GPS ในอาคาร",
        useCurrentLocation: "ใช้ตำแหน่งปัจจุบัน",
        locating: "กำลังอ่านตำแหน่ง...",
        geoUnsupported: "อุปกรณ์นี้ไม่รองรับการอ่านตำแหน่ง",
        geoInsecure: "เบราว์เซอร์บล็อกการอ่านตำแหน่งเพราะหน้านี้เปิดผ่านการเชื่อมต่อที่ไม่ปลอดภัย ให้เปิดผ่าน http://localhost:3000 หรือ https แล้วลองใหม่",
        geoDenied: "การเข้าถึงตำแหน่งถูกปฏิเสธ ไปที่ไอคอนหน้าเว็บ (แถบ URL) → การตั้งค่าเว็บไซต์ → ตำแหน่ง → อนุญาต แล้วลองใหม่",
        geoUnavailable: "อ่านตำแหน่งไม่ได้ในขณะนี้ ตรวจสอบว่าเปิด GPS/Location ของอุปกรณ์แล้ว",
        geoTimeout: "อ่านตำแหน่งหมดเวลา ลองใหม่อีกครั้ง หรือย้ายไปที่รับสัญญาณ GPS ได้ดีขึ้น",
        validateCoords: "กรุณากรอกพิกัดให้ถูกต้อง (หรือกดใช้ตำแหน่งปัจจุบัน)",
        validateRadius: "รัศมีต้องอยู่ระหว่าง 20 ถึง 5000 เมตร",
        dangerZone: "พื้นที่อันตราย / ลบร้านอาหาร",
        dangerZoneHint: "การดำเนินการที่เป็นอันตรายและไม่สามารถย้อนกลับได้",
        deleteRestaurant: "ลบร้านอาหารนี้",
        deleteWarning: "การลบร้านอาหารจะลบข้อมูลโต๊ะ เมนู สมาชิก ออเดอร์ทั้งหมด และไม่สามารถกู้คืนได้อีก",
        onlyOwnerCanDelete: "เฉพาะเจ้าของร้านเท่านั้นที่สามารถลบร้านได้",
        confirmDeleteTitle: "ยืนยันการลบร้านอาหาร",
        confirmDeleteSubtitle: "กรุณาพิมพ์ชื่อร้านอาหารเพื่อยืนยันการลบ",
        confirmDeleteInputPlaceholder: "พิมพ์ชื่อร้านอาหารเพื่อยืนยัน",
        confirmDeleteBtn: "ยืนยันการลบร้านอาหาร",
        cancel: "ยกเลิก",
        deleting: "กำลังลบ...",
      }
    : {
        eyebrow: "Restaurant",
        title: "Restaurant and billing",
        subtitle: "Restaurant settings that affect bills and live operations, available to accounts with permission.",
        back: "Settings",
        denied: "This account does not have permission to manage restaurant settings.",
        loading: "Loading restaurant details...",
        noRestaurant: "No active restaurant selected",
        goRestaurants: "Go to restaurants",
        identity: "Restaurant profile",
        identityHint: "These details appear in the system and on receipts.",
        operations: "Hours and tables",
        operationsHint: "Default restaurant settings. This does not auto-create tables.",
        billing: "Billing and PromptPay",
        billingHint: "Values are snapshotted to orders when payment is confirmed.",
        logo: "Restaurant logo",
        upload: "Upload logo",
        uploading: "Uploading...",
        noLogo: "No logo",
        coverImage: "Restaurant cover image",
        uploadCover: "Upload cover image",
        uploadingCover: "Uploading cover...",
        noCover: "No cover image (using default)",
        name: "Restaurant name",
        slug: "Restaurant link",
        slugTaken: "Another restaurant already uses this name",
        slugInvalid: "Use 3–40 of a–z, 0–9 and -, including a letter",
        branch: "Branch name",
        branchHelp: "Use Main branch if this is your only location.",
        type: "Restaurant type",
        phone: "Restaurant phone",
        address: "Restaurant address",
        openTime: "Open time",
        closeTime: "Close time",
        tableCount: "Starting tables",
        service: "Service charge",
        serviceHelp: "Commonly 10%",
        vat: "VAT",
        vatHelp: "Commonly 7%",
        promptpayName: "PromptPay account name",
        promptpayQr: "PromptPay QR code",
        uploadQr: "Upload QR",
        uploadingQr: "Uploading QR...",
        noQr: "No QR yet",
        save: "Save restaurant",
        saving: "Saving...",
        saved: "Restaurant details saved.",
        saveError: "Could not save restaurant details.",
        logoUploaded: "Logo uploaded.",
        coverUploaded: "Cover image uploaded.",
        qrUploaded: "PromptPay QR uploaded.",
        uploadError: "Could not upload the logo.",
        uploadCoverError: "Could not upload the cover image.",
        uploadQrError: "Could not upload the QR code.",
        validateName: "Please enter the restaurant name.",
        validateBranch: "Please enter the branch name.",
        validatePhone: "The phone number must be 9-10 digits.",
        validateOpen: "Open time must use HH:mm.",
        validateClose: "Close time must use HH:mm.",
        validateTables: "Table count must be between 1 and 500.",
        geofenceTitle: "Location check for QR ordering",
        geofenceHint: "Stops someone who photographed the QR from ordering off-site by verifying the customer is within the restaurant's radius. If location cannot be verified, the order waits for staff confirmation instead of being blocked.",
        geofenceEnable: "Enable location check",
        latitude: "Latitude",
        longitude: "Longitude",
        radius: "Allowed radius (meters)",
        radiusHelp: "100-200 m is recommended to allow for indoor GPS drift.",
        useCurrentLocation: "Use current location",
        locating: "Reading location...",
        geoUnsupported: "This device does not support location.",
        geoInsecure: "The browser blocked location because this page is served over an insecure connection. Open it via http://localhost:3000 or https, then try again.",
        geoDenied: "Location access was blocked. Click the site icon in the address bar → Site settings → Location → Allow, then try again.",
        geoUnavailable: "Location is unavailable right now. Make sure your device's GPS/Location is turned on.",
        geoTimeout: "Reading location timed out. Try again or move somewhere with a better GPS signal.",
        validateCoords: "Enter valid coordinates (or tap Use current location).",
        validateRadius: "Radius must be between 20 and 5000 meters.",
        dangerZone: "Danger Zone / Delete Restaurant",
        dangerZoneHint: "Irreversible and destructive actions",
        deleteRestaurant: "Delete this restaurant",
        deleteWarning: "Deleting this restaurant will permanently remove all tables, menus, members, and orders. This action cannot be undone.",
        onlyOwnerCanDelete: "Only the restaurant owner can delete the restaurant.",
        confirmDeleteTitle: "Confirm Restaurant Deletion",
        confirmDeleteSubtitle: "Please type the restaurant name to confirm deletion",
        confirmDeleteInputPlaceholder: "Type the restaurant name to confirm",
        confirmDeleteBtn: "Confirm Delete",
        cancel: "Cancel",
        deleting: "Deleting...",
      };

  // Saving and uploading both report through the global toast, so the outcome
  // shows up where the user is looking instead of at the bottom of the page.
  const notifySaved = useCallback(() => showToast({ title: copy.saved }), [copy.saved, showToast]);
  const notifyError = useCallback((title: string) => showToast({ title, tone: "error" }), [showToast]);

  useEffect(() => {
    let active = true;
    const loadTimer = window.setTimeout(() => {
      if (!restaurantId || !canManageRestaurant) {
        setLoading(false);
        return;
      }

      setLoading(true);
      getRestaurant(restaurantId)
        .then((res) => {
          if (!active) return;
          setRestaurant(res.data);
          setForm(toForm(res.data, language));
          setErrors({});
        })
        .catch(() => {
          if (active) notifyError(copy.saveError);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(loadTimer);
    };
  }, [canManageRestaurant, copy.saveError, language, notifyError, restaurantId]);

  const setField = (field: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const setBool = (field: "service_charge_enabled" | "vat_enabled" | "geofence_enabled", value: boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, latitude: undefined, order_radius_meters: undefined }));
  };

  // Fills the geofence coordinates from the device the owner is standing on,
  // so they can just open this page at the restaurant and tap once.
  const useCurrentLocation = () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setErrors((current) => ({ ...current, latitude: copy.geoUnsupported }));
      return;
    }
    // Geolocation only runs in a secure context (https, or http://localhost).
    // Served over a plain-HTTP LAN origin (e.g. http://192.168.x.x:3000) the
    // browser blocks it silently and never shows the permission prompt, so name
    // that cause instead of the generic "please allow" message.
    if (typeof window !== "undefined" && window.isSecureContext === false) {
      setErrors((current) => ({ ...current, latitude: copy.geoInsecure }));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setForm((current) => ({
          ...current,
          latitude: position.coords.latitude.toFixed(6),
          longitude: position.coords.longitude.toFixed(6),
        }));
        setErrors((current) => ({ ...current, latitude: undefined }));
        setLocating(false);
      },
      (error) => {
        const message =
          error.code === error.POSITION_UNAVAILABLE ? copy.geoUnavailable
            : error.code === error.TIMEOUT ? copy.geoTimeout
              : copy.geoDenied;
        setErrors((current) => ({ ...current, latitude: message }));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const validate = () => {
    const next: FormErrors = {};
    const tableCount = Number.parseInt(form.table_count, 10);
    const serviceRate = Number.parseFloat(form.service_charge_rate);
    const vatRate = Number.parseFloat(form.vat_rate);
    if (!form.name.trim()) next.name = copy.validateName;
    if (!form.branch_name.trim()) next.branch_name = copy.validateBranch;
    if (form.phone.trim() && form.phone.replace(/\D/g, "").length < 9) next.phone = copy.validatePhone;
    if (!validateTime(form.open_time)) next.open_time = copy.validateOpen;
    if (!validateTime(form.close_time)) next.close_time = copy.validateClose;
    if (!Number.isFinite(tableCount) || tableCount < 1 || tableCount > 500) next.table_count = copy.validateTables;
    if (!Number.isFinite(serviceRate) || serviceRate < 0 || serviceRate > 30) next.service_charge_rate = language === "th" ? "ค่าบริการต้องอยู่ระหว่าง 0 ถึง 30%" : "Service charge must be between 0 and 30%.";
    if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 20) next.vat_rate = language === "th" ? "VAT ต้องอยู่ระหว่าง 0 ถึง 20%" : "VAT must be between 0 and 20%.";
    if (form.geofence_enabled) {
      const latitude = Number.parseFloat(form.latitude);
      const longitude = Number.parseFloat(form.longitude);
      const radius = Number.parseInt(form.order_radius_meters, 10);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        next.latitude = copy.validateCoords;
      }
      if (!Number.isFinite(radius) || radius < 20 || radius > 5000) next.order_radius_meters = copy.validateRadius;
    }
    setErrors(next);
    // A bad or taken slug is already spelled out under its field as it is
    // typed; it only has to stop the save here.
    const slugBlocked = form.slug !== restaurant?.slug && (!isValidRestaurantSlug(form.slug) || slugStatus === "taken");
    return Object.keys(next).length === 0 && !slugBlocked;
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setErrors({});
    if (!restaurantId || !validate()) return;

    await saveOnceRef.current(async () => {
      setSaving(true);
      try {
        const slugChanged = form.slug !== restaurant?.slug;
        const res = await updateRestaurant(restaurantId, {
          name: form.name.trim(),
          ...(slugChanged ? { slug: form.slug } : {}),
          branch_name: form.branch_name.trim(),
          restaurant_type: form.restaurant_type,
          phone: form.phone.trim(),
          address: form.address.trim(),
          open_time: form.open_time,
          close_time: form.close_time,
          table_count: Number.parseInt(form.table_count, 10),
          service_charge_enabled: form.service_charge_enabled,
          service_charge_rate: Number.parseFloat(form.service_charge_rate),
          vat_enabled: form.vat_enabled,
          vat_rate: Number.parseFloat(form.vat_rate),
          promptpay_name: form.promptpay_name.trim(),
          promptpay_qr_image: form.promptpay_qr_image.trim(),
          cover_image: form.cover_image.trim(),
          latitude: form.geofence_enabled ? Number.parseFloat(form.latitude) : null,
          longitude: form.geofence_enabled ? Number.parseFloat(form.longitude) : null,
          order_radius_meters: form.geofence_enabled ? Number.parseInt(form.order_radius_meters, 10) : 0,
        });
        if (slugChanged) {
          // Every URL this tab could be on just changed. A full load lands on
          // the new one with fresh memberships; refreshing them in place first
          // would leave the guard holding a slug that no longer exists.
          notifySaved();
          window.location.replace(restaurantHref(res.data.restaurant.slug, "/settings/restaurant"));
          return;
        }
        setRestaurant(res.data.restaurant);
        setForm(toForm(res.data.restaurant, language));
        notifySaved();
        await refreshMemberships();
      } catch (error) {
        const code = apiErrorCode(error);
        if (code === "slug_taken" || code === "slug_invalid") {
          setErrors((current) => ({ ...current, slug: code === "slug_taken" ? copy.slugTaken : copy.slugInvalid }));
        } else {
          notifyError(copy.saveError);
        }
      } finally {
        setSaving(false);
      }
    });
  };

  // Logo, cover and PromptPay QR uploads only differ by endpoint, the field they
  // write back, and which busy flag they toggle.
  const createImageUpload = (
    field: ImageField,
    upload: (id: number, file: File) => Promise<{ data: { restaurant: Restaurant } }>,
    setBusy: (busy: boolean) => void,
    successText: string,
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
        setForm((current) => ({ ...current, [field]: value }));
        setRestaurant((current) => (current ? { ...current, [field]: value } : current));
        showToast({ title: successText });
        await refreshMemberships();
      } catch {
        notifyError(errorText);
      } finally {
        setBusy(false);
      }
    });
  };

  const uploadLogo = createImageUpload("logo", uploadRestaurantLogo, setUploading, copy.logoUploaded, copy.uploadError);
  const uploadCover = createImageUpload("cover_image", uploadRestaurantCover, setUploadingCover, copy.coverUploaded, copy.uploadCoverError);
  const uploadQr = createImageUpload("promptpay_qr_image", uploadRestaurantPromptPayQR, setUploadingQr, copy.qrUploaded, copy.uploadQrError);

  if (!canManageRestaurant) {
    return <PermissionDenied title={copy.denied} />;
  }

  if (!restaurantId) {
    return (
      <SettingsShell eyebrow={copy.eyebrow} title={copy.title} subtitle={copy.noRestaurant} backLabel={copy.back}>
        <Link href="/restaurants" className="ui-press inline-flex h-10 items-center rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white dark:bg-orange-700 dark:text-white">{copy.goRestaurants}</Link>
      </SettingsShell>
    );
  }

  return (
    <SettingsShell
      eyebrow={copy.eyebrow}
      title={copy.title}
      subtitle={copy.subtitle}
      backLabel={copy.back}
      hideHeader
    >
      <form id="restaurant-settings-form" onSubmit={save} className="space-y-4 pb-20 sm:pb-0">
        {loading ? (
          <div className="rounded-md border border-gray-200 bg-white px-4 py-10 text-[13px] text-gray-500 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">{copy.loading}</div>
        ) : (
          <>
            <SettingsPanel title={copy.identity} hint={copy.identityHint}>
              <div className="grid gap-4 md:grid-cols-2 mb-4">
                {/* Logo Uploader */}
                <div className="flex flex-col gap-4 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/60 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-orange-50 text-center text-[11px] font-semibold text-orange-600 dark:bg-orange-900/20 dark:text-orange-300">
                      {form.logo ? <Image src={form.logo} alt={form.name || copy.logo} width={64} height={64} unoptimized className="h-full w-full object-cover" /> : copy.noLogo}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{copy.logo}</p>
                      <p className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-gray-400">{restaurant?.name || form.name}</p>
                    </div>
                  </div>
                  <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={uploadLogo} />
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="ui-press h-10 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800">
                    {uploading ? copy.uploading : copy.upload}
                  </button>
                </div>

                {/* Cover Image Uploader */}
                <div className="flex flex-col gap-4 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/60 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-orange-50 text-center text-[11px] font-semibold text-orange-600 dark:bg-orange-900/20 dark:text-orange-300">
                      {form.cover_image ? <Image src={form.cover_image} alt={form.name || copy.coverImage} width={96} height={64} unoptimized className="h-full w-full object-cover" /> : <span className="p-1 line-clamp-2 text-[10px] leading-tight">{copy.noCover}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{copy.coverImage}</p>
                      <p className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-gray-400">{restaurant?.name || form.name}</p>
                    </div>
                  </div>
                  <input ref={coverFileInputRef} type="file" accept="image/*" className="hidden" onChange={uploadCover} />
                  <button type="button" onClick={() => coverFileInputRef.current?.click()} disabled={uploadingCover} className="ui-press h-10 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800">
                    {uploadingCover ? copy.uploadingCover : copy.uploadCover}
                  </button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={copy.name} value={form.name} onChange={(value) => setField("name", value)} error={errors.name} />
                <Field label={copy.branch} value={form.branch_name} onChange={(value) => setField("branch_name", value)} error={errors.branch_name} help={copy.branchHelp} />
                <div className="sm:col-span-2">
                  <RestaurantSlugField
                    label={copy.slug}
                    value={form.slug}
                    onChange={(value) => setField("slug", value)}
                    status={slugStatus}
                    error={errors.slug}
                  />
                </div>
                <label className="block sm:col-span-2">
                  <span className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.type}</span>
                  <ThemedSelect value={form.restaurant_type} onChange={(value) => setField("restaurant_type", value)} options={RESTAURANT_TYPES.map((item) => ({ value: item, label: getRestaurantTypeLabel(item, language) }))} />
                </label>
                <Field label={copy.phone} value={form.phone} onChange={(value) => setField("phone", normalizePhone(value))} error={errors.phone} inputMode="tel" />
                <div className="sm:col-span-2">
                  <TextAreaField label={copy.address} value={form.address} onChange={(value) => setField("address", value)} />
                </div>
              </div>
            </SettingsPanel>

            <SettingsPanel title={copy.operations} hint={copy.operationsHint}>
              <div className="grid gap-3 sm:grid-cols-3">
                {/* Picking the opening time leads straight into the closing time. */}
                <Field
                  label={copy.openTime}
                  type="time"
                  value={form.open_time}
                  onChange={(value) => setField("open_time", value)}
                  error={errors.open_time}
                  timeOptions={{
                    doneLabel: language === "th" ? "ถัดไป: เวลาปิด" : "Next: close time",
                    onDone: () => setCloseTimeSignal((n) => n + 1),
                  }}
                />
                <Field
                  label={copy.closeTime}
                  type="time"
                  value={form.close_time}
                  onChange={(value) => setField("close_time", value)}
                  error={errors.close_time}
                  timeOptions={{ openSignal: closeTimeSignal }}
                />
                <Field label={copy.tableCount} value={form.table_count} onChange={(value) => setField("table_count", value)} error={errors.table_count} inputMode="numeric" />
              </div>
            </SettingsPanel>

            <SettingsPanel title={copy.billing} hint={copy.billingHint}>
              <div className="grid gap-3 sm:grid-cols-2">
                {/* Service charge: toggle + rate combined */}
                <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
                  <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                    <span>
                      <span className="block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.service}</span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">{copy.serviceHelp}</span>
                    </span>
                    <input type="checkbox" checked={form.service_charge_enabled} onChange={(event) => setBool("service_charge_enabled", event.target.checked)} className="h-4 w-4 accent-orange-600" />
                  </label>
                  <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                    <Field label={`${copy.service} %`} value={form.service_charge_rate} onChange={(value) => setField("service_charge_rate", value)} error={errors.service_charge_rate} inputMode="decimal" />
                  </div>
                </div>
                {/* VAT: toggle + rate combined */}
                <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
                  <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
                    <span>
                      <span className="block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.vat}</span>
                      <span className="text-[11px] text-gray-500 dark:text-gray-400">{copy.vatHelp}</span>
                    </span>
                    <input type="checkbox" checked={form.vat_enabled} onChange={(event) => setBool("vat_enabled", event.target.checked)} className="h-4 w-4 accent-orange-600" />
                  </label>
                  <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-800">
                    <Field label={`${copy.vat} %`} value={form.vat_rate} onChange={(value) => setField("vat_rate", value)} error={errors.vat_rate} inputMode="decimal" />
                  </div>
                </div>
                <Field label={copy.promptpayName} value={form.promptpay_name} onChange={(value) => setField("promptpay_name", value)} />
                {/* PromptPay QR Uploader */}
                <div className="flex flex-col gap-4 rounded-md border border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/60 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-orange-50 text-center text-[11px] font-semibold text-orange-600 dark:bg-orange-900/20 dark:text-orange-300">
                      {form.promptpay_qr_image ? <Image src={form.promptpay_qr_image} alt={copy.promptpayQr} width={64} height={64} unoptimized className="h-full w-full object-contain" /> : <span className="p-1 line-clamp-2 text-[10px] leading-tight">{copy.noQr}</span>}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-gray-900 dark:text-white">{copy.promptpayQr}</p>
                      <p className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-gray-400">{form.promptpay_name || restaurant?.name || form.name}</p>
                    </div>
                  </div>
                  <input ref={qrFileInputRef} type="file" accept="image/*" className="hidden" onChange={uploadQr} />
                  <button type="button" onClick={() => qrFileInputRef.current?.click()} disabled={uploadingQr} className="ui-press h-10 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-gray-800">
                    {uploadingQr ? copy.uploadingQr : copy.uploadQr}
                  </button>
                </div>
              </div>
            </SettingsPanel>

            <SettingsPanel title={copy.geofenceTitle} hint={copy.geofenceHint}>
              <div className="space-y-3">
                <label className="flex min-h-14 items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
                  <span className="block text-[12px] font-medium text-gray-700 dark:text-gray-300">{copy.geofenceEnable}</span>
                  <input type="checkbox" checked={form.geofence_enabled} onChange={(event) => setBool("geofence_enabled", event.target.checked)} className="h-4 w-4 accent-orange-600" />
                </label>

                {form.geofence_enabled && (
                  <>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field label={copy.latitude} value={form.latitude} onChange={(value) => setField("latitude", value)} error={errors.latitude} inputMode="decimal" placeholder="13.736717" />
                      <Field label={copy.longitude} value={form.longitude} onChange={(value) => setField("longitude", value)} inputMode="decimal" placeholder="100.523186" />
                      <Field label={copy.radius} value={form.order_radius_meters} onChange={(value) => setField("order_radius_meters", value)} error={errors.order_radius_meters} inputMode="numeric" />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={useCurrentLocation}
                        disabled={locating}
                        className="ui-press h-10 rounded-md border border-gray-200 bg-white px-4 text-[12px] font-semibold text-gray-800 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 dark:hover:bg-gray-800"
                      >
                        {locating ? copy.locating : copy.useCurrentLocation}
                      </button>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400">{copy.radiusHelp}</p>
                    </div>
                  </>
                )}
              </div>
            </SettingsPanel>

            {/* The form reads top to bottom, so saving lives at the end of it.
                Mobile keeps the sticky bar below instead. */}
            <div className="hidden justify-end sm:flex">
              <button
                type="submit"
                disabled={saving || loading}
                className="ui-press inline-flex h-10 items-center justify-center rounded-md bg-orange-700 px-5 text-[13px] font-semibold text-white hover:bg-orange-800 disabled:opacity-60 dark:bg-orange-700 dark:text-white"
              >
                {saving ? copy.saving : copy.save}
              </button>
            </div>

            <SettingsPanel title={copy.dangerZone} hint={copy.dangerZoneHint}>
              <div className="rounded-md border border-red-200/50 bg-red-50/30 p-4 dark:border-red-900/30 dark:bg-red-950/10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <p className="text-[13px] font-semibold text-red-650 dark:text-red-400">{copy.deleteRestaurant}</p>
                  <p className="text-[12px] text-gray-500 dark:text-gray-400 leading-normal max-w-xl">{copy.deleteWarning}</p>
                  {!isOwner && (
                    <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{copy.onlyOwnerCanDelete}</p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={!isOwner}
                  onClick={() => { setDeleteModalClosing(false); setDeleteModalOpen(true); }}
                  className="ui-press shrink-0 h-10 px-4 rounded-md border border-red-200 bg-white hover:bg-red-50 text-[12px] font-semibold text-red-600 hover:text-red-750 disabled:opacity-40 disabled:cursor-not-allowed dark:border-red-900/40 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  {copy.deleteRestaurant}
                </button>
              </div>
            </SettingsPanel>

          </>
        )}

        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 p-3 backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 sm:hidden">
          <button type="submit" disabled={saving || loading} className="ui-press flex h-12 w-full items-center justify-center rounded-md bg-orange-700 px-4 text-[13px] font-semibold text-white disabled:opacity-60 dark:bg-orange-700 dark:text-white">
            {saving ? copy.saving : copy.save}
          </button>
        </div>
      </form>

      {deleteModalOpen && (
        <div {...deleteBackdrop} className={`${deleteModalClosing ? "motion-overlay-exit" : "motion-overlay"} fixed inset-0 z-50 flex items-end justify-center bg-gray-950/45 px-3 pb-3 backdrop-blur-sm sm:items-center sm:px-4 sm:pb-0`}>
          <div className={`${deleteModalClosing ? "motion-bottom-sheet-exit" : "motion-bottom-sheet"} flex max-h-[86vh] w-full max-w-md flex-col rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-900`}>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <h2 className="text-[14px] font-semibold text-red-750 dark:text-red-400">{copy.confirmDeleteTitle}</h2>
              <button type="button" onClick={closeDeleteModal} className="h-8 w-8 rounded-md text-xl text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200">×</button>
            </div>
            <form onSubmit={handleDeleteRestaurant} className="p-4 space-y-4">
              <p className="text-[13px] text-gray-650 dark:text-gray-400 leading-relaxed">
                {copy.deleteWarning}
              </p>
              <div className="rounded-md bg-red-50/60 p-3 dark:bg-red-950/20 border border-red-100/60 dark:border-red-900/30">
                <p className="text-[12px] font-medium text-red-800 dark:text-red-300 leading-normal">
                  {language === "th" ? `กรุณาพิมพ์ชื่อร้านอาหาร "${restaurant?.name}" เพื่อยืนยันการลบ` : `Please type the restaurant name "${restaurant?.name}" to confirm deletion`}
                </p>
              </div>
              <input
                value={confirmRestaurantName}
                onChange={(e) => {
                  setConfirmRestaurantName(e.target.value);
                  setDeleteError("");
                }}
                placeholder={copy.confirmDeleteInputPlaceholder}
                className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[13px] outline-none focus:border-red-500 dark:border-gray-700 dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              {deleteError && (
                <p className="text-[11px] font-medium text-red-600 dark:text-red-300">{deleteError}</p>
              )}
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={closeDeleteModal}
                  disabled={deleting}
                  className="h-10 rounded-md border border-gray-200 bg-white px-4 text-[12px] font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  {copy.cancel}
                </button>
                <button
                  type="submit"
                  disabled={deleting || confirmRestaurantName !== restaurant?.name}
                  className="h-10 rounded-md bg-red-600 px-4 text-[12px] font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:hover:bg-red-600 active:scale-[0.98] transition-transform"
                >
                  {deleting ? copy.deleting : copy.confirmDeleteBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </SettingsShell>
  );
}
