'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';
import { Search, Plus, Minus, Trash2, ShoppingCart, Ticket, X, Bike } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useZipCodeAutofill } from '@/hooks/use-zip-code-autofill';
import AppImage from '@/components/ui/AppImage';

interface Product {
  id: string;
  name: string;
  price: number;
  categoryId: string;
  imageUrl?: string | null;
  available: boolean;
}

interface Category {
  id: string;
  name: string;
}

interface CartItem extends Product {
  quantity: number;
}

type PaymentMethod = string;
type SaleMode = 'tab' | 'quick';
type PaymentMethodOption = {
  id: string;
  name: string;
  methodType: PaymentMethod;
  feePercent: number;
  feeFixed: number;
  settlementDays: number;
};

type CheckoutPaymentLine = {
  id: string;
  paymentMethodId: string;
  amount: string;
};

type OpenTab = {
  id: string;
  tableNumber: string;
  customerName: string;
  customerPhone: string;
  discountAmount: number;
  surchargeAmount: number;
  deliveryFeeAmount: number;
  subtotalAmount: number;
  totalAmount: number;
  itemsCount: number;
  openedAt: string;
  updatedAt: string;
  status: 'open' | 'closed' | 'cancelled';
};

type TabDetailResponse = {
  tab: {
    id: string;
    tableNumber: string;
    customerName: string;
    customerPhone: string;
    discountAmount: number;
    surchargeAmount: number;
    deliveryFeeAmount: number;
    subtotalAmount: number;
    totalAmount: number;
    status: 'open' | 'closed' | 'cancelled';
    items: Array<{
      id: string;
      productId: string;
      productName: string;
      imageUrl: string | null;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      notes: string;
    }>;
  };
};

type SaveTabMetaInput = {
  tableNumber?: string;
  customerName?: string;
  customerPhone?: string;
  discountAmount?: number;
  surchargeAmount?: number;
  deliveryFeeAmount?: number;
};

type AmountAdjustmentKind = 'surcharge' | 'deliveryFee';

type TabDeleteTarget = {
  id: string;
  tableNumber: string;
} | null;

const PAYMENT_OPTIONS: PaymentMethodOption[] = [
  { id: 'fixed-pix', name: 'PIX', methodType: 'pix', feePercent: 0, feeFixed: 0, settlementDays: 0 },
  { id: 'fixed-card', name: 'CARTAO', methodType: 'card', feePercent: 0, feeFixed: 0, settlementDays: 0 },
  { id: 'fixed-cash', name: 'DINHEIRO', methodType: 'cash', feePercent: 0, feeFixed: 0, settlementDays: 0 },
];

interface CustomerOption {
  id: string;
  name: string;
  phone: string;
}

type QuickCustomerForm = {
  name: string;
  phone: string;
  label: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  reference: string;
};

type QuickStreetSuggestion = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  complement: string;
};

const EMPTY_QUICK_CUSTOMER_FORM: QuickCustomerForm = {
  name: '',
  phone: '',
  label: 'Casa',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  zipCode: '',
  reference: '',
};

