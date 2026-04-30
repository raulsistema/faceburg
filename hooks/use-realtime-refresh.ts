'use client';

import { useCallback, useEffect, useRef } from 'react';

type UseRealtimeRefreshOptions = {
  load: (showLoader: boolean) => Promise<boolean>;
  eventUrl?: string;
  eventName?: string;
  fallbackRefreshMs?: number;
  dedupeMs?: number;
  initialLoader?: boolean;
};

export function useRealtimeRefresh({
  load,
  eventUrl = '/api/orders/events',
  eventName = 'order-updated',
  fallbackRefreshMs = 300000,
  dedupeMs = 1500,
  initialLoader = true,
}: UseRealtimeRefreshOptions) {
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRefreshAtRef = useRef(0);
  const refreshFnRef = useRef<(showLoader?: boolean, force?: boolean) => void>(() => undefined);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let disposed = false;

    function clearRefreshTimer() {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
    }

    function scheduleRefresh(delayMs = fallbackRefreshMs) {
      if (disposed) return;
      clearRefreshTimer();
      if (document.hidden) return;
      refreshTimerRef.current = setTimeout(() => {
        if (disposed) return;
        void runRefresh(false, true);
      }, delayMs);
    }

    async function runRefresh(showLoader = false, force = false) {
      if (disposed) return;
      if (!force && Date.now() - lastRefreshAtRef.current < dedupeMs) return;

      try {
        const success = await load(showLoader);
        if (success) {
          lastRefreshAtRef.current = Date.now();
        }
      } finally {
        if (!disposed) {
          scheduleRefresh(fallbackRefreshMs);
        }
      }
    }

    function connectEventSource() {
      if (disposed || typeof window === 'undefined' || typeof EventSource === 'undefined') return;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      eventSource = new EventSource(eventUrl);
      eventSource.addEventListener(eventName, () => {
        void runRefresh(false, true);
      });
      eventSource.onerror = () => {
        if (disposed) return;
        scheduleRefresh(30000);
      };
    }

    refreshFnRef.current = (showLoader = false, force = true) => {
      void runRefresh(showLoader, force);
    };

    void runRefresh(initialLoader, true).finally(() => {
      if (disposed) return;
      connectEventSource();
    });

    const onFocus = () => {
      void runRefresh(false, false);
    };

    const onVisibility = () => {
      if (!document.hidden) {
        void runRefresh(false, false);
        if (!eventSource || eventSource.readyState === EventSource.CLOSED) {
          connectEventSource();
        }
      } else {
        clearRefreshTimer();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      clearRefreshTimer();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    };
  }, [dedupeMs, eventName, eventUrl, fallbackRefreshMs, initialLoader, load]);

  const refreshNow = useCallback((showLoader = false, force = true) => {
    refreshFnRef.current(showLoader, force);
  }, []);

  return { refreshNow };
}
