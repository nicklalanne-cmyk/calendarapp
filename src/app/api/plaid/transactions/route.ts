import { NextResponse } from "next/server";
import { requireUser } from "@/lib/google/session";

function toCsv(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return "date,merchant,name,amount,category,account_id,pending\n";
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = "date,merchant,name,amount,category,account_id,pending";
  const lines = rows.map((r) =>
    [r.date, r.merchant_name, r.name, r.amount, (r.category as string[] | null)?.[0] ?? "", r.account_id, r.pending]
      .map(esc)
      .join(",")
  );
  return [header, ...lines].join("\n");
}

export async function GET(request: Request) {
  const { supabase, user } = await requireUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const accountId = searchParams.get("account_id")?.trim();
  const category = searchParams.get("category")?.trim();
  const from = searchParams.get("from")?.trim();
  const to = searchParams.get("to")?.trim();
  const format = searchParams.get("format");
  const limit = format === "csv" ? 5000 : Math.min(parseInt(searchParams.get("limit") ?? "200", 10) || 200, 500);

  let query = supabase
    .from("plaid_transactions")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .limit(limit);

  if (q) query = query.or(`name.ilike.%${q}%,merchant_name.ilike.%${q}%`);
  if (accountId) query = query.eq("account_id", accountId);
  if (category) query = query.contains("category", [category]);
  if (from) query = query.gte("date", from);
  if (to) query = query.lte("date", to);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (format === "csv") {
    return new NextResponse(toCsv(data ?? []), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="cadence-transactions-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  return NextResponse.json({ transactions: data ?? [] });
}
