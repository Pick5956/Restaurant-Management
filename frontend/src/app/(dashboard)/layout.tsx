import { SidebarProvider } from "@/src/providers/SidebarProvider";
import Sidebar from "@/src/components/shared/Sidebar";
import MobileTopBar from "@/src/components/shared/MobileTopBar";
import ContentWrapper from "@/src/components/shared/ContentWrapper";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <Sidebar />
      <ContentWrapper>
        <MobileTopBar />
        <main>{children}</main>
      </ContentWrapper>
    </SidebarProvider>
  );
}
