"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/src/providers/AuthProvider";
import { createRestaurant, type CreateRestaurantInput } from "@/src/lib/restaurant";
import { createSingleFlight } from "@/src/lib/singleFlight";
import { useLanguage } from "@/src/providers/LanguageProvider";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import ThemedTimeInput from "@/src/components/shared/ThemedTimeInput";
import { restaurantRepository } from "../../repositories/restaurantRepository";
import { isValidRestaurantSlug, restaurantHref, suggestRestaurantSlug } from "@/src/lib/restaurantPath";
import RestaurantSlugField, { useRestaurantSlugStatus } from "@/src/components/shared/RestaurantSlugField";
import { apiErrorCode } from "@/src/lib/apiErrors";
import {
  BackToRestaurants,
  RESTAURANT_TYPES,
  WorkspaceShell,
  getRestaurantTypeLabel,
} from "../restaurantWorkspaceUi";

type FormErrors = Partial<{
  name: string;
  slug: string;
  branch: string;
  phone: string;
  address: string;
  openTime: string;
  closeTime: string;
  initialTables: string;
  submit: string;
}>;

const SETUP_STEPS = ["identity", "service", "contact", "review"] as const;
type SetupStepId = (typeof SETUP_STEPS)[number];

type StepCopy = {
  id: SetupStepId;
  title: string;
  description: string;
};

type RestaurantType = string;

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  help?: string;
  /** Shown on hover over the required star instead of as a line under the box. */
  hint?: string;
  required?: boolean;
  type?: "text" | "tel" | "number";
  min?: number;
  max?: number;
  disabled?: boolean;
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  error,
  help,
  hint,
  required,
  type = "text",
  min,
  max,
  disabled,
}: FieldProps) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
        {label}
        {required && hint ? (
          // The explanation folds into the star: hover or focus it to read.
          <span className="group relative ml-1 inline-block">
            <span
              tabIndex={0}
              aria-label={hint}
              className="cursor-help rounded-sm text-orange-600 outline-none focus-visible:ring-2 focus-visible:ring-orange-300 dark:text-orange-400"
            >
              *
            </span>
            <span
              role="tooltip"
              className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 w-max max-w-[20rem] -translate-x-1/2 rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-normal leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 dark:bg-gray-700"
            >
              {hint}
            </span>
          </span>
        ) : required ? (
          <span className="ml-1 text-orange-600 dark:text-orange-400">*</span>
        ) : null}
      </span>
      <input
        className={`w-full rounded-md border bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-orange-500 disabled:bg-gray-50 disabled:text-gray-500 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 dark:disabled:bg-gray-900/60 dark:disabled:text-gray-500 ${
          error ? "border-red-300 dark:border-red-900/60" : "border-gray-300 dark:border-gray-700"
        }`}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        min={min}
        max={max}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
      />
      {help ? <p className="text-xs text-gray-500 dark:text-gray-400">{help}</p> : null}
      {error ? <p className="text-xs font-medium text-red-600 dark:text-red-300">{error}</p> : null}
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
  error,
  help,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  help?: string;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
      <textarea
        className={`min-h-24 w-full resize-y rounded-md border bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-500 focus:border-orange-500 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 ${
          error ? "border-red-300 dark:border-red-900/60" : "border-gray-300 dark:border-gray-700"
        }`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-invalid={error ? "true" : undefined}
      />
      {help ? <p className="text-xs text-gray-500 dark:text-gray-400">{help}</p> : null}
      {error ? <p className="text-xs font-medium text-red-600 dark:text-red-300">{error}</p> : null}
    </label>
  );
}

function TimeField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div className="block space-y-2">
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
        {label}
        <span className="ml-1 text-orange-600 dark:text-orange-400">*</span>
      </span>
      <ThemedTimeInput value={value} onChange={onChange} error={error} />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-3 last:border-b-0 dark:border-gray-800">
      <span className="text-sm text-gray-500 dark:text-gray-400">{label}</span>
      <span className="max-w-56 text-right text-sm font-semibold text-gray-900 dark:text-white">{value}</span>
    </div>
  );
}

