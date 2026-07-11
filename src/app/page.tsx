import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const ALLOWED = ["/app", "/app/agenda", "/app/notes", "/app/accounts"];

export default async function Home() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("user_settings")
    .select("home_page")
    .eq("user_id", user.id)
    .maybeSingle();

  const home = data?.home_page && ALLOWED.includes(data.home_page) ? data.home_page : "/app";
  redirect(home);
}
