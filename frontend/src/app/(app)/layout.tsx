import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";
import { Badge } from "@/components/ui/badge";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name, role")
    .eq("user_id", user.id)
    .single();

  const role = (profile?.role as "admin" | "operator") || "operator";
  const isAdmin = role === "admin";

  const adminLinks = [
    { href: "/admin", label: "Home" },
    { href: "/invoices", label: "Invoices" },
    { href: "/bank-statement", label: "Bank Statement" },
    { href: "/payment-folio", label: "Payment Folio" },
    { href: "/admin/approvals", label: "Approvals" },
    { href: "/admin/discrepancies", label: "Discrepancies" },
    { href: "/admin/mis", label: "MIS Report" },
    { href: "/admin/manual-payments", label: "Manual Payments" },
    { href: "/reports/deductions", label: "Deductions" },
    { href: "/reports/reconciliation", label: "Reconciliation Report" },
    { href: "/audit", label: "Audit Log" },
    { href: "/admin/issues", label: "Issues" },
    { href: "/admin/settings/payment-sources", label: "Settings" },
    { href: "/admin/settings/issue-categories", label: "Issue Categories" },
  ];
  const operatorLinks = [
    { href: "/invoices", label: "Invoices" },
    { href: "/bank-statement", label: "Bank Statement" },
    { href: "/payment-folio", label: "Payment Folio" },
    { href: "/reports/deductions", label: "Deductions" },
    { href: "/audit", label: "Audit Log" },
  ];
  const links = isAdmin ? adminLinks : operatorLinks;

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-card">
        <div className="flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-3">
            <div className="font-semibold">Hotel Reconciliation</div>
            <Badge variant={isAdmin ? "info" : "outline"}>{isAdmin ? "Admin" : "Operator"}</Badge>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">{profile?.display_name || user.email}</span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <div className="flex gap-6 px-6 py-6">
        <aside className="w-52 shrink-0">
          <nav className="space-y-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className="block rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted"
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </aside>
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
