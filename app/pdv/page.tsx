'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';
import { Search, Plus, Minus, Trash2, CreditCard, Banknote, QrCode, ShoppingCart, Ticket } from 'lucide-react';
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

type PaymentMethod = 'cash' | 'card' | 'pix';
type PaymentMethodOption = {
  id: string;
  name: string;
  methodType: PaymentMethod;
  active: boolean;
};

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

function maskPhone(raw: string) {
  const numbers = raw.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

export default function PDVPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('pix');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [paymentMethodOptions, setPaymentMethodOptions] = useState<PaymentMethodOption[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([]);
  const [customersLoading, setCustomersLoading] = useState(false);
  const [showCustomerOptions, setShowCustomerOptions] = useState(false);
  const [loading, setLoading] = useState(true);
  const [finalizing, setFinalizing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountInput, setDiscountInput] = useState('0');
  const [appliedDiscount, setAppliedDiscount] = useState(0);
  const [quickModalOpen, setQuickModalOpen] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickForm, setQuickForm] = useState<QuickCustomerForm>({
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
  });
  const customerBoxRef = useRef<HTMLDivElement | null>(null);

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
      if (!response.ok) return;
      const methods = Array.isArray(data.paymentMethods) ? data.paymentMethods : [];
      const parsed = methods
        .filter((item: { active?: boolean }) => item.active !== false)
        .map((item: { id: string; name: string; methodType: PaymentMethod; active: boolean }) => ({
          id: item.id,
          name: item.name,
          methodType: item.methodType,
          active: item.active,
        })) as PaymentMethodOption[];
      setPaymentMethodOptions(parsed);
      if (parsed.length > 0) {
        setPaymentMethod(parsed[0].methodType);
        setPaymentMethodId(parsed[0].id);
      }
    } catch {
      // Mantem fallback fixo quando API nao responder
    }
  }

  useEffect(() => {
    void loadProducts();
    void loadPaymentMethods();
  }, []);

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
      if (!customerBoxRef.current) return;
      if (!customerBoxRef.current.contains(event.target as Node)) {
        setShowCustomerOptions(false);
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

  const addToCart = (product: Product) => {
    setCart((prev) => {
      const existing = prev.find((item) => item.id === product.id);
      if (existing) {
        return prev.map((item) => (item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.id !== id) return item;
          return { ...item, quantity: Math.max(0, item.quantity + delta) };
        })
        .filter((item) => item.quantity > 0),
    );
  };

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const total = Math.max(0, subtotal - appliedDiscount);

  useEffect(() => {
    if (subtotal <= 0) {
      setAppliedDiscount(0);
      return;
    }
    if (appliedDiscount > subtotal) {
      setAppliedDiscount(subtotal);
    }
  }, [subtotal, appliedDiscount]);

  function applyDiscount() {
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
  }

  async function finalizeSale() {
    if (!cart.length || finalizing) return;
    setFinalizing(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/pdv/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customerName,
          paymentMethod,
          paymentMethodId: paymentMethodId || undefined,
          discountAmount: appliedDiscount,
          type: 'pickup',
          items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao finalizar venda.');
        return;
      }

      setCart([]);
      setCustomerName('');
      setAppliedDiscount(0);
      setDiscountInput('0');
      setMessage(`Venda concluida. Pedido ${data.orderId?.slice(0, 8) || ''} - Total R$ ${Number(data.total).toFixed(2)}`);
    } catch {
      setError('Falha ao finalizar venda.');
    } finally {
      setFinalizing(false);
    }
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

      setCustomerName(String(customerData.customer.name || ''));
      setShowCustomerOptions(false);
      setQuickModalOpen(false);
      setQuickForm({
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
      });
    } catch {
      setQuickError('Falha ao cadastrar cliente.');
    } finally {
      setQuickSaving(false);
    }
  }

  return (
    <DashboardShell>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 h-[calc(100vh-180px)] overflow-hidden">
        <div className="lg:col-span-8 flex flex-col gap-6 min-h-0 overflow-hidden">
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
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 overflow-y-auto pr-2 flex-1 min-h-0">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => addToCart(product)}
                  className="bg-white border border-slate-200 p-4 rounded-2xl shadow-sm text-left hover:border-brand-primary hover:shadow-md transition-all group"
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

        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl shadow-lg flex flex-col overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-brand-primary" />
              <h3 className="font-bold text-slate-900 uppercase tracking-wider text-xs">Itens do Pedido ({cart.length})</h3>
            </div>
            <button onClick={() => setCart([])} className="text-slate-400 hover:text-red-500 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
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
                <p className="text-sm border-t border-slate-100 pt-4 font-bold uppercase tracking-widest text-center leading-tight">O carrinho esta vazio</p>
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
                  className="font-medium text-green-600 hover:underline"
                >
                  - R$ {appliedDiscount.toFixed(2)}
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
                    setQuickModalOpen(true);
                    setQuickForm((prev) => ({ ...prev, name: customerName || prev.name }));
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
                          setShowCustomerOptions(false);
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

            <div className="grid grid-cols-3 gap-2">
              {(paymentMethodOptions.length > 0
                ? paymentMethodOptions
                : [
                    { id: 'fallback-cash', name: 'DINHEIRO', methodType: 'cash' as const, active: true },
                    { id: 'fallback-card', name: 'CARTAO', methodType: 'card' as const, active: true },
                    { id: 'fallback-pix', name: 'PIX', methodType: 'pix' as const, active: true },
                  ]
              ).map((method) => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(method.methodType);
                    setPaymentMethodId(method.id.startsWith('fallback-') ? '' : method.id);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all',
                    paymentMethod === method.methodType && (paymentMethodId === method.id || paymentMethodOptions.length === 0)
                      ? 'border-brand-primary bg-brand-primary/5 text-brand-primary shadow-sm ring-1 ring-brand-primary/20'
                      : 'border-slate-200 text-slate-600 hover:border-brand-primary hover:bg-brand-primary/5 hover:text-brand-primary',
                  )}
                >
                  {method.methodType === 'cash' ? <Banknote className="w-5 h-5" /> : null}
                  {method.methodType === 'card' ? <CreditCard className="w-5 h-5" /> : null}
                  {method.methodType === 'pix' ? <QrCode className="w-5 h-5" /> : null}
                  <span className="text-[10px] font-bold uppercase">{method.name}</span>
                </button>
              ))}
            </div>

            {error ? <p className="text-xs text-red-500">{error}</p> : null}
            {message ? <p className="text-xs text-emerald-600">{message}</p> : null}

            <button
              disabled={cart.length === 0 || finalizing}
              onClick={finalizeSale}
              className={cn(
                'w-full py-4 rounded-2xl font-bold text-white shadow-lg transition-all active:scale-[0.98] mt-2',
                cart.length > 0 && !finalizing ? 'bg-brand-primary hover:bg-brand-primary/90' : 'bg-slate-300 cursor-not-allowed shadow-none',
              )}
            >
              {finalizing ? 'FINALIZANDO...' : 'FINALIZAR VENDA'}
            </button>
          </div>
        </div>
      </div>
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
      {quickModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" className="absolute inset-0 bg-slate-950/45" onClick={() => setQuickModalOpen(false)} />
          <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-900">Cadastro rapido de cliente</h3>
            <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nome *" value={quickForm.name} onChange={(e) => setQuickForm((p) => ({ ...p, name: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Telefone *" value={quickForm.phone} onChange={(e) => setQuickForm((p) => ({ ...p, phone: maskPhone(e.target.value) }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Apelido do endereco" value={quickForm.label} onChange={(e) => setQuickForm((p) => ({ ...p, label: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="CEP (busca automatica)" value={quickForm.zipCode} onChange={(e) => setQuickForm((p) => ({ ...p, zipCode: e.target.value.replace(/\D/g, '').slice(0, 8) }))} />
              <input className="md:col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Rua" value={quickForm.street} onChange={(e) => setQuickForm((p) => ({ ...p, street: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Numero" value={quickForm.number} onChange={(e) => setQuickForm((p) => ({ ...p, number: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Complemento" value={quickForm.complement} onChange={(e) => setQuickForm((p) => ({ ...p, complement: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Bairro" value={quickForm.neighborhood} onChange={(e) => setQuickForm((p) => ({ ...p, neighborhood: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Cidade" value={quickForm.city} onChange={(e) => setQuickForm((p) => ({ ...p, city: e.target.value }))} />
              <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="UF" value={quickForm.state} onChange={(e) => setQuickForm((p) => ({ ...p, state: e.target.value }))} />
              <input className="md:col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Referencia" value={quickForm.reference} onChange={(e) => setQuickForm((p) => ({ ...p, reference: e.target.value }))} />
            </div>
            {quickError ? <p className="mt-3 text-sm text-rose-600">{quickError}</p> : null}
            <div className="mt-4 flex gap-2">
              <button type="button" className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700" onClick={() => setQuickModalOpen(false)} disabled={quickSaving}>Cancelar</button>
              <button type="button" className="flex-1 rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" onClick={() => void saveQuickCustomer()} disabled={quickSaving}>{quickSaving ? 'Salvando...' : 'Salvar cliente'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}

