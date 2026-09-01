import { AppSidebar } from "@/components/app-sidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CommandPalette } from "@/features/search/components/command-palette";

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <SidebarProvider>
      <AppSidebar />
      {/* Mounted once for the whole dashboard: the Cmd+K listener is global,
          and a per-page instance would register duplicate handlers. */}
      <CommandPalette />
      <SidebarInset className="bg-surface">{children}</SidebarInset>
    </SidebarProvider>
  );
};

export default Layout;
