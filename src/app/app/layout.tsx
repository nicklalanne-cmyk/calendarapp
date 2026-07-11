import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import AppShell from "@/components/AppShell";
import SettingsProvider from "@/components/SettingsProvider";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <SettingsProvider>
      <AppShell email={user.email ?? ""}>{children}</AppShell>
    </SettingsProvider>
  );
}
