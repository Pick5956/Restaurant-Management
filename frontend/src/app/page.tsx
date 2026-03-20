"use client";

import Image from "next/image";
import { useState } from "react";
import AuthModal from "../components/auth/AuthModal";

export default function Home() {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 dark:from-gray-900 dark:via-gray-800 dark:to-gray-900 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Home Content */}
      <div className="text-center z-10 max-w-2xl px-4">
        <Image
          src="/SUT_Logo.png"
          width={120}
          height={120}
          alt="SUT Logo"
          className="mx-auto mb-8 drop-shadow-lg"
          priority
        />
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-400 dark:to-indigo-400 mb-6 drop-shadow-sm">
          ระบบจัดการโครงงาน
        </h1>
        <p className="text-lg md:text-xl text-gray-700 dark:text-gray-300 mb-10 leading-relaxed max-w-xl mx-auto font-medium">
          มหาวิทยาลัยเทคโนโลยีสุรนารี
          <br />
          <span className="text-base text-gray-500 dark:text-gray-400 font-normal mt-2 block">
            เข้าสู่ระบบเพื่อจัดการและติดตามความคืบหน้าของโครงงานได้อย่างมีประสิทธิภาพ
          </span>
        </p>

        <button
          onClick={() => setIsAuthModalOpen(true)}
          className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-lg md:text-xl py-4 px-12 rounded-full shadow-lg hover:shadow-xl hover:shadow-blue-500/30 transition-all duration-300 transform hover:-translate-y-1"
        >
          เข้าสู่ระบบ (Login)
        </button>
      </div>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        initialMode="login"
      />
    </div>
  );
}
