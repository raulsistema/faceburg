'use client';

import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import LocalAgentSettings from './LocalAgentSettings';

type LocalAgentSettingsProps = ComponentProps<typeof LocalAgentSettings>;

type ConfigState = {
  print: LocalAgentSettingsProps['initialPrintData'];
  whatsapp: LocalAgentSettingsProps['initialWhatsAppData'];
};

async function readJson<T>(path: string, label: string) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) throw new Error(data.error || `Falha ao carregar ${label}.`);
    return data;
  } catch (loadError) {
    if (loadError instanceof Error && loadError.name === 'AbortError') {
      throw new Error(`Tempo esgotado ao carregar ${label}.`);
    }
    throw loadError;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export default function LazyLocalAgentSettings({ tenantId, tenantSlug }: Pick<LocalAgentSettingsProps, 'tenantId' | 'tenantSlug'>) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadWarning, setLoadWarning] = useState('');
  const [configs, setConfigs] = useState<ConfigState | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || configs || error) return;

    let active = true;
    async function loadConfigs() {
      setLoading(true);
      setError('');
      setLoadWarning('');
      try {
        const [printResult, whatsappResult] = await Promise.allSettled([
          readJson<NonNullable<LocalAgentSettingsProps['initialPrintData']>>('/api/print/config', 'configuracao da impressora'),
          readJson<NonNullable<LocalAgentSettingsProps['initialWhatsAppData']>>('/api/whatsapp/config', 'configuracao do WhatsApp'),
        ]);
        if (!active) return;

        const print = printResult.status === 'fulfilled' ? printResult.value : null;
        const whatsapp = whatsappResult.status === 'fulfilled' ? whatsappResult.value : null;
        const failures = [
          printResult.status === 'rejected' ? 'impressora' : '',
          whatsappResult.status === 'rejected' ? 'WhatsApp' : '',
        ].filter(Boolean);

        setConfigs({ print, whatsapp });
        if (failures.length) {
          setLoadWarning(`Abri o agente, mas nao consegui carregar ${failures.join(' e ')} agora. Ao salvar, o sistema tenta sincronizar de novo.`);
        }
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Falha ao carregar automacao local.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadConfigs();
    return () => {
      active = false;
    };
  }, [configs, error, open, reloadKey]);

  if (open && configs) {
    return (
      <div className="space-y-3">
        {loadWarning ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            {loadWarning}
          </div>
        ) : null}
        <LocalAgentSettings
          tenantId={tenantId}
          tenantSlug={tenantSlug}
          initialPrintData={configs.print}
          initialWhatsAppData={configs.whatsapp}
        />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Agente local</h3>
          <p className="mt-2 text-sm text-slate-500">
            Impressao, WhatsApp e sincronizacao com o aplicativo instalado neste computador.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError('');
            setLoadWarning('');
            setOpen(true);
            if (open) setReloadKey((current) => current + 1);
          }}
          className="btn-primary min-w-36"
          disabled={loading}
        >
          {loading ? 'Carregando...' : error ? 'Tentar novamente' : 'Abrir agente'}
        </button>
      </div>
      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
    </div>
  );
}
