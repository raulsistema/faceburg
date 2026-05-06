'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Save, Volume2 } from 'lucide-react';
import {
  DEFAULT_ORDER_NOTIFICATION_SOUND,
  ORDER_NOTIFICATION_SOUND_OPTIONS,
  normalizeOrderNotificationSound,
  type OrderNotificationSound,
  scheduleOrderNotificationSound,
} from '@/lib/order-notification-sounds';
import { cn } from '@/lib/utils';

type OrderSoundSettingsData = {
  orderNotificationSound: string;
};

export default function OrderSoundSettings({
  initialData,
}: {
  initialData?: Partial<OrderSoundSettingsData> | null;
}) {
  const [selectedSound, setSelectedSound] = useState<OrderNotificationSound>(() =>
    normalizeOrderNotificationSound(initialData?.orderNotificationSound || DEFAULT_ORDER_NOTIFICATION_SOUND),
  );
  const [savedSound, setSavedSound] = useState<OrderNotificationSound>(() =>
    normalizeOrderNotificationSound(initialData?.orderNotificationSound || DEFAULT_ORDER_NOTIFICATION_SOUND),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!initialData) return;
    const normalized = normalizeOrderNotificationSound(initialData.orderNotificationSound);
    setSelectedSound(normalized);
    setSavedSound(normalized);
  }, [initialData]);

  function getAudioContext() {
    if (typeof window === 'undefined') return null;
    if (!audioContextRef.current) {
      const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      audioContextRef.current = new Ctx();
    }
    return audioContextRef.current;
  }

  async function previewSound(sound = selectedSound) {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }
    scheduleOrderNotificationSound(ctx, sound);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/cardapio/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderNotificationSound: selectedSound }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        orderNotificationSound?: string;
      };
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar som do pedido.');
        return;
      }
      const normalized = normalizeOrderNotificationSound(data.orderNotificationSound || selectedSound);
      setSavedSound(normalized);
      setSelectedSound(normalized);
      setMessage('Som de novo pedido atualizado.');
    } catch {
      setError('Falha ao salvar som do pedido.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="text-sm uppercase tracking-widest text-slate-500 font-bold">Som de Novo Pedido</h3>
          <p className="mt-1 text-sm text-slate-500">Toque usado quando um pedido novo chega em /pedidos.</p>
        </div>
        <button
          type="button"
          onClick={() => void previewSound()}
          className="btn-secondary inline-flex w-fit items-center gap-2"
        >
          <Volume2 className="h-4 w-4" />
          Testar som
        </button>
      </div>

      <form onSubmit={onSubmit} className="mt-4 space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {ORDER_NOTIFICATION_SOUND_OPTIONS.map((option) => {
            const checked = selectedSound === option.id;
            const saved = savedSound === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  setSelectedSound(option.id);
                  setMessage('');
                  setError('');
                }}
                onDoubleClick={() => void previewSound(option.id)}
                className={cn(
                  'rounded-xl border p-4 text-left transition',
                  checked
                    ? 'border-rose-300 bg-rose-50 ring-2 ring-rose-100'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-slate-900">{option.label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{option.description}</p>
                  </div>
                  {saved ? <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" /> : null}
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={saving || selectedSound === savedSound} className="btn-primary gap-2 disabled:opacity-60">
            <Save className="h-4 w-4" />
            {saving ? 'Salvando...' : 'Salvar som'}
          </button>
          {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>
      </form>
    </div>
  );
}
