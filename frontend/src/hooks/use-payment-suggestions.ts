"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { PaymentSuggestion } from "@/lib/types";

/**
 * Fetches payment folio suggestions for a given invoice via
 * rpc_get_payment_suggestions.  Matches on booking_id or invoice_number_raw.
 */
export function usePaymentSuggestions(invoiceId: string) {
  return useQuery({
    queryKey: ["payment-suggestions", invoiceId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("rpc_get_payment_suggestions", {
        p_invoice_id: invoiceId,
      });
      if (error) throw error;
      return (data ?? []) as PaymentSuggestion[];
    },
    staleTime: 30_000,
    enabled: !!invoiceId,
  });
}
