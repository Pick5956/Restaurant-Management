"use client";

import AppLogo from "@/src/components/shared/AppLogo";
import AppWordmark from "@/src/components/shared/AppWordmark";
import LanguageToggle from "@/src/components/shared/LanguageToggle";
import { Browser, Phone, Tablet, WebShot } from "@/src/components/landing/LandingDevices";
import { LANDING_COPY } from "@/src/components/landing/landingCopy";
import { FadeUp, clamp, docProgress, ease, enterProgress, lerp, stickyProgress, useScrollDriven } from "@/src/components/landing/landingMotion";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { safeNextPathFromSearch } from "@/src/lib/safeRedirect";
import { ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// The landing page, one dark page from top to bottom (27 ก.ย. 2569). It sells
// the web first, then the iPad and the phone app, then everything else:
//   1  the web window rises and lies flat under the headline
//   2  the web a page at a time, picked with tabs in the window's own bar
//   3  an iPad settles and a phone slides in beside it
//   4  what the phone app shows, the phone held still while the story scrolls
//   5  twelve features, 6  sign up
// One glow behind the whole page drifts with the scroll, so no section has an
// edge. The web and iPad screens are drawn stand-ins until real screenshots
// are dropped into public/landing/ (see LandingDevices › WebShot).

// "Get started" opens the sign-up form, "Sign in" the sign-in form.
function PillButtons({ register, login, onRegister, onLogin }: { register: string; login: string; onRegister: () => void; onLogin: () => void }) {
  return (
    <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
      <button
        type="button"
        onClick={onRegister}
        className="ui-press inline-flex h-11 items-center rounded-full bg-orange-700 px-6 text-[17px] font-medium text-white transition-colors hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
      >
        {register}
      </button>
      <button
        type="button"
        onClick={onLogin}
        className="inline-flex items-center gap-0.5 text-[17px] text-orange-400 transition-colors hover:text-orange-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
      >
        {login} <ChevronRight className="h-4 w-4" strokeWidth={2.2} />
      </button>
    </div>
  );
}

export default function LandingPage() {
  const router = useRouter();
  const { closeLoginModal, openLoginModal, user, loading } = useAuth();
  const { language } = useLanguage();
  const didRequestAuthOnLanding = useRef(false);
  const authRedirectToRef = useRef<string | undefined>(undefined);

  const readAuthRedirectTo = useCallback(() => {
    authRedirectToRef.current = safeNextPathFromSearch(window.location.search);
    return authRedirectToRef.current;
  }, []);

  useEffect(() => {
    if (didRequestAuthOnLanding.current || user) return;
    if (readAuthRedirectTo()) return;
    closeLoginModal();
  }, [closeLoginModal, loading, readAuthRedirectTo, user]);

  useEffect(() => {
    if (!loading && user) {
      router.replace(readAuthRedirectTo() ?? "/restaurants");
    }
  }, [loading, readAuthRedirectTo, router, user]);

  useEffect(() => {
    if (loading || user || didRequestAuthOnLanding.current) return;
    const authRedirectTo = readAuthRedirectTo();
    if (!authRedirectTo) return;
    didRequestAuthOnLanding.current = true;
    const timer = window.setTimeout(() => openLoginModal(authRedirectTo), 0);
    return () => window.clearTimeout(timer);
  }, [loading, openLoginModal, readAuthRedirectTo, user]);

  const [webIndex, setWebIndex] = useState(0);
  const [activeApp, setActiveApp] = useState(0);

  const glow = useRef<HTMLDivElement>(null);
  const hero = useRef<HTMLDivElement>(null);
  const heroTitle = useRef<HTMLDivElement>(null);
  const heroShot = useRef<HTMLDivElement>(null);
  const devices = useRef<HTMLDivElement>(null);
  const devicesTitle = useRef<HTMLDivElement>(null);
  const tablet = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const appStory = useRef<HTMLDivElement>(null);

  // Every moving part is drawn here from the scroll position, straight onto
  // the element — nothing below sets these styles, so a render never undoes
  // them. All positions are read first, then all styles written, so the
  // browser lays the page out once per frame and not once per element.
  useScrollDriven(() => {
    const g = docProgress();
    const p = stickyProgress(hero.current);
    // From the moment the iPad's section shows at the bottom of the window,
    // not from when it reaches the top: waiting for the top left a whole
    // screen of black after the web window (28 ก.ย. 2569).
    const t = enterProgress(devices.current);
    const appProgress = stickyProgress(appStory.current);

    const rise = ease(clamp(p / 0.75));
    const titleOut = clamp(p / 0.4);
    const arrive = ease(clamp((t - 0.1) / 0.65));
    const shown = clamp((t - 0.1) / 0.25);

    if (glow.current) {
      glow.current.style.background = [
        `radial-gradient(60% 50% at 50% ${lerp(105, 15, g)}%, rgba(234,88,12,${0.18 + 0.22 * Math.sin(g * Math.PI)}), transparent 70%)`,
        `radial-gradient(40% 40% at ${lerp(10, 90, g)}% ${lerp(30, 85, g)}%, rgba(245,158,11,0.12), transparent 70%)`,
      ].join(",");
    }
    if (heroTitle.current) {
      heroTitle.current.style.opacity = String(1 - titleOut);
      heroTitle.current.style.transform = `translateY(${-titleOut * 60}px) scale(${1 - titleOut * 0.06})`;
    }
    if (heroShot.current) {
      heroShot.current.style.transform = `translate(-50%, -50%) translateY(${lerp(72, 0, rise)}%) perspective(1800px) rotateX(${lerp(26, 0, rise)}deg) scale(${lerp(0.9, 1, rise)})`;
    }
    if (devicesTitle.current) {
      devicesTitle.current.style.opacity = String(shown);
      devicesTitle.current.style.transform = `translateY(${(1 - shown) * 30}px)`;
    }
    if (tablet.current) {
      tablet.current.style.transform = `translateX(${lerp(0, -6, arrive)}%) scale(${lerp(1.18, 1, arrive)})`;
      tablet.current.style.opacity = String(shown);
    }
    if (phone.current) {
      phone.current.style.left = `${lerp(130, 86, arrive)}%`;
      phone.current.style.transform = `translateX(-50%) rotate(${lerp(12, 3, arrive)}deg)`;
      phone.current.style.opacity = String(clamp(arrive * 1.5));
    }
    setActiveApp(Math.min(LANDING_COPY.th.appSteps.length - 1, Math.floor(appProgress * LANDING_COPY.th.appSteps.length)));
  });

  if (loading || user) {
    return <div className="min-h-[100dvh] bg-black" />;
  }

  const copy = LANDING_COPY[language];
  const openLandingLoginModal = (mode: "login" | "register" = "login") => {
    didRequestAuthOnLanding.current = true;
    openLoginModal(readAuthRedirectTo(), mode);
  };
  const cta = (
    <PillButtons
      register={copy.register}
      login={copy.login}
      onRegister={() => openLandingLoginModal("register")}
      onLogin={() => openLandingLoginModal("login")}
    />
  );

  return (
    <div className="relative min-h-[100dvh] bg-black text-[#f5f5f7]">
      {/* globals.css gives body overflow-x: hidden, which makes body a scroll
          box of its own that never scrolls, so nothing inside could stick.
          clip hides the same sideways overflow without that. The root is
          painted black too, so a bounce past either end shows no white. */}
      <style>{`html, body { background: #000; } body { overflow-x: clip; }`}</style>

      <div ref={glow} aria-hidden="true" className="pointer-events-none fixed inset-0" />

      <header className="fixed inset-x-0 top-0 z-50 h-12 border-b border-white/10 bg-black/60 backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-full max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <AppLogo decorative size={24} priority />
            <AppWordmark height={14} className="text-white" />
          </div>
          <div className="flex items-center gap-2">
            <LanguageToggle className="shrink-0" />
            <button
              type="button"
              onClick={() => openLandingLoginModal("login")}
              className="ui-press rounded-full bg-orange-700 px-3.5 py-1 text-[13px] font-medium text-white transition-colors hover:bg-orange-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
            >
              {copy.login}
            </button>
          </div>
        </div>
      </header>

      <main className="relative">
        {/* 1 · the web rises up and lies flat */}
        <div ref={hero} className="relative h-[220vh]">
          <div className="sticky top-0 h-[100dvh] overflow-hidden">
            <div ref={heroTitle} className="absolute inset-x-0 top-[11dvh] px-4 text-center will-change-transform">
              <p className="text-[17px] font-semibold text-orange-400">{copy.heroEyebrow}</p>
              <h1 className="mt-3 text-[40px] font-semibold leading-[1.25] sm:text-[60px] lg:text-[72px]">
                {/* Thai has no spaces to break on, so each half is kept whole;
                    English is left to wrap, or it runs off a phone. */}
                <span className={language === "th" ? "whitespace-nowrap" : ""}>{copy.heroTitle[0]}</span>
                <br />
                <span className={language === "th" ? "whitespace-nowrap" : ""}>{copy.heroTitle[1]}</span>
              </h1>
              <p className="mx-auto mt-4 max-w-xl text-[17px] text-white/60 sm:text-[21px]">{copy.heroDesc}</p>
              {cta}
            </div>

            <div ref={heroShot} className="absolute left-1/2 top-1/2 w-[min(94vw,1180px,calc((100dvh_-_150px)*1.6))] will-change-transform">
              <Browser>
                <WebShot file="desktop-home.png" alt={copy.heroShotAlt} />
              </Browser>
            </div>
          </div>
        </div>

        {/* 2 · the web, a page at a time — picked with the tabs in the window's
            own title bar, not by scrolling. The frame is sized to nearly the
            whole window height, so frame and tabs fit on one screen together. */}
        <section className="relative flex flex-col items-center px-3 pb-16 pt-24 sm:px-4">
          <div className="grid w-full max-w-2xl text-center [&>*]:[grid-area:1/1]">
            {copy.webSteps.map((step, i) => (
              <div
                key={step.file}
                aria-hidden={i !== webIndex}
                className={`transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${i === webIndex ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
              >
                <h2 className="text-[30px] font-semibold leading-[1.2] sm:text-[40px]">{step.title}</h2>
                <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-white/60 sm:text-[17px]">{step.desc}</p>
              </div>
            ))}
          </div>

          <FadeUp className="mt-8 w-[min(96vw,1400px,calc((100dvh_-_130px)*1.6))]">
            <Browser
              tabs={
                <div role="tablist" className="flex w-max gap-1">
                  {copy.webSteps.map((step, i) => (
                    <button
                      key={step.file}
                      type="button"
                      role="tab"
                      aria-selected={i === webIndex}
                      onClick={() => setWebIndex(i)}
                      className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium leading-5 transition-colors duration-300 sm:px-4 sm:text-[15px] ${
                        i === webIndex ? "bg-white text-black" : "text-white/60 hover:bg-white/[0.08] hover:text-white"
                      }`}
                    >
                      {step.tab}
                    </button>
                  ))}
                </div>
              }
            >
              {copy.webSteps.map((step, i) => (
                <div
                  key={step.file}
                  aria-hidden={i !== webIndex}
                  className={`absolute inset-0 transition-opacity duration-500 motion-reduce:transition-none ${i === webIndex ? "opacity-100" : "opacity-0"}`}
                >
                  <WebShot file={step.file} alt={step.title} />
                </div>
              ))}
            </Browser>
          </FadeUp>
        </section>

        {/* 3 · then the iPad and the phone come in. Clipped sideways only, for
            the phone sliding in from the right: a box that clipped all round
            cut the phone off in a straight line on a short window. */}
        <div ref={devices} className="relative h-[180vh] overflow-x-clip">
          <div className="sticky top-0 flex h-[100dvh] flex-col items-center px-4 pt-[10dvh]">
            <div ref={devicesTitle} className="text-center will-change-transform">
              <p className="text-[15px] font-semibold text-orange-400">{copy.devicesEyebrow}</p>
              <h2 className="mt-2 text-[34px] font-semibold leading-[1.2] sm:text-[52px]">{copy.devicesTitle}</h2>
              <p className="mx-auto mt-3 max-w-xl text-[17px] leading-relaxed text-white/60 sm:text-[19px]">{copy.devicesDesc}</p>
            </div>

            <div className="relative mt-10 flex w-full flex-1 items-center justify-center pb-[6dvh]">
              <div className="relative w-[min(80vw,860px,calc((100dvh_-_360px)*1.43))]">
                <div ref={tablet} className="will-change-transform">
                  <Tablet>
                    <WebShot file="tablet-home.png" alt={copy.tabletAlt} />
                  </Tablet>
                </div>
                {/* A quarter of the iPad's width, so it can never outgrow it. */}
                <div ref={phone} className="absolute top-[16%] w-[24%] will-change-transform">
                  <Phone src={copy.appSteps[0].shot} alt={copy.phoneAlt} />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 4 · what the phone app shows. Words and screen sit in one sticky
            screen and change together, halfway through the scroll: when each
            step was a full screen of its own, the phone changed while the
            words for it were still at the bottom of the window. */}
        <div ref={appStory} className="relative h-[200vh]">
          <div className="sticky top-0 mx-auto flex h-[100dvh] max-w-6xl flex-col items-center justify-center gap-8 px-4 pt-12 lg:grid lg:grid-cols-2 lg:gap-16 lg:pt-0">
            <div className="grid w-full text-center lg:text-left [&>*]:[grid-area:1/1]">
              {copy.appSteps.map((step, i) => (
                <div
                  key={step.shot}
                  aria-hidden={activeApp !== i}
                  className={`transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${activeApp === i ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}
                >
                  <p className="text-[15px] font-semibold text-orange-400">{step.label}</p>
                  <h2 className="mt-2 text-[32px] font-semibold leading-[1.2] sm:text-[52px]">{step.title}</h2>
                  <p className="mx-auto mt-3 max-w-md text-[16px] leading-7 text-white/65 sm:text-[19px] sm:leading-8 lg:mx-0">{step.desc}</p>
                </div>
              ))}
            </div>
            <div className="relative w-[min(52vw,34dvh)] lg:mx-auto lg:w-[min(26vw,32dvh)]">
              {copy.appSteps.map((step, i) => (
                <div
                  key={step.shot}
                  aria-hidden={activeApp !== i}
                  className={`transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${i === 0 ? "relative" : "absolute inset-0"} ${activeApp === i ? "scale-100 opacity-100" : "scale-[0.96] opacity-0"}`}
                >
                  <Phone src={step.shot} alt={step.alt} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 5 · everything else it does */}
        <section className="relative mx-auto max-w-6xl px-4 py-32">
          <FadeUp>
            <p className="text-center text-[15px] font-semibold text-orange-400">{copy.featuresEyebrow}</p>
            <h2 className="mt-2 text-center text-[34px] font-semibold leading-[1.2] sm:text-[52px]">
              {copy.featuresTitle[0]}
              <br />
              <span className="text-white/45">{copy.featuresTitle[1]}</span>
            </h2>
          </FadeUp>
          <div className="mt-16 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {copy.features.map((item, i) => {
              const Icon = item.icon;
              return (
                <FadeUp key={item.title} delay={(i % 3) * 90}>
                  <div className="h-full rounded-[24px] bg-white/[0.04] p-7 ring-1 ring-white/10 backdrop-blur-sm transition-colors duration-500 hover:bg-white/[0.07]">
                    <Icon className="h-7 w-7 text-orange-400" strokeWidth={1.6} />
                    <h3 className="mt-5 text-[19px] font-semibold">{item.title}</h3>
                    <p className="mt-1.5 text-[15px] leading-relaxed text-white/55">{item.desc}</p>
                  </div>
                </FadeUp>
              );
            })}
          </div>
        </section>

        {/* 6 · the ask */}
        <section className="relative px-4 pb-24 pt-16 text-center">
          <FadeUp>
            <h2 className="text-[36px] font-semibold leading-[1.2] sm:text-[60px]">{copy.ctaTitle}</h2>
            <p className="mx-auto mt-4 max-w-lg text-[17px] text-white/60 sm:text-[21px]">{copy.ctaDesc}</p>
            {cta}
          </FadeUp>
        </section>
      </main>

      <footer className="relative border-t border-white/10 py-8">
        <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-4">
          <AppLogo decorative size={24} />
          <AppWordmark height={14} className="text-white/80" />
        </div>
      </footer>
    </div>
  );
}
