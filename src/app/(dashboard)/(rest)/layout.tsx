import { AppHeader } from "@/components/app-header";

const Layout = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <AppHeader />
      {/* `SidebarInset` already renders the page <main>; this is just the
          scroll body under the sticky header. */}
      <div className="flex flex-1 flex-col bg-surface">{children}</div>
    </>
  );
};

export default Layout;
