"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { IssueCategory } from "@/lib/types";

const APPLIES_TO_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All" },
  { value: "mmt", label: "MMT" },
  { value: "yatra", label: "Yatra" },
  { value: "agoda", label: "Agoda" },
  { value: "walk_in", label: "Walk-in" },
];

interface CategoryFormState {
  id: string | null;
  code: string;
  label: string;
  applies_to: string[];
  is_active: boolean;
  sort_order: number;
}

const EMPTY_FORM: CategoryFormState = {
  id: null,
  code: "",
  label: "",
  applies_to: ["all"],
  is_active: true,
  sort_order: 10,
};

export default function IssueCategoriesPage() {
  const supabase = React.useMemo(() => createClient(), []);
  const qc = useQueryClient();
  const toast = useToast();

  const [formOpen, setFormOpen] = React.useState(false);
  const [form, setForm] = React.useState<CategoryFormState>(EMPTY_FORM);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = React.useState<IssueCategory | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const categoriesQ = useQuery({
    queryKey: ["issue-categories-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("issue_categories")
        .select("id, code, label, applies_to, is_active, sort_order")
        .order("sort_order");
      if (error) throw error;
      return (data || []) as IssueCategory[];
    },
  });

  function openCreate() {
    setForm({ ...EMPTY_FORM });
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(cat: IssueCategory) {
    setForm({
      id: cat.id,
      code: cat.code,
      label: cat.label,
      applies_to: [...cat.applies_to],
      is_active: cat.is_active,
      sort_order: cat.sort_order,
    });
    setFormError(null);
    setFormOpen(true);
  }

  function toggleAppliesTo(value: string) {
    setForm((f) => {
      const current = f.applies_to;
      if (current.includes(value)) {
        // Don't allow deselecting all options
        if (current.length === 1) return f;
        return { ...f, applies_to: current.filter((v) => v !== value) };
      }
      return { ...f, applies_to: [...current, value] };
    });
  }

  async function handleSave() {
    if (!form.label.trim()) {
      setFormError("Label is required.");
      return;
    }
    if (!form.id && !form.code.trim()) {
      setFormError("Code is required for new categories.");
      return;
    }
    if (form.applies_to.length === 0) {
      setFormError("At least one 'Applies to' option must be selected.");
      return;
    }

    setSaving(true);
    setFormError(null);

    const { error } = await supabase.rpc("rpc_upsert_issue_category", {
      p_id: form.id,
      p_code: form.code.trim().toLowerCase(),
      p_label: form.label.trim(),
      p_applies_to: form.applies_to,
      p_is_active: form.is_active,
      p_sort_order: form.sort_order,
    });

    setSaving(false);

    if (error) {
      const msg = error.message || "";
      if (msg.includes("CATEGORY_HAS_OPEN_REPORTS")) {
        setFormError(
          "Cannot modify this category — it has open reports. Resolve all open reports first."
        );
      } else if (msg.includes("INVALID_APPLIES_TO")) {
        setFormError("One or more 'Applies to' values are invalid.");
      } else if (msg.includes("Not authorized")) {
        setFormError("Only admins can manage categories.");
      } else {
        setFormError("Failed to save. Please try again.");
      }
      return;
    }

    toast.show("success", form.id ? "Category updated." : "Category created.");
    setFormOpen(false);
    qc.invalidateQueries({ queryKey: ["issue-categories-admin"] });
    qc.invalidateQueries({ queryKey: ["issue-categories"] });
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.rpc("rpc_delete_issue_category", {
      p_id: deleteTarget.id,
    });
    setDeleting(false);
    if (error) {
      const msg = error.message || "";
      if (msg.includes("CATEGORY_IN_USE")) {
        toast.show(
          "error",
          "Cannot delete this category — it is referenced by existing reports."
        );
      } else if (msg.includes("Not authorized")) {
        toast.show("error", "Only admins can delete categories.");
      } else {
        toast.show("error", "Failed to delete. Please try again.");
      }
      setDeleteTarget(null);
      return;
    }
    toast.show("success", "Category deleted.");
    setDeleteTarget(null);
    qc.invalidateQueries({ queryKey: ["issue-categories-admin"] });
    qc.invalidateQueries({ queryKey: ["issue-categories"] });
  }

  const isEdit = !!form.id;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Issue Categories</h1>
        <Button onClick={openCreate}>Add category</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {categoriesQ.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading categories…</div>
          ) : categoriesQ.isError ? (
            <div className="p-6 text-sm text-red-700">
              Failed to load: {(categoriesQ.error as Error).message}
            </div>
          ) : (categoriesQ.data || []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No categories yet. Add one to get started.
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Label</TH>
                  <TH>Applies to</TH>
                  <TH>Sort order</TH>
                  <TH>Active</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(categoriesQ.data || []).map((cat) => (
                  <TR key={cat.id}>
                    <TD className="font-mono text-xs">{cat.code}</TD>
                    <TD>{cat.label}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {cat.applies_to.map((v) => (
                          <Badge key={v} variant="outline" className="text-xs">
                            {APPLIES_TO_OPTIONS.find((o) => o.value === v)?.label ?? v}
                          </Badge>
                        ))}
                      </div>
                    </TD>
                    <TD>{cat.sort_order}</TD>
                    <TD>
                      {cat.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="default" className="bg-slate-100 text-slate-600">Inactive</Badge>
                      )}
                    </TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => openEdit(cat)}>
                          Edit
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleteTarget(cat)}
                        >
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit dialog */}
      <Dialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={isEdit ? "Edit category" : "Add category"}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : isEdit ? "Save changes" : "Create category"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
              {formError}
            </div>
          )}

          <div>
            <Label>Code {isEdit && <span className="text-muted-foreground text-xs">(immutable)</span>}</Label>
            <Input
              value={form.code}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              placeholder="e.g. wrong_amount"
              disabled={isEdit}
              className={isEdit ? "opacity-60" : ""}
            />
          </div>

          <div>
            <Label>Label</Label>
            <Input
              value={form.label}
              onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              placeholder="e.g. Wrong amount charged"
            />
          </div>

          <div>
            <Label>Applies to</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {APPLIES_TO_OPTIONS.map((opt) => {
                const checked = form.applies_to.includes(opt.value);
                return (
                  <label
                    key={opt.value}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      checked
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={checked}
                      onChange={() => toggleAppliesTo(opt.value)}
                    />
                    {opt.label}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Sort order</Label>
              <Input
                type="number"
                value={form.sort_order}
                onChange={(e) =>
                  setForm((f) => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))
                }
                min={0}
              />
            </div>
            <div className="flex flex-col">
              <Label>Active</Label>
              <label className="mt-2 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-300"
                />
                <span className="text-sm">Category is active</span>
              </label>
            </div>
          </div>
        </div>
      </Dialog>

      {/* Delete confirm dialog */}
      <Dialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="Delete category?"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Delete <span className="font-medium text-foreground">{deleteTarget?.label}</span>? This
          cannot be undone. If any reports reference this category, the deletion will be rejected.
        </p>
      </Dialog>
    </div>
  );
}
