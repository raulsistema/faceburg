'use client';

import { useEffect } from 'react';

type ZipCodeAutofillFields = {
  street?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  complement?: string;
};

type ZipCodeAutofillOptions = {
  zipCode: string;
  enabled?: boolean;
  delayMs?: number;
  apply: (fields: ZipCodeAutofillFields) => void;
};

export function useZipCodeAutofill({
  zipCode,
  enabled = true,
  delayMs = 250,
  apply,
}: ZipCodeAutofillOptions) {
  useEffect(() => {
    if (!enabled) return;

    const digits = zipCode.replace(/\D/g, '');
    if (digits.length !== 8) return;

    let active = true;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/lookup/cep/${digits}`, { cache: 'no-store' });
        const data = (await response.json()) as ZipCodeAutofillFields & { error?: string };
        if (!response.ok || !active) return;
        apply({
          street: data.street,
          neighborhood: data.neighborhood,
          city: data.city,
          state: data.state,
          complement: data.complement,
        });
      } catch {
        // Keep manual entry available when lookup fails.
      }
    }, delayMs);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [apply, delayMs, enabled, zipCode]);
}
