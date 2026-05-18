import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BankStatementClient } from "./bank-statement-client";

export default async function BankStatementPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("user_id, role")
    .eq("user_id", user.id)
    .single();

  const role = (profile?.role as "admin" | "operator") || "operator";

  return <BankStatementClient currentRole={role} />;
}
