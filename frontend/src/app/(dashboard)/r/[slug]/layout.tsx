import { SidebarProvider } from "@/src/providers/SidebarProvider";
import Sidebar from "@/src/components/shared/Sidebar";
import PhoneTopBar from "@/src/components/shared/PhoneTopBar";
import ContentWrapper from "@/src/components/shared/ContentWrapper";
import ShellScroll from "@/src/components/shared/ShellScroll";
import DashboardRestaurantGuard from "@/src/components/shared/DashboardRestaurantGuard";
import AIOperationsFloatingChatGate from "@/src/components/shared/AIOperationsFloatingChatGate";
import SettingsModal from "@/src/components/settings/SettingsModal";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardRestaurantGuard>
      <SidebarProvider>
        <div aria-hidden="true" data-shell-frame="" className="pointer-events-none fixed inset-0 -z-10 hidden lg:block" />
        <Sidebar />
        <ContentWrapper>
          <PhoneTopBar />
          {/* Phone Safari (iOS 26) colours the area behind its bottom toolbar
              from a fixed box touching that edge; without one the phone showed
              a black band there once the top bar was gone (19 ก.ย. 2569). A
              matching strip at the top drew a visible line over cards as the
              page scrolled under the status bar, so the top relies on the
              html background instead. */}
          <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 bottom-0 z-10 h-0.5 bg-slate-100 dark:bg-gray-950 lg:hidden" />
          <div data-shell-sheet="">
            <ShellScroll>
              <main className="min-w-0 max-w-full overflow-x-clip">{children}</main>
            </ShellScroll>
          </div>
        </ContentWrapper>
        <AIOperationsFloatingChatGate />
        {/* The settings window, opened from the account menu (27 ก.ย. 2569). */}
        <SettingsModal />
      </SidebarProvider>
    </DashboardRestaurantGuard>
  );
}