function maskPhone(raw: string) {
  const numbers = raw.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

function normalizeMoneyInput(raw: string) {
  const sanitized = raw.replace(',', '.').replace(/[^\d.]/g, '');
  return sanitized;
}

function makeLocalId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function PDVPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [saleMode, setSaleMode] = useState<SaleMode>('tab');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>([]);
  const [checkoutPayments, setCheckoutPayments] = useState<CheckoutPaymentLine[]>([]);
  const [selectedTabId, setSelectedTabId] = useState('');
  const [activeTableNumber, setActiveTableNumber] = useState('');
  const [newTableNumber, setNewTableNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [showCustomerOptions, setShowCustomerOptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [creatingTab, setCreatingTab] = useState(false);
  const [deletingTabId, setDeletingTabId] = useState('');
  const [tabDeleteTarget, setTabDeleteTarget] = useState<TabDeleteTarget>(null);
  const [savingTab, setSavingTab] = useState(false);
  const [closingTab, setClosingTab] = useState(false);
  const [syncingItems, setSyncingItems] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [checkoutModalOpen, setCheckoutModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountInput, setDiscountInput] = useState('0');
  const [appliedDiscount, setAppliedDiscount] = useState(0);
  const [adjustmentModalKind, setAdjustmentModalKind] = useState<AmountAdjustmentKind | null>(null);
  const [adjustmentInput, setAdjustmentInput] = useState('0');
  const [appliedSurcharge, setAppliedSurcharge] = useState(0);
  const [appliedDeliveryFee, setAppliedDeliveryFee] = useState(0);
  const [quickModalOpen, setQuickModalOpen] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickForm, setQuickForm] = useState<QuickCustomerForm>({ ...EMPTY_QUICK_CUSTOMER_FORM });
  const [quickStreetOptions, setQuickStreetOptions] = useState<QuickStreetSuggestion[]>([]);
  const [quickStreetLoading, setQuickStreetLoading] = useState(false);
  const [quickStreetMenuOpen, setQuickStreetMenuOpen] = useState(false);
  const [quickStreetScopeState, setQuickStreetScopeState] = useState('');
  const customerBoxRef = useRef<HTMLDivElement | null>(null);
  const quickStreetBoxRef = useRef<HTMLDivElement | null>(null);
  const selectedTabIdRef = useRef('');
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const syncJobsRef = useRef(0);

  useEffect(() => {
    selectedTabIdRef.current = selectedTabId;
  }, [selectedTabId]);

  useEffect(() => {
    if (!message) return;
    const timeoutId = window.setTimeout(() => {
      setMessage((currentMessage) => (currentMessage === message ? null : currentMessage));
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  const clearSelectedTab = useCallback(() => {
    setSelectedTabId('');
    setActiveTableNumber('');
    setCustomerName('');
    setCustomerPhone('');
    setAppliedDiscount(0);
    setAppliedSurcharge(0);
    setAppliedDeliveryFee(0);
    setDiscountInput('0');
    setAdjustmentInput('0');
    setAdjustmentModalKind(null);
    setCart([]);
    setCheckoutPayments([]);
    setCheckoutModalOpen(false);
    setTabDeleteTarget(null);
    setSyncingItems(false);
    syncQueueRef.current = Promise.resolve();
    syncJobsRef.current = 0;
  }, []);

  const switchSaleMode = useCallback((nextMode: SaleMode) => {
    if (nextMode === saleMode) return;
    setSaleMode(nextMode);
    setMessage(null);
    setError(null);
    setCheckoutModalOpen(false);
    setShowCustomerOptions(false);
    setCart([]);
    setCustomerName('');
    setCustomerPhone('');
    setAppliedDiscount(0);
    setAppliedSurcharge(0);
    setAppliedDeliveryFee(0);
    setDiscountInput('0');
    setAdjustmentInput('0');
    setAdjustmentModalKind(null);
    setCheckoutPayments([]);
    setSyncingItems(false);
    setTabDeleteTarget(null);
    syncQueueRef.current = Promise.resolve();
    syncJobsRef.current = 0;

    if (nextMode === 'quick') {
      setSelectedTabId('');
      setActiveTableNumber('');
    }
  }, [saleMode]);

  async function loadProducts() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/pdv/products');
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar produtos.');
        return;
      }
      setProducts(data.products || []);
      setCategories(data.categories || []);
    } catch {
      setError('Falha ao carregar produtos.');
    } finally {
      setLoading(false);
    }
  }

  async function loadPaymentMethods() {
    try {
      const response = await fetch('/api/finance/payment-methods', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        setPaymentMethods(PAYMENT_OPTIONS);
        return;
      }
      const methods = Array.isArray(data.paymentMethods)
        ? (data.paymentMethods as Array<{
            id: string;
            name: string;
            methodType: string;
            feePercent: number;
            feeFixed: number;
            settlementDays: number;
            active: boolean;
          }>)
            .filter((item) => item.active !== false)
            .map((item) => ({
              id: String(item.id),
              name: String(item.name),
              methodType: String(item.methodType || '').toLowerCase(),
              feePercent: Number(item.feePercent || 0),
              feeFixed: Number(item.feeFixed || 0),
              settlementDays: Number(item.settlementDays || 0),
            }))
        : [];
      setPaymentMethods(methods.length > 0 ? methods : PAYMENT_OPTIONS);
    } catch {
      setPaymentMethods(PAYMENT_OPTIONS);
    }
  }

  const loadOpenTabs = useCallback(async (autoSelectFirst = false) => {
    setTabsLoading(true);
    try {
      const response = await fetch('/api/pdv/tabs', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar comandas.');
        return;
      }

      const list = Array.isArray(data.tabs) ? (data.tabs as OpenTab[]) : [];
      setTabs(list);
      const currentId = selectedTabIdRef.current;
      if (currentId && !list.some((tab) => tab.id === currentId)) {
        clearSelectedTab();
      }
      if ((autoSelectFirst || !currentId) && list.length > 0) {
        const targetId = currentId && list.some((tab) => tab.id === currentId) ? currentId : list[0].id;
        if (targetId && targetId !== currentId) {
          const detailResponse = await fetch(`/api/pdv/tabs/${targetId}`, { cache: 'no-store' });
          const detailData = (await detailResponse.json()) as TabDetailResponse;
          if (detailResponse.ok) {
            const detailTab = detailData.tab;
            setSelectedTabId(detailTab.id);
            setActiveTableNumber(detailTab.tableNumber);
            setCustomerName(detailTab.customerName || '');
            setCustomerPhone(detailTab.customerPhone || '');
            setAppliedDiscount(Number(detailTab.discountAmount || 0));
            setAppliedSurcharge(Number(detailTab.surchargeAmount || 0));
            setAppliedDeliveryFee(Number(detailTab.deliveryFeeAmount || 0));
            setDiscountInput(String(Number(detailTab.discountAmount || 0).toFixed(2)));
            setCart(
              detailTab.items.map((item) => ({
                id: item.productId,
                name: item.productName,
                price: Number(item.unitPrice || 0),
                quantity: item.quantity,
                categoryId: '',
                imageUrl: item.imageUrl,
                available: true,
              })),
            );
          }
        }
      }
    } catch {
      setError('Falha ao carregar comandas.');
    } finally {
      setTabsLoading(false);
    }
  }, [clearSelectedTab]);

  useEffect(() => {
    void loadProducts();
    void loadPaymentMethods();
    // Carrega dados iniciais uma vez ao abrir a tela.
  }, []);

  useEffect(() => {
    if (saleMode === 'tab') {
      void loadOpenTabs(true);
    }
  }, [saleMode, loadOpenTabs]);

  const applyQuickZipLookup = useCallback((fields: { street?: string; neighborhood?: string; city?: string; state?: string; complement?: string }) => {
    setQuickForm((prev) => ({
      ...prev,
      street: prev.street || String(fields.street || ''),
      neighborhood: prev.neighborhood || String(fields.neighborhood || ''),
      city: prev.city || String(fields.city || ''),
      state: prev.state || String(fields.state || ''),
      complement: prev.complement || String(fields.complement || ''),
    }));
  }, []);

  useZipCodeAutofill({
    zipCode: quickForm.zipCode,
    enabled: quickModalOpen,
    apply: applyQuickZipLookup,
  });

  useEffect(() => {
    if (!quickModalOpen) {
      setQuickStreetOptions([]);
      setQuickStreetLoading(false);
      setQuickStreetScopeState('');
      return;
    }

    const streetQuery = quickForm.street.trim();
    const cityQuery = quickForm.city.trim();
    const stateQuery = quickForm.state.trim().toUpperCase();

    if (streetQuery.length < 2) {
      setQuickStreetOptions([]);
      setQuickStreetLoading(false);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setQuickStreetLoading(true);
      try {
        const params = new URLSearchParams({ street: streetQuery });
        if (cityQuery) params.set('city', cityQuery);
        if (stateQuery) params.set('state', stateQuery);
        const response = await fetch(`/api/lookup/address?${params.toString()}`, { cache: 'no-store' });
        const data = (await response.json()) as { suggestions?: QuickStreetSuggestion[]; effectiveState?: string };
        if (!response.ok || !active) return;
        setQuickStreetScopeState(String(data.effectiveState || '').toUpperCase());
        setQuickStreetOptions(Array.isArray(data.suggestions) ? data.suggestions.slice(0, 8) : []);
      } catch {
        if (!active) return;
        setQuickStreetScopeState('');
        setQuickStreetOptions([]);
      } finally {
        if (active) setQuickStreetLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [quickForm.city, quickForm.state, quickForm.street, quickModalOpen]);

  useEffect(() => {
    const query = customerName.trim();
    const digitsOnly = query.replace(/\D/g, '');
    const lookupTerm = digitsOnly.length >= 2 ? digitsOnly : query;
    if (lookupTerm.length < 2) {
      setCustomerOptions([]);
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setCustomersLoading(true);
      try {
        const response = await fetch(`/api/customers?search=${encodeURIComponent(lookupTerm)}`, { cache: 'no-store' });
        const data = await response.json();
        if (!response.ok || !active) return;
        const options = Array.isArray(data.customers)
          ? (data.customers as Array<{ id: string; name: string; phone: string }>).slice(0, 8)
          : [];
        setCustomerOptions(options.map((item) => ({ id: item.id, name: item.name, phone: item.phone })));
      } finally {
        if (active) setCustomersLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [customerName]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (customerBoxRef.current && !customerBoxRef.current.contains(event.target as Node)) {
        setShowCustomerOptions(false);
      }
      if (quickStreetBoxRef.current && !quickStreetBoxRef.current.contains(event.target as Node)) {
        setQuickStreetMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const categoryOptions = useMemo(() => [{ id: 'all', name: 'Todos' }, ...categories], [categories]);

  const filteredProducts = products.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = activeCategory === 'all' || product.categoryId === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const selectedTab = useMemo(() => tabs.find((tab) => tab.id === selectedTabId) || null, [tabs, selectedTabId]);

  async function selectTab(tabId: string) {
    if (!tabId) return;
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/pdv/tabs/${tabId}`, { cache: 'no-store' });
      const data = (await response.json()) as TabDetailResponse;
      if (!response.ok || !data.tab) {
        setError((data as { error?: string }).error || 'Falha ao carregar comanda.');
        return;
      }

      const detailTab = data.tab;
      syncQueueRef.current = Promise.resolve();
      syncJobsRef.current = 0;
      setSyncingItems(false);
      setSelectedTabId(detailTab.id);
      setActiveTableNumber(detailTab.tableNumber);
      setCustomerName(detailTab.customerName || '');
      setCustomerPhone(detailTab.customerPhone || '');
      setAppliedDiscount(Number(detailTab.discountAmount || 0));
      setAppliedSurcharge(Number(detailTab.surchargeAmount || 0));
      setAppliedDeliveryFee(Number(detailTab.deliveryFeeAmount || 0));
      setDiscountInput(String(Number(detailTab.discountAmount || 0).toFixed(2)));
      setCart(
        detailTab.items.map((item) => ({
          id: item.productId,
          name: item.productName,
          price: Number(item.unitPrice || 0),
          quantity: item.quantity,
          categoryId: '',
          imageUrl: item.imageUrl,
          available: true,
        })),
      );
      setCheckoutPayments([]);
      setShowCustomerOptions(false);
      setCheckoutModalOpen(false);
      setMessage(`Comanda da mesa ${detailTab.tableNumber} carregada.`);
    } catch {
      setError('Falha ao carregar comanda.');
    }
  }

  async function openTab() {
    if (creatingTab) return;
    if (!newTableNumber.trim()) {
      setError('Informe o numero/nome da mesa para abrir comanda.');
      return;
    }
    setCreatingTab(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/pdv/tabs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tableNumber: newTableNumber.trim(),
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao abrir comanda.');
        return;
      }
      const createdId = String(data?.tab?.id || '');
      setNewTableNumber('');
      await loadOpenTabs();
      if (createdId) {
        await selectTab(createdId);
      }
      setMessage(`Comanda aberta para a mesa ${data?.tab?.tableNumber || ''}.`);
    } catch {
      setError('Falha ao abrir comanda.');
    } finally {
      setCreatingTab(false);
    }
  }

  function requestDeleteTab(tab: OpenTab) {
    if (!tab.id || deletingTabId) return;
    setTabDeleteTarget({ id: tab.id, tableNumber: tab.tableNumber });
  }

  async function confirmDeleteTab() {
    const target = tabDeleteTarget;
    if (!target || deletingTabId) return;

    setDeletingTabId(target.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/pdv/tabs/${target.id}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao excluir comanda.');
        return;
      }

      if (selectedTabIdRef.current === target.id) {
        clearSelectedTab();
      }
      await loadOpenTabs(true);
      setMessage(`Comanda ${target.tableNumber} excluida.`);
      setTabDeleteTarget(null);
    } catch {
      setError('Falha ao excluir comanda.');
    } finally {
      setDeletingTabId('');
    }
  }

  const saveTabMeta = useCallback(async (input: SaveTabMetaInput = {}, showSuccessMessage = false) => {
    if (!selectedTabIdRef.current) return false;
    const tabId = selectedTabIdRef.current;
    const payload = {
      tableNumber: input.tableNumber ?? activeTableNumber,
      customerName: input.customerName ?? customerName,
      customerPhone: input.customerPhone ?? customerPhone,
      discountAmount: input.discountAmount ?? appliedDiscount,
      surchargeAmount: input.surchargeAmount ?? appliedSurcharge,
      deliveryFeeAmount: input.deliveryFeeAmount ?? appliedDeliveryFee,
    };

    try {
      const response = await fetch(`/api/pdv/tabs/${tabId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao atualizar comanda.');
        return false;
      }
      const updatedTab = data.tab as {
        id: string;
        tableNumber: string;
        customerName: string;
        customerPhone: string;
        discountAmount: number;
        surchargeAmount: number;
        deliveryFeeAmount: number;
        subtotalAmount: number;
        totalAmount: number;
        status: 'open' | 'closed' | 'cancelled';
        openedAt: string;
        updatedAt: string;
      };
      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === updatedTab.id
            ? {
                ...tab,
                tableNumber: updatedTab.tableNumber,
                customerName: updatedTab.customerName || '',
                customerPhone: updatedTab.customerPhone || '',
                discountAmount: Number(updatedTab.discountAmount || 0),
                surchargeAmount: Number(updatedTab.surchargeAmount || 0),
                deliveryFeeAmount: Number(updatedTab.deliveryFeeAmount || 0),
                subtotalAmount: Number(updatedTab.subtotalAmount || 0),
                totalAmount: Number(updatedTab.totalAmount || 0),
                status: updatedTab.status,
                openedAt: updatedTab.openedAt,
                updatedAt: updatedTab.updatedAt,
              }
            : tab,
        ),
      );
      setActiveTableNumber(updatedTab.tableNumber);
      setCustomerName(updatedTab.customerName || '');
      setCustomerPhone(updatedTab.customerPhone || '');
      setAppliedDiscount(Number(updatedTab.discountAmount || 0));
      setAppliedSurcharge(Number(updatedTab.surchargeAmount || 0));
      setAppliedDeliveryFee(Number(updatedTab.deliveryFeeAmount || 0));
      setDiscountInput(String(Number(updatedTab.discountAmount || 0).toFixed(2)));
      setError(null);
      if (showSuccessMessage) {
        setMessage('Comanda salva com sucesso.');
      }
      return true;
    } catch {
      setError('Falha ao atualizar comanda.');
      return false;
    }
  }, [activeTableNumber, appliedDeliveryFee, appliedDiscount, appliedSurcharge, customerName, customerPhone]);

  const syncTabItems = useCallback(async (tabId: string, nextCart: CartItem[]) => {
    const response = await fetch(`/api/pdv/tabs/${tabId}/items`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: nextCart.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
        })),
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao salvar itens da comanda.');
      return false;
    }

    const subtotalAmount = Number(data.subtotal || 0);
    const discountAmount = Number(data.discountAmount || 0);
    const surchargeAmount = Number(data.surchargeAmount || 0);
    const deliveryFeeAmount = Number(data.deliveryFeeAmount || 0);
    const totalAmount = Number(data.total || 0);
    const itemsCount = Number(data.itemsCount || nextCart.length);
    setAppliedDiscount(discountAmount);
    setAppliedSurcharge(surchargeAmount);
    setAppliedDeliveryFee(deliveryFeeAmount);
    setDiscountInput(String(discountAmount.toFixed(2)));
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              subtotalAmount,
              discountAmount,
              surchargeAmount,
              deliveryFeeAmount,
              totalAmount,
              itemsCount,
              customerName: tab.id === selectedTabIdRef.current ? customerName : tab.customerName,
              customerPhone: tab.id === selectedTabIdRef.current ? customerPhone : tab.customerPhone,
              updatedAt: new Date().toISOString(),
            }
          : tab,
      ),
    );
    setError(null);
    return true;
  }, [customerName, customerPhone]);

  const queueSyncItems = useCallback((tabId: string, nextCart: CartItem[]) => {
    syncJobsRef.current += 1;
    setSyncingItems(true);
    syncQueueRef.current = syncQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          await syncTabItems(tabId, nextCart);
        } finally {
          syncJobsRef.current -= 1;
          if (syncJobsRef.current <= 0) {
            syncJobsRef.current = 0;
            setSyncingItems(false);
          }
        }
      });
  }, [syncTabItems]);

  const addToCart = (product: Product) => {
    if (saleMode === 'quick') {
      setCart((prev) => {
        const existing = prev.find((item) => item.id === product.id);
        if (existing) {
          return prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
        }
        return [...prev, { ...product, quantity: 1 }];
      });
      return;
    }

    const tabId = selectedTabIdRef.current;
    if (!tabId) {
      setError('Abra ou selecione uma comanda antes de adicionar itens.');
      return;
    }

    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      const next = existing
        ? prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item))
        : [...prev, { ...product, quantity: 1 }];
      queueSyncItems(tabId, next);
      return next;
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    if (saleMode === 'quick') {
      setCart((prev) =>
        prev
          .map((item) => {
            if (item.id !== id) return item;
            return { ...item, quantity: Math.max(0, item.quantity + delta) };
          })
          .filter((item) => item.quantity > 0),
      );
      return;
    }

    const tabId = selectedTabIdRef.current;
    if (!tabId) {
      setError('Abra ou selecione uma comanda antes de alterar itens.');
      return;
    }

    setCart((prev) => {
      const next = prev
        .map((item) => {
          if (item.id !== id) return item;
          return { ...item, quantity: Math.max(0, item.quantity + delta) };
        })
        .filter((item) => item.quantity > 0);
      queueSyncItems(tabId, next);
      return next;
    });
  };

  const clearCart = () => {
    if (saleMode === 'quick') {
      setCart([]);
      return;
    }

    const tabId = selectedTabIdRef.current;
    if (!tabId) return;
    setCart([]);
    queueSyncItems(tabId, []);
  };

  const formatMoneyValue = (value: number) => Number(Math.max(0, value).toFixed(2));
  const currentAmountAdjustment = adjustmentModalKind === 'surcharge' ? appliedSurcharge : appliedDeliveryFee;
  const amountAdjustmentLabel = adjustmentModalKind === 'deliveryFee' ? 'Taxa de entrega' : 'Acrescimo';

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = formatMoneyValue(subtotal - appliedDiscount + appliedSurcharge + appliedDeliveryFee);
  const activePaymentMethods = paymentMethods.length > 0 ? paymentMethods : PAYMENT_OPTIONS;
  const checkoutPaymentsTotal = checkoutPayments.reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const checkoutRemaining = Number((total - checkoutPaymentsTotal).toFixed(2));
  const checkoutValid =
    checkoutPayments.length > 0 &&
    checkoutPayments.every((line) => line.paymentMethodId && Number(line.amount || 0) > 0) &&
    Math.abs(checkoutRemaining) <= 0.01;

  function createDefaultCheckoutLines(currentTotal: number) {
    if (!(currentTotal > 0)) {
      return [] as CheckoutPaymentLine[];
    }
    const firstMethodId = activePaymentMethods[0]?.id || '';
    if (!firstMethodId) return [];
    return [
      {
        id: makeLocalId(),
        paymentMethodId: firstMethodId,
        amount: Number(currentTotal).toFixed(2),
      },
    ];
  }

  function openCheckoutDialog() {
    if (activePaymentMethods.length === 0) {
      setError('Cadastre uma forma de pagamento ativa para finalizar.');
      return;
    }
    if (!checkoutPayments.length) {
      setCheckoutPayments(createDefaultCheckoutLines(total));
    } else if (!checkoutPayments.some((line) => line.paymentMethodId)) {
      setCheckoutPayments(createDefaultCheckoutLines(total));
    } else if (Math.abs(total - checkoutPaymentsTotal) > 0.01) {
      setCheckoutPayments(createDefaultCheckoutLines(total));
    }
    setCheckoutModalOpen(true);
  }

  function addCheckoutPaymentLine() {
    const defaultMethodId = activePaymentMethods[0]?.id || '';
    setCheckoutPayments((prev) => [
      ...prev,
      { id: makeLocalId(), paymentMethodId: defaultMethodId, amount: '0' },
    ]);
  }

  function removeCheckoutPaymentLine(id: string) {
    setCheckoutPayments((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((line) => line.id !== id);
    });
  }

  function updateCheckoutPaymentLine(id: string, patch: Partial<CheckoutPaymentLine>) {
    setCheckoutPayments((prev) =>
      prev.map((line) => {
        if (line.id !== id) return line;
        return { ...line, ...patch };
      }),
    );
  }

  useEffect(() => {
    if (subtotal <= 0) {
      if (appliedDiscount !== 0) {
        setAppliedDiscount(0);
        setDiscountInput('0');
      }
      if (appliedSurcharge !== 0) {
        setAppliedSurcharge(0);
      }
      if (appliedDeliveryFee !== 0) {
        setAppliedDeliveryFee(0);
      }
      return;
    }
    if (appliedDiscount > subtotal) {
      const nextDiscount = Number(subtotal.toFixed(2));
      setAppliedDiscount(nextDiscount);
      setDiscountInput(String(nextDiscount.toFixed(2)));
    }
  }, [subtotal, appliedDeliveryFee, appliedDiscount, appliedSurcharge]);

  async function saveCurrentTab() {
    const tabId = selectedTabIdRef.current;
    if (!tabId) {
      setError('Selecione uma comanda para salvar.');
      return;
    }
    if (savingTab) return;
    setSavingTab(true);
    setError(null);
    setMessage(null);
    try {
      await syncQueueRef.current.catch(() => undefined);
      const metaSaved = await saveTabMeta({}, false);
      const itemsSaved = await syncTabItems(tabId, cart);
      if (metaSaved && itemsSaved) {
        setMessage('Comanda salva com sucesso.');
      }
    } finally {
      setSavingTab(false);
    }
  }

  function applyDiscount() {
    if (saleMode === 'tab' && !selectedTabIdRef.current) {
      setError('Selecione uma comanda para aplicar desconto.');
      return;
    }
    const value = Number(discountInput || 0);
    if (!Number.isFinite(value) || value < 0) {
      setError('Valor de desconto invalido.');
      return;
    }
    let nextDiscount = 0;
    if (discountType === 'percent') {
      nextDiscount = subtotal * (Math.min(100, value) / 100);
    } else {
      nextDiscount = value;
    }
    nextDiscount = Number(Math.min(subtotal, Math.max(0, nextDiscount)).toFixed(2));
    setAppliedDiscount(nextDiscount);
    setDiscountModalOpen(false);
    setError(null);
    if (saleMode === 'tab') {
      void saveTabMeta({ discountAmount: nextDiscount }, false);
    }
  }

  function openAmountAdjustmentModal(kind: AmountAdjustmentKind) {
    if (saleMode === 'tab' && !selectedTabIdRef.current) {
      setError('Selecione uma comanda para ajustar valores.');
      return;
    }
    if (subtotal <= 0) {
      setError('Adicione itens antes de aplicar ajustes.');
      return;
    }
    setAdjustmentModalKind(kind);
    const currentValue = kind === 'surcharge' ? appliedSurcharge : appliedDeliveryFee;
    setAdjustmentInput(currentValue.toFixed(2));
    setError(null);
  }

  function applyAmountAdjustment() {
    if (!adjustmentModalKind) return;
    const value = Number(normalizeMoneyInput(adjustmentInput || '0') || 0);
    if (!Number.isFinite(value) || value < 0) {
      setError(`${amountAdjustmentLabel} invalido.`);
      return;
    }

    const nextValue = formatMoneyValue(value);
    if (adjustmentModalKind === 'surcharge') {
      setAppliedSurcharge(nextValue);
      if (saleMode === 'tab') {
        void saveTabMeta({ surchargeAmount: nextValue }, false);
      }
    } else {
      setAppliedDeliveryFee(nextValue);
      if (saleMode === 'tab') {
        void saveTabMeta({ deliveryFeeAmount: nextValue }, false);
      }
    }

    setAdjustmentModalKind(null);
    setAdjustmentInput('0');
    setError(null);
  }

  function buildCheckoutPaymentsPayload() {
    return checkoutPayments
      .map((line) => {
        const amount = Number(normalizeMoneyInput(line.amount || '0') || 0);
        const method = activePaymentMethods.find((item) => item.id === line.paymentMethodId);
        return {
          paymentMethodId: line.paymentMethodId,
          methodType: method?.methodType || '',
          amount: Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0,
        };
      })
      .filter((line) => line.paymentMethodId && line.amount > 0);
  }

  async function finalizeTabSale() {
    const tabId = selectedTabIdRef.current;
    if (!tabId || !cart.length || closingTab) return;
    if (!checkoutValid) {
      setError('A soma dos pagamentos precisa fechar o total da venda.');
      return;
    }
    setClosingTab(true);
    setError(null);
    setMessage(null);
    try {
      await syncQueueRef.current.catch(() => undefined);
      const metaSaved = await saveTabMeta({
        discountAmount: appliedDiscount,
        surchargeAmount: appliedSurcharge,
        deliveryFeeAmount: appliedDeliveryFee,
      }, false);
      if (!metaSaved) {
        return;
      }
      const syncSaved = await syncTabItems(tabId, cart);
      if (!syncSaved) {
        return;
      }

      const response = await fetch(`/api/pdv/tabs/${tabId}/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paymentMethod: activePaymentMethods.find((method) => method.id === checkoutPayments[0]?.paymentMethodId)?.methodType || 'pix',
          paymentMethodId: checkoutPayments[0]?.paymentMethodId || '',
          payments: buildCheckoutPaymentsPayload(),
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao fechar conta da mesa.');
        return;
      }

      const orderShort = String(data.orderId || '').slice(0, 8);
      setCheckoutModalOpen(false);
      setMessage(
        `Conta da mesa ${activeTableNumber} fechada. Pedido ${orderShort} - Total R$ ${Number(data.total || 0).toFixed(2)}`,
      );

      clearSelectedTab();
      await loadOpenTabs(true);
    } catch {
      setError('Falha ao fechar conta da mesa.');
    } finally {
      setClosingTab(false);
    }
  }

  async function finalizeQuickSale() {
    if (!cart.length || closingTab) return;
    if (!checkoutValid) {
      setError('A soma dos pagamentos precisa fechar o total da venda.');
      return;
    }
    setClosingTab(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/pdv/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerName: customerName.trim(),
          paymentMethod: activePaymentMethods.find((method) => method.id === checkoutPayments[0]?.paymentMethodId)?.methodType || 'pix',
          paymentMethodId: checkoutPayments[0]?.paymentMethodId || '',
          payments: buildCheckoutPaymentsPayload(),
          discountAmount: appliedDiscount,
          surchargeAmount: appliedSurcharge,
          deliveryFeeAmount: appliedDeliveryFee,
          type: 'pickup',
          items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao finalizar venda.');
        return;
      }

      const orderShort = String(data.orderId || '').slice(0, 8);
      setCheckoutModalOpen(false);
      setCart([]);
      setCustomerName('');
      setCustomerPhone('');
      setAppliedDiscount(0);
      setAppliedSurcharge(0);
      setAppliedDeliveryFee(0);
      setDiscountInput('0');
      setAdjustmentInput('0');
      setAdjustmentModalKind(null);
      setCheckoutPayments([]);
      setMessage(`Venda rapida concluida. Pedido ${orderShort} - Total R$ ${Number(data.total || 0).toFixed(2)}`);
    } catch {
      setError('Falha ao finalizar venda.');
    } finally {
      setClosingTab(false);
    }
  }

  async function confirmCheckout() {
    if (saleMode === 'tab') {
      await finalizeTabSale();
      return;
    }
    await finalizeQuickSale();
  }

  async function saveQuickCustomer() {
    if (quickSaving) return;
    setQuickError(null);
    if (!quickForm.name.trim() || quickForm.phone.replace(/\D/g, '').length < 10) {
      setQuickError('Informe nome e telefone valido.');
      return;
    }

    setQuickSaving(true);
    try {
      const customerResponse = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: quickForm.name.trim(),
          phone: quickForm.phone.trim(),
        }),
      });
      const customerData = await customerResponse.json();
      if (!customerResponse.ok) {
        setQuickError(customerData.error || 'Falha ao cadastrar cliente.');
        return;
      }

      const customerId = String(customerData?.customer?.id || '');
      if (!customerId) {
        setQuickError('Cadastro sem retorno de cliente.');
        return;
      }

      if (quickForm.street.trim()) {
        await fetch(`/api/customers/${customerId}/addresses`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            label: quickForm.label.trim(),
            street: quickForm.street.trim(),
            number: quickForm.number.trim(),
            complement: quickForm.complement.trim(),
            neighborhood: quickForm.neighborhood.trim(),
            city: quickForm.city.trim(),
            state: quickForm.state.trim(),
            zipCode: quickForm.zipCode.trim(),
            reference: quickForm.reference.trim(),
            isDefault: true,
          }),
        });
      }

      const nextName = String(customerData.customer.name || '');
      const nextPhone = maskPhone(String(customerData.customer.phone || quickForm.phone || ''));
      setCustomerName(nextName);
      setCustomerPhone(nextPhone);
      setShowCustomerOptions(false);
      setQuickModalOpen(false);
      setQuickStreetMenuOpen(false);
      setQuickStreetOptions([]);
      setQuickForm({ ...EMPTY_QUICK_CUSTOMER_FORM });

      if (saleMode === 'tab' && selectedTabIdRef.current) {
        void saveTabMeta({ customerName: nextName, customerPhone: nextPhone }, false);
      }
    } catch {
      setQuickError('Falha ao cadastrar cliente.');
    } finally {
      setQuickSaving(false);
    }
  }

  return (
    <DashboardShell>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:h-full lg:min-h-0">
        <div className="lg:col-span-8 flex flex-col gap-6 lg:min-h-0">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Pesquisar produto..."
              className="w-full pl-12 pr-4 py-4 bg-white border border-slate-200 rounded-2xl shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all text-sm font-medium"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {categoryOptions.map((category) => (
              <button
                key={category.id}
                onClick={() => setActiveCategory(category.id)}
                className={cn(
                  'px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all',
                  activeCategory === category.id
                    ? 'bg-brand-primary text-white border border-brand-primary'
                    : 'bg-white border border-slate-200 text-slate-600 hover:border-brand-primary hover:text-brand-primary',
                )}
              >
                {category.name}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-8 text-sm text-slate-500">Carregando produtos do banco...</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 lg:overflow-y-auto pr-2 lg:flex-1 lg:min-h-0">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  disabled={saleMode === 'tab' ? !selectedTabId : false}
                  className={cn(
                    'bg-white border border-slate-200 p-4 rounded-2xl shadow-sm text-left transition-all group',
                    saleMode === 'quick' || selectedTabId ? 'hover:border-brand-primary hover:shadow-md' : 'opacity-60 cursor-not-allowed',
                  )}
                >
                  <div className="w-full aspect-square bg-slate-100 rounded-xl mb-3 flex items-center justify-center text-slate-400 overflow-hidden relative">
                    {product.imageUrl ? (
                      <AppImage src={product.imageUrl} alt={product.name} fill sizes="(max-width: 1024px) 50vw, 25vw" className="absolute inset-0 h-full w-full object-cover" />
                    ) : (
                      <ShoppingCart className="w-8 h-8 opacity-20 group-hover:scale-110 transition-transform" />
                    )}
                    <div className="absolute top-2 right-2 p-1.5 bg-brand-primary text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                      <Plus className="w-4 h-4" />
                    </div>
                  </div>
                  <h4 className="font-bold text-slate-900 text-sm mb-1 leading-tight">{product.name}</h4>
                  <p className="text-sm font-bold text-brand-primary">R$ {product.price.toFixed(2)}</p>
                </button>
              ))}
              {filteredProducts.length === 0 ? <p className="text-sm text-slate-500">Nenhum produto disponivel.</p> : null}
            </div>
          )}
        </div>

        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl shadow-lg flex flex-col lg:h-full lg:min-h-0 overflow-visible">
          <div className="p-4 border-b border-slate-200 space-y-3 shrink-0">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => switchSaleMode('tab')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-bold uppercase',
                  saleMode === 'tab'
                    ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
                    : 'border-slate-200 text-slate-600 hover:border-brand-primary/50',
                )}
              >
                Mesa/Comanda
              </button>
              <button
                type="button"
                onClick={() => switchSaleMode('quick')}
                className={cn(
                  'rounded-lg border px-3 py-2 text-xs font-bold uppercase',
                  saleMode === 'quick'
                    ? 'border-brand-primary bg-brand-primary/5 text-brand-primary'
                    : 'border-slate-200 text-slate-600 hover:border-brand-primary/50',
                )}
              >
                Venda rapida
              </button>
            </div>

            {saleMode === 'tab' ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900 uppercase tracking-wider text-xs">Comandas abertas</h3>
                  {tabsLoading ? <span className="text-[10px] text-slate-500">Atualizando...</span> : null}
                </div>
                <div className="flex gap-2">
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Mesa/Comanda (ex: Mesa 07)"
                    value={newTableNumber}
                    onChange={(e) => setNewTableNumber(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => void openTab()}
                    disabled={creatingTab}
                    className="shrink-0 rounded-lg bg-brand-primary px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
                  >
                    {creatingTab ? 'Abrindo...' : 'Nova mesa'}
                  </button>
                </div>

                <div className="max-h-28 overflow-y-auto space-y-2 pr-1">
                  {tabs.map((tab) => (
                    <div
                      key={tab.id}
                      className={cn(
                        'relative w-full rounded-xl border transition-all',
                        selectedTabId === tab.id
                          ? 'border-brand-primary bg-brand-primary/5 shadow-sm'
                          : 'border-slate-200 hover:border-brand-primary/40',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => void selectTab(tab.id)}
                        className="w-full px-3 py-2 text-left pr-8"
                      >
                        <p className="text-xs font-bold text-slate-900">{tab.tableNumber}</p>
                        <p className="text-[11px] text-slate-600 truncate">{tab.customerName || 'Sem cliente'}</p>
                        <div className="mt-0.5 flex items-center justify-between">
                          <p className="text-[11px] font-semibold text-brand-primary">R$ {Number(tab.totalAmount || 0).toFixed(2)}</p>
                          <span className="text-[10px] font-semibold text-slate-500">{tab.itemsCount} itens</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        title={`Excluir comanda ${tab.tableNumber}`}
                        onClick={() => requestDeleteTab(tab)}
                        disabled={deletingTabId === tab.id}
                        className="absolute right-1.5 top-1.5 rounded-md p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  {!tabsLoading && tabs.length === 0 ? (
                    <p className="text-xs text-slate-500">Nenhuma comanda aberta.</p>
                  ) : null}
                </div>

                {selectedTab ? (
                  <p className="text-[11px] text-emerald-700 font-semibold">
                    Comanda ativa: {selectedTab.tableNumber}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">Abra ou selecione uma comanda para adicionar itens.</p>
                )}
              </>
            ) : null}
          </div>

          <div className="px-2.5 py-1.5 border-b border-slate-100 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-1.5">
              <ShoppingCart className="w-4 h-4 text-brand-primary" />
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-[11px]">
                {saleMode === 'tab' ? 'Itens da Comanda' : 'Itens da Venda'} ({cart.length})
              </h3>
            </div>
            <button
              onClick={clearCart}
              disabled={saleMode === 'tab' ? !selectedTabId : false}
              className="text-slate-400 hover:text-red-500 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 min-h-[96px] lg:min-h-[120px] max-h-[190px] lg:max-h-[220px] overflow-y-auto p-2.5 space-y-2.5">
            {cart.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 group">
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900 leading-tight mb-0.5">{item.name}</p>
                  <p className="text-xs text-slate-500">R$ {item.price.toFixed(2)} / un</p>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => updateQuantity(item.id, -1)} className="p-1 rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200">
                    <Minus className="w-3 h-3" />
                  </button>
                  <span className="text-sm font-bold text-slate-900 w-4 text-center">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item.id, 1)} className="p-1 rounded-md bg-slate-100 text-slate-500 hover:bg-slate-200">
                    <Plus className="w-3 h-3" />
                  </button>
                </div>
                <div className="text-right min-w-[60px]">
                  <p className="text-sm font-bold text-slate-900">R$ {(item.price * item.quantity).toFixed(2)}</p>
                </div>
              </div>
            ))}
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-30 select-none">
                <ShoppingCart className="w-12 h-12 mb-4" />
                <p className="text-sm border-t border-slate-100 pt-4 font-bold uppercase tracking-widest text-center leading-tight">
                  {saleMode === 'tab' ? (selectedTabId ? 'A comanda esta vazia' : 'Selecione uma comanda') : 'A venda esta vazia'}
                </p>
              </div>
            ) : null}
          </div>

          <div className="p-6 bg-slate-50 border-t border-slate-200 space-y-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Subtotal</span>
                <span className="font-medium text-slate-900">R$ {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1 text-slate-500">
                  <Ticket className="w-3 h-3" />
                  <span>Desconto</span>
                </div>
                <button
                  type="button"
                  onClick={() => setDiscountModalOpen(true)}
                  disabled={saleMode === 'tab' ? !selectedTabId : false}
                  className="font-medium text-green-600 hover:underline disabled:text-slate-400 disabled:no-underline"
                >
                  - R$ {appliedDiscount.toFixed(2)}
                </button>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1 text-slate-500">
                  <Plus className="w-3 h-3" />
                  <span>Acrescimo</span>
                </div>
                <button
                  type="button"
                  onClick={() => openAmountAdjustmentModal('surcharge')}
                  disabled={(saleMode === 'tab' ? !selectedTabId : false) || subtotal <= 0}
                  className="font-medium text-sky-600 hover:underline disabled:text-slate-400 disabled:no-underline"
                >
                  + R$ {appliedSurcharge.toFixed(2)}
                </button>
              </div>
              <div className="flex justify-between text-sm">
                <div className="flex items-center gap-1 text-slate-500">
                  <Bike className="w-3 h-3" />
                  <span>Taxa de entrega</span>
                </div>
                <button
                  type="button"
                  onClick={() => openAmountAdjustmentModal('deliveryFee')}
                  disabled={(saleMode === 'tab' ? !selectedTabId : false) || subtotal <= 0}
                  className="font-medium text-emerald-600 hover:underline disabled:text-slate-400 disabled:no-underline"
                >
                  + R$ {appliedDeliveryFee.toFixed(2)}
                </button>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between">
                <span className="font-bold text-slate-900">Total</span>
                <span className="font-black text-xl text-brand-primary">R$ {total.toFixed(2)}</span>
              </div>
            </div>

            <div className="relative" ref={customerBoxRef}>
              <div className="flex gap-2">
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Cliente (buscar por nome ou telefone)"
                  value={customerName}
                  onFocus={() => setShowCustomerOptions(true)}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    setShowCustomerOptions(true);
                  }}
                />
                <button
                  type="button"
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    setQuickError(null);
                    setQuickStreetMenuOpen(false);
                    setQuickStreetOptions([]);
                    setQuickModalOpen(true);
                    setQuickForm((prev) => ({ ...prev, name: customerName || prev.name, phone: customerPhone || prev.phone }));
                  }}
                >
                  Novo cliente
                </button>
              </div>
              {showCustomerOptions && (customerOptions.length > 0 || customersLoading) ? (
                <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                  {customersLoading ? (
                    <p className="px-3 py-2 text-xs text-slate-500">Buscando clientes...</p>
                  ) : (
                    customerOptions.map((customer) => (
                      <button
                        key={customer.id}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50"
                        onClick={() => {
                          setCustomerName(customer.name);
                          setCustomerPhone(maskPhone(customer.phone));
                          setShowCustomerOptions(false);
                          if (saleMode === 'tab' && selectedTabIdRef.current) {
                            void saveTabMeta({ customerName: customer.name, customerPhone: maskPhone(customer.phone) }, false);
                          }
                        }}
                      >
                        <p className="font-semibold text-slate-900">{customer.name}</p>
                        <p className="text-xs text-slate-500">{customer.phone}</p>
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            {saleMode === 'tab' && syncingItems ? <p className="text-xs text-slate-500">Sincronizando itens da comanda...</p> : null}
            {error ? <p className="text-xs text-red-500">{error}</p> : null}
            {message ? <p className="text-xs text-emerald-600">{message}</p> : null}

            {saleMode === 'tab' ? (
              <div className="grid grid-cols-2 gap-2">
                <button
                  disabled={!selectedTabId || savingTab}
                  onClick={() => void saveCurrentTab()}
                  className={cn(
                    'w-full py-2 rounded-lg text-xs font-semibold transition-all active:scale-[0.98]',
                    selectedTabId && !savingTab
                      ? 'border border-brand-primary text-brand-primary bg-white hover:bg-brand-primary/5'
                      : 'border border-slate-200 text-slate-400 cursor-not-allowed',
                  )}
                >
                  {savingTab ? 'SALVANDO...' : 'SALVAR COMANDA'}
                </button>
                <button
                  disabled={!selectedTabId || cart.length === 0 || closingTab}
                  onClick={openCheckoutDialog}
                  className={cn(
                    'w-full py-2 rounded-lg text-xs font-semibold text-white shadow-md transition-all active:scale-[0.98]',
                    selectedTabId && cart.length > 0 && !closingTab
                      ? 'bg-brand-primary hover:bg-brand-primary/90'
                      : 'bg-slate-300 cursor-not-allowed shadow-none',
                  )}
                >
                  FECHAR CONTA
                </button>
              </div>
            ) : (
              <button
                disabled={cart.length === 0 || closingTab}
                onClick={openCheckoutDialog}
                className={cn(
                  'w-full py-2 rounded-lg text-xs font-semibold text-white shadow-md transition-all active:scale-[0.98]',
                  cart.length > 0 && !closingTab
                    ? 'bg-brand-primary hover:bg-brand-primary/90'
                    : 'bg-slate-300 cursor-not-allowed shadow-none',
                )}
              >
                FINALIZAR VENDA
              </button>
            )}
          </div>
        </div>
      </div>
      {checkoutModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-950/45" onClick={() => setCheckoutModalOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {saleMode === 'tab' ? `Fechar conta - ${activeTableNumber || 'Mesa'}` : 'Finalizar venda rapida'}
              </h3>
              <button type="button" className="rounded-lg p-1.5 hover:bg-slate-100" onClick={() => setCheckoutModalOpen(false)}>
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <p className="mt-2 text-sm text-slate-600">
              Escolha a forma de pagamento para concluir a venda.
            </p>
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-sm">
              <div className="flex items-center justify-between text-slate-600">
                <span>Subtotal</span>
                <span>R$ {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Desconto</span>
                <span>- R$ {appliedDiscount.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Acrescimo</span>
                <span>+ R$ {appliedSurcharge.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-slate-600">
                <span>Taxa de entrega</span>
                <span>+ R$ {appliedDeliveryFee.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
                <span>Total a pagar</span>
                <strong className="text-brand-primary text-base">R$ {total.toFixed(2)}</strong>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {checkoutPayments.map((line, index) => (
                <div key={line.id} className="grid grid-cols-[1fr_110px_auto] gap-2 items-center">
                  <select
                    value={line.paymentMethodId}
                    onChange={(e) => updateCheckoutPaymentLine(line.id, { paymentMethodId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs"
                  >
                    {activePaymentMethods.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.amount}
                    onChange={(e) => updateCheckoutPaymentLine(line.id, { amount: normalizeMoneyInput(e.target.value) })}
                    className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs text-right"
                    placeholder="0.00"
                  />
                  <button
                    type="button"
                    onClick={() => removeCheckoutPaymentLine(line.id)}
                    disabled={checkoutPayments.length <= 1}
                    className="rounded-lg border border-slate-200 px-2 py-2 text-[10px] font-semibold text-slate-600 disabled:opacity-40"
                  >
                    {checkoutPayments.length <= 1 ? '-' : index === 0 ? 'Remover' : 'X'}
                  </button>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={addCheckoutPaymentLine}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
                >
                  + Adicionar forma
                </button>
                <p className={cn('text-xs font-semibold', Math.abs(checkoutRemaining) <= 0.01 ? 'text-emerald-600' : 'text-rose-600')}>
                  Restante: R$ {checkoutRemaining.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => setCheckoutModalOpen(false)}
                disabled={closingTab}
              >
                Voltar
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={() => void confirmCheckout()}
                disabled={closingTab || cart.length === 0 || (saleMode === 'tab' && !selectedTabId) || !checkoutValid}
              >
                {closingTab ? 'Fechando...' : 'Finalizar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {tabDeleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-950/45" onClick={() => setTabDeleteTarget(null)} />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900">Excluir comanda</h3>
            <p className="mt-2 text-sm text-slate-600">
              Tem certeza que deseja excluir a comanda <strong>{tabDeleteTarget.tableNumber}</strong>? Essa acao remove todos os itens.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => setTabDeleteTarget(null)}
                disabled={Boolean(deletingTabId)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                onClick={() => void confirmDeleteTab()}
                disabled={Boolean(deletingTabId)}
              >
                {deletingTabId ? 'Excluindo...' : 'Excluir'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {discountModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-950/45" onClick={() => setDiscountModalOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Aplicar desconto</h3>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={cn('rounded-lg border px-3 py-2 text-sm font-semibold', discountType === 'percent' ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-slate-200 text-slate-600')}
                onClick={() => setDiscountType('percent')}
              >
                Percentual (%)
              </button>
              <button
                type="button"
                className={cn('rounded-lg border px-3 py-2 text-sm font-semibold', discountType === 'amount' ? 'border-brand-primary bg-brand-primary/5 text-brand-primary' : 'border-slate-200 text-slate-600')}
                onClick={() => setDiscountType('amount')}
              >
                Valor (R$)
              </button>
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder={discountType === 'percent' ? 'Ex.: 10' : 'Ex.: 15.00'}
            />
            <p className="mt-2 text-xs text-slate-500">
              Subtotal: R$ {subtotal.toFixed(2)} - Total atual: R$ {total.toFixed(2)}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => {
                  setAppliedDiscount(0);
                  setDiscountInput('0');
                  setDiscountModalOpen(false);
                  if (saleMode === 'tab' && selectedTabIdRef.current) {
                    void saveTabMeta({ discountAmount: 0 }, false);
                  }
                }}
              >
                Limpar
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white"
                onClick={applyDiscount}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {adjustmentModalKind ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => {
              setAdjustmentModalKind(null);
              setAdjustmentInput('0');
            }}
          />
          <div className="relative z-10 w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Ajustar {amountAdjustmentLabel.toLowerCase()}</h3>
            <input
              type="number"
              min="0"
              step="0.01"
              value={adjustmentInput}
              onChange={(e) => setAdjustmentInput(normalizeMoneyInput(e.target.value))}
              className="mt-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              placeholder="Ex.: 5.00"
            />
            <p className="mt-2 text-xs text-slate-500">
              Valor atual: R$ {currentAmountAdjustment.toFixed(2)} - Total atual: R$ {total.toFixed(2)}
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => {
                  if (adjustmentModalKind === 'surcharge') {
                    setAppliedSurcharge(0);
                    if (saleMode === 'tab' && selectedTabIdRef.current) {
                      void saveTabMeta({ surchargeAmount: 0 }, false);
                    }
                  } else {
                    setAppliedDeliveryFee(0);
                    if (saleMode === 'tab' && selectedTabIdRef.current) {
                      void saveTabMeta({ deliveryFeeAmount: 0 }, false);
                    }
                  }
                  setAdjustmentInput('0');
                  setAdjustmentModalKind(null);
                }}
              >
                Limpar
              </button>
              <button
                type="button"
                className="flex-1 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white"
                onClick={applyAmountAdjustment}
              >
                Aplicar
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {quickModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/45"
            onClick={() => {
              setQuickStreetMenuOpen(false);
              setQuickStreetOptions([]);
              setQuickModalOpen(false);
            }}
          />
          <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Cadastro rapido de cliente</h3>
            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nome *" value={quickForm.name} onChange={(e) => setQuickForm((p) => ({ ...p, name: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Telefone *" value={quickForm.phone} onChange={(e) => setQuickForm((p) => ({ ...p, phone: maskPhone(e.target.value) }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Apelido do endereco" value={quickForm.label} onChange={(e) => setQuickForm((p) => ({ ...p, label: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="CEP (busca automatica)" value={quickForm.zipCode} onChange={(e) => setQuickForm((p) => ({ ...p, zipCode: e.target.value.replace(/\D/g, '').slice(0, 8) }))} />
              <div className="md:col-span-2" ref={quickStreetBoxRef}>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Rua"
                  value={quickForm.street}
                  autoComplete="off"
                  onFocus={() => setQuickStreetMenuOpen(true)}
                  onChange={(e) => {
                    setQuickStreetMenuOpen(true);
                    setQuickForm((p) => ({ ...p, street: e.target.value }));
                  }}
                />
                {quickStreetMenuOpen && (quickStreetOptions.length > 0 || quickStreetLoading || quickForm.street.trim().length >= 2) ? (
                  <div className="relative">
                    <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {quickStreetLoading ? (
                        <p className="px-3 py-2 text-xs text-slate-500">Buscando ruas...</p>
                      ) : quickStreetOptions.length > 0 ? (
                        quickStreetOptions.map((option, index) => (
                          <button
                            key={`${option.zipCode}-${option.street}-${index}`}
                            type="button"
                            className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                            onClick={() => {
                              setQuickStreetMenuOpen(false);
                              setQuickStreetOptions([]);
                              setQuickForm((prev) => ({
                                ...prev,
                                street: option.street || prev.street,
                                neighborhood: option.neighborhood || prev.neighborhood,
                                city: option.city || prev.city,
                                state: option.state || quickStreetScopeState || prev.state,
                                zipCode: option.zipCode || prev.zipCode,
                                complement: prev.complement || option.complement,
                              }));
                            }}
                          >
                            <div className="text-sm font-medium text-slate-800">{option.street}</div>
                            <div className="text-xs text-slate-500">
                              {[option.neighborhood, option.city, option.state, option.zipCode].filter(Boolean).join(' | ')}
                            </div>
                          </button>
                        ))
                      ) : (
                        <p className="px-3 py-2 text-xs text-slate-500">Nenhuma rua encontrada ainda. Continue digitando ou informe cidade/UF para ampliar a busca.</p>
                      )}
                    </div>
                  </div>
                ) : null}
                <p className="mt-1 text-[11px] text-slate-500">
                  {quickForm.street.trim().length < 2
                    ? 'Digite pelo menos 2 letras da rua para abrir as sugestoes.'
                    : quickStreetScopeState
                      ? `As ruas aparecem enquanto voce digita. Busca filtrada pela UF do emitente (${quickStreetScopeState}).`
                      : 'As ruas aparecem enquanto voce digita. Se a UF do emitente estiver configurada, a busca usa ela automaticamente.'}
                </p>
              </div>
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Numero" value={quickForm.number} onChange={(e) => setQuickForm((p) => ({ ...p, number: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Complemento" value={quickForm.complement} onChange={(e) => setQuickForm((p) => ({ ...p, complement: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Bairro" value={quickForm.neighborhood} onChange={(e) => setQuickForm((p) => ({ ...p, neighborhood: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Cidade" value={quickForm.city} onChange={(e) => setQuickForm((p) => ({ ...p, city: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm uppercase" placeholder="UF" value={quickForm.state} onChange={(e) => setQuickForm((p) => ({ ...p, state: e.target.value.toUpperCase().slice(0, 2) }))} />
              <input className="md:col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Referencia" value={quickForm.reference} onChange={(e) => setQuickForm((p) => ({ ...p, reference: e.target.value }))} />
            </div>
            {quickError ? <p className="mt-3 text-sm text-rose-600">{quickError}</p> : null}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
                onClick={() => {
                  setQuickStreetMenuOpen(false);
                  setQuickStreetOptions([]);
                  setQuickModalOpen(false);
                }}
                disabled={quickSaving}
              >
                Cancelar
              </button>
              <button type="button" className="flex-1 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void saveQuickCustomer()} disabled={quickSaving}>{quickSaving ? 'Salvando...' : 'Salvar cliente'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}

