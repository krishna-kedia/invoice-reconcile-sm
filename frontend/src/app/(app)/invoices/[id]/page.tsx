import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InvoiceDetailClient } from "./detail-client";

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from("user_profiles").select("user_id, role, display_name").eq("user_id", user.id).single()
    : { data: null };

  const { data: invoice, error } = await supabase
    .from("hotel_invoice")
    .select("*")
    .eq("id", params.id)
    .single();
  if (error || !invoice) notFound();

  return (
    <InvoiceDetailClient
      invoice={invoice}
      currentUserId={profile?.user_id || null}
      currentRole={(profile?.role as "admin" | "operator") || "operator"}
    />
  );
}
