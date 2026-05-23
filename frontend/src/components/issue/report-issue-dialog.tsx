"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { classifyInvoiceSource } from "@/lib/types";
import type { IssueCategory } from "@/lib/types";

interface ReportIssueDialogProps {
  invoiceId: string;
  invoiceSource: string | null;
  hasOpenReport: boolean;
  onReported: () => void;
}

export function ReportIssueDialog({
  invoiceId,
  invoiceSource,
  hasOpenReport,
  onReported,
}: ReportIssueDialogProps) {
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();

  const [open, setOpen] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [inlineError, setInlineError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Fetch active categories
  const categoriesQ = useQuery({
    queryKey: ["issue-categories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("issue_categories")
        .select("id, code, label, applies_to, is_active, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return (data || []) as IssueCategory[];
    },
  });

  // Classify invoice source bucket and filter categories
  const sourceBucket = classifyInvoiceSource(invoiceSource);
  const filteredCategories = React.useMemo(() => {
    if (!categoriesQ.data) return [];
    return categoriesQ.data.filter(
      (cat) =>
        cat.applies_to.includes("all") || cat.applies_to.includes(sourceBucket)
    );
  }, [categoriesQ.data, sourceBucket]);

  // Reset state when dialog opens
  function openDialog() {
    setSelectedCategory(filteredCategories[0]?.code ?? "");
    setNotes("");
    setInlineError(null);
    setOpen(true);
  }

  // When categories load, initialise selection
  React.useEffect(() => {
    if (open && filteredCategories.length > 0 && !selectedCategory) {
      setSelectedCategory(filteredCategories[0].code);
    }
  }, [filteredCategories, open, selectedCategory]);

  const isOther = selectedCategory === "other";
  const notesRequired = isOther && notes.trim().length === 0;
  const canSubmit = selectedCategory && !notesRequired && !busy;

  async function handleSubmit() {
    if (!canSubmit) return;
    setBusy(true);
    setInlineError(null);

    const { error } = await supabase.rpc("rpc_create_issue_report", {
      p_invoice_id: invoiceId,
      p_category: selectedCategory,
      p_notes: notes.trim() || null,
    });

    setBusy(false);

    if (error) {
      const msg = error.message || "";
      if (msg.includes("ISSUE_ALREADY_OPEN")) {
        setInlineError(
          "An open report already exists for this invoice. Please resolve or withdraw it before filing a new one."
        );
        return;
      }
      if (msg.includes("INVALID_CATEGORY_FOR_SOURCE")) {
        setInlineError(
          "This category does not apply to the booking source of this invoice."
        );
        return;
      }
      if (msg.includes("Not authorized")) {
        setInlineError("You are not authorised to report issues.");
        return;
      }
      setInlineError("Failed to submit the report. Please try again.");
      return;
    }

    toast.show("success", "Issue reported successfully.");
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["issue-report", invoiceId] });
    qc.invalidateQueries({ queryKey: ["invoices.walkin"] });
    onReported();
  }

  return (
    <>
      <div title={hasOpenReport ? "An open report already exists for this invoice" : undefined}>
        <Button
          variant="destructive"
          size="sm"
          disabled={hasOpenReport}
          onClick={openDialog}
          className="opacity-100 disabled:opacity-50"
        >
          Report an issue
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Report an issue"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSubmit}
              disabled={!canSubmit}
            >
              {busy ? "Submitting…" : "Submit report"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {inlineError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {inlineError}
            </div>
          )}

          {categoriesQ.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading categories…</p>
          ) : filteredCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No issue categories are available for this invoice type.
            </p>
          ) : (
            <>
              <div>
                <Label>Issue category</Label>
                <Select
                  value={selectedCategory}
                  onChange={(e) => {
                    setSelectedCategory(e.target.value);
                    setInlineError(null);
                  }}
                >
                  {filteredCategories.map((cat) => (
                    <option key={cat.code} value={cat.code}>
                      {cat.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label>
                  Notes{isOther ? " (required)" : " (optional)"}
                </Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Describe the issue…"
                  rows={3}
                />
                {isOther && notes.trim().length === 0 && (
                  <p className="mt-1 text-xs text-red-600">
                    Notes are required when category is &ldquo;Other&rdquo;.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </Dialog>
    </>
  );
}
