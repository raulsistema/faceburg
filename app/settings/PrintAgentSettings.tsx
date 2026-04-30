'use client';

import { useEffect, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';

type PrintConfig = {
  enabled: boolean;
  hasAgentKey: boolean;
  agentKey: string;
  printerName: string;
  lastSeenAt: string | null;
};

function buildPrintState(data?: PrintConfig | null) {
  return {
    data: data ?? null,
    enabled: Boolean(data?.enabled),
    printerName: String(data?.printerName || ''),
  };
}

export default function PrintAgentSettings({ initialData }: { initialData?: PrintConfig | null }) {
  const initialState = buildPrintState(initialData);
  const [data, setData] = useState<PrintConfig | null>(initialState.data);
  const [enabled, setEnabled] = useState(initialState.enabled);
  const [printerName, setPrinterName] = useState(initialState.printerName);
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!initialData) return;
    const nextState = buildPrintState(initialData);
    setData(nextState.data);
    setEnabled(nextState.enabled);
    setPrinterName(nextState.printerName);
    setLoading(false);
  }, [initialData]);

  async function loadConfig() {
    setLoading(true);
    setError(null);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      if (requestControllerRef.current) {
        requestControllerRef.current.abort();
      }
      const controller = new AbortController();
      requestControllerRef.current = controller;
      timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch('/api/print/config', { cache: 'no-store', signal: controller.signal });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || 'Falha ao carregar configuracao da impressora.');
        return;
      }
      setData(json as PrintConfig);
      setEnabled(Boolean(json.enabled));
      setPrinterName(String(json.printerName || ''));
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === 'AbortError') {
        setError('Tempo esgotado ao carregar impressora. Clique em atualizar.');
      } else {
        setError('Falha ao carregar configuracao da impressora.');
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialData) return undefined;
    void loadConfig();
    return () => {
      if (requestControllerRef.current) {
        requestControllerRef.current.abort();
        requestControllerRef.current = null;
      }
    };
  }, [initialData]);

  async function saveConfig(rotateKey = false) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/print/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          printerName,
          rotateKey,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || 'Falha ao salvar configuracao.');
        return;
      }
      setMessage(rotateKey ? 'Nova chave gerada com sucesso.' : 'Configuracao salva com sucesso.');
      setData((current) => ({
        enabled,
        hasAgentKey: true,
        agentKey: String(json.agentKey || current?.agentKey || ''),
        printerName: String(json.printerName || ''),
        lastSeenAt: current?.lastSeenAt || null,
      }));
    } catch {
      setError('Falha ao salvar configuracao.');
    } finally {
      setSaving(false);
    }
  }

  async function copyAgentKey() {
    if (!data?.agentKey) return;
    try {
      await navigator.clipboard.writeText(data.agentKey);
      setMessage('Chave copiada para a area de transferencia.');
    } catch {
      setError('Nao foi possivel copiar a chave.');
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm uppercase tracking-widest text-slate-500 font-bold">Impressao Automatica</h3>
          <p className="text-sm text-slate-500 mt-1">
            Configure o agente local para imprimir pedidos novos e mudancas de status sem popup.
          </p>
        </div>
        <button
          onClick={() => void loadConfig()}
          className="btn-secondary"
          type="button"
          disabled={loading}
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Ativar fila de impressao automatica
          </label>

          <input
            value={printerName}
            onChange={(event) => setPrinterName(event.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            placeholder="Nome da impressora (opcional, padrao do Windows se vazio)"
          />

          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50">
            <p className="text-xs text-slate-500 mb-1">Chave do Agente</p>
            <p className="text-xs font-mono break-all text-slate-800">{data?.agentKey || 'Nao gerada'}</p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => void saveConfig(true)} disabled={saving}>
                Gerar Nova Chave
              </button>
              <button type="button" className="btn-secondary" onClick={() => void copyAgentKey()} disabled={!data?.agentKey}>
                <Copy className="w-4 h-4" />
                Copiar
              </button>
            </div>
          </div>

          <div className="text-xs text-slate-500 space-y-1">
            <p>
              Ultimo heartbeat do agente:{' '}
              <strong className="text-slate-700">
                {data?.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString('pt-BR') : 'ainda nao conectado'}
              </strong>
            </p>
            <p>Agente de impressao controlado pelo Faceburg Hub.</p>
          </div>

          <button type="button" className="btn-primary" onClick={() => void saveConfig(false)} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Configuracao'}
          </button>
        </>
      )}
    </div>
  );
}
