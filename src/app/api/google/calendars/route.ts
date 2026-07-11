import { NextResponse } from "next/server";
import { requireUser, type GoogleAccountRow } from "@/lib/google/session";
import { getGoogleAccessToken } from "@/lib/google/tokens";
import { listCalendars } from "@/lib/google/calendar";

export const dynamic = "force-dynamic";

export async function GET() {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { data } = await supabase.from("google_accounts").select("*");
  const accounts = (data as GoogleAccountRow[] | null) ?? [];
  const cals: {
    id: string;
    summary: string;
    color: string | null;
    accountEmail: string;
    accountId: string;
    canWrite: boolean;
    primary: boolean;
  }[] = [];

  await Promise.all(
    accounts.map(async (acc) => {
      const token = await getGoogleAccessToken(acc.refresh_token);
      if (!token) return;
      try {
        const list = await listCalendars(token);
        for (const c of list) {
          if (c.selected === false) continue;
          cals.push({
            id: c.id,
            summary: c.summary ?? c.id,
            color: c.backgroundColor ?? null,
            accountEmail: acc.google_email,
            accountId: acc.id,
            // you can only add events to calendars you own or can write to
            canWrite:
              (c as { accessRole?: string }).accessRole === "owner" ||
              (c as { accessRole?: string }).accessRole === "writer",
            primary: Boolean((c as { primary?: boolean }).primary),
          });
        }
      } catch {
        /* skip account */
      }
    })
  );
  return NextResponse.json({ calendars: cals });
}
