import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Dumps everything the signed-in user owns as one JSON file — tasks, notes,
 * notebooks (+ their pages), pages/records, automations, settings, and which
 * Google accounts are connected (email only, never tokens). Runs through the
 * normal request-scoped RLS client, so it can only ever see this user's own
 * rows — no service-role access needed for a read-only export.
 */
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const [
    tasks,
    notes,
    notebooks,
    notebookPages,
    notebookFolders,
    pages,
    pageProperties,
    pageRecords,
    automations,
    settings,
    googleAccounts,
    focusSessions,
  ] = await Promise.all([
    supabase.from("tasks").select("*"),
    supabase.from("notes").select("*"),
    supabase.from("notebooks").select("*"),
    supabase.from("notebook_pages").select("*"),
    supabase.from("notebook_folders").select("*"),
    supabase.from("pages").select("*"),
    supabase.from("page_properties").select("*"),
    supabase.from("page_records").select("*"),
    supabase.from("automations").select("*"),
    supabase.from("user_settings").select("*").maybeSingle(),
    supabase.from("google_accounts").select("id, google_email, is_default, created_at"),
    supabase.from("focus_sessions").select("*"),
  ]);

  const exportedAt = new Date().toISOString();
  return NextResponse.json(
    {
      exportedAt,
      userId: user.id,
      email: user.email,
      tasks: tasks.data ?? [],
      notes: notes.data ?? [],
      notebooks: notebooks.data ?? [],
      notebookPages: notebookPages.data ?? [],
      notebookFolders: notebookFolders.data ?? [],
      pages: pages.data ?? [],
      pageProperties: pageProperties.data ?? [],
      pageRecords: pageRecords.data ?? [],
      automations: automations.data ?? [],
      settings: settings.data ?? null,
      connectedGoogleAccounts: googleAccounts.data ?? [],
      focusSessions: focusSessions.data ?? [],
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="cadence-export-${exportedAt.slice(0, 10)}.json"`,
      },
    }
  );
}
