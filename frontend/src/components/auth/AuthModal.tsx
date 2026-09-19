"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { User } from "../../types/auth";
import { Membership } from "../../types/restaurant";
import { googleLogin, login, register, requestPasswordReset, LoginResponse } from "../../lib/auth";
import { authRepository } from "../../app/repositories/authRepository";
import { apiErrorCode } from "@/src/lib/apiErrors";
import {
  authModalMotionClasses,
  scheduleAuthModalClose,
  scheduleAuthModalFocus,
  type AuthModalMotionPhase,
} from "@/src/lib/authModalMotion";
import { useLanguage } from "@/src/providers/LanguageProvider";
import AppLogo from "@/src/components/shared/AppLogo";
import AppWordmark from "@/src/components/shared/AppWordmark";
import GoogleGlyph from "@/src/components/auth/GoogleGlyph";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { safeInternalPath } from "@/src/lib/safeRedirect";
import {
  GOOGLE_AUTH_MESSAGE,
  GOOGLE_TAB_NAME,
  buildGoogleAuthUrl,
  clearPendingGoogleAuth,
  googleCallbackUrl,
  isGoogleCallbackTrusted,
  randomAuthToken,
  rememberPendingGoogleAuth,
  type GoogleAuthMessage,
  type GoogleAuthPending,
} from "@/src/lib/googleOAuth";

const EyeIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="h-4 w-4">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
    />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0Z" />
  </svg>
);

const EyeSlashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="h-4 w-4">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 01-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
    />
  </svg>
);

const ClearIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="h-3.5 w-3.5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
  </svg>
);

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type InputFieldLabels = {
  clear: string;
  hidePassword: string;
  showPassword: string;
};

interface InputFieldProps {
  id: string;
  name?: string;
  label: string;
  type?: string;
  value: string | undefined;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  required?: boolean;
  autoComplete?: string;
  onClear?: () => void;
  showPasswordToggle?: boolean;
  isPasswordVisible?: boolean;
  onTogglePassword?: () => void;
  labels: InputFieldLabels;
}

const InputField = ({
  id,
  name,
  label,
  type = "text",
  value = "",
  onChange,
  placeholder,
  required,
  autoComplete,
  onClear,
  showPasswordToggle,
  isPasswordVisible,
  onTogglePassword,
  labels,
}: InputFieldProps) => {
  const isPasswordType = type === "password";
  const actualType = isPasswordType && isPasswordVisible ? "text" : type;

  let prClass = "pr-3";
  if (showPasswordToggle && onClear) prClass = "pr-16";
  else if (showPasswordToggle || onClear) prClass = "pr-9";

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-medium text-gray-700 dark:text-gray-300">
        {label}
      </label>
      <div className="relative">
        <input
          type={actualType}
          id={id}
          name={name || id}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          autoComplete={autoComplete}
          className={`h-9 w-full rounded-md border border-gray-200 bg-white pl-3 ${prClass} text-[16px] text-gray-900 outline-none transition-colors placeholder:text-gray-500 focus:border-orange-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white sm:text-[13px]`}
        />

        {value.length > 0 && onClear && (
          <button
            type="button"
            onClick={onClear}
            title={labels.clear}
            tabIndex={-1}
            aria-label={labels.clear}
            className={`absolute top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 transition-colors hover:text-gray-600 dark:hover:text-gray-300 ${
              showPasswordToggle ? "right-8" : "right-2"
            }`}
          >
            <ClearIcon />
          </button>
        )}

        {showPasswordToggle && (
          <button
            type="button"
            onClick={onTogglePassword}
            title={isPasswordVisible ? labels.hidePassword : labels.showPassword}
            tabIndex={-1}
            aria-label={isPasswordVisible ? labels.hidePassword : labels.showPassword}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-500 transition-colors hover:text-gray-600 dark:hover:text-gray-300"
          >
            {isPasswordVisible ? <EyeSlashIcon /> : <EyeIcon />}
          </button>
        )}
      </div>
    </div>
  );
};

function BrandLine() {
  return (
    <div className="flex items-center gap-2">
      <AppLogo decorative size={28} />
      <div className="leading-none">
        <AppWordmark height={14} className="text-gray-900 dark:text-white" />
        <p className="mt-1 text-[8px] font-semibold uppercase tracking-[0.13em] text-gray-400 dark:text-gray-500">Restaurant operations</p>
      </div>
    </div>
  );
}

