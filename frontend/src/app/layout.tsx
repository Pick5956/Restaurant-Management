import type { Metadata, Viewport } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";

import { Kanit, Sarabun, Inter } from "next/font/google";
import { AuthProvider } from "@/src/providers/AuthProvider";
import { LanguageProvider } from "@/src/providers/LanguageProvider";
import { ThemeProvider } from "@/src/providers/ThemeProvider";
import { FeedbackProvider } from "@/src/components/shared/FeedbackProvider";
import DocumentTitle from "@/src/components/shared/DocumentTitle";
import NumericInputGuard from "@/src/components/shared/NumericInputGuard";

const fontKanit = Kanit({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-kanit",
  display: "swap",
});

// Clean LOOPED (มีหัว) Thai/Latin face — currently trialled on the kitchen board
// via the --font-kitchen variable (see kitchen/page.tsx). Sarabun is looped,
// unlike the loopless Kanit/Anuphan/IBM Plex Sans Thai.
const fontKitchen = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-kitchen",
  display: "swap",
});

// Latin/number face for the kitchen board. Loaded with the "latin" subset only,
// so it has no Thai glyphs — listed BEFORE the Thai font in font-family, it wins
// for Latin + digits while Thai falls through to Sarabun.
const fontLatin = Inter({
  subsets: ["latin"],
  variable: "--font-latin",
  display: "swap",
});

// Browser bars on phones follow the page, light or dark.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f5f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
  ],
};

export const metadata: Metadata = {
  title: {
    default: "Dishy · ระบบจัดการร้านอาหาร",
    template: "%s · Dishy",
  },
  description: "ระบบจัดการร้านอาหาร ออเดอร์ ครัว โต๊ะ และการชำระเงิน",
  icons: {
    icon: [{ url: "/web-logo.png?v=2", type: "image/png" }],
    shortcut: [{ url: "/web-logo.png?v=2", type: "image/png" }],
    apple: [{ url: "/web-logo.png?v=2", type: "image/png" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body className={`${fontKanit.variable} ${fontKitchen.variable} ${fontLatin.variable}`}>
        <LanguageProvider>
          <ThemeProvider>
            <FeedbackProvider>
              <AuthProvider>
                <DocumentTitle />
                <NumericInputGuard />
                {children}
              </AuthProvider>
            </FeedbackProvider>
          </ThemeProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
