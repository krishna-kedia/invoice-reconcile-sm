import * as React from "react";
import { cn } from "@/lib/utils";
import type { ReconciliationStatus } from "@/lib/types";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "outline" | "destructive" | "success" | "warning" | "info";
}

const variants: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "bg-secondary text-secondary-foreground",
  outline: "border border-border text-foreground",
  destructive: "bg-red-100 text-red-800",
  success: "bg-green-100 text-green-800",
  warning: "bg-amber-100 text-amber-900",
  info: "bg-purple-100 text-purple-800",
};

export const Badge = ({ className, variant = "default", ...props }: BadgeProps) => (
  <span
    className={cn(
      "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
      variants[variant],
      className
    )}
    {...props}
  />
);

export function StatusBadge({ status, pendingManualPayment }: { status: ReconciliationStatus | string | null | undefined; pendingManualPayment?: boolean }) {
  if (pendingManualPayment && status === "unreconciled") {
    return <Badge variant="warning">Pending approval</Badge>;
  }
  switch (status) {
    case "fully_reconciled":
      return <Badge variant="success">Fully reconciled</Badge>;
    case "partial":
      return <Badge variant="warning">Partial</Badge>;
    case "flagged_for_review":
      return <Badge variant="info">Flagged</Badge>;
    case "unreconciled":
    default:
      return <Badge variant="destructive">Unreconciled</Badge>;
  }
}
