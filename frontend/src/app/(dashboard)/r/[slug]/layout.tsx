import { SidebarProvider } from "@/src/providers/SidebarProvider";
import Sidebar from "@/src/components/shared/Sidebar";
import MobileNavHandle from "@/src/components/shared/MobileNavHandle";
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
          <MobileNavHandle />
          <div data-shell-sheet="">
            <div data-shell-scroll="">
              <main className="min-w-0 max-w-full overflow-x-clip">{children}</main>
            </div>
          </div>
        </ContentWrapper>
        <AIOperationsFloatingChatGate />
      </SidebarProvider>
    </DashboardRestaurantGuard>
  );
}