const RESTAURANT_TYPE_SETUP_DEFAULTS = [
  { openTime: "17:00", closeTime: "00:00", tables: "12" },
  { openTime: "08:00", closeTime: "20:00", tables: "8" },
  { openTime: "11:00", closeTime: "22:00", tables: "16" },
  { openTime: "10:00", closeTime: "22:00", tables: "4" },
  { openTime: "16:00", closeTime: "22:00", tables: "4" },
];

function setupDefaultsFor(type: RestaurantType) {
  const index = RESTAURANT_TYPES.indexOf(type);
  return RESTAURANT_TYPE_SETUP_DEFAULTS[index] ?? RESTAURANT_TYPE_SETUP_DEFAULTS[0];
}

function normalizePhone(value: string) {
  return value.replace(/[()\s-]/g, "");
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function firstStepForErrors(errors: FormErrors): SetupStepId {
  if (errors.name || errors.slug || errors.branch) {
    return "identity";
  }

  if (errors.openTime || errors.closeTime || errors.initialTables) {
    return "service";
  }

  if (errors.phone || errors.address) {
    return "contact";
  }

  return "review";
}

export default function NewRestaurantPage() {
  const router = useRouter();
  const { language } = useLanguage();
  const { setActiveRestaurant, refreshMemberships } = useAuth();
  const [activeStep, setActiveStep] = useState<SetupStepId>("identity");
  const initialType = RESTAURANT_TYPES[0] ?? "restaurant";
  const [type, setType] = useState<RestaurantType>(initialType);
  const [name, setName] = useState("");
  // Follows the name until the owner types in it; after that it is theirs.
  // Empty is allowed - the server then picks one, changeable in settings.
  const [slugInput, setSlugInput] = useState<string | null>(null);
  const slug = slugInput ?? suggestRestaurantSlug(name);
  const slugStatus = useRestaurantSlugStatus(slug);
  const [branch, setBranch] = useState(language === "th" ? "สาขาหลัก" : "Main branch");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const defaults = useMemo(() => setupDefaultsFor(initialType), [initialType]);
  const [openTime, setOpenTime] = useState(defaults.openTime);
  const [closeTime, setCloseTime] = useState(defaults.closeTime);
  const [initialTables, setInitialTables] = useState(defaults.tables);
  const [splitZones, setSplitZones] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reviewSubmitReady, setReviewSubmitReady] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const submitOnceRef = useRef(createSingleFlight());

  useEffect(() => {
    const readyTimer = window.setTimeout(
      () => setReviewSubmitReady(activeStep === "review"),
      activeStep === "review" ? 150 : 0,
    );
    return () => window.clearTimeout(readyTimer);
  }, [activeStep]);

  const copy = language === "th"
    ? {
        back: "กลับไปร้านของฉัน",
        title: "สร้างร้านใหม่",
        subtitle: "ตั้งค่าทีละขั้นตอนให้พร้อมใช้งานจริง ก่อนเปิด dashboard ร้าน",
        stepLabel: "ขั้นตอน",
        stepNavigationLabel: "ขั้นตอนการสร้างร้าน",
        identityTitle: "ข้อมูลร้าน",
        identityDescription: "ตั้งชื่อร้าน สาขา และประเภทร้านเพื่อสร้างบริบทหลัก",
        serviceTitle: "เวลาและโต๊ะ",
        serviceDescription: "กำหนดเวลาทำการและจำนวนโต๊ะเริ่มต้นสำหรับหน้าร้าน",
        contactTitle: "ข้อมูลใบเสร็จ",
        contactDescription: "เพิ่มข้อมูลติดต่อสำหรับบิลและโปรไฟล์ร้าน หรือข้ามไปก่อน",
        reviewTitle: "ตรวจสอบ",
        reviewDescription: "เช็กข้อมูลสุดท้ายก่อนสร้างร้าน",
        name: "ชื่อร้าน",
        branch: "ชื่อสาขา",
        type: "ประเภทร้าน",
        phone: "เบอร์โทร",
        address: "ที่อยู่ร้าน",
        openTime: "เวลาเปิด",
        closeTime: "เวลาปิด",
        initialTables: "จำนวนโต๊ะเริ่มต้น",
        zonesLabel: "โซนโต๊ะ",
        splitZonesLabel: "แบ่งโซนอัตโนมัติ",
        zonedSummary: "แบ่งโซนอัตโนมัติ",
        flatSummary: "ไม่แบ่งโซน (เรียงลำดับ)",
        optional: "ไม่บังคับ",
        phonePlaceholder: "เช่น 081-234-5678",
        addressPlaceholder: "ที่อยู่สำหรับแสดงบนบิลหรือข้อมูลร้าน",
        typeHelp: "การเลือกประเภทจะตั้งค่าเวลาและจำนวนโต๊ะเริ่มต้นให้แก้ต่อได้",
        tableHelp: "ระบบจะสร้างโต๊ะตัวอย่างตามจำนวนนี้หลังสร้างร้าน",
        contactHelp: "ข้อมูลนี้แก้ได้ภายหลังในหน้าตั้งค่าร้าน",
        nextService: "ต่อไป: เวลาและโต๊ะ",
        nextContact: "ต่อไป: ข้อมูลใบเสร็จ",
        nextReview: "ต่อไป: ตรวจสอบ",
        skipContact: "ข้ามข้อมูลเสริม",
        previous: "ย้อนกลับ",
        submitIdle: "สร้างร้าน",
        submitBusy: "กำลังสร้างร้าน...",
        reviewHeading: "ข้อมูลที่จะสร้าง",
        reviewNote: "ระบบจะใช้ข้อมูลนี้สร้าง workspace ร้านและพาคุณไปตั้งค่าต่อใน dashboard",
        asideTitle: "ภาพรวมร้านใหม่",
        asideHint: "ข้อมูลจะแสดงตามสิ่งที่กรอกในแต่ละขั้น",
        setupTitle: "หลังสร้าง ระบบจะเตรียมให้",
        setupItems: [
          "เมนูเริ่มต้นตามประเภทร้าน",
          "โต๊ะเริ่มต้นสำหรับรับออเดอร์",
          "สิทธิ์เจ้าของร้านสำหรับบัญชีนี้",
        ],
        slug: "ลิงก์ร้าน",
        slugAuto: "ระบบตั้งให้ แก้ได้ในตั้งค่า",
        emptyName: "ยังไม่ได้ตั้งชื่อร้าน",
        emptyBranch: "ยังไม่ได้ตั้งชื่อสาขา",
        emptyPhone: "ยังไม่ใส่เบอร์โทร",
        emptyAddress: "ยังไม่ใส่ที่อยู่",
        tablesUnit: "โต๊ะ",
        tableWord: "โต๊ะ",
        createFailed: "สร้างร้านไม่สำเร็จ กรุณาลองใหม่",
        validation: {
          nameRequired: "กรุณากรอกชื่อร้าน",
          nameTooLong: "ชื่อร้านต้องไม่เกิน 120 ตัวอักษร",
          slugInvalid: "ใช้ a–z, 0–9 และ - ได้ 3–40 ตัว และต้องมีตัวอักษร",
          slugTaken: "มีร้านใช้ชื่อนี้แล้ว",
          branchRequired: "กรุณากรอกชื่อสาขา",
          branchTooLong: "ชื่อสาขาต้องไม่เกิน 80 ตัวอักษร",
          phoneInvalid: "เบอร์โทรควรมี 9-15 หลัก",
          openTimeInvalid: "กรุณาระบุเวลาเปิดให้ถูกต้อง",
          closeTimeInvalid: "กรุณาระบุเวลาปิดให้ถูกต้อง",
          tablesInvalid: "จำนวนโต๊ะต้องอยู่ระหว่าง 1-300",
        },
      }
    : {
        back: "Back to restaurants",
        title: "Create a restaurant",
        subtitle: "Set up the restaurant step by step before opening its dashboard.",
        stepLabel: "Step",
        stepNavigationLabel: "Restaurant setup steps",
        identityTitle: "Restaurant identity",
        identityDescription: "Name the restaurant, branch, and operating concept.",
        serviceTitle: "Hours and tables",
        serviceDescription: "Set starter service hours and table count for the floor.",
        contactTitle: "Receipt details",
        contactDescription: "Add receipt/profile contact details now, or skip them.",
        reviewTitle: "Review",
        reviewDescription: "Check the final setup before creating the restaurant.",
        name: "Restaurant name",
        branch: "Branch name",
        type: "Restaurant type",
        phone: "Phone",
        address: "Restaurant address",
        openTime: "Opening time",
        closeTime: "Closing time",
        initialTables: "Initial tables",
        zonesLabel: "Table zones",
        splitZonesLabel: "Split into zones automatically",
        zonedSummary: "Auto-split into zones",
        flatSummary: "No zones (sequential)",
        optional: "Optional",
        phonePlaceholder: "e.g. 081-234-5678",
        addressPlaceholder: "Address shown on bills or restaurant profile",
        typeHelp: "Changing the type seeds editable starter hours and table count.",
        tableHelp: "The system will create starter tables using this count.",
        contactHelp: "You can edit these details later in restaurant settings.",
        nextService: "Next: hours and tables",
        nextContact: "Next: receipt details",
        nextReview: "Next: review",
        skipContact: "Skip optional details",
        previous: "Back",
        submitIdle: "Create restaurant",
        submitBusy: "Creating restaurant...",
        reviewHeading: "Setup to create",
        reviewNote: "The system will use this information to create the restaurant workspace.",
        asideTitle: "New restaurant overview",
        asideHint: "This preview updates as you complete each step.",
        setupTitle: "After creation, the system prepares",
        setupItems: [
          "Starter menu based on restaurant type",
          "Starter tables for taking orders",
          "Owner access for this account",
        ],
        slug: "Restaurant link",
        slugAuto: "Set automatically; change it in settings",
        emptyName: "Restaurant name not set",
        emptyBranch: "Branch name not set",
        emptyPhone: "Phone not added",
        emptyAddress: "Address not added",
        tablesUnit: "tables",
        tableWord: "tables",
        createFailed: "Could not create the restaurant. Please try again.",
        validation: {
          nameRequired: "Restaurant name is required",
          nameTooLong: "Restaurant name must be 120 characters or less",
          slugInvalid: "Use 3–40 of a–z, 0–9 and -, including a letter",
          slugTaken: "Another restaurant already uses this name",
          branchRequired: "Branch name is required",
          branchTooLong: "Branch name must be 80 characters or less",
          phoneInvalid: "Phone number should contain 9-15 digits",
          openTimeInvalid: "Enter a valid opening time",
          closeTimeInvalid: "Enter a valid closing time",
          tablesInvalid: "Table count must be between 1 and 300",
        },
      };

  const steps: StepCopy[] = [
    {
      id: "identity",
      title: copy.identityTitle,
      description: copy.identityDescription,
    },
    {
      id: "service",
      title: copy.serviceTitle,
      description: copy.serviceDescription,
    },
    {
      id: "contact",
      title: copy.contactTitle,
      description: copy.contactDescription,
    },
    {
      id: "review",
      title: copy.reviewTitle,
      description: copy.reviewDescription,
    },
  ];

  const activeStepIndex = SETUP_STEPS.indexOf(activeStep);
  const currentStep = steps[activeStepIndex] ?? steps[0];
  const restaurantTypeLabel = getRestaurantTypeLabel(type, language);
  const trimmedName = name.trim();
  const trimmedBranch = branch.trim();
  const trimmedPhone = phone.trim();
  const trimmedAddress = address.trim();
  const tableCount = Number(initialTables);
  const contactButtonLabel = trimmedPhone || trimmedAddress ? copy.nextReview : copy.skipContact;

  function applyRestaurantType(nextType: RestaurantType) {
    setType(nextType);
    const nextDefaults = setupDefaultsFor(nextType);
    setOpenTime(nextDefaults.openTime);
    setCloseTime(nextDefaults.closeTime);
    setInitialTables(nextDefaults.tables);
  }

  function validateStepValues(step: SetupStepId): FormErrors {
    const nextErrors: FormErrors = {};

    if (step === "identity" || step === "review") {
      if (!trimmedName) {
        nextErrors.name = copy.validation.nameRequired;
      } else if (trimmedName.length > 120) {
        nextErrors.name = copy.validation.nameTooLong;
      }

      if (slug && !isValidRestaurantSlug(slug)) {
        nextErrors.slug = copy.validation.slugInvalid;
      } else if (slugStatus === "taken") {
        nextErrors.slug = copy.validation.slugTaken;
      }

      if (!trimmedBranch) {
        nextErrors.branch = copy.validation.branchRequired;
      } else if (trimmedBranch.length > 80) {
        nextErrors.branch = copy.validation.branchTooLong;
      }
    }

    if (step === "service" || step === "review") {
      if (!isValidTime(openTime)) {
        nextErrors.openTime = copy.validation.openTimeInvalid;
      }

      if (!isValidTime(closeTime)) {
        nextErrors.closeTime = copy.validation.closeTimeInvalid;
      }

      if (!Number.isInteger(tableCount) || tableCount < 1 || tableCount > 300) {
        nextErrors.initialTables = copy.validation.tablesInvalid;
      }
    }

    if (step === "contact" || step === "review") {
      const normalizedPhone = normalizePhone(trimmedPhone);
      if (normalizedPhone && !/^\+?\d{9,15}$/.test(normalizedPhone)) {
        nextErrors.phone = copy.validation.phoneInvalid;
      }
    }

    return nextErrors;
  }

  function mergeStepErrors(step: SetupStepId, stepErrors: FormErrors) {
    setErrors((current) => {
      const merged = { ...current };
      const keysByStep: Record<SetupStepId, (keyof FormErrors)[]> = {
        identity: ["name", "slug", "branch"],
        service: ["openTime", "closeTime", "initialTables"],
        contact: ["phone", "address"],
        review: [
          "name",
          "slug",
          "branch",
          "openTime",
          "closeTime",
          "initialTables",
          "phone",
          "address",
        ],
      };

      keysByStep[step].forEach((key) => {
        delete merged[key];
      });

      delete merged.submit;
      return { ...merged, ...stepErrors };
    });
  }

  function handleNext() {
    const stepErrors = validateStepValues(activeStep);
    mergeStepErrors(activeStep, stepErrors);

    if (Object.keys(stepErrors).length > 0) {
      return;
    }

    const nextStep = SETUP_STEPS[Math.min(activeStepIndex + 1, SETUP_STEPS.length - 1)];
    setActiveStep(nextStep);
  }

  function handlePrevious() {
    const previousStep = SETUP_STEPS[Math.max(activeStepIndex - 1, 0)];
    setActiveStep(previousStep);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reviewSubmitReady || submitting) {
      return;
    }

    const nextErrors = validateStepValues("review");

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setActiveStep(firstStepForErrors(nextErrors));
      return;
    }

    setErrors({});
    await submitOnceRef.current(async () => {
      setSubmitting(true);
      try {
        const payload: CreateRestaurantInput = {
          name: trimmedName,
          ...(slug ? { slug } : {}),
          branch_name: trimmedBranch,
          restaurant_type: type,
          phone: trimmedPhone || undefined,
          address: trimmedAddress || undefined,
          open_time: openTime,
          close_time: closeTime,
          table_count: tableCount,
          split_zones: splitZones,
        };

        const res = await createRestaurant(payload);
        const membership = res.data.membership;
        const createdSlug = res.data.restaurant?.slug || membership.restaurant?.slug || String(membership.restaurant_id);
        restaurantRepository.setActiveId(membership.restaurant_id, createdSlug);
        setActiveRestaurant(membership.restaurant_id);
        await refreshMemberships();
        router.push(restaurantHref(createdSlug, "/home"));
      } catch (error) {
        const code = apiErrorCode(error);
        if (code === "slug_taken" || code === "slug_invalid") {
          // Someone took the name between the check and the submit.
          setErrors({ slug: code === "slug_taken" ? copy.validation.slugTaken : copy.validation.slugInvalid });
          setActiveStep("identity");
        } else {
          console.error(error);
          setErrors({ submit: copy.createFailed });
          setActiveStep("review");
        }
      } finally {
        setSubmitting(false);
      }
    });
  }

  const nextButtonLabel = activeStep === "identity"
    ? copy.nextService
    : activeStep === "service"
      ? copy.nextContact
      : contactButtonLabel;
  const progressPercent = ((activeStepIndex + 1) / SETUP_STEPS.length) * 100;

  return (
    <WorkspaceShell title={copy.title} description={copy.subtitle} hideIntro>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <BackToRestaurants />
          <span className="hidden h-6 w-px bg-gray-200 dark:bg-gray-800 sm:block" aria-hidden="true" />
          <h1 className="text-base font-semibold text-gray-950 dark:text-white">{copy.title}</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mx-auto mt-3 max-w-3xl">
        <section className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-950 dark:shadow-none">
          <div className="border-b border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                {copy.stepLabel} {activeStepIndex + 1} / {SETUP_STEPS.length}
              </span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden="true">
              <div className="h-full rounded-full bg-gray-950 transition-[width] motion-reduce:transition-none dark:bg-white" style={{ width: `${progressPercent}%` }} />
            </div>
            <h2 className="mt-4 text-xl font-bold text-gray-950 dark:text-white">{currentStep.title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600 dark:text-gray-400">{currentStep.description}</p>
          </div>

          <div className="px-4 py-5 sm:px-6">
            {activeStep === "identity" ? (
              <div className="grid gap-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label={copy.name}
                    value={name}
                    onChange={setName}
                    placeholder={language === "th" ? "เช่น กะเย็นซันนี่" : "e.g. Sunny Dinner"}
                    error={errors.name}
                    required
                  />
                  <Field
                    label={copy.branch}
                    value={branch}
                    onChange={setBranch}
                    placeholder={language === "th" ? "เช่น สาขาหลัก" : "e.g. Main branch"}
                    error={errors.branch}
                    required
                  />
                </div>

                <RestaurantSlugField
                  variant="onboarding"
                  label={copy.slug}
                  value={slug}
                  onChange={(value) => {
                    setSlugInput(value);
                    setErrors((current) => ({ ...current, slug: undefined }));
                  }}
                  status={slugStatus}
                  error={errors.slug}
                  placeholder="kruapick"
                />

                <label className="block space-y-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{copy.type}</span>
                  <ThemedSelect
                    value={type}
                    onChange={(value) => applyRestaurantType(value as RestaurantType)}
                    options={RESTAURANT_TYPES.map((option) => ({
                      value: option,
                      label: getRestaurantTypeLabel(option, language),
                    }))}
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400">{copy.typeHelp}</p>
                </label>
              </div>
            ) : null}

            {activeStep === "service" ? (
              <div className="grid gap-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <TimeField
                    label={copy.openTime}
                    value={openTime}
                    onChange={setOpenTime}
                    error={errors.openTime}
                  />
                  <TimeField
                    label={copy.closeTime}
                    value={closeTime}
                    onChange={setCloseTime}
                    error={errors.closeTime}
                  />
                </div>

                {/* Side by side: the count and how those tables are laid out are one
                    decision. The checkbox card is the input's height and its
                    explanation sits under it, so the two columns line up row for row. */}
                <div className="grid items-start gap-4 sm:grid-cols-2">
                  <Field
                    label={copy.initialTables}
                    value={initialTables}
                    onChange={setInitialTables}
                    type="number"
                    min={1}
                    max={300}
                    error={errors.initialTables}
                    hint={copy.tableHelp}
                    required
                  />
                  {/* A heading like the field beside it, then the checkbox in a row
                      the input's height, so the two columns line up. */}
                  <div className="block space-y-2">
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{copy.zonesLabel}</span>
                    <label className="flex h-[43.6px] cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={splitZones}
                        onChange={(event) => setSplitZones(event.target.checked)}
                        className="h-4 w-4 shrink-0 accent-orange-600"
                      />
                      <span className="text-sm text-gray-800 dark:text-gray-200">{copy.splitZonesLabel}</span>
                    </label>
                  </div>
                </div>
              </div>
            ) : null}

            {activeStep === "contact" ? (
              <div className="grid gap-5">
                <Field
                  label={`${copy.phone} (${copy.optional})`}
                  value={phone}
                  onChange={setPhone}
                  placeholder={copy.phonePlaceholder}
                  type="tel"
                  error={errors.phone}
                  help={copy.contactHelp}
                />

                <TextAreaField
                  label={`${copy.address} (${copy.optional})`}
                  value={address}
                  onChange={setAddress}
                  placeholder={copy.addressPlaceholder}
                  error={errors.address}
                />
              </div>
            ) : null}

            {activeStep === "review" ? (
              <div className="grid gap-5">
                <div>
                  <h3 className="text-lg font-bold text-gray-950 dark:text-white">{copy.reviewHeading}</h3>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{copy.reviewNote}</p>
                </div>

                <div className="rounded-md border border-gray-200 px-4 dark:border-gray-800">
                  <SummaryRow label={copy.name} value={trimmedName || copy.emptyName} />
                  <SummaryRow label={copy.slug} value={slug ? `/r/${slug}` : copy.slugAuto} />
                  <SummaryRow label={copy.branch} value={trimmedBranch || copy.emptyBranch} />
                  <SummaryRow label={copy.type} value={restaurantTypeLabel} />
                  <SummaryRow label={copy.openTime} value={openTime} />
                  <SummaryRow label={copy.closeTime} value={closeTime} />
                  <SummaryRow
                    label={copy.initialTables}
                    value={`${Number.isFinite(tableCount) ? initialTables : "-"} ${copy.tableWord}`}
                  />
                  <SummaryRow
                    label={copy.splitZonesLabel}
                    value={splitZones ? copy.zonedSummary : copy.flatSummary}
                  />
                  <SummaryRow label={copy.phone} value={trimmedPhone || copy.emptyPhone} />
                  <SummaryRow label={copy.address} value={trimmedAddress || copy.emptyAddress} />
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-800 sm:px-6">
            {errors.submit ? (
              <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
                {errors.submit}
              </div>
            ) : null}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                className="ui-press inline-flex min-h-10 justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:border-gray-700 dark:hover:bg-gray-900"
                onClick={handlePrevious}
                disabled={activeStepIndex === 0 || submitting}
              >
                {copy.previous}
              </button>

              {activeStep === "review" ? (
                <button
                  type="submit"
                  className="ui-press inline-flex min-h-10 justify-center rounded-md bg-orange-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:text-white"
                  disabled={submitting || !reviewSubmitReady}
                >
                  {submitting ? copy.submitBusy : copy.submitIdle}
                </button>
              ) : (
                <button
                  type="button"
                  className="ui-press inline-flex min-h-10 justify-center rounded-md bg-orange-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-orange-800 dark:bg-orange-700 dark:text-white"
                  onClick={handleNext}
                >
                  {nextButtonLabel}
                </button>
              )}
            </div>
          </div>
        </section>
      </form>
    </WorkspaceShell>
  );
}
