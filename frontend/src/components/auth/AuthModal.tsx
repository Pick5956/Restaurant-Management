"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { User } from "../../types/auth";
import { login, register, getRoles } from "../../lib/auth";
import { authRepository } from "../../app/repositories/authRepository";

// --- Icons ---
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

// --- Reusable Input Component ---
interface InputFieldProps {
    id: string;
    name?: string;
    label: string;
    type?: string;
    value: string | undefined;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    required?: boolean;
    ringColor?: "blue" | "green";
    onClear?: () => void;
    showPasswordToggle?: boolean;
    isPasswordVisible?: boolean;
    onTogglePassword?: () => void;
}

const InputField = ({
    id, name, label, type = "text", value = "", onChange, placeholder, required,
    ringColor = "blue", onClear, showPasswordToggle, isPasswordVisible, onTogglePassword
}: InputFieldProps) => {
    const isPasswordType = type === "password";
    const actualType = isPasswordType && isPasswordVisible ? "text" : type;

    // Calculate right padding depending on icons
    let prClass = "pr-4";
    if (showPasswordToggle && onClear) prClass = "pr-20"; // Both eye and clear
    else if (showPasswordToggle) prClass = "pr-12";       // Just eye
    else if (onClear) prClass = "pr-12";                  // Just clear

    const ringClass = ringColor === "green" ? "focus:ring-green-500" : "focus:ring-blue-500";

    return (
        <div>
            <label htmlFor={id} className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {label}
            </label>
            <div className="relative">
                <input
                    type={actualType} id={id} name={name || id} value={value} onChange={onChange}
                    className={`w-full pl-4 ${prClass} py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl focus:ring-2 ${ringClass} focus:border-transparent dark:bg-gray-700 dark:text-white transition-all duration-200 outline-none`}
                    placeholder={placeholder} required={required}
                />

                {value.length > 0 && onClear && (
                    <button
                        type="button" onClick={onClear} title="ล้างข้อความ" tabIndex={-1}
                        className={`absolute ${showPasswordToggle ? 'right-11' : 'right-3'} top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full focus:outline-none transition-all`}
                    >
                        <ClearIcon />
                    </button>
                )}

                {showPasswordToggle && (
                    <button
                        type="button" onClick={onTogglePassword} title={isPasswordVisible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"} tabIndex={-1}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 focus:outline-none transition-colors"
                    >
                        {isPasswordVisible ? <EyeSlashIcon /> : <EyeIcon />}
                    </button>
                )}
            </div>
        </div>
    );
};

// --- Main AuthModal Component ---
export interface AuthModalProps {
    isOpen: boolean;
    onClose: () => void;
    initialMode?: "login" | "register";
}

export default function AuthModal({ isOpen, onClose, initialMode = "login" }: AuthModalProps) {
    const [authMode, setAuthMode] = useState<"login" | "register">(initialMode);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const router = useRouter();

    const [isRoleDropdownOpen, setIsRoleDropdownOpen] = useState(false);
    const [rolesList, setRolesList] = useState<{ id: number; label: string; icon: string }[]>([]);

    // Reset state when modal opens
    useEffect(() => {
        if (isOpen) {
            setAuthMode(initialMode);
            setError("");
            
            // ดึง Roles จาก API
            getRoles().then(res => {
                if (res && res.data && res.data.data) {
                    const apiRoles = res.data.data.map((r: any) => {
                        let label = r.Role || r.role;
                        
                        // ปรับชื่อให้สวยงาม (เอา Icon ออกตามที่ขอ)
                        if (label.toLowerCase().includes("admin")) { label = "ผู้ดูแลระบบ (Admin)"; }
                        else if (label.toLowerCase().includes("teacher")) { label = "อาจารย์ (Teacher)"; }
                        else if (label.toLowerCase().includes("student")) { label = "นักศึกษา (Student)"; }
                        
                        return { id: r.ID || r.id, label, icon: "" };
                    });
                    setRolesList(apiRoles);
                }
            });
        }
    }, [isOpen, initialMode]);

    // Login Form State
    const [sutId, setSutId] = useState("");
    const [password, setPassword] = useState("");
    const [showLoginPassword, setShowLoginPassword] = useState(false);

    // Register Form State — password fields are local only (not part of User type)
    const [registerForm, setRegisterForm] = useState<Partial<User> & { password?: string; confirmPassword?: string; role_id?: number }>({
        sut_id: "",
        first_name: "",
        last_name: "",
        email: "",
        password: "",
        confirmPassword: "",
        role_id: 3 // Default Role 3 (Student)
    });

    const [showRegisterPw, setShowRegisterPw] = useState(false);
    const [showConfirmPw, setShowConfirmPw] = useState(false);

    const handleRegisterChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const val = e.target.name === 'role_id' ? parseInt(e.target.value, 10) : e.target.value;
        setRegisterForm(prev => ({ ...prev, [e.target.name]: val }));
    };
    const clearRegisterField = (field: keyof typeof registerForm) => {
        setRegisterForm(prev => ({ ...prev, [field]: "" }));
    };

    const handleLoginSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true); setError("");
        try {
            if (sutId && password) {
                const res = await login(sutId, password);
                if (res && res.data) {
                    const token = res.data.token || res.data.access_token;
                    const tokenType = res.data.token_type || "Bearer";
                    
                    if (token) {
                        authRepository.setToken(token, tokenType);
                    }

                    onClose();
                    router.push("/home");
                } else {
                    setError("ข้อมูลเข้าสู่ระบบไม่ถูกต้อง");
                }
            } else setError("กรุณากรอกรหัสนักศึกษา/บุคลากรและรหัสผ่าน");
        } catch (err) {
            setError("เข้าสู่ระบบล้มเหลว กรุณาลองใหม่อีกครั้ง");
        } finally {
            setLoading(false);
        }
    };

    const handleRegisterSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true); setError("");

        if (registerForm.password !== registerForm.confirmPassword) {
            setError("รหัสผ่านไม่ตรงกัน"); setLoading(false);
            return;
        }

        try {
            if (!registerForm.sut_id || !registerForm.email || !registerForm.password || !registerForm.first_name || !registerForm.last_name) {
                setError("กรุณากรอกข้อมูลสำคัญให้ครบถ้วน");
                setLoading(false);
                return;
            }

            const { confirmPassword, ...userData } = registerForm;
            // Send default role_id if not present
            userData.role_id = userData.role_id || 3;
            
            const res = await register(userData as unknown as Omit<User, "password">);
            
            if (res) {
                // 🚀 สมัครสำเร็จปุ๊บ สั่งยิง API ขอ Log in อัตโนมัติต่อทันที!
                const loginRes = await login(registerForm.sut_id!, registerForm.password!);
                
                if (loginRes && loginRes.data) {
                    const token = loginRes.data.token || loginRes.data.access_token;
                    const tokenType = loginRes.data.token_type || "Bearer";
                    
                    if (token) {
                        authRepository.setToken(token, tokenType);
                    }
                    
                    onClose(); // ปิดหน้าต่าง Modal 
                    window.location.href = "/home"; // รีเฟรชหน้าเพื่อให้สถานะผู้ใช้อัปเดต
                } else {
                    // ถ้า auto-login พลาด (ซึ่งไม่ควรเกิด) ก็สลับไปให้ล็อกอินเอง
                    setAuthMode("login");
                    setSutId(registerForm.sut_id || "");
                    setPassword("");
                }
            } else {
                setError("การสมัครสมาชิกล้มเหลว (รหัสนักศึกษาหรืออีเมลอาจซ้ำในระบบ)");
            }
        } catch (err) {
            setError("การสมัครสมาชิกล้มเหลว กรุณาลองใหม่อีกครั้ง");
        } finally {
            setLoading(false);
        }
    };

    const toggleAuthMode = () => {
        setAuthMode(prev => prev === "login" ? "register" : "login");
        setError("");
        setShowLoginPassword(false); setShowRegisterPw(false); setShowConfirmPw(false);
    };

    return (
        <div
            className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-300 ${isOpen ? "opacity-100 visible bg-black/50 backdrop-blur-sm" : "opacity-0 invisible bg-black/0 backdrop-blur-none"}`}
        >
            <div className={`w-full max-w-md bg-white dark:bg-gray-800 rounded-3xl shadow-2xl overflow-hidden relative border border-white/20 dark:border-gray-700/50 transform transition-all duration-300 ${isOpen ? "translate-y-0 scale-100 opacity-100" : "-translate-y-8 scale-95 opacity-0"}`}>

                {/* Close Button */}
                <button
                    onClick={onClose}
                    className="absolute cursor-pointer top-4 right-4 text-white/80 hover:text-white bg-black/20 hover:bg-black/40 rounded-full p-2 backdrop-blur-md transition-all z-20"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>

                {/* Header */}
                <div className={`p-8 text-center relative overflow-hidden transition-colors duration-500 ${authMode === 'login' ? 'bg-gradient-to-r from-blue-600 to-indigo-600' : 'bg-gradient-to-r from-green-600 to-emerald-600'}`}>
                    <div className="absolute inset-0 bg-white/10 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '20px 20px' }}></div> 
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
                        <form onSubmit={handleLoginSubmit} className="space-y-6">
                            <InputField
                                id="login-sutid" label="รหัสนักศึกษา/บุคลากร" type="text" placeholder="B6XXXXXXXX" required ringColor="blue"
                                value={sutId} onChange={(e) => setSutId(e.target.value)} onClear={() => setSutId("")}
                            />
                            <InputField
                                id="login-password" label="รหัสผ่าน" type="password" placeholder="••••••••" required ringColor="blue"
                                value={password} onChange={(e) => setPassword(e.target.value)} onClear={() => setPassword("")}
                                showPasswordToggle isPasswordVisible={showLoginPassword} onTogglePassword={() => setShowLoginPassword(p => !p)}
                            />

                            {error && <div className="text-red-600 text-sm text-center bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-100 dark:border-red-900/30">{error}</div>}

                            <button
                                type="submit" disabled={loading}
                                className="cursor-pointer w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-300 transform shadow-md hover:shadow-lg hover:shadow-blue-500/30 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
                            >
                                {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={handleRegisterSubmit} className="space-y-4">
                            <div className="relative">
                                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                    สถานะ (Role)
                                </label>
                                <div 
                                    onClick={() => setIsRoleDropdownOpen(!isRoleDropdownOpen)}
                                    className={`w-full px-4 py-2.5 flex items-center justify-between border ${isRoleDropdownOpen ? 'border-green-500 ring-2 ring-green-500/20' : 'border-gray-300 dark:border-gray-600'} rounded-xl cursor-pointer bg-white dark:bg-gray-700 text-gray-900 dark:text-white transition-all duration-200 outline-none select-none hover:border-green-400 dark:hover:border-green-500`}
                                >
                                    <span className="flex items-center gap-2">
                                        {rolesList.find(r => r.id === registerForm.role_id)?.icon}
                                        {rolesList.find(r => r.id === registerForm.role_id)?.label}
                                    </span>
                                    <svg className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isRoleDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>

                                {isRoleDropdownOpen && (
                                    <>
                                        {/* แผ่นใสสำหรับดักคลิกเพื่อปิดเมนู */}
                                        <div className="fixed inset-0 z-40" onClick={() => setIsRoleDropdownOpen(false)}></div>
                                        
                                        {/* เมนู Dropdown ตัวจริง */}
                                        <div className="absolute z-50 w-full mt-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                            {rolesList.map(role => (
                                                <div 
                                                    key={role.id}
                                                    onClick={() => {
                                                        setRegisterForm(prev => ({ ...prev, role_id: role.id }));
                                                        setIsRoleDropdownOpen(false);
                                                    }}
                                                    className={`px-4 py-3 flex items-center cursor-pointer transition-colors ${registerForm.role_id === role.id ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 font-medium' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                                                >
                                                    <span className="mr-3 text-lg">{role.icon}</span>
                                                    {role.label}
                                                    {registerForm.role_id === role.id && (
                                                        <svg className="w-5 h-5 ml-auto text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                            <InputField
                                id="register-sutid" name="sut_id" label="รหัสนักศึกษา/บุคลากร (SUT ID)" type="text" placeholder="B6XXXXXXXX" required ringColor="green"
                                value={registerForm.sut_id} onChange={handleRegisterChange} onClear={() => clearRegisterField("sut_id")}
                            />
                            <InputField
                                id="firstName" name="first_name" label="ชื่อ" placeholder="ชื่อ" required ringColor="green"
                                value={registerForm.first_name} onChange={handleRegisterChange} onClear={() => clearRegisterField("first_name")}
                            />
                            <InputField
                                id="lastName" name="last_name" label="นามสกุล" placeholder="นามสกุล" required ringColor="green"
                                value={registerForm.last_name} onChange={handleRegisterChange} onClear={() => clearRegisterField("last_name")}
                            />
                            <InputField
                                id="register-email" name="email" label="อีเมล" type="email" placeholder="example@sut.ac.th" required ringColor="green"
                                value={registerForm.email} onChange={handleRegisterChange} onClear={() => clearRegisterField("email")}
                            />
                            <InputField
                                id="register-password" name="password" label="รหัสผ่าน" type="password" placeholder="••••••••" required ringColor="green"
                                value={registerForm.password} onChange={handleRegisterChange} onClear={() => clearRegisterField("password")}
                                showPasswordToggle isPasswordVisible={showRegisterPw} onTogglePassword={() => setShowRegisterPw(p => !p)}
                            />
                            <InputField
                                id="confirmPassword" name="confirmPassword" label="ยืนยันรหัสผ่าน" type="password" placeholder="••••••••" required ringColor="green"
                                value={registerForm.confirmPassword} onChange={handleRegisterChange} onClear={() => clearRegisterField("confirmPassword")}
                                showPasswordToggle isPasswordVisible={showConfirmPw} onTogglePassword={() => setShowConfirmPw(p => !p)}
                            />

                            {error && <div className="text-red-600 text-sm text-center bg-red-50 dark:bg-red-900/20 p-3 rounded-xl border border-red-100 dark:border-red-900/30">{error}</div>}

                            <button
                                type="submit" disabled={loading}
                                className="cursor-pointer w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white font-bold py-3.5 px-4 rounded-xl transition-all duration-300 transform shadow-md hover:shadow-lg hover:shadow-green-500/30 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none mt-2"
                            >
                                {loading ? "กำลังสมัครสมาชิก..." : "สมัครสมาชิก"}
                            </button>
                        </form>
                    )}

                    <div className="mt-8 text-center border-t border-gray-100 dark:border-gray-700 pt-6">
                        <p className="text-gray-600 dark:text-gray-400 text-sm">
                            {authMode === "login" ? "ยังไม่มีบัญชี?" : "มีบัญชีอยู่แล้ว?"}{" "}
                            <button
                                onClick={toggleAuthMode} type="button"
                                className={`font-semibold transition-colors duration-200 cursor-pointer ${authMode === "login" ? "text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300" : "text-green-600 hover:text-green-800 dark:text-green-400 dark:hover:text-green-300"}`}
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
