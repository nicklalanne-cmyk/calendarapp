import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/google/session";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const { subscription } = (await request.json()) as {
    subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  };
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: "no subscription" }, { status: 400 });
  }

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
    { onConflict: "endpoint" }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, push_enabled: true, updated_at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "not_signed_in" }, { status: 401 });

  const endpoint = request.nextUrl.searchParams.get("endpoint");
  if (endpoint) await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  await supabase
    .from("user_settings")
    .upsert({ user_id: user.id, push_enabled: false, updated_at: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
