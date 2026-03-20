"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMode?: "login" | "register";
}

export default function AuthModal({ isOpen, onClose, initialMode = "login" }: AuthModalProps) {
    const [authMode, setAuthMode] = useState<"login" | "register">(initialMode);

    // Login State
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showLoginPassword, setShowLoginPassword] = useState(false);

    // Register State
    const [registerForm, setRegisterForm] = useState({
        firstName: "",
        lastName: "",
        email: "",
        password: "",
        confirmPassword: ""
    });
    const [showRegisterPassword, setShowRegisterPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setAuthMode(initialMode);
            setError("");
        }
    }, [isOpen, initialMode]);

    const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRegisterForm(prev => ({
            ...prev,
            [e.target.name]: e.target.value
        }));
    };

    const clearRegisterField = (field: keyof typeof registerForm) => {
        setRegisterForm(prev => ({
            ...prev,
            [field]: ""
        }));
    };

    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        try {
            if (email && password) {
                // Simulate API call
                await new Promise(resolve => setTimeout(resolve, 1000));
                router.push("/dashboard");
            } else {
                setError("กรุณากรอกอีเมลและรหัสผ่าน");
            }
        } catch (err) {
            setError("เข้าสู่ระบบล้มเหลว กรุณาลองใหม่อีกครั้ง");
        } finally {
            setLoading(false);
        }
    };

    const handleRegisterSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError("");

        if (registerForm.password !== registerForm.confirmPassword) {
            setError("รหัสผ่านไม่ตรงกัน");
            setLoading(false);
            return;
        }

        try {
            // Mock register - replace with actual API call
            await new Promise(resolve => setTimeout(resolve, 1000));
            // Switch back to login after successful register
            setAuthMode("login");
            setEmail(registerForm.email); // Pre-fill email
            setPassword(""); // Clear password
        } catch (err) {
            setError("การสมัครสมาชิกล้มเหลว กรุณาลองใหม่อีกครั้ง");
        } finally {
            setLoading(false);
        }
    };

    const toggleAuthMode = () => {
        setAuthMode(prev => prev === "login" ? "register" : "login");
        setError("");
        // Reset visible states
        setShowLoginPassword(false);
        setShowRegisterPassword(false);
        setShowConfirmPassword(false);
    };

    // Reusable Icons
    const EyeIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
        </svg>
    );

    const EyeSlashIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" />
        </svg>
    );

    const ClearIcon = () => (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
    );

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${isOpen
                ? "opacity-100 visible bg-black/50 backdrop-blur-sm"
                : "opacity-0 invisible bg-black/0 backdrop-blur-none"
                }`}
        >
            {/* Modal Content */}
            <div
                className={`w-full max-w-md bg-white dark:bg-gray-800 rounded-3xl shadow-2xl overflow-hidden relative border border-white/20 dark:border-gray-700/50 transform transition-all duration-300 ${isOpen
                    ? "translate-y-0 scale-100 opacity-100"
                    : "-translate-y-8 scale-95 opacity-0"
                    }`}
            >
                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-white/80 hover:text-white bg-black/20 hover:bg-black/40 rounded-full p-2 backdrop-blur-md transition-all z-20"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Header with Logo */}
                <div className={`p-8 text-center relative overflow-hidden transition-colors duration-500 ${authMode === 'login' ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-gradient-to-r from-green-600 to-emerald-600'}`}>
                    <div className="absolute inset-0 bg-white/10 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '20px 20px' }}></div>
                    <Image
                        src="/SUT_Logo.png"
                        width={70}
                        height={70}
                        alt="SUT Logo"
                        className="mx-auto mb-4 relative z-10"
                    />
                    <h2 className="text-2xl font-bold text-white mb-2 relative z-10">
                        {authMode === "login" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}
                    </h2>
                    <p className={`${authMode === 'login' ? 'text-blue-100' : 'text-green-100'} text-sm relative z-10`}>
                        {authMode === "login" ? "กรุณากรอกข้อมูลเพื่อเข้าใช้งานระบบ" : "สร้างบัญชีใหม่เพื่อเริ่มใช้งาน"}
                    </p>
                </div>

                {/* Form Content */}
                <div className="px-8 py-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {authMode === "login" ? (
                        // Login Form
                        <form onSubmit={handleLoginSubmit} className="space-y-6">
                            {/* Email Field */}
                            <div>
                                <label htmlFor="login-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    อีเมล
                                </label>
                                <div className="relative">
                                    <input
                                        type="email"
                                        id="login-email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full pl-4 pr-12 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white transition-all duration-200 outline-none"
                                        placeholder="example@sut.ac.th"
                                        required
                                    />
                                    {email.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setEmail("")}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full focus:outline-none transition-all"
                                            title="ล้างข้อความ"
                                        >
                                            <ClearIcon />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Password Field */}
                            <div>
                                <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    รหัสผ่าน
                                </label>
                                <div className="relative">
                                    <input
                                        type={showLoginPassword ? "text" : "password"}
                                        id="login-password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        className="w-full pl-4 pr-20 py-3 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white transition-all duration-200 outline-none"
                                        placeholder="••••••••"
                                        required
                                    />
                                    {password.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => setPassword("")}
                                            className="absolute right-11 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full focus:outline-none transition-all"
                                            title="ล้างข้อความ"
                                        >
                                            <ClearIcon />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setShowLoginPassword((prev) => !prev)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
                                        title={showLoginPassword ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                                    >
                                        {showLoginPassword ? <EyeSlashIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                            </div>

                            {/* Error Message */}
                            {error && (
                                <div className="text-red-600 text-sm text-center bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-100 dark:border-red-900/30">
                                    {error}
                                </div>
                            )}

                            {/* Login Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-300 transform shadow-md hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
                            >
                                {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
                            </button>
                        </form>
                    ) : (
                        // Register Form
                        <form onSubmit={handleRegisterSubmit} className="space-y-4">
                            {/* First Name & Last Name Grid */}
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        ชื่อ
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            id="firstName"
                                            name="firstName"
                                            value={registerForm.firstName}
                                            onChange={handleRegisterChange}
                                            className="w-full pl-4 pr-10 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white transition-all duration-200 outline-none"
                                            placeholder="ชื่อ"
                                            required
                                        />
                                        {registerForm.firstName.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => clearRegisterField('firstName')}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full focus:outline-none transition-all"
                                            >
                                                <ClearIcon />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                        นามสกุล
                                    </label>
                                    <div className="relative">
                                        <input
                                            type="text"
                                            id="lastName"
                                            name="lastName"
                                            value={registerForm.lastName}
                                            onChange={handleRegisterChange}
                                            className="w-full pl-4 pr-10 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white transition-all duration-200 outline-none"
                                            placeholder="นามสกุล"
                                            required
                                        />
                                        {registerForm.lastName.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={() => clearRegisterField('lastName')}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full focus:outline-none transition-all"
                                            >
                                                <ClearIcon />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Email */}
                            <div>
                                <label htmlFor="register-email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    อีเมล
                                </label>
                                <div className="relative">
                                    <input
                                        type="email"
                                        id="register-email"
                                        name="email"
                                        value={registerForm.email}
                                        onChange={handleRegisterChange}
                                        className="w-full pl-4 pr-12 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white transition-all duration-200 outline-none"
                                        placeholder="example@sut.ac.th"
                                        required
                                    />
                                    {registerForm.email.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => clearRegisterField('email')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full focus:outline-none transition-all"
                                        >
                                            <ClearIcon />
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Password */}
                            <div>
                                <label htmlFor="register-password" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    รหัสผ่าน
                                </label>
                                <div className="relative">
                                    <input
                                        type={showRegisterPassword ? "text" : "password"}
                                        id="register-password"
                                        name="password"
                                        value={registerForm.password}
                                        onChange={handleRegisterChange}
                                        className="w-full pl-4 pr-20 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white transition-all duration-200 outline-none"
                                        placeholder="••••••••"
                                        required
                                    />
                                    {registerForm.password.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => clearRegisterField('password')}
                                            className="absolute right-11 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full focus:outline-none transition-all"
                                            title="ล้างข้อความ"
                                        >
                                            <ClearIcon />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setShowRegisterPassword((prev) => !prev)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
                                    >
                                        {showRegisterPassword ? <EyeSlashIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                            </div>

                            {/* Confirm Password */}
                            <div>
                                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    ยืนยันรหัสผ่าน
                                </label>
                                <div className="relative">
                                    <input
                                        type={showConfirmPassword ? "text" : "password"}
                                        id="confirmPassword"
                                        name="confirmPassword"
                                        value={registerForm.confirmPassword}
                                        onChange={handleRegisterChange}
                                        className="w-full pl-4 pr-20 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 focus:ring-green-500 focus:border-transparent dark:bg-gray-700 dark:text-white transition-all duration-200 outline-none"
                                        placeholder="••••••••"
                                        required
                                    />
                                    {registerForm.confirmPassword.length > 0 && (
                                        <button
                                            type="button"
                                            onClick={() => clearRegisterField('confirmPassword')}
                                            className="absolute right-11 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full focus:outline-none transition-all"
                                            title="ล้างข้อความ"
                                        >
                                            <ClearIcon />
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword((prev) => !prev)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
                                    >
                                        {showConfirmPassword ? <EyeSlashIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                            </div>

                            {/* Error Message */}
                            {error && (
                                <div className="text-red-600 text-sm text-center bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-100 dark:border-red-900/30">
                                    {error}
                                </div>
                            )}

                            {/* Register Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-300 transform shadow-md hover:shadow-lg hover:shadow-green-500/30 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none mt-2"
                            >
                                {loading ? "กำลังสมัครสมาชิก..." : "สมัครสมาชิก"}
                            </button>
                        </form>
                    )}

                    {/* Toggle Link */}
                    <div className="mt-8 text-center border-t border-gray-100 dark:border-gray-700 pt-6">
                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                            {authMode === "login" ? "ยังไม่มีบัญชี?" : "มีบัญชีอยู่แล้ว?"}{" "}
                            <button
                                onClick={toggleAuthMode}
                                type="button"
                                className={`font-semibold transition-colors duration-200 cursor-pointer ${authMode === "login"
                                    ? "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                                    : "text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"
                                    }`}
                            >
                                {authMode === "login" ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}
                            </button>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
