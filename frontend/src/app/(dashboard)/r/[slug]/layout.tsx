import { SidebarProvider } from "@/src/providers/SidebarProvider";
import Sidebar from "@/src/components/shared/Sidebar";
import MobileTopBar from "@/src/components/shared/MobileTopBar";
import ContentWrapper from "@/src/components/shared/ContentWrapper";
import DashboardRestaurantGuard from "@/src/components/shared/DashboardRestaurantGuard";
import AIOperationsFloatingChatGate from "@/src/components/shared/AIOperationsFloatingChatGate";

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
          <MobileTopBar />
          <div data-shell-sheet="">
            <div data-shell-scroll="">
              <main className="min-w-0 max-w-full overflow-x-clip pt-14 lg:pt-0">{children}</main>
            </div>
          </div>
        </ContentWrapper>
        <AIOperationsFloatingChatGate />
      </SidebarProvider>
    </DashboardRestaurantGuard>
  );
}
