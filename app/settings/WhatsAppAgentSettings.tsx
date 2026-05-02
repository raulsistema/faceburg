'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw } from 'lucide-react';
import AppImage from '@/components/ui/AppImage';

type WhatsAppConfig = {
  enabled: boolean;
  hasAgentKey: boolean;
  agentKey: string;
  sessionStatus: string;
  qrCode: string;
  phoneNumber: string;
  lastSeenAt: string | null;
};

type WhatsAppConfigSaveResponse = {
  ok?: boolean;
  enabled?: boolean;
  requiresHubSetup?: boolean;
  message?: string;
  error?: string;
};

function sessionLabel(status: string) {
  if (status === 'ready') return 'Conectado';
  if (status === 'qr') return 'Aguardando leitura do QR';
  if (status === 'connecting') return 'Conectando';
  if (status === 'auth_failure') return 'Falha de autenticacao';
  return 'Desconectado';
}

function buildWhatsAppState(data?: WhatsAppConfig | null) {
  return {
    data: data ?? null,
    enabled: Boolean(data?.enabled),
  };
}

export default function WhatsAppAgentSettings({ initialData }: { initialData?: WhatsAppConfig | null }) {
  const initialState = buildWhatsAppState(initialData);
  const [data, setData] = useState<WhatsAppConfig | null>(initialState.data);
  const [enabled, setEnabled] = useState(initialState.enabled);
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'warning'>('success');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [isInView, setIsInView] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  const requestControllerRef = useRef<AbortController | null>(null);

  async function loadConfig(options?: { silent?: boolean }) {
    const silent = Boolean(options?.silent);
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      if (requestControllerRef.current) {
        requestControllerRef.current.abort();
      }
      const controller = new AbortController();
      requestControllerRef.current = controller;
      timeout = setTimeout(() => controller.abort(), 12000);
      const response = await fetch('/api/whatsapp/config', { cache: 'no-store', signal: controller.signal });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || 'Falha ao carregar configuracao do WhatsApp.');
        return;
      }
      if (!isMountedRef.current) return;
      setData(json as WhatsAppConfig);
      setEnabled(Boolean(json.enabled));
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === 'AbortError') {
        setError('Tempo esgotado ao carregar WhatsApp. Clique em atualizar.');
      } else {
        setError('Falha ao carregar configuracao do WhatsApp.');
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (!silent && isMountedRef.current) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    if (!initialData) return;
    const nextState = buildWhatsAppState(initialData);
    setData(nextState.data);
    setEnabled(nextState.enabled);
    setLoading(false);
  }, [initialData]);

  useEffect(() => {
    isMountedRef.current = true;
    if (!initialData) {
      void loadConfig();
    }
    return () => {
      isMountedRef.current = false;
      if (requestControllerRef.current) {
        requestControllerRef.current.abort();
        requestControllerRef.current = null;
      }
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
      }
    };
  }, [initialData]);

  useEffect(() => {
    if (!containerRef.current || typeof IntersectionObserver === 'undefined') {
      setIsInView(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(entry.isIntersecting);
      },
      { threshold: 0.2 },
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && isInView) {
        void loadConfig({ silent: true });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isInView]);

  useEffect(() => {
    if (pollingTimerRef.current) {
      clearTimeout(pollingTimerRef.current);
      pollingTimerRef.current = null;
    }

    const needsLiveRefresh =
      isInView &&
      document.visibilityState === 'visible' &&
      (data?.sessionStatus === 'connecting' || data?.sessionStatus === 'qr');

    if (!needsLiveRefresh) return;

    pollingTimerRef.current = setTimeout(() => {
      void loadConfig({ silent: true });
    }, 7000);

    return () => {
      if (pollingTimerRef.current) {
        clearTimeout(pollingTimerRef.current);
        pollingTimerRef.current = null;
      }
    };
  }, [data?.sessionStatus, data?.qrCode, data?.phoneNumber, data?.lastSeenAt, isInView]);

  useEffect(() => {
    let active = true;
    async function generateQr() {
      if (!isInView || data?.sessionStatus !== 'qr' || !data.qrCode) {
        setQrDataUrl('');
        return;
      }
      try {
        const qrModule = await import('qrcode');
        const dataUrl = await qrModule.toDataURL(data.qrCode, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 220,
        });
        if (active) {
          setQrDataUrl(dataUrl);
        }
      } catch {
        if (active) {
          setQrDataUrl('');
        }
      }
    }
    void generateQr();
    return () => {
      active = false;
    };
  }, [data?.qrCode, data?.sessionStatus, isInView]);

  async function saveConfig(rotateKey = false) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          rotateKey,
        }),
      });
      const json = (await response.json()) as WhatsAppConfigSaveResponse;
      if (!response.ok) {
        setError(json.error || 'Falha ao salvar configuracao.');
        return;
      }
      if (typeof json.enabled === 'boolean') {
        setEnabled(json.enabled);
      }
      setMessageTone(json.requiresHubSetup ? 'warning' : 'success');
      setMessage(json.message || (rotateKey ? 'Nova chave do WhatsApp gerada.' : 'Configuracao do WhatsApp salva.'));
      await loadConfig();
    } catch {
      setError('Falha ao salvar configuracao do WhatsApp.');
    } finally {
      setSaving(false);
    }
  }

  async function copyAgentKey() {
    if (!data?.agentKey) return;
    try {
      await navigator.clipboard.writeText(data.agentKey);
      setMessageTone('success');
      setMessage('Chave do WhatsApp copiada para a area de transferencia.');
    } catch {
      setError('Nao foi possivel copiar a chave.');
    }
  }

  const isConnected = useMemo(() => data?.sessionStatus === 'ready', [data?.sessionStatus]);

  return (
    <div ref={containerRef} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm uppercase tracking-widest text-slate-500 font-bold">WhatsApp Automatico</h3>
          <p className="text-sm text-slate-500 mt-1">
            Envia mensagem automatica para cliente em pedido novo e quando sair para entrega.
          </p>
        </div>
        <button onClick={() => void loadConfig()} className="btn-secondary" type="button" disabled={loading}>
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {message ? <p className={`text-sm ${messageTone === 'warning' ? 'text-amber-700' : 'text-emerald-600'}`}>{message}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : (
        <>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            Ativar envio automatico via WhatsApp
          </label>

          <div className="rounded-xl border border-slate-200 p-3 bg-slate-50 space-y-2">
            <p className="text-xs text-slate-500">Chave do Agente WhatsApp</p>
            <p className="text-xs font-mono break-all text-slate-800">{data?.agentKey || 'Nao gerada'}</p>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" onClick={() => void saveConfig(true)} disabled={saving}>
                Gerar Nova Chave
              </button>
              <button type="button" className="btn-secondary" onClick={() => void copyAgentKey()} disabled={!data?.agentKey}>
                <Copy className="w-4 h-4" />
                Copiar
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 p-3 bg-white">
            <p className="text-xs text-slate-500 mb-2">Status da Sessao</p>
            <p className={`text-sm font-semibold ${isConnected ? 'text-emerald-600' : 'text-amber-600'}`}>
              {sessionLabel(data?.sessionStatus || 'disconnected')}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Numero conectado: <strong className="text-slate-700">{data?.phoneNumber || 'nao conectado'}</strong>
            </p>
            <p className="text-xs text-slate-500">
              Ultimo heartbeat: <strong className="text-slate-700">{data?.lastSeenAt ? new Date(data.lastSeenAt).toLocaleString('pt-BR') : 'nunca'}</strong>
            </p>
          </div>

          {data?.sessionStatus === 'qr' ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-semibold text-emerald-700 mb-2">Escaneie o QR com o WhatsApp da empresa</p>
              {qrDataUrl ? <AppImage src={qrDataUrl} alt="QR Code WhatsApp" width={220} height={220} className="h-[220px] w-[220px] rounded-lg border border-emerald-200 bg-white p-2" /> : null}
            </div>
          ) : null}

          <div className="text-xs text-slate-500 space-y-1">
            <p>Agente WhatsApp controlado pelo Faceburg Hub.</p>
          </div>

          <button type="button" className="btn-primary" onClick={() => void saveConfig(false)} disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar Configuracao'}
          </button>
        </>
      )}
    </div>
  );
}