function decideRedirect(): string {
  return "/restaurants";
}

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: "login" | "register";
  onAuthenticated?: (user?: User, memberships?: Membership[]) => void;
  redirectTo?: string;
}

type AuthMode = "login" | "register" | "forgot";

type RegisterFormState = {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  confirmPassword: string;
};

export default function AuthModal({
  isOpen,
  onClose,
  initialMode = "login",
  onAuthenticated,
  redirectTo,
}: AuthModalProps) {
  const { language } = useLanguage();
  const [authMode, setAuthMode] = useState<AuthMode>(initialMode);
  const [loading, setLoading] = useState(false);
  const [closing, setClosing] = useState(false);
  const [lastIsOpen, setLastIsOpen] = useState(isOpen);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [googlePending, setGooglePending] = useState(false);
  const googleTabRef = useRef<Window | null>(null);
  const googleRequestRef = useRef<GoogleAuthPending | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const router = useRouter();

  if (lastIsOpen !== isOpen) {
    setLastIsOpen(isOpen);
    if (!isOpen) {
      setClosing(false);
      setGooglePending(false);
    }
  }

  const copy = language === "th"
    ? {
        clear: "ล้างข้อความ",
        hidePassword: "ซ่อนรหัสผ่าน",
        showPassword: "แสดงรหัสผ่าน",
        googleCredentialMissing: "ไม่สามารถเข้าสู่ระบบด้วย Google ได้",
        googleLoginFailed: "เข้าสู่ระบบด้วย Google ไม่สำเร็จ",
        googleLoginRetry: "เข้าสู่ระบบด้วย Google ล้มเหลว กรุณาลองใหม่อีกครั้ง",
        invalidCredentials: "ข้อมูลเข้าสู่ระบบไม่ถูกต้อง",
        invalidCredentialsHint: "ถ้าเคยใช้ Google กับอีเมลนี้ ให้กด Continue with Google แทน",
        fillLogin: "กรุณากรอกอีเมลและรหัสผ่าน",
        loginFailed: "เข้าสู่ระบบล้มเหลว กรุณาลองใหม่อีกครั้ง",
        resetEmailRequired: "กรุณากรอกอีเมลสำหรับกู้รหัสผ่าน",
        resetRequestFailed: "ส่งลิงก์กู้รหัสผ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
        resetGoogleAccount: "อีเมลนี้ใช้เข้าสู่ระบบด้วย Google กรุณากด Continue with Google แทน",
        resetEmailSent: "ถ้ามีอีเมลนี้ในระบบ เราส่งลิงก์กู้รหัสผ่านให้แล้ว",
        passwordMismatch: "รหัสผ่านไม่ตรงกัน",
        fillRequired: "กรุณากรอกข้อมูลสำคัญให้ครบถ้วน",
        registerFailed: "การสมัครสมาชิกไม่สำเร็จ (อีเมลนี้อาจซ้ำในระบบ)",
        registerRetry: "การสมัครสมาชิกล้มเหลว กรุณาลองใหม่อีกครั้ง",
        loginTitle: "เข้าสู่ระบบร้าน",
        registerTitle: "สร้างบัญชีใหม่",
        forgotTitle: "กู้รหัสผ่าน",
        loginSubtitle: "เข้าใช้งานแผงควบคุมร้านและออเดอร์",
        registerSubtitle: "สมัครเสร็จเลือกได้ว่าจะสร้างร้านใหม่หรือเข้าร่วมร้านที่มีอยู่",
        forgotSubtitle: "กรอกอีเมลบัญชีของคุณ แล้วเราจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่",
        close: "ปิดหน้าต่าง",
        email: "อีเมล",
        password: "รหัสผ่าน",
        firstName: "ชื่อ",
        lastName: "นามสกุล",
        confirmPassword: "ยืนยันรหัสผ่าน",
        loginButton: "เข้าสู่ระบบ",
        loginBusy: "กำลังเข้าสู่ระบบ...",
        sendResetLink: "ส่งลิงก์กู้รหัสผ่าน",
        sendResetBusy: "กำลังส่งลิงก์...",
        createAccountButton: "สร้างบัญชี",
        createAccountBusy: "กำลังสร้างบัญชี...",
        or: "หรือ",
        continueWithGoogle: "ดำเนินการต่อโดยใช้ Google",
        googleBusy: "กำลังรอหน้าต่าง Google...",
        noAccount: "ยังไม่มีบัญชี?",
        haveAccount: "มีบัญชีอยู่แล้ว?",
        forgotPassword: "ลืมรหัสผ่าน?",
        backToLogin: "กลับไปเข้าสู่ระบบ",
        switchToRegister: "สร้างบัญชี",
        switchToLogin: "เข้าสู่ระบบ",
      }
    : {
        clear: "Clear text",
        hidePassword: "Hide password",
        showPassword: "Show password",
        googleCredentialMissing: "Google sign-in could not be started.",
        googleLoginFailed: "Google sign-in was not successful.",
        googleLoginRetry: "Google sign-in failed. Please try again.",
        invalidCredentials: "The email or password is incorrect.",
        invalidCredentialsHint: "If you used Google with this email, continue with Google instead.",
        fillLogin: "Please enter your email and password.",
        loginFailed: "Sign-in failed. Please try again.",
        resetEmailRequired: "Please enter the email for your account.",
        resetRequestFailed: "Could not send the reset link. Please try again.",
        resetGoogleAccount: "This email uses Google sign-in. Please continue with Google instead.",
        resetEmailSent: "If this email exists, we sent a password reset link.",
        passwordMismatch: "Passwords do not match.",
        fillRequired: "Please fill in all required information.",
        registerFailed: "Registration was not successful. This email may already exist.",
        registerRetry: "Registration failed. Please try again.",
        loginTitle: "Sign in to your restaurant",
        registerTitle: "Create an account",
        forgotTitle: "Reset your password",
        loginSubtitle: "Access the restaurant dashboard and order operations.",
        registerSubtitle: "After signing up, you can create a new restaurant or join an existing one.",
        forgotSubtitle: "Enter your account email and we will send a link to set a new password.",
        close: "Close",
        email: "Email",
        password: "Password",
        firstName: "First name",
        lastName: "Last name",
        confirmPassword: "Confirm password",
        loginButton: "Sign in",
        loginBusy: "Signing in...",
        sendResetLink: "Send reset link",
        sendResetBusy: "Sending link...",
        createAccountButton: "Create account",
        createAccountBusy: "Creating account...",
        or: "or",
        continueWithGoogle: "Continue with Google",
        googleBusy: "Waiting for Google...",
        noAccount: "Don't have an account?",
        haveAccount: "Already have an account?",
        forgotPassword: "Forgot password?",
        backToLogin: "Back to sign in",
        switchToRegister: "Create one",
        switchToLogin: "Sign in",
      };

  useEffect(() => {
    if (!isOpen) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      return;
    }
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [isOpen]);

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  const [loginEmail, setLoginEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotEmail, setForgotEmail] = useState("");
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [registerForm, setRegisterForm] = useState<RegisterFormState>({
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showRegisterPw, setShowRegisterPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);

  useEffect(() => {
    if (!isOpen || closing) return;
    const targetId = authMode === "forgot" ? "forgot-email" : authMode === "register" ? "firstName" : "login-email";
    const timer = scheduleAuthModalFocus(
      () => document.getElementById(targetId),
      (callback, delay) => window.setTimeout(callback, delay),
    );
    return () => window.clearTimeout(timer);
  }, [authMode, closing, isOpen]);

  const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setRegisterForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const clearRegisterField = (field: keyof RegisterFormState) => {
    setRegisterForm((prev) => ({ ...prev, [field]: "" }));
  };

  const completeAuth = useCallback(
    (data: LoginResponse, hardReload = false) => {
      const tokenType = "Bearer";
      if (data.token) authRepository.setToken(data.token, tokenType);
      onAuthenticated?.(data.user, data.memberships);
      onClose();
      const target = safeInternalPath(redirectTo) ?? decideRedirect();
      if (hardReload) {
        window.location.href = target;
      } else {
        router.push(target);
      }
    },
    [onAuthenticated, onClose, redirectTo, router]
  );

  const finishGoogleLogin = useCallback(
    async (idToken: string) => {
      setLoading(true);
      setError("");
      try {
        const res = await googleLogin(idToken);
        if (res?.data) {
          completeAuth(res.data);
        } else {
          setError(copy.googleLoginFailed);
        }
      } catch {
        setError(copy.googleLoginRetry);
      } finally {
        setLoading(false);
      }
    },
    [completeAuth, copy.googleLoginFailed, copy.googleLoginRetry]
  );

  // Google sign-in runs in its own browser tab, the way most sites do it. The
  // tab lands on /auth/google/callback, which posts the credential back here.
  const startGoogleLogin = useCallback(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      setError(copy.googleCredentialMissing);
      return;
    }
    setError("");

    const request: GoogleAuthPending = {
      state: randomAuthToken(),
      nonce: randomAuthToken(),
      next: safeInternalPath(redirectTo),
    };
    googleRequestRef.current = request;
    rememberPendingGoogleAuth(request);

    const authUrl = buildGoogleAuthUrl({
      clientId,
      redirectUri: googleCallbackUrl(),
      state: request.state,
      nonce: request.nonce,
    });

    // Opened straight out of the click so the browser counts it as user
    // initiated. If a blocker still refuses, sign in through this tab instead -
    // the callback page finishes the exchange when it has no opener.
    const tab = window.open(authUrl, GOOGLE_TAB_NAME);
    if (!tab) {
      window.location.href = authUrl;
      return;
    }
    googleTabRef.current = tab;
    setGooglePending(true);
    tab.focus?.();
  }, [copy.googleCredentialMissing, redirectTo]);

  // Mounted for the whole time the modal is open rather than only while a tab
  // is pending: the callback tab closes itself right after posting, and tearing
  // the listener down on that close could race the message it just sent.
  useEffect(() => {
    if (!isOpen) return;

    const handleMessage = (event: MessageEvent<GoogleAuthMessage>) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== GOOGLE_AUTH_MESSAGE) return;

      const request = googleRequestRef.current;
      if (!request || data.state !== request.state) return;

      googleRequestRef.current = null;
      googleTabRef.current = null;
      clearPendingGoogleAuth();
      setGooglePending(false);

      if (!isGoogleCallbackTrusted({ idToken: data.idToken, state: data.state, error: data.error }, request)) {
        // access_denied is the user backing out of the chooser on purpose.
        if (data.error !== "access_denied") setError(copy.googleLoginFailed);
        return;
      }
      void finishGoogleLogin(data.idToken as string);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [copy.googleLoginFailed, finishGoogleLogin, isOpen]);

  // The tab can also be closed without choosing an account, which posts
  // nothing. Watch for that so the button does not stay stuck on "waiting".
  useEffect(() => {
    if (!googlePending) return;
    const timer = window.setInterval(() => {
      if (googleTabRef.current?.closed) setGooglePending(false);
    }, 600);
    return () => window.clearInterval(timer);
  }, [googlePending]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (loginEmail && password) {
        const res = await login(loginEmail, password);
        if (res?.data) {
          completeAuth(res.data);
        } else {
          setError(`${copy.invalidCredentials} ${copy.invalidCredentialsHint}`);
        }
      } else {
        setError(copy.fillLogin);
      }
    } catch {
      setError(copy.loginFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    const email = forgotEmail.trim();
    if (!email) {
      setError(copy.resetEmailRequired);
      setLoading(false);
      return;
    }

    try {
      const res = await requestPasswordReset(email);
      if (res) {
        setNotice(copy.resetEmailSent);
      } else {
        setError(copy.resetRequestFailed);
      }
    } catch (err) {
      const code = apiErrorCode(err);
      setError(code === "GOOGLE_ACCOUNT_USE_GOOGLE_LOGIN" ? copy.resetGoogleAccount : copy.resetRequestFailed);
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (registerForm.password !== registerForm.confirmPassword) {
      setError(copy.passwordMismatch);
      setLoading(false);
      return;
    }

    try {
      if (!registerForm.email || !registerForm.password || !registerForm.first_name || !registerForm.last_name) {
        setError(copy.fillRequired);
        setLoading(false);
        return;
      }

      const res = await register({
        email: registerForm.email,
        first_name: registerForm.first_name,
        last_name: registerForm.last_name,
        nickname: "",
        password: registerForm.password,
        phone: "",
        address: "",
        birthday: "",
        profile_image: "",
      });

      if (res) {
        const loginRes = await login(registerForm.email, registerForm.password);
        if (loginRes?.data) {
          completeAuth(loginRes.data, true);
        } else {
          setAuthMode("login");
          setLoginEmail(registerForm.email);
          setPassword("");
        }
      } else {
        setError(copy.registerFailed);
      }
    } catch {
      setError(copy.registerRetry);
    } finally {
      setLoading(false);
    }
  };

  const toggleAuthMode = () => {
    setAuthMode((prev) => (prev === "login" ? "register" : "login"));
    setError("");
    setNotice("");
    setShowLoginPassword(false);
    setShowRegisterPw(false);
    setShowConfirmPw(false);
  };

  const closeAndRestoreFocus = useCallback(() => {
    if (!isOpen || closeTimerRef.current !== null) return;
    const restoreTarget = restoreFocusRef.current;
    setClosing(true);
    closeTimerRef.current = scheduleAuthModalClose(
      () => {
        setClosing(false);
        setAuthMode(initialMode);
        setError("");
        setNotice("");
        onClose();
        restoreTarget?.focus({ preventScroll: true });
        closeTimerRef.current = null;
      },
      (callback, delay) => window.setTimeout(callback, delay),
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    );
  }, [initialMode, isOpen, onClose]);

  const backdropCloseHandlers = useBackdropClose(closeAndRestoreFocus);

  const handleDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [])
      .filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const isLogin = authMode === "login";
  const isForgot = authMode === "forgot";
  const title = isForgot ? copy.forgotTitle : isLogin ? copy.loginTitle : copy.registerTitle;
  const subtitle = isForgot ? copy.forgotSubtitle : isLogin ? copy.loginSubtitle : copy.registerSubtitle;
  const motionPhase: AuthModalMotionPhase = !isOpen ? "closed" : closing ? "closing" : "entering";
  const motionClasses = authModalMotionClasses(motionPhase);

  return (
    // Keep the full-screen blur stable; animate opacity and the dialog surface only.
    <div
      aria-hidden={!isOpen}
      inert={!isOpen}
      {...backdropCloseHandlers}
      className={`${motionClasses.overlay} fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm`}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        onKeyDown={handleDialogKeyDown}
        className={`${motionClasses.dialog} w-full overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl dark:border-gray-800 dark:bg-gray-950 ${
          isLogin || isForgot ? "max-w-sm" : "max-w-lg"
        }`}
      >
        <div className="flex items-start justify-between border-b border-gray-100 px-5 pb-3 pt-4 dark:border-gray-800">
          <div>
            <BrandLine />
            <h2 id="auth-modal-title" className="mt-3 text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">
              {title}
            </h2>
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={closeAndRestoreFocus}
            aria-label={copy.close}
            className="-mr-1.5 -mt-1 rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto overscroll-contain px-5 py-4">
          {isLogin ? (
            <form onSubmit={handleLoginSubmit} className="space-y-3.5">
              <InputField
                id="login-email"
                label={copy.email}
                type="email"
                placeholder="example@email.com"
                required
                autoComplete="email"
                value={loginEmail}
                onChange={(e) => setLoginEmail(e.target.value)}
                onClear={() => setLoginEmail("")}
                labels={copy}
              />
              <InputField
                id="login-password"
                label={copy.password}
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onClear={() => setPassword("")}
                showPasswordToggle
                isPasswordVisible={showLoginPassword}
                onTogglePassword={() => setShowLoginPassword((prev) => !prev)}
                labels={copy}
              />

              <div className="-mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode("forgot");
                    setForgotEmail(loginEmail);
                    setError("");
                    setNotice("");
                  }}
                  className="text-[12px] font-semibold text-orange-600 transition-colors hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
                >
                  {copy.forgotPassword}
                </button>
              </div>

              {error && <ErrorBox message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 h-10 w-full rounded-md bg-orange-700 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:text-white"
              >
                {loading ? copy.loginBusy : copy.loginButton}
              </button>

              {process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID && (
                <>
                  <div className="flex items-center gap-3 py-0.5">
                    <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
                    <span className="text-[11px] text-gray-500 dark:text-gray-500">{copy.or}</span>
                    <div className="h-px flex-1 bg-gray-200 dark:bg-gray-800" />
                  </div>
                  <button
                    type="button"
                    onClick={startGoogleLogin}
                    disabled={loading || googlePending}
                    className="mx-auto flex h-10 w-full max-w-80 items-center justify-center gap-2.5 rounded-md border border-gray-300 bg-white text-[13px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 focus-visible:border-orange-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200 dark:hover:bg-gray-900"
                  >
                    <GoogleGlyph />
                    {googlePending ? copy.googleBusy : copy.continueWithGoogle}
                  </button>
                </>
              )}
            </form>
          ) : isForgot ? (
            <form onSubmit={handleForgotSubmit} className="space-y-3.5">
              <InputField
                id="forgot-email"
                label={copy.email}
                type="email"
                placeholder="example@email.com"
                required
                autoComplete="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                onClear={() => setForgotEmail("")}
                labels={copy}
              />

              {error && <ErrorBox message={error} />}
              {notice && <NoticeBox message={notice} />}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 h-10 w-full rounded-md bg-orange-700 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:text-white"
              >
                {loading ? copy.sendResetBusy : copy.sendResetLink}
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InputField
                  id="firstName"
                  name="first_name"
                  label={copy.firstName}
                  placeholder={copy.firstName}
                  required
                  autoComplete="given-name"
                  value={registerForm.first_name}
                  onChange={handleRegisterChange}
                  onClear={() => clearRegisterField("first_name")}
                  labels={copy}
                />
                <InputField
                  id="lastName"
                  name="last_name"
                  label={copy.lastName}
                  placeholder={copy.lastName}
                  required
                  autoComplete="family-name"
                  value={registerForm.last_name}
                  onChange={handleRegisterChange}
                  onClear={() => clearRegisterField("last_name")}
                  labels={copy}
                />
              </div>

              <InputField
                id="register-email"
                name="email"
                label={copy.email}
                type="email"
                placeholder="example@email.com"
                required
                autoComplete="email"
                value={registerForm.email}
                onChange={handleRegisterChange}
                onClear={() => clearRegisterField("email")}
                labels={copy}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InputField
                  id="register-password"
                  name="password"
                  label={copy.password}
                  type="password"
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  value={registerForm.password}
                  onChange={handleRegisterChange}
                  onClear={() => clearRegisterField("password")}
                  showPasswordToggle
                  isPasswordVisible={showRegisterPw}
                  onTogglePassword={() => setShowRegisterPw((prev) => !prev)}
                  labels={copy}
                />
                <InputField
                  id="confirmPassword"
                  name="confirmPassword"
                  label={copy.confirmPassword}
                  type="password"
                  placeholder="••••••••"
                  required
                  autoComplete="new-password"
                  value={registerForm.confirmPassword}
                  onChange={handleRegisterChange}
                  onClear={() => clearRegisterField("confirmPassword")}
                  showPasswordToggle
                  isPasswordVisible={showConfirmPw}
                  onTogglePassword={() => setShowConfirmPw((prev) => !prev)}
                  labels={copy}
                />
              </div>

              {error && <ErrorBox message={error} />}

              <button
                type="submit"
                disabled={loading}
                className="mt-1 h-10 w-full rounded-md bg-orange-700 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-orange-700 dark:text-white"
              >
                {loading ? copy.createAccountBusy : copy.createAccountButton}
              </button>
            </form>
          )}
        </div>

        <div className="bg-slate-50/60 px-5 py-3 text-center dark:bg-gray-900/40 border-t border-gray-100 dark:border-gray-800">
          {isForgot ? (
            <button
              onClick={() => {
                setAuthMode("login");
                setError("");
                setNotice("");
              }}
              type="button"
              className="text-[12px] font-semibold text-orange-600 transition-colors hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
            >
              {copy.backToLogin}
            </button>
          ) : (
            <p className="text-[12px] text-gray-600 dark:text-gray-400">
              {isLogin ? copy.noAccount : copy.haveAccount}{" "}
              <button
                onClick={toggleAuthMode}
                type="button"
                className="font-semibold text-orange-600 transition-colors hover:text-orange-700 dark:text-orange-400 dark:hover:text-orange-300"
              >
                {isLogin ? copy.switchToRegister : copy.switchToLogin}
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:border-red-900/30 dark:bg-red-900/20 dark:text-red-400">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-px h-4 w-4 shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span>{message}</span>
    </div>
  );
}

function NoticeBox({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700 dark:border-emerald-900/30 dark:bg-emerald-900/20 dark:text-emerald-300">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-px h-4 w-4 shrink-0"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
      <span>{message}</span>
    </div>
  );
}
