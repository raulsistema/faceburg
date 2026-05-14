
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bike,
  ChevronDown,
  Clock3,
  Gift,
  LogIn,
  MapPinned,
  Minus,
  PackageCheck,
  Phone,
  Plus,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  UserCircle2,
  User,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useZipCodeAutofill } from '@/hooks/use-zip-code-autofill';
import AppImage from '@/components/ui/AppImage';
import { formatBusinessDateTime } from '@/lib/business-time';
import { parseMoneyInput } from '@/lib/finance-utils';

type Tenant = {
  name: string;
  slug: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  issuerStreet: string | null;
  issuerNumber: string | null;
  issuerCity: string | null;
  issuerState: string | null;
  whatsappPhone: string | null;
  prepTimeMinutes: number;
  deliveryFeeBase: number;
  deliveryFeeMode: 'fixed' | 'per_km' | 'distance_table';
  deliveryFeePerKm: number;
  deliveryFeeTable: DeliveryFeeTier[];
  deliveryMaxDistanceKm: number;
  deliveryMinOrderAmount: number;
  storeOpen: boolean;
  primaryColor: string;
};

type DeliveryFeeTier = {
  upToMeters: number;
  fee: number;
};

type ProductOption = {
  id: string;
  name: string;
  imageUrl: string | null;
  priceAddition: number;
};

type ProductOptionGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: ProductOption[];
};

type Category = {
  id: string;
  name: string;
  icon: string | null;
};

type Product = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: string;
  image_url: string | null;
  product_type: 'prepared' | 'packaged' | 'size_based' | 'ingredient' | 'special';
  product_meta: Record<string, unknown>;
  optionGroups: ProductOptionGroup[];
  optionGroupCount?: number;
};

type SizeBasedOption = {
  label: string;
  price: number;
};

type PizzaConfig = {
  allowHalfAndHalf: boolean;
  maxFlavors: number;
  pricingStrategy: 'highest';
};

type PizzaBorder = {
  label: string;
  price: number;
};

type PizzaDough = {
  label: string;
  price: number;
};

type PizzaGiftRule = {
  sizeLabel: string;
  drinkName: string;
  quantity: number;
};

type PizzaSelection = {
  sizeLabel: string;
  flavorIds: string[];
  flavorNames: string[];
  borderLabel: string | null;
  borderPrice: number;
  doughLabel: string | null;
  doughPrice: number;
  giftDrinkId: string | null;
  giftDrinkName: string | null;
  giftQuantity: number;
};

type CartItem = {
  key: string;
  productId: string;
  name: string;
  basePrice: number;
  quantity: number;
  notes: string;
  selectedOptions: ProductOption[];
  pizzaSelection: PizzaSelection | null;
};

type CheckoutStep = 'cart' | 'customer' | 'address' | 'payment' | 'review' | 'success';
type OrderType = 'delivery' | 'pickup' | 'table';
type PaymentMethodType = 'pix' | 'card' | 'cash' | 'bank_slip' | 'wallet' | 'other';
type TopTab = 'products' | 'portal' | 'contact' | 'about';

type PaymentMethodOption = {
  id: string;
  name: string;
  methodType: PaymentMethodType;
  isSystem: boolean;
};

type SubmittedSnapshot = {
  orderId: string;
  trackingUrl: string;
  createdAtIso: string;
  customerName: string;
  customerPhone: string;
  orderType: OrderType;
  deliveryAddress: string;
  paymentMethodLabel: string;
  changeFor: number;
  subtotal: number;
  deliveryFee: number;
  total: number;
  items: Array<{ name: string; quantity: number; unitPrice: number; notes: string }>;
};

type SavedAddress = {
  id: string;
  label: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  reference: string | null;
  isDefault: boolean;
};

type AddressFormState = {
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

type AddressEntryMode = 'saved' | 'new';

type AddressStreetSuggestion = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  complement: string;
};

type DeliveryFeeQuoteResponse = {
  deliveryFeeAmount?: number;
  distanceKm?: number | null;
  distanceMeters?: number | null;
  deliveryFeeMode?: 'fixed' | 'per_km' | 'distance_table';
  deliveryFeePerKm?: number;
  deliveryMaxDistanceMeters?: number;
  matchedTier?: DeliveryFeeTier | null;
  usedFallback?: boolean;
  isDeliveryAvailable?: boolean;
  deliveryUnavailableReason?: string | null;
  error?: string;
};

type PortalCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
};

type PortalOrder = {
  id: string;
  deliveryAddress: string;
  total: number;
  status: 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';
  type: 'delivery' | 'pickup' | 'table';
  paymentMethod: string;
  createdAt: string;
  itemsSummary: string;
};

type CustomerLookupResponse = {
  found?: boolean;
  customer?: {
    id?: string;
    name?: string;
    phone?: string;
    email?: string | null;
    isCompany?: boolean;
    companyName?: string | null;
    documentNumber?: string | null;
  } | null;
  addresses?: SavedAddress[];
  orders?: PortalOrder[];
  error?: string;
};

type CustomerLookupCacheEntry = {
  tenantSlug: string;
  phone: string;
  includeOrders: boolean;
  loadedAt: number;
  data: CustomerLookupResponse | null;
};

type DeliveryFeeQuoteCacheEntry = {
  loadedAt: number;
  quote: DeliveryFeeQuoteResponse;
};

type MenuStory = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  displayOrder: number;
  expiresAt: string | null;
};

type PublicMenuData = {
  tenant?: Tenant | null;
  stories?: MenuStory[];
  categories?: Category[];
  products?: Product[];
  productPage?: PublicMenuProductPage;
  paymentMethods?: Array<Record<string, unknown>>;
  error?: string;
};

type PublicMenuProductPage = {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  search: string;
  categoryId: string;
};

type PublicMenuProductsResponse = {
  products?: Product[];
  productPage?: PublicMenuProductPage;
  error?: string;
};

type PublicMenuClientProps = {
  tenantSlug: string;
  initialData?: PublicMenuData | null;
};

const checkoutSteps: CheckoutStep[] = ['cart', 'customer', 'address', 'payment', 'review'];

const EMPTY_ADDRESS_FORM: AddressFormState = {
  label: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  zipCode: '',
  reference: '',
};

const CUSTOMER_LOOKUP_CACHE_MS = 30_000;
const DELIVERY_FEE_QUOTE_CACHE_MS = 5 * 60_000;
const NETWORK_TIMEOUT_MS = 8_000;
const CHECKOUT_TIMEOUT_MS = 20_000;
const NETWORK_RETRY_DELAY_MS = 450;
const PRODUCT_PAGE_SIZE = 30;
const BRAND_NAME = 'RBS Gestor';

type RequestJsonOptions = RequestInit & {
  timeoutMs?: number;
  retries?: number;
};

function hasManualAddressDraft(form: AddressFormState) {
  return Object.values(form).some((value) => String(value || '').trim().length > 0);
}

function isAddressReadyForDeliveryQuote(address: {
  street?: string | null;
  number?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
}) {
  const street = String(address.street || '').trim();
  const number = String(address.number || '').trim();
  const city = String(address.city || '').trim();
  const state = String(address.state || '').trim();
  const zipCodeDigits = String(address.zipCode || '').replace(/\D/g, '');
  if (!street || !number) return false;
  return zipCodeDigits.length >= 8 || (city.length >= 2 && state.length === 2);
}

function buildDeliveryFeeQuoteKey(input: {
  tenantSlug: string;
  mode: Tenant['deliveryFeeMode'];
  base: number;
  perKm: number;
  table: DeliveryFeeTier[];
  maxDistanceKm: number;
  address: Record<string, unknown> | null;
  freeform: string;
}) {
  return JSON.stringify({
    tenantSlug: input.tenantSlug,
    mode: input.mode,
    base: input.base,
    perKm: input.perKm,
    table: input.table,
    maxDistanceKm: input.maxDistanceKm,
    address: input.address,
    freeform: input.freeform.trim().toLowerCase(),
  });
}

function brl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatDistanceMeters(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
  }
  return `${value} m`;
}

function formatPaymentMethodLabel(value: string) {
  const method = String(value || '').trim();
  if (!method) return 'Nao informado';
  const normalized = method.toLowerCase();
  if (normalized === 'pix') return 'Pix';
  if (normalized === 'card') return 'Cartao';
  if (normalized === 'cash') return 'Dinheiro';
  if (normalized === 'bank_slip') return 'Boleto';
  if (normalized === 'wallet') return 'Carteira digital';
  if (normalized === 'other') return 'Outro';
  return method;
}

function normalizePaymentMethodType(value: string): PaymentMethodType {
  const normalized = String(value || '').trim().toLowerCase();
  if (['pix', 'card', 'cash', 'bank_slip', 'wallet', 'other'].includes(normalized)) {
    return normalized as PaymentMethodType;
  }
  return 'pix';
}

function maskPhone(raw: string) {
  const numbers = raw.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

function normalizePhone(raw: string) {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  return digits.replace(/^0+/, '');
}

function createCheckoutKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatSavedAddress(address: SavedAddress) {
  const main = [address.street, address.number].filter(Boolean).join(', ');
  const area = [address.neighborhood, address.city, address.state].filter(Boolean).join(' - ');
  const extra = [address.complement, address.reference].filter(Boolean).join(' | ');
  return [main, area, extra].filter(Boolean).join(' | ');
}

function getCartKey(
  productId: string,
  selectedOptions: ProductOption[],
  notes: string,
  pizzaSelection: PizzaSelection | null,
) {
  const pizzaKey = pizzaSelection
    ? `${pizzaSelection.sizeLabel}::${pizzaSelection.flavorIds.slice().sort().join('|')}::${pizzaSelection.borderLabel || ''}::${pizzaSelection.doughLabel || ''}::${pizzaSelection.giftDrinkId || ''}`
    : 'standard';
  return `${productId}::${selectedOptions.map((option) => option.id).sort().join('|')}::${pizzaKey}::${notes
    .trim()
    .toLowerCase()}`;
}

function orderStatusLabel(status: PortalOrder['status']) {
  if (status === 'pending') return 'Recebido';
  if (status === 'processing') return 'Em preparo';
  if (status === 'delivering') return 'Saiu para entrega';
  if (status === 'completed') return 'Concluido';
  if (status === 'cancelled') return 'Cancelado';
  return status;
}

function orderStatusTone(status: PortalOrder['status']) {
  if (status === 'pending') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (status === 'processing') return 'bg-sky-50 text-sky-700 border-sky-200';
  if (status === 'delivering') return 'bg-violet-50 text-violet-700 border-violet-200';
  if (status === 'completed') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'cancelled') return 'bg-rose-50 text-rose-700 border-rose-200';
  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function orderTypeLabel(type: PortalOrder['type']) {
  if (type === 'delivery') return 'Entrega';
  if (type === 'pickup') return 'Retirada';
  if (type === 'table') return 'Consumo no local';
  return type;
}

function getSizeOptions(product: Product): SizeBasedOption[] {
  if (!Array.isArray(product.product_meta?.sizes)) return [];
  return product.product_meta.sizes
    .map((size) => {
      if (!size || typeof size !== 'object') return null;
      const record = size as Record<string, unknown>;
      const label = String(record.label || '').trim();
      const price = Number(record.price || 0);
      if (!label || !(price > 0)) return null;
      return { label, price };
    })
    .filter((size): size is SizeBasedOption => Boolean(size));
}

function getPizzaConfig(product: Product): PizzaConfig {
  if (!product.product_meta || typeof product.product_meta.pizzaConfig !== 'object' || !product.product_meta.pizzaConfig) {
    return {
      allowHalfAndHalf: false,
      maxFlavors: 1,
      pricingStrategy: 'highest',
    };
  }

  const config = product.product_meta.pizzaConfig as Record<string, unknown>;
  return {
    allowHalfAndHalf: config.allowHalfAndHalf !== false,
    maxFlavors: Math.max(1, Number(config.maxFlavors || 2)),
    pricingStrategy: 'highest',
  };
}

function getPizzaBorders(product: Product): PizzaBorder[] {
  if (!Array.isArray(product.product_meta?.borders)) return [];
  return product.product_meta.borders
    .map((border) => {
      if (!border || typeof border !== 'object') return null;
      const record = border as Record<string, unknown>;
      const label = String(record.label || '').trim();
      const price = Number(record.price || 0);
      if (!label || price < 0) return null;
      return { label, price };
    })
    .filter((border): border is PizzaBorder => Boolean(border));
}

function getPizzaDoughs(product: Product): PizzaDough[] {
  if (!Array.isArray(product.product_meta?.doughs)) return [];
  return product.product_meta.doughs
    .map((dough) => {
      if (!dough || typeof dough !== 'object') return null;
      const record = dough as Record<string, unknown>;
      const label = String(record.label || '').trim();
      const price = Number(record.price || 0);
      if (!label || price < 0) return null;
      return { label, price };
    })
    .filter((dough): dough is PizzaDough => Boolean(dough));
}

function getPizzaGiftRules(product: Product): PizzaGiftRule[] {
  if (!Array.isArray(product.product_meta?.giftRules)) return [];
  return product.product_meta.giftRules
    .map((rule) => {
      if (!rule || typeof rule !== 'object') return null;
      const record = rule as Record<string, unknown>;
      const sizeLabel = String(record.sizeLabel || '').trim();
      const drinkName = String(record.drinkName || '').trim();
      const quantity = Math.max(1, Number(record.quantity || 1));
      if (!sizeLabel || !drinkName) return null;
      return { sizeLabel, drinkName, quantity };
    })
    .filter((rule): rule is PizzaGiftRule => Boolean(rule));
}

function getProductCardPrice(product: Product) {
  if (product.product_type !== 'size_based') {
    return brl(Number(product.price));
  }
  const sizes = getSizeOptions(product);
  const minimum = sizes.length > 0 ? Math.min(...sizes.map((size) => size.price)) : Number(product.price);
  return `A partir de ${brl(minimum)}`;
}

function getFlavorModeLabel(count: number) {
  if (count <= 1) return '1 sabor';
  if (count === 2) return 'Meio a meio';
  if (count === 3) return '3 sabores';
  return `${count} sabores`;
}

function getPortalSessionKey(tenantSlug?: string) {
  return `cardapio-portal-session:${tenantSlug || 'default'}`;
}

function createEmptyPortalCustomerState() {
  return {
    portalCustomer: null as PortalCustomer | null,
    portalOrders: [] as PortalOrder[],
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    customerIsCompany: false,
    customerCompanyName: '',
    customerDocumentNumber: '',
    savedAddresses: [] as SavedAddress[],
    addressEntryMode: 'new' as AddressEntryMode,
    selectedSavedAddressId: '',
    addressForm: { ...EMPTY_ADDRESS_FORM },
    deliveryAddress: '',
    portalNameInput: '',
    portalPhoneInput: '',
  };
}

function normalizeMenuTenant(tenantData?: Tenant | null): Tenant | null {
  if (!tenantData) return null;
  return {
    ...tenantData,
    deliveryFeeMode:
      tenantData.deliveryFeeMode === 'per_km' || tenantData.deliveryFeeMode === 'distance_table'
        ? tenantData.deliveryFeeMode
        : 'fixed',
    deliveryFeeTable: Array.isArray(tenantData.deliveryFeeTable) ? tenantData.deliveryFeeTable : [],
    deliveryMaxDistanceKm: Number(tenantData.deliveryMaxDistanceKm || 0),
    deliveryMinOrderAmount: Number(tenantData.deliveryMinOrderAmount || 0),
  };
}

function normalizePublicPaymentMethods(rawPaymentMethods?: Array<Record<string, unknown>>) {
  return (Array.isArray(rawPaymentMethods) ? rawPaymentMethods : [])
    .map((method) => {
      const methodType = normalizePaymentMethodType(String(method?.methodType || 'pix'));
      return {
        id: String(method?.id || '').trim(),
        name: String(method?.name || '').trim() || formatPaymentMethodLabel(methodType),
        methodType,
        isSystem: true,
      };
    })
    .filter((method): method is PaymentMethodOption => Boolean(method.id));
}

function normalizeProductPage(page: PublicMenuProductPage | undefined, productsCount: number): PublicMenuProductPage {
  const total = Math.max(productsCount, Number(page?.total || productsCount));
  const offset = Math.max(0, Number(page?.offset || 0));
  const limit = Math.max(1, Number(page?.limit || PRODUCT_PAGE_SIZE));
  return {
    offset,
    limit,
    total,
    hasMore: Boolean(page?.hasMore) && productsCount < total,
    search: String(page?.search || ''),
    categoryId: String(page?.categoryId || ''),
  };
}

function normalizePublicMenuData(data?: PublicMenuData | null) {
  const products = Array.isArray(data?.products) ? data.products : [];
  return {
    tenant: normalizeMenuTenant(data?.tenant || null),
    stories: Array.isArray(data?.stories) ? data.stories : [],
    categories: Array.isArray(data?.categories) ? data.categories : [],
    products,
    productPage: normalizeProductPage(data?.productPage, products.length),
    paymentMethods: normalizePublicPaymentMethods(data?.paymentMethods),
  };
}

async function readJsonSafely<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal || controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function requestJson<T>(input: RequestInfo | URL, options: RequestJsonOptions = {}) {
  const { timeoutMs = NETWORK_TIMEOUT_MS, retries = 0, ...init } = options;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(input, init, timeoutMs);
      const data = await readJsonSafely<T>(response);
      if (response.ok || response.status < 500 || attempt >= retries) {
        return { response, data };
      }
    } catch (error) {
      lastError = error;
      if (attempt >= retries) {
        throw error;
      }
    }

    await sleep(NETWORK_RETRY_DELAY_MS * (attempt + 1));
  }

  throw lastError instanceof Error ? lastError : new Error('Falha de conexao.');
}

export default function PublicMenuClient({ tenantSlug, initialData }: PublicMenuClientProps) {
  const initialMenuData = normalizePublicMenuData(initialData);

  const [tenant, setTenant] = useState<Tenant | null>(() => initialMenuData.tenant);
  const [categories, setCategories] = useState<Category[]>(() => initialMenuData.categories);
  const [products, setProducts] = useState<Product[]>(() => initialMenuData.products);
  const [productPage, setProductPage] = useState<PublicMenuProductPage>(() => initialMenuData.productPage);
  const [productPageLoadingMode, setProductPageLoadingMode] = useState<'replace' | 'append' | null>(null);
  const [productPageError, setProductPageError] = useState<string | null>(null);
  const [loading, setLoading] = useState(initialData === undefined);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [activeTopTab, setActiveTopTab] = useState<TopTab>('products');
  const [portalOpen, setPortalOpen] = useState(false);
  const [portalSaving, setPortalSaving] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [portalNameInput, setPortalNameInput] = useState('');
  const [portalPhoneInput, setPortalPhoneInput] = useState('');
  const [portalCustomer, setPortalCustomer] = useState<PortalCustomer | null>(null);
  const [portalOrders, setPortalOrders] = useState<PortalOrder[]>([]);
  const [portalSyncing, setPortalSyncing] = useState(false);
  const [menuStories, setMenuStories] = useState<MenuStory[]>([]);
  const [activeStory, setActiveStory] = useState<MenuStory | null>(null);

  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<CheckoutStep>('cart');
  const [submitting, setSubmitting] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [submittedSnapshot, setSubmittedSnapshot] = useState<SubmittedSnapshot | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodOption[]>(() => initialMenuData.paymentMethods);

  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerIsCompany, setCustomerIsCompany] = useState(false);
  const [customerCompanyName, setCustomerCompanyName] = useState('');
  const [customerDocumentNumber, setCustomerDocumentNumber] = useState('');
  const [customerLookupLoading, setCustomerLookupLoading] = useState(false);
  const [customerLookupDone, setCustomerLookupDone] = useState(false);
  const [customerLookupFound, setCustomerLookupFound] = useState(false);
  const [savedAddresses, setSavedAddresses] = useState<SavedAddress[]>([]);
  const [addressDeleteTarget, setAddressDeleteTarget] = useState<SavedAddress | null>(null);
  const [addressDeleteError, setAddressDeleteError] = useState<string | null>(null);
  const [deletingAddressId, setDeletingAddressId] = useState('');
  const [addressEntryMode, setAddressEntryMode] = useState<AddressEntryMode>('new');
  const [selectedSavedAddressId, setSelectedSavedAddressId] = useState('');
  const [addressForm, setAddressForm] = useState<AddressFormState>({ ...EMPTY_ADDRESS_FORM });
  const [addressStreetOptions, setAddressStreetOptions] = useState<AddressStreetSuggestion[]>([]);
  const [addressStreetLoading, setAddressStreetLoading] = useState(false);
  const [addressStreetMenuOpen, setAddressStreetMenuOpen] = useState(false);
  const [addressStreetScopeState, setAddressStreetScopeState] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('delivery');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryFeeQuote, setDeliveryFeeQuote] = useState<DeliveryFeeQuoteResponse | null>(null);
  const [deliveryFeeLoading, setDeliveryFeeLoading] = useState(false);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState('');
  const [changeFor, setChangeFor] = useState('');
  const addressStreetBoxRef = useRef<HTMLDivElement | null>(null);
  const tenantSlugRef = useRef(tenantSlug || '');
  const addressEntryModeRef = useRef<AddressEntryMode>('new');
  const selectedSavedAddressIdRef = useRef('');
  const addressFormRef = useRef<AddressFormState>({ ...EMPTY_ADDRESS_FORM });
  const savedAddressesRef = useRef<SavedAddress[]>([]);
  const customerLookupCacheRef = useRef<CustomerLookupCacheEntry | null>(null);
  const deliveryFeeQuoteCacheRef = useRef<Map<string, DeliveryFeeQuoteCacheEntry>>(new Map());
  const customerLookupPromiseRef = useRef<{
    tenantSlug: string;
    phone: string;
    includeOrders: boolean;
    promise: Promise<CustomerLookupResponse | null>;
  } | null>(null);
  const checkoutKeyRef = useRef('');
  const initialMenuDataConsumedRef = useRef(initialData !== undefined);
  const skipProductFilterFetchRef = useRef(initialData !== undefined);
  const productPageRequestRef = useRef(0);

  const [customizeProduct, setCustomizeProduct] = useState<Product | null>(null);
  const [menuActionError, setMenuActionError] = useState<string | null>(null);
  const [selectedByGroup, setSelectedByGroup] = useState<Record<string, string[]>>({});
  const [requiredOptionPromptGroupId, setRequiredOptionPromptGroupId] = useState<string | null>(null);
  const [customNotes, setCustomNotes] = useState('');
  const [customQuantity, setCustomQuantity] = useState(1);
  const [selectedPizzaSize, setSelectedPizzaSize] = useState('');
  const [selectedPizzaFlavorIds, setSelectedPizzaFlavorIds] = useState<string[]>([]);
  const [selectedPizzaBorderLabel, setSelectedPizzaBorderLabel] = useState('');
  const [selectedPizzaDoughLabel, setSelectedPizzaDoughLabel] = useState('');
  const [extraDrinkQtyById, setExtraDrinkQtyById] = useState<Record<string, number>>({});
  const [pizzaFlavorPickerOpen, setPizzaFlavorPickerOpen] = useState(false);
  const [pizzaFlavorSearch, setPizzaFlavorSearch] = useState('');
  const [pizzaDrinkPickerOpen, setPizzaDrinkPickerOpen] = useState(false);
  const [pizzaDrinkSearch, setPizzaDrinkSearch] = useState('');

  useEffect(() => {
    tenantSlugRef.current = tenantSlug || '';
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenant?.name) return;
    document.title = `Pedido online - ${tenant.name} | ${BRAND_NAME}`;
    return () => {
      document.title = `${BRAND_NAME} - Gestao de Lanchonete & PDV`;
    };
  }, [tenant?.name]);

  useEffect(() => {
    addressEntryModeRef.current = addressEntryMode;
  }, [addressEntryMode]);

  useEffect(() => {
    selectedSavedAddressIdRef.current = selectedSavedAddressId;
  }, [selectedSavedAddressId]);

  useEffect(() => {
    addressFormRef.current = addressForm;
  }, [addressForm]);

  useEffect(() => {
    savedAddressesRef.current = savedAddresses;
  }, [savedAddresses]);

  const applyKnownCustomer = useCallback((data: {
    customer?: {
      id?: string;
      name?: string;
      phone?: string;
      email?: string | null;
      isCompany?: boolean;
      companyName?: string | null;
      documentNumber?: string | null;
    } | null;
    addresses?: SavedAddress[];
    orders?: PortalOrder[];
  }) => {
    if (!data.customer) return;
    const keepManualAddressDraft =
      addressEntryModeRef.current === 'new' &&
      (savedAddressesRef.current.length > 0 || hasManualAddressDraft(addressFormRef.current));
    setPortalCustomer({
      id: String(data.customer.id || ''),
      name: String(data.customer.name || ''),
      phone: String(data.customer.phone || ''),
      email: data.customer.email || null,
    });
    setCustomerName(String(data.customer.name || ''));
    setCustomerPhone(maskPhone(String(data.customer.phone || '')));
    setCustomerEmail(data.customer.email || '');
    setCustomerIsCompany(Boolean(data.customer.isCompany));
    setCustomerCompanyName(String(data.customer.companyName || ''));
    setCustomerDocumentNumber(String(data.customer.documentNumber || ''));

    const incomingAddresses = Array.isArray(data.addresses) ? data.addresses : [];
    setSavedAddresses(incomingAddresses);
    if (Array.isArray(data.orders)) {
      setPortalOrders(data.orders);
    }
    if (keepManualAddressDraft) {
      addressEntryModeRef.current = 'new';
      selectedSavedAddressIdRef.current = '';
      setAddressEntryMode('new');
      setSelectedSavedAddressId('');
      return;
    }

    setAddressStreetMenuOpen(false);
    setAddressStreetOptions([]);
    setAddressStreetScopeState('');
    setAddressForm({ ...EMPTY_ADDRESS_FORM });
    const defaultAddress = incomingAddresses.find((address) => address.isDefault);
    if (incomingAddresses.length > 0) {
      const nextAddressId = defaultAddress?.id || incomingAddresses[0]?.id || '';
      addressEntryModeRef.current = 'saved';
      selectedSavedAddressIdRef.current = nextAddressId;
      setAddressEntryMode('saved');
      setSelectedSavedAddressId(nextAddressId);
    } else {
      addressEntryModeRef.current = 'new';
      selectedSavedAddressIdRef.current = '';
      setAddressEntryMode('new');
      setSelectedSavedAddressId('');
    }
  }, []);

  const mergeKnownCustomer = useCallback((data: {
    customer?: {
      id?: string;
      name?: string;
      phone?: string;
      email?: string | null;
      isCompany?: boolean;
      companyName?: string | null;
      documentNumber?: string | null;
    } | null;
    addresses?: SavedAddress[];
    orders?: PortalOrder[];
  }) => {
    if (!data.customer) return;

    setPortalCustomer({
      id: String(data.customer.id || ''),
      name: String(data.customer.name || ''),
      phone: String(data.customer.phone || ''),
      email: data.customer.email || null,
    });
    if (Array.isArray(data.orders)) {
      setPortalOrders(data.orders);
    }
    setSavedAddresses(Array.isArray(data.addresses) ? data.addresses : []);

    if (addressEntryModeRef.current === 'saved') {
      const availableAddresses = Array.isArray(data.addresses) ? data.addresses : [];
      if (availableAddresses.length === 0) {
        addressEntryModeRef.current = 'new';
        selectedSavedAddressIdRef.current = '';
        setSelectedSavedAddressId('');
        setAddressEntryMode('new');
        return;
      }

      const selectedAddressId = selectedSavedAddressIdRef.current;
      if (!selectedAddressId || !availableAddresses.some((address) => address.id === selectedAddressId)) {
        const defaultAddress = availableAddresses.find((address) => address.isDefault);
        const nextAddressId = defaultAddress?.id || availableAddresses[0].id;
        selectedSavedAddressIdRef.current = nextAddressId;
        setSelectedSavedAddressId(nextAddressId);
      }
    }
  }, []);

  const syncPortalByPhone = useCallback(async (
    rawPhone: string,
    preserveAddressState = false,
    options: { includeOrders?: boolean } = {},
  ) => {
    if (!tenantSlug) return null;
    const requestTenantSlug = tenantSlug;
    const digits = normalizePhone(rawPhone);
    if (digits.length < 10) return null;
    const includeOrders = Boolean(options.includeOrders);
    const cached = customerLookupCacheRef.current;
    if (
      cached
      && cached.tenantSlug === requestTenantSlug
      && cached.phone === digits
      && (!includeOrders || cached.includeOrders || !cached.data?.found)
      && Date.now() - cached.loadedAt < CUSTOMER_LOOKUP_CACHE_MS
    ) {
      const data = cached.data;
      if (!data?.found) {
        return null;
      }
      if (preserveAddressState) {
        mergeKnownCustomer(data);
      } else {
        applyKnownCustomer(data);
      }
      return data;
    }

    const inflight = customerLookupPromiseRef.current;
    const lookupPromise =
      inflight
      && inflight.tenantSlug === requestTenantSlug
      && inflight.phone === digits
      && (!includeOrders || inflight.includeOrders)
        ? inflight.promise
        : (() => {
            const promise = (async () => {
              try {
                const params = new URLSearchParams({ phone: digits });
                if (!includeOrders) params.set('includeOrders', 'false');
                const { response, data } = await requestJson<CustomerLookupResponse>(
                  `/api/public/customer/${requestTenantSlug}?${params.toString()}`,
                  { cache: 'no-store', retries: 1 },
                );
                if (!response.ok) {
                  return null;
                }
                const result = data?.found ? data : null;
                customerLookupCacheRef.current = {
                  tenantSlug: requestTenantSlug,
                  phone: digits,
                  includeOrders,
                  loadedAt: Date.now(),
                  data: result,
                };
                return result;
              } finally {
                if (
                  customerLookupPromiseRef.current
                  && customerLookupPromiseRef.current.tenantSlug === requestTenantSlug
                  && customerLookupPromiseRef.current.phone === digits
                  && customerLookupPromiseRef.current.includeOrders === includeOrders
                ) {
                  customerLookupPromiseRef.current = null;
                }
              }
            })();
            customerLookupPromiseRef.current = {
              tenantSlug: requestTenantSlug,
              phone: digits,
              includeOrders,
              promise,
            };
            return promise;
          })();

    const data = await lookupPromise;
    if (!data?.found) {
      return null;
    }

    if (tenantSlugRef.current !== requestTenantSlug) {
      return null;
    }

    if (preserveAddressState) {
      mergeKnownCustomer(data);
    } else {
      applyKnownCustomer(data);
    }
    return data;
  }, [tenantSlug, applyKnownCustomer, mergeKnownCustomer]);

  function openAddressDeleteConfirm(address: SavedAddress) {
    if (deletingAddressId) return;
    setAddressDeleteTarget(address);
    setAddressDeleteError(null);
  }

  function closeAddressDeleteConfirm() {
    if (deletingAddressId) return;
    setAddressDeleteTarget(null);
    setAddressDeleteError(null);
  }

  async function deleteSavedAddress(address: SavedAddress) {
    if (!tenantSlug || deletingAddressId) return;
    const phoneDigits = normalizePhone(customerPhone || portalCustomer?.phone || '');
    if (phoneDigits.length < 10) {
      setAddressDeleteError('Informe o celular do cliente antes de remover o endereco.');
      return;
    }

    setDeletingAddressId(address.id);
    setAddressDeleteError(null);
    setFormError(null);
    try {
      const { response, data } = await requestJson<CustomerLookupResponse>(`/api/public/customer/${tenantSlug}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        timeoutMs: NETWORK_TIMEOUT_MS,
        retries: 0,
        body: JSON.stringify({
          phone: phoneDigits,
          addressId: address.id,
        }),
      });

      if (!response.ok || !data) {
        setAddressDeleteError(data?.error || 'Nao foi possivel remover o endereco.');
        return;
      }

      setAddressDeleteTarget(null);
      setAddressDeleteError(null);
      const nextAddresses = Array.isArray(data.addresses) ? data.addresses : [];
      setSavedAddresses(nextAddresses);
      savedAddressesRef.current = nextAddresses;
      if (Array.isArray(data.orders)) {
        setPortalOrders(data.orders);
      }
      if (data.customer) {
        setPortalCustomer({
          id: String(data.customer.id || ''),
          name: String(data.customer.name || ''),
          phone: String(data.customer.phone || ''),
          email: data.customer.email || null,
        });
      }
      customerLookupCacheRef.current = {
        tenantSlug,
        phone: phoneDigits,
        includeOrders: true,
        loadedAt: Date.now(),
        data: {
          ...data,
          found: true,
          addresses: nextAddresses,
        },
      };

      const currentSelectedId = selectedSavedAddressIdRef.current;
      const selectedStillExists = Boolean(currentSelectedId && nextAddresses.some((item) => item.id === currentSelectedId));
      if (addressEntryModeRef.current === 'saved' && !selectedStillExists) {
        const nextAddress = nextAddresses.find((item) => item.isDefault) || nextAddresses[0];
        if (nextAddress) {
          addressEntryModeRef.current = 'saved';
          selectedSavedAddressIdRef.current = nextAddress.id;
          setAddressEntryMode('saved');
          setSelectedSavedAddressId(nextAddress.id);
          setDeliveryAddress(formatSavedAddress(nextAddress));
        } else {
          addressEntryModeRef.current = 'new';
          selectedSavedAddressIdRef.current = '';
          setAddressEntryMode('new');
          setSelectedSavedAddressId('');
          setDeliveryAddress('');
          setAddressForm({ ...EMPTY_ADDRESS_FORM });
          setAddressStreetMenuOpen(false);
          setAddressStreetOptions([]);
          setAddressStreetScopeState('');
        }
      }
    } catch {
      setAddressDeleteError('Falha de conexao ao remover endereco.');
    } finally {
      setDeletingAddressId('');
    }
  }

  const ensurePortalCustomer = useCallback(async (input?: { name?: string; phone?: string; email?: string }) => {
    if (!tenantSlug) return null;

    const name = String(input?.name ?? customerName).trim();
    const phoneDigits = normalizePhone(String(input?.phone ?? customerPhone).trim());
    const email = String(input?.email ?? customerEmail).trim();

    if (!name || phoneDigits.length < 10) {
      return null;
    }

    setPortalSaving(true);
    try {
      const { response, data } = await requestJson<{
        customer?: {
          id?: string;
          name?: string;
          phone?: string;
          email?: string | null;
          isCompany?: boolean;
          companyName?: string | null;
          documentNumber?: string | null;
        } | null;
        addresses?: SavedAddress[];
        orders?: PortalOrder[];
        error?: string;
      }>(`/api/public/customer/${tenantSlug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeoutMs: NETWORK_TIMEOUT_MS,
        retries: 1,
        body: JSON.stringify({
          name,
          phone: phoneDigits,
          email,
        }),
      });

      if (!response.ok || !data) {
        throw new Error(data?.error || 'Falha ao entrar.');
      }

      customerLookupCacheRef.current = {
        tenantSlug,
        phone: phoneDigits,
        includeOrders: true,
        loadedAt: Date.now(),
        data: {
          ...data,
          found: true,
        },
      };
      applyKnownCustomer(data);
      setCustomerLookupDone(true);
      setCustomerLookupFound(true);
      return data;
    } finally {
      setPortalSaving(false);
    }
  }, [tenantSlug, customerEmail, customerName, customerPhone, applyKnownCustomer]);

  async function submitPortalAuth() {
    if (!tenantSlug || portalSaving) return;
    setPortalError(null);
    const phoneDigits = normalizePhone(portalPhoneInput);
    if (phoneDigits.length < 10) {
      setPortalError('Informe um celular valido.');
      return;
    }

    try {
      if (!portalNameInput.trim()) {
        const existingPortal = await syncPortalByPhone(phoneDigits, false, { includeOrders: true });
        if (!existingPortal) {
          setPortalError('Cadastro nao encontrado. Informe seu nome para criar o portal agora.');
          return;
        }
      } else {
        await ensurePortalCustomer({
          name: portalNameInput.trim(),
          phone: phoneDigits,
        });
      }
      setPortalOpen(false);
      setActiveTopTab('portal');
    } catch (error) {
      setPortalError(error instanceof Error ? error.message : 'Falha ao entrar.');
    }
  }

  useEffect(() => {
    let mounted = true;
    async function loadData() {
      if (!tenantSlug) return;
      if (initialMenuDataConsumedRef.current) {
        initialMenuDataConsumedRef.current = false;
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const menuResult = await requestJson<PublicMenuData>(`/api/public/menu/${tenantSlug}`, { cache: 'default', retries: 1 });
        const { response: menuResponse, data } = menuResult;
        if (!menuResponse.ok) {
          if (mounted) {
            setTenant(null);
            setMenuStories([]);
            setCategories([]);
            setProducts([]);
            setProductPage(normalizeProductPage(undefined, 0));
            setPaymentMethods([]);
            setSelectedPaymentMethodId('');
          }
          setLoading(false);
          return;
        }
        if (!data?.tenant) {
          if (mounted) {
            setTenant(null);
            setMenuStories([]);
            setCategories([]);
            setProducts([]);
            setProductPage(normalizeProductPage(undefined, 0));
            setPaymentMethods([]);
            setSelectedPaymentMethodId('');
          }
          setLoading(false);
          return;
        }
        const nextData = normalizePublicMenuData(data);
        if (mounted) {
          setTenant(nextData.tenant);
          setMenuStories(nextData.stories);
          setCategories(nextData.categories);
          setProducts(nextData.products);
          setProductPage(nextData.productPage);
          setPaymentMethods(nextData.paymentMethods);
          setSelectedPaymentMethodId((current) => {
            return nextData.paymentMethods.some((method) => method.id === current)
              ? current
              : '';
          });
          setActiveCategory('all');
        }
        setLoading(false);
      } catch {
        if (mounted) {
          setTenant(null);
          setMenuStories([]);
          setCategories([]);
          setProducts([]);
          setProductPage(normalizeProductPage(undefined, 0));
          setPaymentMethods([]);
          setSelectedPaymentMethodId('');
        }
        setLoading(false);
      }
    }
    void loadData();
    return () => {
      mounted = false;
    };
  }, [tenantSlug]);

  const loadProductPage = useCallback(async (mode: 'replace' | 'append', offset: number) => {
    if (!tenantSlug) return;

    const requestId = productPageRequestRef.current + 1;
    productPageRequestRef.current = requestId;
    setProductPageLoadingMode(mode);
    setProductPageError(null);

    const params = new URLSearchParams({
      limit: String(PRODUCT_PAGE_SIZE),
      offset: String(Math.max(0, offset)),
    });
    const searchTerm = search.trim();
    if (searchTerm) params.set('search', searchTerm);
    if (activeCategory !== 'all') params.set('categoryId', activeCategory);

    try {
      const { response, data } = await requestJson<PublicMenuProductsResponse>(
        `/api/public/menu-products/${tenantSlug}?${params.toString()}`,
        { cache: 'default', retries: 1 },
      );
      if (productPageRequestRef.current !== requestId) return;
      if (!response.ok || !data) {
        throw new Error(data?.error || 'Falha ao carregar produtos.');
      }

      const nextProducts = Array.isArray(data.products) ? data.products : [];
      const nextLoadedCount = mode === 'append' ? offset + nextProducts.length : nextProducts.length;
      setProducts((current) => {
        const byId = new Map<string, Product>();
        if (mode === 'append') {
          for (const product of current) byId.set(product.id, product);
        }
        for (const product of nextProducts) {
          const existing = byId.get(product.id);
          byId.set(
            product.id,
            existing?.optionGroups.length
              ? {
                  ...product,
                  optionGroups: existing.optionGroups,
                  optionGroupCount: Math.max(product.optionGroupCount || 0, existing.optionGroupCount || 0),
                }
              : product,
          );
        }
        return Array.from(byId.values());
      });
      setProductPage(normalizeProductPage(data.productPage, nextLoadedCount));
    } catch (error) {
      if (productPageRequestRef.current === requestId) {
        setProductPageError(error instanceof Error ? error.message : 'Falha ao carregar produtos.');
      }
    } finally {
      if (productPageRequestRef.current === requestId) {
        setProductPageLoadingMode(null);
      }
    }
  }, [activeCategory, search, tenantSlug]);

  useEffect(() => {
    if (!tenantSlug) return;
    if (skipProductFilterFetchRef.current) {
      skipProductFilterFetchRef.current = false;
      return;
    }

    const timer = setTimeout(() => {
      void loadProductPage('replace', 0);
    }, search.trim() ? 300 : 0);

    return () => clearTimeout(timer);
  }, [activeCategory, loadProductPage, search, tenantSlug]);

  useEffect(() => {
    if (!tenantSlug) return;
    const emptyState = createEmptyPortalCustomerState();
    setPortalCustomer(emptyState.portalCustomer);
    setPortalOrders(emptyState.portalOrders);
    setPortalSyncing(false);
    setPortalNameInput(emptyState.portalNameInput);
    setPortalPhoneInput(emptyState.portalPhoneInput);
    setCustomerName(emptyState.customerName);
    setCustomerPhone(emptyState.customerPhone);
    setCustomerEmail(emptyState.customerEmail);
    setCustomerIsCompany(emptyState.customerIsCompany);
    setCustomerCompanyName(emptyState.customerCompanyName);
    setCustomerDocumentNumber(emptyState.customerDocumentNumber);
    setCustomerLookupLoading(false);
    setCustomerLookupDone(false);
    setCustomerLookupFound(false);
    setSavedAddresses(emptyState.savedAddresses);
    addressEntryModeRef.current = emptyState.addressEntryMode;
    selectedSavedAddressIdRef.current = emptyState.selectedSavedAddressId;
    setAddressEntryMode(emptyState.addressEntryMode);
    setSelectedSavedAddressId(emptyState.selectedSavedAddressId);
    setAddressForm(emptyState.addressForm);
    setDeliveryAddress(emptyState.deliveryAddress);
    setAddressStreetMenuOpen(false);
    setAddressStreetOptions([]);
    setAddressStreetScopeState('');
    setProfileMenuOpen(false);
    setPortalOpen(false);

    try {
      const raw = localStorage.getItem(getPortalSessionKey(tenantSlug));
      if (!raw) return;
      const parsed = JSON.parse(raw) as PortalCustomer;
      if (!parsed?.phone || !parsed?.name) return;
      setPortalCustomer(parsed);
      setCustomerName(parsed.name);
      setCustomerPhone(maskPhone(parsed.phone));
      setCustomerEmail(parsed.email || '');
      setPortalNameInput(parsed.name);
      setPortalPhoneInput(maskPhone(parsed.phone));
    } catch {
      // ignora sessao invalida
    }
  }, [tenantSlug]);

  useEffect(() => {
    if (!tenantSlug) return;
    try {
      if (portalCustomer) {
        localStorage.setItem(getPortalSessionKey(tenantSlug), JSON.stringify(portalCustomer));
      } else {
        localStorage.removeItem(getPortalSessionKey(tenantSlug));
      }
    } catch {
      // ignora erro de storage
    }
  }, [tenantSlug, portalCustomer]);

  useEffect(() => {
    if (!portalCustomer?.phone || !tenantSlug) {
      setPortalOrders([]);
      setPortalSyncing(false);
      return;
    }
    const portalPhone = portalCustomer.phone;

    let active = true;
    async function refreshPortal() {
      if (!active) return;
      if (typeof document !== 'undefined' && document.hidden) return;
      setPortalSyncing(true);
      try {
        await syncPortalByPhone(portalPhone, true, { includeOrders: true });
      } catch {
        // Mantem a sessao local do portal mesmo se a atualizacao falhar.
      } finally {
        if (active) setPortalSyncing(false);
      }
    }

    void refreshPortal();
    const onVisibilityChange = () => {
      if (!document.hidden) {
        void refreshPortal();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = setInterval(() => {
      void refreshPortal();
    }, 60000);

    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(interval);
    };
  }, [portalCustomer?.phone, tenantSlug, syncPortalByPhone]);

  useEffect(() => {
    if (!tenantSlug) return;
    const digits = normalizePhone(customerPhone);
    if (digits.length < 10) {
      const keepManualAddressDraft = addressEntryModeRef.current === 'new' && hasManualAddressDraft(addressFormRef.current);
      setCustomerLookupDone(false);
      setCustomerLookupFound(false);
      setCustomerLookupLoading(false);
      setSavedAddresses([]);
      addressEntryModeRef.current = 'new';
      selectedSavedAddressIdRef.current = '';
      setAddressEntryMode('new');
      setSelectedSavedAddressId('');
      if (!keepManualAddressDraft) {
        setAddressStreetMenuOpen(false);
        setAddressStreetOptions([]);
        setAddressStreetScopeState('');
        setAddressForm({ ...EMPTY_ADDRESS_FORM });
      }
      return;
    }

    let active = true;
    const requestTenantSlug = tenantSlug;
    const requestDigits = digits;
    setCustomerLookupDone(false);
    setCustomerLookupFound(false);
    const timeout = setTimeout(async () => {
      if (!active) return;
      setCustomerLookupDone(false);
      setCustomerLookupFound(false);
      setCustomerLookupLoading(true);
      try {
        const data = await syncPortalByPhone(requestDigits);
        if (!active || tenantSlugRef.current !== requestTenantSlug || normalizePhone(customerPhone) !== requestDigits) {
          return;
        }
        if (!data?.found) {
          const keepManualAddressDraft = addressEntryModeRef.current === 'new' && hasManualAddressDraft(addressFormRef.current);
          setCustomerLookupDone(true);
          setCustomerLookupFound(false);
          setSavedAddresses([]);
          addressEntryModeRef.current = 'new';
          selectedSavedAddressIdRef.current = '';
          setAddressEntryMode('new');
          setSelectedSavedAddressId('');
          if (!keepManualAddressDraft) {
            setAddressStreetMenuOpen(false);
            setAddressStreetOptions([]);
            setAddressStreetScopeState('');
            setAddressForm({ ...EMPTY_ADDRESS_FORM });
          }
          return;
        }

        setCustomerLookupDone(true);
        setCustomerLookupFound(true);
      } catch {
        setCustomerLookupDone(false);
        setCustomerLookupFound(false);
      } finally {
        setCustomerLookupLoading(false);
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [tenantSlug, customerPhone, syncPortalByPhone]);

  const checkoutPhoneDigits = normalizePhone(customerPhone);
  const portalCustomerMatchesCheckout = Boolean(
    portalCustomer?.phone && checkoutPhoneDigits && normalizePhone(portalCustomer.phone) === checkoutPhoneDigits,
  );
  const usingNewAddress = orderType === 'delivery' && (savedAddresses.length === 0 || addressEntryMode === 'new');

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const byCategory = activeCategory === 'all' || product.category_id === activeCategory;
      const term = search.trim().toLowerCase();
      const bySearch =
        term.length === 0 || product.name.toLowerCase().includes(term) || (product.description || '').toLowerCase().includes(term);
      return byCategory && bySearch;
    });
  }, [products, activeCategory, search]);

  useEffect(() => {
    if (addressEntryMode !== 'saved') return;
    if (!selectedSavedAddressId) return;
    const selected = savedAddresses.find((address) => address.id === selectedSavedAddressId);
    if (!selected) return;
    setDeliveryAddress(formatSavedAddress(selected));
    setAddressStreetMenuOpen(false);
    setAddressStreetOptions([]);
    setAddressStreetScopeState('');
    setAddressForm({ ...EMPTY_ADDRESS_FORM });
  }, [addressEntryMode, selectedSavedAddressId, savedAddresses]);

  useEffect(() => {
    if (savedAddresses.length === 0) return;
    if (addressEntryMode === 'new') return;
    if (selectedSavedAddressId) return;
    const defaultAddress = savedAddresses.find((address) => address.isDefault);
    const nextAddressId = defaultAddress?.id || savedAddresses[0].id;
    selectedSavedAddressIdRef.current = nextAddressId;
    setSelectedSavedAddressId(nextAddressId);
  }, [addressEntryMode, savedAddresses, selectedSavedAddressId]);

  const applyManualAddressZipLookup = useCallback((fields: { street?: string; neighborhood?: string; city?: string; state?: string; complement?: string }) => {
    setAddressForm((prev) => ({
      ...prev,
      street: prev.street || String(fields.street || ''),
      neighborhood: prev.neighborhood || String(fields.neighborhood || ''),
      city: prev.city || String(fields.city || ''),
      state: prev.state || String(fields.state || ''),
      complement: prev.complement || String(fields.complement || ''),
    }));
  }, []);

  useZipCodeAutofill({
    zipCode: addressForm.zipCode,
    enabled: usingNewAddress,
    apply: applyManualAddressZipLookup,
  });

  useEffect(() => {
    if (!usingNewAddress || !tenantSlug) {
      setAddressStreetOptions([]);
      setAddressStreetLoading(false);
      setAddressStreetScopeState('');
      return;
    }

    const streetQuery = addressForm.street.trim();
    const issuerStateQuery = String(tenant?.issuerState || '').trim().toUpperCase();
    const stateQuery = issuerStateQuery || addressForm.state.trim().toUpperCase();

    if (streetQuery.length < 2) {
      setAddressStreetOptions([]);
      setAddressStreetLoading(false);
      setAddressStreetScopeState('');
      return;
    }

    let active = true;
    setAddressStreetOptions([]);
    setAddressStreetScopeState(stateQuery);
    setAddressStreetLoading(true);
    const timer = setTimeout(async () => {
      setAddressStreetLoading(true);
      try {
        const params = new URLSearchParams({ street: streetQuery, slug: tenantSlug });
        if (stateQuery) params.set('state', stateQuery);
        const { response, data } = await requestJson<{
          suggestions?: AddressStreetSuggestion[];
          effectiveCity?: string;
          effectiveState?: string;
        }>(`/api/lookup/address?${params.toString()}`, { cache: 'no-store', timeoutMs: 10_000 });
        if (!response.ok || !active || !data) return;
        setAddressStreetScopeState(String(data.effectiveState || '').toUpperCase());
        setAddressStreetOptions(Array.isArray(data.suggestions) ? data.suggestions.slice(0, 8) : []);
      } catch {
        if (!active) return;
        setAddressStreetOptions([]);
        setAddressStreetScopeState('');
      } finally {
        if (active) setAddressStreetLoading(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [addressForm.state, addressForm.street, tenant?.issuerState, tenantSlug, usingNewAddress]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!addressStreetBoxRef.current) return;
      if (!addressStreetBoxRef.current.contains(event.target as Node)) {
        setAddressStreetMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const productsByCategory = useMemo(() => {
    return categories
      .map((category) => ({ category, items: filteredProducts.filter((product) => product.category_id === category.id) }))
      .filter((entry) => entry.items.length > 0);
  }, [categories, filteredProducts]);
  const totalFilteredProducts = useMemo(
    () => productPage.total,
    [productPage.total],
  );
  const renderedProductsCount = useMemo(
    () => productsByCategory.reduce((sum, entry) => sum + entry.items.length, 0),
    [productsByCategory],
  );
  const hasMoreProducts = Boolean(productPage.hasMore) && renderedProductsCount < totalFilteredProducts;

  const cartItemsCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);
  const subtotal = useMemo(
    () =>
      cart.reduce(
        (sum, item) =>
          sum +
          (item.basePrice +
            item.selectedOptions.reduce((s, option) => s + option.priceAddition, 0) +
            (item.pizzaSelection?.borderPrice || 0) +
            (item.pizzaSelection?.doughPrice || 0)) *
            item.quantity,
        0,
      ),
    [cart],
  );
  const availablePaymentMethods = paymentMethods;
  const selectedPaymentMethod = useMemo(
    () => availablePaymentMethods.find((method) => method.id === selectedPaymentMethodId) || null,
    [availablePaymentMethods, selectedPaymentMethodId],
  );
  const selectedSavedAddress = useMemo(
    () => savedAddresses.find((address) => address.id === selectedSavedAddressId) || null,
    [savedAddresses, selectedSavedAddressId],
  );
  const manualDeliveryAddress = useMemo(() => {
    const main = [addressForm.street, addressForm.number].filter(Boolean).join(', ');
    const area = [addressForm.neighborhood, addressForm.city, addressForm.state].filter(Boolean).join(' - ');
    const extra = [addressForm.complement, addressForm.reference].filter(Boolean).join(' | ');
    return [main, area, extra].filter(Boolean).join(' | ');
  }, [addressForm]);
  const effectiveDeliveryAddress =
    orderType === 'delivery'
      ? selectedSavedAddress
        ? formatSavedAddress(selectedSavedAddress)
        : manualDeliveryAddress || deliveryAddress
      : '';
  const hasDeliveryDistanceLimit = orderType === 'delivery' && Number(tenant?.deliveryMaxDistanceKm || 0) > 0;
  const needsDeliveryDistanceQuote =
    orderType === 'delivery' && Boolean(tenant) && (tenant?.deliveryFeeMode !== 'fixed' || hasDeliveryDistanceLimit);

  useEffect(() => {
    let active = true;

    if (!tenantSlug || !tenant || orderType !== 'delivery') {
      setDeliveryFeeQuote(null);
      setDeliveryFeeLoading(false);
      return () => {
        active = false;
      };
    }

    const baseQuote: DeliveryFeeQuoteResponse = {
      deliveryFeeAmount: Number(tenant.deliveryFeeBase || 0),
      distanceKm: null,
      distanceMeters: null,
      deliveryFeeMode: tenant.deliveryFeeMode,
      deliveryFeePerKm: Number(tenant.deliveryFeePerKm || 0),
      deliveryMaxDistanceMeters: Math.round(Number(tenant.deliveryMaxDistanceKm || 0) * 1000),
      matchedTier: null,
      usedFallback: false,
      isDeliveryAvailable: true,
      deliveryUnavailableReason: null,
    };

    if (tenant.deliveryFeeMode === 'fixed' && !hasDeliveryDistanceLimit) {
      setDeliveryFeeQuote({
        deliveryFeeAmount: Number(tenant.deliveryFeeBase || 0),
        distanceKm: null,
        distanceMeters: null,
        deliveryFeeMode: 'fixed',
        deliveryFeePerKm: Number(tenant.deliveryFeePerKm || 0),
        deliveryMaxDistanceMeters: 0,
        matchedTier: null,
        usedFallback: false,
        isDeliveryAvailable: true,
        deliveryUnavailableReason: null,
      });
      setDeliveryFeeLoading(false);
      return () => {
        active = false;
      };
    }

    const addressPayload =
      !usingNewAddress && selectedSavedAddress
        ? {
            street: selectedSavedAddress.street,
            number: selectedSavedAddress.number || '',
            neighborhood: selectedSavedAddress.neighborhood || '',
            city: selectedSavedAddress.city || '',
            state: selectedSavedAddress.state || '',
            zipCode: selectedSavedAddress.zipCode || '',
            reference: selectedSavedAddress.reference || '',
          }
        : usingNewAddress
          ? {
              street: addressForm.street,
              number: addressForm.number,
              neighborhood: addressForm.neighborhood,
              city: addressForm.city,
              state: addressForm.state,
              zipCode: addressForm.zipCode,
              reference: addressForm.reference,
            }
        : null;

    const addressReady =
      !usingNewAddress && selectedSavedAddress
        ? isAddressReadyForDeliveryQuote(selectedSavedAddress)
        : usingNewAddress
          ? isAddressReadyForDeliveryQuote(addressForm)
          : false;

    if (!addressReady) {
      setDeliveryFeeQuote(baseQuote);
      setDeliveryFeeLoading(false);
      return () => {
        active = false;
      };
    }

    const quoteKey = buildDeliveryFeeQuoteKey({
      tenantSlug,
      mode: tenant.deliveryFeeMode,
      base: Number(tenant.deliveryFeeBase || 0),
      perKm: Number(tenant.deliveryFeePerKm || 0),
      table: tenant.deliveryFeeTable,
      maxDistanceKm: Number(tenant.deliveryMaxDistanceKm || 0),
      address: addressPayload,
      freeform: effectiveDeliveryAddress,
    });
    const cachedQuote = deliveryFeeQuoteCacheRef.current.get(quoteKey);
    if (cachedQuote && Date.now() - cachedQuote.loadedAt < DELIVERY_FEE_QUOTE_CACHE_MS) {
      setDeliveryFeeQuote(cachedQuote.quote);
      setDeliveryFeeLoading(false);
      return () => {
        active = false;
      };
    }

    setDeliveryFeeQuote(baseQuote);

    const timer = setTimeout(async () => {
      setDeliveryFeeLoading(true);
      try {
        const { response, data } = await requestJson<DeliveryFeeQuoteResponse>(`/api/public/delivery-fee/${tenantSlug}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          cache: 'no-store',
          timeoutMs: 6_000,
          retries: 0,
          body: JSON.stringify({
            orderType,
            deliveryAddress: effectiveDeliveryAddress,
            address: addressPayload,
          }),
        });
        if (!active) return;
        if (!response.ok || !data) {
          setDeliveryFeeQuote({
            ...baseQuote,
            matchedTier: null,
            usedFallback: true,
          });
          return;
        }
        const nextQuote: DeliveryFeeQuoteResponse = {
          deliveryFeeAmount: Number(data.deliveryFeeAmount ?? tenant.deliveryFeeBase ?? 0),
          distanceKm: data.distanceKm ?? null,
          distanceMeters: data.distanceMeters ?? null,
          deliveryFeeMode: data.deliveryFeeMode === 'per_km' || data.deliveryFeeMode === 'distance_table' ? data.deliveryFeeMode : 'fixed',
          deliveryFeePerKm: Number(data.deliveryFeePerKm ?? tenant.deliveryFeePerKm ?? 0),
          deliveryMaxDistanceMeters: Number(data.deliveryMaxDistanceMeters ?? Math.round(Number(tenant.deliveryMaxDistanceKm || 0) * 1000)),
          matchedTier: data.matchedTier ?? null,
          usedFallback: Boolean(data.usedFallback),
          isDeliveryAvailable: data.isDeliveryAvailable !== false,
          deliveryUnavailableReason: data.deliveryUnavailableReason || null,
        };
        deliveryFeeQuoteCacheRef.current.set(quoteKey, {
          loadedAt: Date.now(),
          quote: nextQuote,
        });
        if (deliveryFeeQuoteCacheRef.current.size > 80) {
          const oldestKey = deliveryFeeQuoteCacheRef.current.keys().next().value;
          if (oldestKey) deliveryFeeQuoteCacheRef.current.delete(oldestKey);
        }
        setDeliveryFeeQuote(nextQuote);
      } catch {
        if (!active) return;
        setDeliveryFeeQuote({
          ...baseQuote,
          matchedTier: null,
          usedFallback: true,
        });
      } finally {
        if (active) {
          setDeliveryFeeLoading(false);
        }
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    addressForm,
    addressForm.city,
    addressForm.neighborhood,
    addressForm.number,
    addressForm.reference,
    addressForm.state,
    addressForm.street,
    addressForm.zipCode,
    effectiveDeliveryAddress,
    hasDeliveryDistanceLimit,
    orderType,
    selectedSavedAddress,
    tenant,
    tenantSlug,
    usingNewAddress,
  ]);

  const deliveryBlockedByDistance = orderType === 'delivery' && deliveryFeeQuote?.isDeliveryAvailable === false;
  const deliveryFee =
    orderType === 'delivery' && !deliveryBlockedByDistance
      ? Number(deliveryFeeQuote?.deliveryFeeAmount ?? tenant?.deliveryFeeBase ?? 0)
      : 0;
  const deliveryAddressReadyForQuote =
    orderType !== 'delivery' ||
    !needsDeliveryDistanceQuote ||
    (!usingNewAddress && selectedSavedAddress
      ? isAddressReadyForDeliveryQuote(selectedSavedAddress)
      : usingNewAddress
        ? isAddressReadyForDeliveryQuote(addressForm)
        : false);
  const baseTotal = subtotal + deliveryFee;
  const total = baseTotal;
  const deliveryMinOrderAmount = Math.max(0, Number(tenant?.deliveryMinOrderAmount || 0));
  const deliveryMinimumRemaining = Math.max(0, deliveryMinOrderAmount - subtotal);
  const deliveryMinimumMissing =
    orderType === 'delivery' && deliveryMinOrderAmount > 0 && subtotal < deliveryMinOrderAmount;
  const parsedChangeForAmount = useMemo(() => parseMoneyInput(changeFor), [changeFor]);

  const heroImage =
    tenant?.coverImageUrl ||
    products.find((product) => product.image_url)?.image_url ||
    'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=1400&q=80';
  const tenantAddressLine = [
    [tenant?.issuerStreet, tenant?.issuerNumber].filter(Boolean).join(', '),
    [tenant?.issuerCity, tenant?.issuerState].filter(Boolean).join('/'),
  ]
    .filter(Boolean)
    .join(' • ');

  const latestPortalOrder = useMemo(() => portalOrders[0] || null, [portalOrders]);
  const requiredOptionPromptGroup = useMemo(() => {
    if (!customizeProduct || !requiredOptionPromptGroupId) return null;
    return customizeProduct.optionGroups.find((group) => group.id === requiredOptionPromptGroupId) || null;
  }, [customizeProduct, requiredOptionPromptGroupId]);
  const requiredOptionPromptSelectedCount = requiredOptionPromptGroup
    ? (selectedByGroup[requiredOptionPromptGroup.id] || []).length
    : 0;

  async function loadProductOptionGroups(product: Product) {
    const cachedProduct = products.find((candidate) => candidate.id === product.id);
    if (cachedProduct?.optionGroups.length) return cachedProduct;
    if (!tenantSlug || Number(product.optionGroupCount || 0) === 0) return cachedProduct || product;

    const { response, data } = await requestJson<{
      optionGroups?: ProductOptionGroup[];
      error?: string;
    }>(`/api/public/product-options/${tenantSlug}/${product.id}`, {
      cache: 'default',
      timeoutMs: NETWORK_TIMEOUT_MS,
      retries: 1,
    });

    if (!response.ok || !data) {
      throw new Error(data?.error || 'Falha ao carregar complementos.');
    }

    const optionGroups = Array.isArray(data.optionGroups) ? data.optionGroups : [];
    const nextProduct = {
      ...(cachedProduct || product),
      optionGroups,
      optionGroupCount: optionGroups.length,
    };
    setProducts((current) => current.map((candidate) => (candidate.id === product.id ? nextProduct : candidate)));
    return nextProduct;
  }

  async function openCustomize(product: Product) {
    setMenuActionError(null);
    let readyProduct = product;
    try {
      readyProduct = await loadProductOptionGroups(product);
    } catch (error) {
      setMenuActionError(error instanceof Error ? error.message : 'Falha ao carregar complementos.');
      return;
    }

    setCustomizeProduct(readyProduct);
    setPizzaFlavorPickerOpen(false);
    setPizzaFlavorSearch('');
    setSelectedByGroup({});
    setRequiredOptionPromptGroupId(null);
    setCustomNotes('');
    setCustomQuantity(1);
    if (readyProduct.product_type === 'size_based') {
      const sizes = getSizeOptions(readyProduct);
      const firstSize = sizes[0]?.label || '';
      setSelectedPizzaSize(firstSize);
      setSelectedPizzaFlavorIds([readyProduct.id]);
      setSelectedPizzaBorderLabel('');
      setSelectedPizzaDoughLabel(getPizzaDoughs(readyProduct)[0]?.label || '');
      setExtraDrinkQtyById({});
    } else {
      setSelectedPizzaSize('');
      setSelectedPizzaFlavorIds([]);
      setSelectedPizzaBorderLabel('');
      setSelectedPizzaDoughLabel('');
      setExtraDrinkQtyById({});
    }
  }

  function getPizzaFlavorCandidates(product: Product) {
    if (product.product_type !== 'size_based') return [];
    return products.filter(
      (candidate) =>
        candidate.product_type === 'size_based' &&
        candidate.category_id === product.category_id &&
        candidate.id !== product.id,
    );
  }

  function getPizzaFlavorPool(product: Product) {
    if (product.product_type !== 'size_based') return [];
    return [product, ...getPizzaFlavorCandidates(product)];
  }

  function getFilteredPizzaFlavorPool(product: Product) {
    const term = pizzaFlavorSearch.trim().toLowerCase();
    const pool = getPizzaFlavorPool(product);
    if (!term) return pool;
    return pool.filter(
      (flavor) =>
        flavor.name.toLowerCase().includes(term) ||
        (flavor.description || '').toLowerCase().includes(term),
    );
  }

  function getSelectedPizzaProducts(product: Product) {
    if (product.product_type !== 'size_based') return [];
    const ids = selectedPizzaFlavorIds.length > 0 ? selectedPizzaFlavorIds : [product.id];
    return ids
      .map((id) => products.find((candidate) => candidate.id === id))
      .filter((candidate): candidate is Product => Boolean(candidate));
  }

  function getPizzaUnitPrice(product: Product) {
    const selectedProducts = getSelectedPizzaProducts(product);
    if (!selectedPizzaSize || selectedProducts.length === 0) {
      return Number(product.price);
    }

    const prices = selectedProducts
      .map((selectedProduct) =>
        getSizeOptions(selectedProduct).find((size) => size.label === selectedPizzaSize)?.price || 0,
      )
      .filter((price) => price > 0);

    if (prices.length === 0) return Number(product.price);
    return Math.max(...prices);
  }

  function getSelectedPizzaBorder(product: Product) {
    return getPizzaBorders(product).find((border) => border.label === selectedPizzaBorderLabel) || null;
  }

  function getSelectedPizzaDough(product: Product) {
    return getPizzaDoughs(product).find((dough) => dough.label === selectedPizzaDoughLabel) || null;
  }

  function getBeverageProducts() {
    return products.filter((product) => product.product_type === 'packaged');
  }

  function getFilteredBeverageProducts() {
    const term = pizzaDrinkSearch.trim().toLowerCase();
    const drinks = getBeverageProducts();
    if (!term) return drinks;
    return drinks.filter(
      (drink) =>
        drink.name.toLowerCase().includes(term) ||
        (drink.description || '').toLowerCase().includes(term),
    );
  }

  function getSelectedExtraDrinksSummary() {
    const selected = Object.entries(extraDrinkQtyById)
      .map(([id, qty]) => {
        const drink = products.find((product) => product.id === id);
        if (!drink || qty <= 0) return null;
        return `${drink.name} x${qty}`;
      })
      .filter((item): item is string => Boolean(item));
    return selected;
  }

  function getExtraDrinksSubtotal() {
    return Object.entries(extraDrinkQtyById).reduce((sum, [id, qty]) => {
      const drink = products.find((product) => product.id === id);
      if (!drink || qty <= 0) return sum;
      return sum + Number(drink.price) * qty;
    }, 0);
  }

  function getActivePizzaGiftRule(product: Product) {
    if (!selectedPizzaSize) return null;
    return getPizzaGiftRules(product).find((rule) => rule.sizeLabel === selectedPizzaSize) || null;
  }

  function updateExtraDrinkQty(drinkId: string, diff: number) {
    setExtraDrinkQtyById((current) => {
      const nextQty = Math.max(0, (current[drinkId] || 0) + diff);
      if (nextQty === 0) {
        const next = { ...current };
        delete next[drinkId];
        return next;
      }
      return { ...current, [drinkId]: nextQty };
    });
  }

  function getPizzaSelectionSummary(product: Product) {
    const selectedProducts = getSelectedPizzaProducts(product);
    if (selectedProducts.length === 0) return 'Selecione os sabores';
    const border = getSelectedPizzaBorder(product);
    const dough = getSelectedPizzaDough(product);
    const activeGiftRule = getActivePizzaGiftRule(product);
    const flavorSummary = `${getFlavorModeLabel(selectedProducts.length)}: ${selectedProducts
      .map((selectedProduct) => selectedProduct.name)
      .join(' / ')}`;
    const withBorder = border ? `${flavorSummary} • Borda ${border.label}` : flavorSummary;
    const withDough = dough ? `${withBorder} • Massa ${dough.label}` : withBorder;
    if (activeGiftRule) {
      return `${withDough} • Brinde ${activeGiftRule.drinkName} x${activeGiftRule.quantity}`;
    }
    return withDough;
  }

  function getChosenOptions(product: Product) {
    const selected: ProductOption[] = [];
    for (const group of product.optionGroups) {
      const selectedIds = selectedByGroup[group.id] || [];
      for (const option of group.options) {
        if (selectedIds.includes(option.id)) selected.push(option);
      }
    }
    return selected;
  }

  function getRequiredSelectionCount(group: ProductOptionGroup) {
    return group.required ? Math.max(1, Number(group.minSelect || 0)) : Number(group.minSelect || 0);
  }

  function getFirstInvalidOptionGroup(product: Product) {
    if (product.product_type === 'size_based') return null;
    for (const group of product.optionGroups) {
      const selectedCount = (selectedByGroup[group.id] || []).length;
      const requiredCount = getRequiredSelectionCount(group);
      if (requiredCount > 0 && selectedCount < requiredCount) return group;
      if (group.maxSelect > 0 && selectedCount > group.maxSelect) return group;
    }
    return null;
  }

  function isSelectionValid(product: Product) {
    if (product.product_type === 'size_based') {
      const pizzaConfig = getPizzaConfig(product);
      const selectedProducts = getSelectedPizzaProducts(product);
      if (!selectedPizzaSize) return false;
      if (selectedProducts.length === 0) return false;
      if (selectedProducts.length > pizzaConfig.maxFlavors) return false;
      if (!pizzaConfig.allowHalfAndHalf && selectedProducts.length > 1) return false;

      return selectedProducts.every((selectedProduct) =>
        getSizeOptions(selectedProduct).some((size) => size.label === selectedPizzaSize),
      );
    }

    for (const group of product.optionGroups) {
      const selectedCount = (selectedByGroup[group.id] || []).length;
      if (selectedCount < getRequiredSelectionCount(group)) return false;
      if (group.maxSelect > 0 && selectedCount > group.maxSelect) return false;
    }
    return true;
  }

  function togglePizzaFlavor(product: Product, flavorId: string) {
    setMenuActionError(null);
    const pizzaConfig = getPizzaConfig(product);
    setSelectedPizzaFlavorIds((current) => {
      const exists = current.includes(flavorId);
      if (flavorId === product.id) return [product.id];
      if (exists) {
        const next = current.filter((id) => id !== flavorId);
        return next.length > 0 ? next : [product.id];
      }
      if (current.length >= pizzaConfig.maxFlavors) return current;
      return [...current, flavorId];
    });
  }

  function toggleOption(group: ProductOptionGroup, option: ProductOption) {
    setMenuActionError(null);
    setSelectedByGroup((prev) => {
      const current = prev[group.id] || [];
      const exists = current.includes(option.id);
      if (exists) return { ...prev, [group.id]: current.filter((id) => id !== option.id) };
      if (group.maxSelect > 0 && current.length >= group.maxSelect) return prev;
      return { ...prev, [group.id]: [...current, option.id] };
    });
  }

  function selectPromptOption(group: ProductOptionGroup, option: ProductOption) {
    setMenuActionError(null);
    setSelectedByGroup((prev) => {
      const current = prev[group.id] || [];
      const exists = current.includes(option.id);
      if (exists) return prev;
      if (group.maxSelect === 1) {
        return { ...prev, [group.id]: [option.id] };
      }
      if (group.maxSelect > 0 && current.length >= group.maxSelect) {
        return { ...prev, [group.id]: [option.id] };
      }
      return { ...prev, [group.id]: [...current, option.id] };
    });
  }

  function addProductToCart(
    product: Product,
    selectedOptions: ProductOption[],
    notes: string,
    pizzaSelection: PizzaSelection | null = null,
    quantityToAdd = 1,
  ) {
    const key = getCartKey(product.id, selectedOptions, notes, pizzaSelection);
    const itemName = pizzaSelection
      ? `Pizza ${pizzaSelection.sizeLabel} - ${pizzaSelection.flavorNames.join(' / ')}`
      : product.name;
    setCart((prev) => {
      const existing = prev.find((item) => item.key === key);
      if (existing) {
        return prev.map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + quantityToAdd } : item,
        );
      }
      return [
        ...prev,
        {
          key,
          productId: product.id,
          name: itemName,
          basePrice: pizzaSelection ? getPizzaUnitPrice(product) : Number(product.price),
          quantity: quantityToAdd,
          notes: notes.trim(),
          selectedOptions,
          pizzaSelection,
        },
      ];
    });
  }

  function getCustomProductUnitTotal(product: Product) {
    return (
      (product.product_type === 'size_based' ? getPizzaUnitPrice(product) : Number(product.price)) +
      (product.product_type === 'size_based' ? getSelectedPizzaDough(product)?.price || 0 : 0) +
      (product.product_type === 'size_based' ? getSelectedPizzaBorder(product)?.price || 0 : 0) +
      getChosenOptions(product).reduce((sum, option) => sum + option.priceAddition, 0)
    );
  }

  function getCustomProductTotal(product: Product) {
    return getCustomProductUnitTotal(product) * customQuantity + getExtraDrinksSubtotal();
  }

  function handleCustomizeAddClick() {
    if (!customizeProduct) return;
    const invalidGroup = getFirstInvalidOptionGroup(customizeProduct);
    if (invalidGroup) {
      setRequiredOptionPromptGroupId(invalidGroup.id);
      return;
    }
    if (!isSelectionValid(customizeProduct)) {
      setMenuActionError(
        customizeProduct.product_type === 'size_based'
          ? 'Escolha o tamanho e os sabores antes de adicionar.'
          : 'Revise as escolhas obrigatorias antes de adicionar.',
      );
      return;
    }
    addCustomProductToCart();
  }

  function confirmRequiredOptionPrompt() {
    if (!customizeProduct || !requiredOptionPromptGroup) return;
    const selectedCount = (selectedByGroup[requiredOptionPromptGroup.id] || []).length;
    if (selectedCount < getRequiredSelectionCount(requiredOptionPromptGroup)) return;

    const nextInvalidGroup = getFirstInvalidOptionGroup(customizeProduct);
    if (nextInvalidGroup && nextInvalidGroup.id !== requiredOptionPromptGroup.id) {
      setRequiredOptionPromptGroupId(nextInvalidGroup.id);
      return;
    }

    setRequiredOptionPromptGroupId(null);
    if (isSelectionValid(customizeProduct)) {
      addCustomProductToCart();
    }
  }

  function addCustomProductToCart() {
    if (!customizeProduct || !isSelectionValid(customizeProduct)) return;
    const activeGiftRule = getActivePizzaGiftRule(customizeProduct);
    const pizzaSelection =
      customizeProduct.product_type === 'size_based'
        ? {
            sizeLabel: selectedPizzaSize,
            flavorIds: getSelectedPizzaProducts(customizeProduct).map((product) => product.id),
            flavorNames: getSelectedPizzaProducts(customizeProduct).map((product) => product.name),
            borderLabel: getSelectedPizzaBorder(customizeProduct)?.label || null,
            borderPrice: getSelectedPizzaBorder(customizeProduct)?.price || 0,
            doughLabel: getSelectedPizzaDough(customizeProduct)?.label || null,
            doughPrice: getSelectedPizzaDough(customizeProduct)?.price || 0,
            giftDrinkId: null,
            giftDrinkName: activeGiftRule ? activeGiftRule.drinkName : null,
            giftQuantity: activeGiftRule ? activeGiftRule.quantity : 0,
          }
        : null;
    addProductToCart(customizeProduct, getChosenOptions(customizeProduct), customNotes, pizzaSelection, customQuantity);

    const extraDrinkEntries = Object.entries(extraDrinkQtyById).filter(([, qty]) => qty > 0);
    for (const [drinkId, quantity] of extraDrinkEntries) {
      const drinkProduct = products.find((product) => product.id === drinkId);
      if (drinkProduct) {
        addProductToCart(drinkProduct, [], '', null, quantity);
      }
    }

    setCustomizeProduct(null);
    setSelectedByGroup({});
    setRequiredOptionPromptGroupId(null);
    setCustomNotes('');
    setCustomQuantity(1);
    setSelectedPizzaSize('');
    setSelectedPizzaFlavorIds([]);
    setSelectedPizzaBorderLabel('');
    setSelectedPizzaDoughLabel('');
    setExtraDrinkQtyById({});
    setPizzaFlavorPickerOpen(false);
    setPizzaFlavorSearch('');
    setPizzaDrinkPickerOpen(false);
    setPizzaDrinkSearch('');
  }

  function updateCartItemQty(key: string, diff: number) {
    setCart((prev) => prev.map((item) => (item.key === key ? { ...item, quantity: Math.max(0, item.quantity + diff) } : item)).filter((item) => item.quantity > 0));
  }

  function removeCartItem(key: string) {
    setCart((prev) => prev.filter((item) => item.key !== key));
  }

  function openCheckout() {
    if (!cart.length) return;
    if (!tenant?.storeOpen) return;
    checkoutKeyRef.current = createCheckoutKey();
    setCheckoutOpen(true);
    setCheckoutStep('cart');
    setSelectedPaymentMethodId('');
    setChangeFor('');
    setFormError(null);
  }

  function openCheckoutAt(step: CheckoutStep) {
    if (!tenant?.storeOpen) return;
    checkoutKeyRef.current = createCheckoutKey();
    setCheckoutOpen(true);
    setCheckoutStep(step);
    setSelectedPaymentMethodId('');
    setChangeFor('');
    setFormError(null);
  }

  function selectOrderType(nextType: OrderType) {
    setOrderType(nextType);
    setFormError(null);
  }

  function closeCheckout() {
    checkoutKeyRef.current = '';
    setCheckoutOpen(false);
    setCheckoutStep('cart');
    setSelectedPaymentMethodId('');
    setChangeFor('');
    setFormError(null);
    setAddressDeleteTarget(null);
    setAddressDeleteError(null);
  }

  function stepIndex(step: CheckoutStep) {
    return checkoutSteps.indexOf(step);
  }

  function goBackStep() {
    if (checkoutStep === 'cart') return closeCheckout();
    if (checkoutStep === 'success') return;
    const index = stepIndex(checkoutStep);
    if (index > 0) setCheckoutStep(checkoutSteps[index - 1]);
  }

  async function goNextStep() {
    setFormError(null);
    if (!tenant?.storeOpen) {
      return setFormError('Delivery indisponivel no momento. Aguarde o estabelecimento abrir para finalizar o pedido.');
    }
    if (checkoutStep === 'cart') {
      if (!cart.length) return setFormError('Seu carrinho esta vazio.');
      if (portalCustomerMatchesCheckout && customerName.trim() && checkoutPhoneDigits.length >= 10) {
        return setCheckoutStep('address');
      }
      return setCheckoutStep('customer');
    }
    if (checkoutStep === 'customer') {
      if (!customerName.trim() || checkoutPhoneDigits.length < 10) return setFormError('Informe nome e celular valido.');
      if (!portalCustomerMatchesCheckout || !customerLookupFound) {
        try {
          await ensurePortalCustomer();
        } catch (error) {
          return setFormError(error instanceof Error ? error.message : 'Nao foi possivel criar o cadastro do cliente agora.');
        }
      }
      return setCheckoutStep('address');
    }
    if (checkoutStep === 'address') {
      if (orderType === 'delivery' && !effectiveDeliveryAddress.trim()) {
        return setFormError('Informe o endereco para entrega.');
      }
      if (usingNewAddress && !addressForm.street.trim()) {
        return setFormError('Informe ao menos a rua do novo endereco.');
      }
      if (usingNewAddress && !addressForm.number.trim()) {
        return setFormError('Informe o numero da casa antes de continuar.');
      }
      if (!usingNewAddress && selectedSavedAddress && !String(selectedSavedAddress.number || '').trim()) {
        return setFormError('O endereco salvo selecionado precisa ter numero. Cadastre um novo endereco ou escolha outro.');
      }
      if (needsDeliveryDistanceQuote && !deliveryAddressReadyForQuote) {
        return setFormError(
          usingNewAddress
            ? 'Para calcular a entrega, informe rua, numero e cidade/UF ou CEP.'
            : 'O endereco salvo precisa de cidade/UF ou CEP para calcular a entrega. Cadastre um novo endereco completo.',
        );
      }
      if (needsDeliveryDistanceQuote && deliveryFeeLoading) {
        return setFormError('Aguarde o calculo da entrega antes de continuar.');
      }
      if (deliveryBlockedByDistance) {
        return setFormError(deliveryFeeQuote?.deliveryUnavailableReason || 'Endereco fora da area de entrega da loja.');
      }
      if (deliveryMinimumMissing) {
        return setFormError(
          `Pedido minimo para entrega: ${brl(deliveryMinOrderAmount)}. Faltam ${brl(deliveryMinimumRemaining)}.`,
        );
      }
      if (availablePaymentMethods.length === 0) {
        return setFormError('A loja ainda nao configurou formas de pagamento para este cardapio.');
      }
      return setCheckoutStep('payment');
    }
    if (checkoutStep === 'payment') {
      if (!selectedPaymentMethod) {
        return setFormError('Selecione uma forma de pagamento para continuar.');
      }
      if (
        selectedPaymentMethod.methodType === 'cash' &&
        changeFor.trim() &&
        (!Number.isFinite(parsedChangeForAmount) || parsedChangeForAmount < 0)
      ) {
        return setFormError('Informe um valor valido para troco.');
      }
      if (selectedPaymentMethod.methodType === 'cash' && parsedChangeForAmount > 0 && parsedChangeForAmount < total) {
        return setFormError('Troco deve ser maior ou igual ao total.');
      }
      setCheckoutStep('review');
    }
  }

  async function submitOrder() {
    if (!tenantSlug || submitting) return;
    if (!tenant?.storeOpen) {
      setFormError('Delivery indisponivel no momento. Aguarde o estabelecimento abrir para finalizar o pedido.');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      if (!selectedPaymentMethod?.id) {
        setFormError(
          availablePaymentMethods.length > 0
            ? 'Selecione uma forma de pagamento para continuar.'
            : 'A loja ainda nao configurou formas de pagamento para este cardapio.',
        );
        return;
      }
      if (usingNewAddress && !addressForm.street.trim()) {
        setFormError('Informe ao menos a rua do novo endereco.');
        return;
      }
      if (usingNewAddress && !addressForm.number.trim()) {
        setFormError('Informe o numero da casa antes de continuar.');
        return;
      }
      if (!usingNewAddress && selectedSavedAddress && !String(selectedSavedAddress.number || '').trim()) {
        setFormError('O endereco salvo selecionado precisa ter numero. Cadastre um novo endereco ou escolha outro.');
        return;
      }
      if (needsDeliveryDistanceQuote && !deliveryAddressReadyForQuote) {
        setFormError(
          usingNewAddress
            ? 'Para calcular a entrega, informe rua, numero e cidade/UF ou CEP.'
            : 'O endereco salvo precisa de cidade/UF ou CEP para calcular a entrega. Cadastre um novo endereco completo.',
        );
        return;
      }
      if (needsDeliveryDistanceQuote && deliveryFeeLoading) {
        setFormError('Aguarde o calculo da entrega antes de finalizar.');
        return;
      }
      if (deliveryBlockedByDistance) {
        setFormError(deliveryFeeQuote?.deliveryUnavailableReason || 'Endereco fora da area de entrega da loja.');
        return;
      }
      if (deliveryMinimumMissing) {
        setFormError(
          `Pedido minimo para entrega: ${brl(deliveryMinOrderAmount)}. Faltam ${brl(deliveryMinimumRemaining)}.`,
        );
        return;
      }
      if (
        selectedPaymentMethod.methodType === 'cash' &&
        changeFor.trim() &&
        (!Number.isFinite(parsedChangeForAmount) || parsedChangeForAmount < 0)
      ) {
        setFormError('Informe um valor valido para troco.');
        return;
      }
      if (selectedPaymentMethod.methodType === 'cash' && parsedChangeForAmount > 0 && parsedChangeForAmount < total) {
        setFormError('Troco deve ser maior ou igual ao total.');
        return;
      }
      const checkoutKey = checkoutKeyRef.current || createCheckoutKey();
      checkoutKeyRef.current = checkoutKey;
      const { response, data } = await requestJson<{
        error?: string;
        orderId?: string;
        trackingToken?: string;
        trackingUrl?: string;
        total?: number;
        deliveryFeeAmount?: number;
      }>(`/api/public/checkout/${tenantSlug}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        timeoutMs: CHECKOUT_TIMEOUT_MS,
        retries: 1,
        body: JSON.stringify({
          checkoutKey,
          customerName,
          customerPhone,
          customerEmail,
          customerIsCompany,
          customerCompanyName,
          customerDocumentNumber,
          orderType,
          deliveryAddress:
            orderType === 'delivery'
              ? !usingNewAddress && selectedSavedAddressId
                ? effectiveDeliveryAddress
                : ''
              : '',
          selectedAddressId: orderType === 'delivery' && !usingNewAddress ? selectedSavedAddressId : '',
          address:
            orderType === 'delivery' && usingNewAddress
              ? {
                  label: addressForm.label,
                  street: addressForm.street,
                  number: addressForm.number,
                  complement: addressForm.complement,
                  neighborhood: addressForm.neighborhood,
                  city: addressForm.city,
                  state: addressForm.state,
                  zipCode: addressForm.zipCode,
                  reference: addressForm.reference,
                }
              : null,
          paymentMethod: selectedPaymentMethod.methodType,
          paymentMethodId: selectedPaymentMethod.id,
          changeFor: selectedPaymentMethod.methodType === 'cash' ? parsedChangeForAmount : 0,
          items: cart.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            selectedOptionIds: item.selectedOptions.map((option) => option.id),
            notes: item.notes,
            pizzaSelection: item.pizzaSelection
              ? {
                  sizeLabel: item.pizzaSelection.sizeLabel,
                  flavorIds: item.pizzaSelection.flavorIds,
                  borderLabel: item.pizzaSelection.borderLabel,
                  doughLabel: item.pizzaSelection.doughLabel,
                  giftDrinkId: item.pizzaSelection.giftDrinkId,
                }
              : null,
          })),
        }),
      });
      if (!response.ok || !data) {
        return setFormError(data?.error || 'Nao foi possivel finalizar o pedido.');
      }

      const currentDeliveryFee =
        orderType === 'delivery'
          ? Number(data.deliveryFeeAmount ?? deliveryFeeQuote?.deliveryFeeAmount ?? tenant?.deliveryFeeBase ?? 0)
          : 0;
      const currentSubtotal = subtotal;
      const currentTotal = Number(data.total ?? currentSubtotal + currentDeliveryFee);
      const currentChangeFor = selectedPaymentMethod.methodType === 'cash' ? parsedChangeForAmount : 0;
      const trackingToken = String(data.trackingToken || '').trim();
      const trackingUrl = String(data.trackingUrl || (trackingToken ? `/acompanhar/${encodeURIComponent(trackingToken)}` : '')).trim();
      setSubmittedSnapshot({
        orderId: String(data.orderId || ''),
        trackingUrl,
        createdAtIso: new Date().toISOString(),
        customerName,
        customerPhone,
        orderType,
        deliveryAddress: effectiveDeliveryAddress,
        paymentMethodLabel: selectedPaymentMethod.name,
        changeFor: currentChangeFor,
        subtotal: currentSubtotal,
        deliveryFee: currentDeliveryFee,
        total: currentTotal,
        items: cart.map((item) => ({
          name: item.selectedOptions.length > 0
            ? `${item.name} (${item.selectedOptions.map((option) => option.name).join(', ')})`
            : item.name,
          quantity: item.quantity,
          unitPrice:
            item.basePrice +
            item.selectedOptions.reduce((sum, option) => sum + option.priceAddition, 0) +
            (item.pizzaSelection?.borderPrice || 0) +
            (item.pizzaSelection?.doughPrice || 0),
          notes: item.notes,
        })),
      });

      try {
        const refreshedPortal = await syncPortalByPhone(customerPhone, true, { includeOrders: true });
        if (!refreshedPortal && !portalCustomer) {
          setPortalCustomer({
            id: normalizePhone(customerPhone),
            name: customerName,
            phone: normalizePhone(customerPhone),
            email: customerEmail || null,
          });
        }
      } catch {
        if (!portalCustomer) {
          setPortalCustomer({
            id: normalizePhone(customerPhone),
            name: customerName,
            phone: normalizePhone(customerPhone),
            email: customerEmail || null,
          });
        }
      }

      setOrderId(String(data.orderId || ''));
      setCheckoutStep('success');
      setCart([]);
      checkoutKeyRef.current = '';
    } catch {
      setFormError('Falha de conexao ao enviar. Tente novamente; se o pedido ja entrou, o sistema nao duplica.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <main className="min-h-screen grid place-items-center text-slate-500">Carregando cardapio...</main>;
  if (!tenant) return <main className="min-h-screen grid place-items-center text-slate-500">Empresa nao encontrada.</main>;

  return (
    <main className="min-h-screen bg-slate-100 pb-28">
      <section className="relative h-60 md:h-72">
        <AppImage src={heroImage} alt={tenant.name} fill priority sizes="100vw" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-black/45" />
        <div className="relative max-w-6xl mx-auto h-full px-4">
          <div className="absolute top-5 right-4 flex items-center gap-4 text-white">
            {portalCustomer ? (
              <div className="relative">
                <button
                  onClick={() => setProfileMenuOpen((current) => !current)}
                  className="flex items-center gap-2 font-semibold"
                >
                  <UserCircle2 className="w-5 h-5" />
                  <span>{`Ola, ${portalCustomer.name}`}</span>
                  <ChevronDown className="w-4 h-4" />
                </button>
                {profileMenuOpen ? (
                  <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white text-slate-800 shadow-xl overflow-hidden">
                    <button
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setActiveTopTab('portal');
                      }}
                      className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-slate-50 flex items-center gap-2"
                    >
                      <PackageCheck className="w-4 h-4 text-slate-400" />
                      Pedidos
                    </button>
                    <button
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setPortalError(null);
                        setPortalNameInput(portalCustomer.name || customerName || '');
                        setPortalPhoneInput(portalCustomer.phone ? maskPhone(portalCustomer.phone) : customerPhone || '');
                        setPortalOpen(true);
                      }}
                      className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-slate-50 flex items-center gap-2"
                    >
                      <UserCircle2 className="w-4 h-4 text-slate-400" />
                      Informacoes basicas
                    </button>
                    <button
                      onClick={() => {
                        setProfileMenuOpen(false);
                        openCheckoutAt('address');
                      }}
                      className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-slate-50 flex items-center gap-2"
                    >
                      <MapPinned className="w-4 h-4 text-slate-400" />
                      Enderecos de Entrega
                    </button>
                    <button
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setActiveTopTab('about');
                      }}
                      className="w-full px-3 py-2 text-left text-sm font-medium hover:bg-slate-50 flex items-center gap-2"
                    >
                      <Gift className="w-4 h-4 text-slate-400" />
                      Meus Pontos
                    </button>
                    <button
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setPortalCustomer(null);
                        setPortalOrders([]);
                        setPortalNameInput('');
                        setPortalPhoneInput('');
                        setActiveTopTab('products');
                      }}
                      className="w-full px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      Sair
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <button
                onClick={() => {
                  setPortalError(null);
                  setPortalNameInput(customerName || '');
                  setPortalPhoneInput(customerPhone || '');
                  setPortalOpen(true);
                }}
                className="flex items-center gap-2 font-semibold"
              >
                <LogIn className="w-5 h-5" />
                <span>Entre ou Cadastre</span>
              </button>
            )}
            <button
              onClick={openCheckout}
              disabled={!tenant.storeOpen}
              className={cn('relative', !tenant.storeOpen ? 'opacity-50 cursor-not-allowed' : '')}
              title={!tenant.storeOpen ? 'Delivery indisponivel no momento.' : 'Abrir checkout'}
            >
              <ShoppingCart className="w-6 h-6" />
              {cartItemsCount > 0 ? <span className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-rose-500 text-white text-[10px] grid place-items-center font-bold">{cartItemsCount}</span> : null}
            </button>
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 -mt-16 relative z-10">
        <div className="bg-white rounded-xl border border-slate-200 p-4 md:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
            <div className="w-28 h-28 md:w-36 md:h-36 rounded-xl bg-slate-100 overflow-hidden shrink-0 border border-slate-200">
              {tenant.logoUrl ? (
                <AppImage src={tenant.logoUrl} alt={`${tenant.name} logo`} width={144} height={144} sizes="144px" priority className="h-full w-full object-cover" />
              ) : products[0]?.image_url ? (
                <AppImage src={products[0].image_url} alt={tenant.name} width={144} height={144} sizes="144px" priority className="h-full w-full object-cover" />
              ) : (
                <div className="w-full h-full grid place-items-center text-slate-400 text-xs">LOGO</div>
              )}
            </div>
            <div className="flex-1">
              <h1 className="text-3xl font-extrabold text-slate-900 leading-tight">{tenant.name}</h1>
              <p className="text-sm text-slate-600 mt-1">{tenantAddressLine || tenant.slug}</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6 text-sm">
                <div>
                  <p className="text-slate-500 flex items-center gap-2"><Clock3 className="w-4 h-4" /> Tempo de entrega hoje</p>
                  <p className="font-bold text-slate-900">{tenant.prepTimeMinutes || 40} minutos</p>
                  {deliveryMinOrderAmount > 0 ? (
                    <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 shadow-sm">
                      <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">Pedido minimo para entrega</span>
                      <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-rose-800 shadow-sm">
                        {brl(deliveryMinOrderAmount)}
                      </span>
                    </div>
                  ) : null}
                </div>
                <div>
                  <p className="text-slate-500 flex items-center gap-2"><Bike className="w-4 h-4" /> Taxa de entrega</p>
                  <p className="font-bold text-slate-900">
                    {tenant.deliveryFeeMode === 'distance_table' && tenant.deliveryFeeTable?.length
                      ? `A partir de ${brl(Number(tenant.deliveryFeeTable[0]?.fee || tenant.deliveryFeeBase || 0))}`
                      : tenant.deliveryFeeMode === 'per_km'
                      ? `${brl(Number(tenant.deliveryFeeBase || 0))} minimo • ${brl(Number(tenant.deliveryFeePerKm || 0))}/km`
                      : `A partir de ${brl(Number(tenant.deliveryFeeBase || 0))}`}
                  </p>
                  {Number(tenant.deliveryMaxDistanceKm || 0) > 0 ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Entrega ate {formatDistanceMeters(Math.round(Number(tenant.deliveryMaxDistanceKm || 0) * 1000))}.
                    </p>
                  ) : tenant.deliveryFeeMode === 'distance_table' && tenant.deliveryFeeTable?.length ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Ate {formatDistanceMeters(tenant.deliveryFeeTable.at(-1)?.upToMeters || 0)} por faixa.
                    </p>
                  ) : null}
                </div>
                <div>
                  <p className="text-slate-500 flex items-center gap-2"><Store className="w-4 h-4" /> Status</p>
                  <p className={cn('font-bold', tenant.storeOpen ? 'text-emerald-700' : 'text-rose-600')}>
                    {tenant.storeOpen ? 'Aberto agora' : 'Fechado no momento'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {menuStories.length > 0 ? (
        <section className="max-w-6xl mx-auto px-4 mt-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Destaques da loja</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900">Stories no topo do catalogo</h2>
              </div>
              <span className="rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-600">
                {menuStories.length} ativo(s)
              </span>
            </div>
            <div className="mt-4 flex gap-4 overflow-x-auto pb-1">
              {menuStories.map((story) => (
                <button
                  key={story.id}
                  onClick={() => setActiveStory(story)}
                  className="group flex min-w-[92px] flex-col items-center text-center"
                >
                  <div className="relative h-20 w-20 overflow-hidden rounded-full border-2 border-rose-200 p-1 transition group-hover:border-rose-400">
                    <div className="relative h-full w-full overflow-hidden rounded-full bg-slate-100">
                      <AppImage
                        src={story.imageUrl}
                        alt={story.title}
                        fill
                        sizes="80px"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    </div>
                  </div>
                  <span className="mt-2 line-clamp-2 text-xs font-semibold text-slate-700">{story.title}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="max-w-6xl mx-auto px-4 mt-5">
        <div className="border-b border-slate-200 flex items-center gap-6 text-sm font-semibold">
          {([portalCustomer ? 'portal' : null, 'products', 'contact', 'about'].filter(Boolean) as TopTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTopTab(tab)}
              className={cn('py-3 border-b-2 transition-colors', activeTopTab === tab ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500')}
            >
              {tab === 'portal' ? 'Meu portal' : tab === 'products' ? 'Produtos' : tab === 'contact' ? 'Contato' : 'Sobre'}
            </button>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-4 pt-4">
        {activeTopTab === 'products' ? (
          <>
            <div className="grid md:grid-cols-[280px_1fr] gap-3">
              <select value={activeCategory} onChange={(e) => setActiveCategory(e.target.value)} className="border border-slate-200 bg-white rounded-lg px-4 py-3 text-sm text-slate-700">
                <option value="all">Ver Todas Categorias</option>
                {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar Produtos" className="w-full border border-slate-200 bg-white rounded-lg pl-10 pr-4 py-3 text-sm" />
              </div>
            </div>
            {menuActionError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {menuActionError}
              </div>
            ) : null}
            {productPageError ? (
              <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                {productPageError}
              </div>
            ) : null}
            {productPageLoadingMode === 'replace' ? (
              <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-700">
                Atualizando produtos...
              </div>
            ) : null}
            <div className="space-y-6 mt-5">
              {productsByCategory.map(({ category, items }) => (
                <section key={category.id}>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
                    <h2 className="text-3xl font-extrabold text-slate-900">{category.name}</h2>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {items.map((product) => (
                      <div
                        key={product.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => void openCustomize(product)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void openCustomize(product);
                          }
                        }}
                        className="flex cursor-pointer overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-rose-200 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-rose-200"
                      >
                        <div className="w-28 h-28 bg-slate-100 shrink-0">
                          {product.image_url ? <AppImage src={product.image_url} alt={product.name} width={112} height={112} sizes="112px" className="h-full w-full object-cover" /> : <div className="w-full h-full grid place-items-center text-slate-400 text-xs">Sem imagem</div>}
                        </div>
                        <div className="flex-1 p-3 flex flex-col">
                          <h3 className="font-bold text-slate-900 text-2xl leading-none">{product.name}</h3>
                          <p className="text-sm text-slate-500 line-clamp-2 mt-1">{product.description || 'Sem descricao'}</p>
                          {product.product_type === 'size_based' ? (
                            <span className="mt-2 inline-flex w-fit rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                              Pizza por tamanho
                            </span>
                          ) : null}
                          <div className="mt-auto flex items-center justify-between">
                            <strong className="text-slate-900 text-xl">{getProductCardPrice(product)}</strong>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
              {totalFilteredProducts === 0 ? <p className="text-sm text-slate-500">Nenhum produto encontrado.</p> : null}
              {hasMoreProducts ? (
                <div className="flex justify-center pt-2">
                  <button
                    type="button"
                    onClick={() => void loadProductPage('append', products.length)}
                    disabled={Boolean(productPageLoadingMode)}
                    className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:cursor-wait disabled:opacity-60"
                  >
                    {productPageLoadingMode === 'append'
                      ? 'Carregando...'
                      : `Mostrar mais produtos (${totalFilteredProducts - renderedProductsCount})`}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}

        {activeTopTab === 'portal' ? (
          portalCustomer ? (
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Portal do cliente</p>
                <h2 className="mt-2 text-2xl font-extrabold text-slate-900">{portalCustomer.name}</h2>
                <p className="mt-1 text-sm text-slate-500">{maskPhone(portalCustomer.phone)}</p>
                <p className="text-sm text-slate-500">{portalCustomer.email || 'Sem e-mail cadastrado'}</p>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-slate-500">Enderecos</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{savedAddresses.length}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="text-slate-500">Pedidos</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{portalOrders.length}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <button
                    onClick={() => setActiveTopTab('products')}
                    className="w-full rounded-xl bg-rose-500 px-4 py-3 text-sm font-bold text-white"
                  >
                    Fazer novo pedido
                  </button>
                  <button
                    onClick={() => openCheckoutAt('address')}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700"
                  >
                    Gerenciar enderecos
                  </button>
                </div>
                <p className="mt-4 text-xs text-slate-500">
                  Atualizamos este portal automaticamente. Se a loja estiver com o WhatsApp ativo, voce tambem recebe avisos por la.
                </p>
              </div>

              <div className="space-y-4">
                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-400">Ultima atualizacao</p>
                      <h3 className="mt-1 text-lg font-bold text-slate-900">
                        {latestPortalOrder ? `Pedido #${latestPortalOrder.id.slice(0, 8).toUpperCase()}` : 'Nenhum pedido ainda'}
                      </h3>
                    </div>
                    {portalSyncing ? <span className="text-xs font-semibold text-sky-600">Atualizando...</span> : null}
                  </div>

                  {latestPortalOrder ? (
                    <div className="mt-4 space-y-3">
                      <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-bold', orderStatusTone(latestPortalOrder.status))}>
                        {orderStatusLabel(latestPortalOrder.status)}
                      </span>
                      <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-2">
                        <p><strong className="text-slate-900">Tipo:</strong> {orderTypeLabel(latestPortalOrder.type)}</p>
                        <p><strong className="text-slate-900">Total:</strong> {brl(latestPortalOrder.total)}</p>
                        <p><strong className="text-slate-900">Data:</strong> {formatBusinessDateTime(latestPortalOrder.createdAt)}</p>
                        <p><strong className="text-slate-900">Pagamento:</strong> {formatPaymentMethodLabel(latestPortalOrder.paymentMethod)}</p>
                      </div>
                      {latestPortalOrder.deliveryAddress ? (
                        <p className="text-sm text-slate-600">
                          <strong className="text-slate-900">Endereco:</strong> {latestPortalOrder.deliveryAddress}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-slate-500">Assim que voce fizer o primeiro pedido, ele aparece aqui com o status atualizado.</p>
                  )}
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                  <h3 className="text-lg font-bold text-slate-900">Historico recente</h3>
                  <p className="mt-1 text-sm text-slate-500">Seus ultimos pedidos neste cardapio.</p>
                  <div className="mt-4 space-y-3">
                    {portalOrders.length === 0 ? (
                      <p className="text-sm text-slate-500">Nenhum pedido encontrado ainda.</p>
                    ) : (
                      portalOrders.map((order) => (
                        <div key={order.id} className="rounded-xl border border-slate-200 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="font-bold text-slate-900">Pedido #{order.id.slice(0, 8).toUpperCase()}</p>
                              <p className="text-xs text-slate-500">{formatBusinessDateTime(order.createdAt)}</p>
                            </div>
                            <span className={cn('inline-flex rounded-full border px-3 py-1 text-xs font-bold', orderStatusTone(order.status))}>
                              {orderStatusLabel(order.status)}
                            </span>
                          </div>
                          <p className="mt-2 text-sm text-slate-600">
                            <strong className="text-slate-900">Tipo:</strong> {orderTypeLabel(order.type)} | <strong className="text-slate-900">Total:</strong> {brl(order.total)}
                          </p>
                          {order.itemsSummary ? <p className="mt-2 text-sm text-slate-500">{order.itemsSummary}</p> : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm text-sm text-slate-600">
              <p className="font-semibold text-slate-900 mb-2">Entre no seu portal</p>
              <p>Informe nome e celular para recuperar seus enderecos e acompanhar seus pedidos.</p>
              <button
                onClick={() => setPortalOpen(true)}
                className="mt-4 rounded-xl bg-rose-500 px-4 py-2 font-semibold text-white"
              >
                Entrar ou cadastrar
              </button>
            </div>
          )
        ) : null}

        {activeTopTab === 'contact' ? (
          <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600">
            <p className="font-semibold text-slate-900 mb-2">Contato da loja</p>
            <p>WhatsApp: {tenant.whatsappPhone || 'Nao configurado'}</p>
            <p>Base da loja: {tenantAddressLine || 'Endereco do emitente nao configurado'}</p>
          </div>
        ) : null}
      {activeTopTab === 'about' ? <div className="bg-white border border-slate-200 rounded-xl p-6 text-sm text-slate-600"><p className="font-semibold text-slate-900 mb-2">Sobre {tenant.name}</p><p>Cardapio online com pedido rapido e checkout completo.</p></div> : null}
      </section>

      {activeStory ? (
        <div className="fixed inset-0 z-50 bg-black/70 p-4">
          <div className="mx-auto flex h-full max-w-lg items-center justify-center">
            <div className="w-full overflow-hidden rounded-[28px] border border-white/10 bg-white shadow-2xl">
              <div className="relative h-[420px] bg-slate-950">
                <AppImage
                  src={activeStory.imageUrl}
                  alt={activeStory.title}
                  fill
                  sizes="(max-width: 768px) 100vw, 540px"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/10" />
                <button
                  onClick={() => setActiveStory(null)}
                  className="absolute right-3 top-3 rounded-full bg-black/40 p-2 text-white backdrop-blur-sm transition hover:bg-black/55"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/75">Story da loja</p>
                  <h3 className="mt-2 text-2xl font-extrabold leading-tight">{activeStory.title}</h3>
                  {activeStory.subtitle ? <p className="mt-2 text-sm text-white/85">{activeStory.subtitle}</p> : null}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 bg-white px-5 py-4 text-sm text-slate-500">
                <span>{activeStory.expiresAt ? `Valido ate ${formatBusinessDateTime(activeStory.expiresAt)}` : 'Sem expiracao definida'}</span>
                <button
                  onClick={() => setActiveStory(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {portalOpen ? (
        <div className="fixed inset-0 z-50 bg-black/50 p-3 overflow-y-auto">
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Entre ou Cadastre</h3>
                <p className="text-xs text-slate-500">
                  Se seu celular ja estiver cadastrado, entramos direto. Se ainda nao existir, basta informar o nome para criar agora.
                </p>
              </div>
              <button onClick={() => setPortalOpen(false)} className="p-2 rounded-lg hover:bg-slate-100">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">Nome</label>
                <input
                  value={portalNameInput}
                  onChange={(e) => setPortalNameInput(e.target.value)}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Seu nome"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Celular</label>
                <input
                  value={portalPhoneInput}
                  onChange={(e) => setPortalPhoneInput(maskPhone(e.target.value))}
                  className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="(00) 00000-0000"
                />
              </div>
              {portalError ? <p className="text-sm text-rose-600">{portalError}</p> : null}
              <button
                onClick={submitPortalAuth}
                disabled={portalSaving}
                className="w-full rounded-xl bg-rose-500 py-3 text-white font-bold disabled:opacity-60"
              >
                {portalSaving ? 'Entrando...' : 'Entrar / Cadastrar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {customizeProduct ? (
        <div className="fixed inset-0 z-40 bg-black/50 p-3 overflow-y-auto">
          <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-2xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Detalhes do item</p>
                <h3 className="font-bold text-slate-900">{customizeProduct.name}</h3>
              </div>
              <button
                onClick={() => {
                  setCustomizeProduct(null);
                  setRequiredOptionPromptGroupId(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <section className="grid gap-4 md:grid-cols-[1fr_240px] md:items-start">
                <div className="rounded-xl border border-slate-200 border-l-4 border-l-sky-400 bg-white p-4">
                  <h4 className="text-lg font-black leading-tight text-slate-900">{customizeProduct.name}</h4>
                  <p className="mt-3 whitespace-pre-line text-sm leading-6 text-slate-700">
                    {customizeProduct.description || 'Sem descricao cadastrada para este item.'}
                  </p>
                </div>
                <div className="relative h-44 overflow-hidden rounded-xl bg-slate-100 md:h-40">
                  {customizeProduct.image_url ? (
                    <AppImage
                      src={customizeProduct.image_url}
                      alt={customizeProduct.name}
                      fill
                      sizes="(min-width: 768px) 240px, 100vw"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center text-xs font-semibold text-slate-400">Sem imagem</div>
                  )}
                </div>
              </section>

              {customizeProduct.product_type === 'size_based' ? (
                <section className="border border-slate-200 rounded-xl p-3 space-y-4">
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-sm font-semibold text-amber-900">Monte sua pizza</p>
                    <p className="mt-1 text-xs text-amber-800">
                      Escolha o tamanho primeiro e depois combine os sabores. O sistema calcula pelo maior preco dos sabores selecionados.
                    </p>
                  </div>

                  <div>
                    <p className="font-semibold text-slate-900">Escolha o tamanho</p>
                    <div className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-2">
                      {getSizeOptions(customizeProduct).map((size) => (
                        <button
                          key={size.label}
                          onClick={() => setSelectedPizzaSize(size.label)}
                          className={cn(
                            'rounded-lg border px-3 py-2 text-sm text-left',
                            selectedPizzaSize === size.label ? 'border-rose-400 bg-rose-50' : 'border-slate-200',
                          )}
                        >
                          <span className="block font-semibold text-slate-900">{size.label}</span>
                          <span className="text-xs text-slate-500">{brl(size.price)}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="font-semibold text-slate-900">Escolha o sabor</p>
                    <p className="text-xs text-slate-500">
                      {getPizzaConfig(customizeProduct).allowHalfAndHalf
                        ? `Voce pode combinar ate ${getPizzaConfig(customizeProduct).maxFlavors} sabores. No meio a meio usamos o maior preco do tamanho escolhido.`
                        : 'Esta pizza trabalha com um sabor por item.'}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {Array.from({ length: getPizzaConfig(customizeProduct).maxFlavors }, (_, index) => index + 1).map((count) => {
                        const disabled = count > 1 && !getPizzaConfig(customizeProduct).allowHalfAndHalf;
                        return (
                          <div
                            key={count}
                            className={cn(
                              'rounded-full border px-3 py-1 text-xs font-semibold',
                              selectedPizzaFlavorIds.length === count
                                ? 'border-rose-400 bg-rose-50 text-rose-700'
                                : 'border-slate-200 bg-white text-slate-500',
                              disabled ? 'opacity-40' : '',
                            )}
                          >
                            {getFlavorModeLabel(count)}
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                      <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Sabores selecionados</p>
                      <div className="flex flex-wrap gap-2">
                        {getSelectedPizzaProducts(customizeProduct).map((flavor) => (
                          <span
                            key={flavor.id}
                            className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700"
                          >
                            {flavor.name}
                          </span>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          onClick={() => setPizzaFlavorPickerOpen(true)}
                          className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                        >
                          Abrir selecao de sabores (tela cheia)
                        </button>
                        {selectedPizzaFlavorIds.length > 1 ? (
                          <button
                            onClick={() => setSelectedPizzaFlavorIds([customizeProduct.id])}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
                          >
                            Voltar para 1 sabor
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {getActivePizzaGiftRule(customizeProduct) ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                      <p className="font-semibold text-emerald-900">Brinde da sua pizza</p>
                      <p className="text-xs text-emerald-800">
                        Para pizza {selectedPizzaSize}, voce recebe automaticamente{' '}
                        {getActivePizzaGiftRule(customizeProduct)?.quantity}x{' '}
                        {getActivePizzaGiftRule(customizeProduct)?.drinkName}.
                      </p>
                    </div>
                  ) : null}

                  {getBeverageProducts().length > 0 ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 space-y-2">
                      <p className="font-semibold text-slate-900">Adicionar mais refrigerante</p>
                      <p className="text-xs text-slate-500">Abra a selecao dedicada para escolher bebidas extras sem carregar esta tela.</p>
                      <button
                        onClick={() => setPizzaDrinkPickerOpen(true)}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
                      >
                        Abrir selecao de refrigerantes
                      </button>
                      {getSelectedExtraDrinksSummary().length > 0 ? (
                        <p className="text-xs text-slate-600">
                          Selecionados: <strong>{getSelectedExtraDrinksSummary().join(' • ')}</strong>
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Resumo da pizza</p>
                    <p className="mt-2 text-sm font-semibold text-slate-900">{getPizzaSelectionSummary(customizeProduct)}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedPizzaSize ? `Tamanho ${selectedPizzaSize}` : 'Selecione um tamanho'} • Total base {brl(getPizzaUnitPrice(customizeProduct))}
                    </p>
                  </div>

                  {getPizzaDoughs(customizeProduct).length > 0 ? (
                    <div>
                      <p className="font-semibold text-slate-900">Escolha a massa</p>
                      <p className="text-xs text-slate-500">A massa pode ter acrescimo ou nao, conforme configuracao da loja.</p>
                      <div className="mt-2 grid md:grid-cols-2 gap-2">
                        {getPizzaDoughs(customizeProduct).map((dough) => (
                          <button
                            key={dough.label}
                            onClick={() => setSelectedPizzaDoughLabel(dough.label)}
                            className={cn(
                              'rounded-lg border px-3 py-3 text-left',
                              selectedPizzaDoughLabel === dough.label
                                ? 'border-rose-400 bg-rose-50'
                                : 'border-slate-200',
                            )}
                          >
                            <span className="block font-semibold text-slate-900">{dough.label}</span>
                            <span className="text-xs text-slate-500">
                              {dough.price > 0 ? `+ ${brl(dough.price)}` : 'Sem acrescimo'}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {getPizzaBorders(customizeProduct).length > 0 ? (
                    <div>
                      <p className="font-semibold text-slate-900">Escolha a borda</p>
                      <p className="text-xs text-slate-500">Opcional. Se nao quiser borda recheada, deixe sem selecionar.</p>
                      <div className="mt-2 grid md:grid-cols-2 gap-2">
                        <button
                          onClick={() => setSelectedPizzaBorderLabel('')}
                          className={cn(
                            'rounded-lg border px-3 py-3 text-left',
                            selectedPizzaBorderLabel === '' ? 'border-rose-400 bg-rose-50' : 'border-slate-200',
                          )}
                        >
                          <span className="block font-semibold text-slate-900">Sem borda recheada</span>
                          <span className="text-xs text-slate-500">Sem acrescimo</span>
                        </button>
                        {getPizzaBorders(customizeProduct).map((border) => (
                          <button
                            key={border.label}
                            onClick={() => setSelectedPizzaBorderLabel(border.label)}
                            className={cn(
                              'rounded-lg border px-3 py-3 text-left',
                              selectedPizzaBorderLabel === border.label
                                ? 'border-rose-400 bg-rose-50'
                                : 'border-slate-200',
                            )}
                          >
                            <span className="block font-semibold text-slate-900">{border.label}</span>
                            <span className="text-xs text-slate-500">+ {brl(border.price)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {customizeProduct.optionGroups.length > 0 ? customizeProduct.optionGroups.map((group) => (
                <section key={group.id} className="border border-slate-200 rounded-xl p-3">
                  <header className="mb-2">
                    <p className="font-semibold text-slate-900">{group.name}</p>
                    <p className="text-xs text-slate-500">{group.required ? 'Obrigatorio' : 'Opcional'} • Min {group.minSelect} • Max {group.maxSelect > 0 ? group.maxSelect : 'livre'}</p>
                  </header>
                  <div className="space-y-2">
                    {group.options.map((option) => {
                      const checked = (selectedByGroup[group.id] || []).includes(option.id);
                      return (
                        <button
                          key={option.id}
                          onClick={() => toggleOption(group, option)}
                          className={cn(
                            'w-full rounded-lg border px-3 py-2 text-sm',
                            checked ? 'border-rose-400 bg-rose-50' : 'border-slate-200',
                          )}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-3">
                              {option.imageUrl ? (
                                <div className="relative h-12 w-12 overflow-hidden rounded-xl border border-slate-200 bg-white">
                                  <AppImage
                                    src={option.imageUrl}
                                    alt={option.name}
                                    fill
                                    sizes="48px"
                                    className="absolute inset-0 h-full w-full object-cover"
                                  />
                                </div>
                              ) : null}
                              <div className="min-w-0 text-left">
                                <span className="block truncate font-medium text-slate-900">{option.name}</span>
                                <span className="text-xs text-slate-500">
                                  {option.imageUrl ? 'Complemento com foto' : 'Complemento do produto'}
                                </span>
                              </div>
                            </div>
                            <strong className="shrink-0 text-slate-900">+ {brl(option.priceAddition)}</strong>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )) : null}

              <div>
                <label className="text-sm font-semibold text-slate-700">Algum comentario?</label>
                <textarea value={customNotes} onChange={(e) => setCustomNotes(e.target.value)} className="w-full mt-1 border border-slate-200 rounded-lg px-3 py-2 text-sm" rows={2} placeholder="Ex: sem cebola, molho a parte..." />
              </div>
              {menuActionError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                  {menuActionError}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCustomQuantity((current) => Math.max(1, current - 1))}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-rose-500"
                  aria-label="Diminuir quantidade"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="grid h-10 min-w-10 place-items-center rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-900">
                  {customQuantity}
                </span>
                <button
                  type="button"
                  onClick={() => setCustomQuantity((current) => Math.min(99, current + 1))}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-slate-200 text-rose-500"
                  aria-label="Aumentar quantidade"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <button
                onClick={handleCustomizeAddClick}
                className="inline-flex min-h-12 items-center justify-center gap-3 rounded-lg bg-slate-950 px-5 py-3 text-sm font-black text-white transition hover:bg-slate-800"
              >
                <ShoppingCart className="h-4 w-4" />
                <span>Adicionar</span>
                <span>{brl(getCustomProductTotal(customizeProduct))}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {customizeProduct && requiredOptionPromptGroup ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/65 p-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rose-500">Escolha obrigatoria</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">{requiredOptionPromptGroup.name}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Selecione {getRequiredSelectionCount(requiredOptionPromptGroup)} opcao para continuar.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRequiredOptionPromptGroupId(null)}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
                aria-label="Fechar selecao obrigatoria"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[56vh] space-y-2 overflow-y-auto p-4">
              {requiredOptionPromptGroup.options.map((option) => {
                const checked = (selectedByGroup[requiredOptionPromptGroup.id] || []).includes(option.id);
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => selectPromptOption(requiredOptionPromptGroup, option)}
                    className={cn(
                      'w-full rounded-xl border px-3 py-3 text-left transition',
                      checked
                        ? 'border-rose-400 bg-rose-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-rose-200 hover:bg-rose-50/40',
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        {option.imageUrl ? (
                          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
                            <AppImage
                              src={option.imageUrl}
                              alt={option.name}
                              fill
                              sizes="56px"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          </div>
                        ) : null}
                        <div className="min-w-0">
                          <span className="block truncate font-bold text-slate-950">{option.name}</span>
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {checked ? 'Selecionado' : 'Toque para selecionar'}
                          </span>
                        </div>
                      </div>
                      <strong className="shrink-0 text-slate-950">+ {brl(option.priceAddition)}</strong>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                type="button"
                onClick={confirmRequiredOptionPrompt}
                disabled={requiredOptionPromptSelectedCount < getRequiredSelectionCount(requiredOptionPromptGroup)}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500 px-4 py-3 text-sm font-black text-white transition hover:bg-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ShoppingCart className="h-4 w-4" />
                Confirmar e adicionar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pizzaFlavorPickerOpen && customizeProduct && customizeProduct.product_type === 'size_based' ? (
        <div className="fixed inset-0 z-50 bg-slate-950/70 p-3 md:p-6 overflow-y-auto">
          <div className="mx-auto max-w-5xl bg-white rounded-2xl border border-slate-200 shadow-xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Selecao de sabores</p>
                <h3 className="font-bold text-slate-900 text-lg">
                  Escolha os sabores da pizza {selectedPizzaSize || ''}
                </h3>
                <p className="text-xs text-slate-500">
                  Selecione ate {getPizzaConfig(customizeProduct).maxFlavors} sabores.
                </p>
              </div>
              <button
                onClick={() => setPizzaFlavorPickerOpen(false)}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-600" />
              </button>
            </div>

            <div className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  value={pizzaFlavorSearch}
                  onChange={(event) => setPizzaFlavorSearch(event.target.value)}
                  placeholder="Buscar sabor de pizza"
                  className="w-full border border-slate-200 rounded-lg pl-10 pr-3 py-2 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {getFilteredPizzaFlavorPool(customizeProduct).map((flavor) => {
                  const checked = selectedPizzaFlavorIds.includes(flavor.id);
                  return (
                    <button
                      key={flavor.id}
                      onClick={() => togglePizzaFlavor(customizeProduct, flavor.id)}
                      className={cn(
                        'rounded-xl border p-3 text-left',
                        checked ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white',
                      )}
                    >
                      <p className="font-bold text-slate-900">{flavor.name}</p>
                      <p className="text-xs text-slate-500 line-clamp-2">{flavor.description || 'Sabor de pizza'}</p>
                      {selectedPizzaSize ? (
                        <span className="mt-2 inline-flex rounded-full bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600">
                          {selectedPizzaSize} • {brl(
                            getSizeOptions(flavor).find((size) => size.label === selectedPizzaSize)?.price || Number(flavor.price),
                          )}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>

              {getFilteredPizzaFlavorPool(customizeProduct).length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Nenhum sabor encontrado na busca.</p>
              ) : null}
            </div>

            <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                Selecionados: <strong>{getSelectedPizzaProducts(customizeProduct).map((item) => item.name).join(' / ')}</strong>
              </div>
              <button
                onClick={() => setPizzaFlavorPickerOpen(false)}
                className="rounded-lg bg-rose-500 px-4 py-2 text-white font-semibold"
              >
                Confirmar sabores
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pizzaDrinkPickerOpen && customizeProduct && customizeProduct.product_type === 'size_based' ? (
        <div className="fixed inset-0 z-50 bg-slate-950/70 p-3 md:p-6 overflow-y-auto">
          <div className="mx-auto max-w-4xl bg-white rounded-2xl border border-slate-200 shadow-xl">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Refrigerantes</p>
                <h3 className="font-bold text-slate-900 text-lg">Adicionar bebidas extras</h3>
                <p className="text-xs text-slate-500">Essas bebidas entram como item pago no carrinho.</p>
              </div>
              <button
                onClick={() => setPizzaDrinkPickerOpen(false)}
                className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-600" />
              </button>
            </div>

            <div className="p-4">
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
                <input
                  value={pizzaDrinkSearch}
                  onChange={(event) => setPizzaDrinkSearch(event.target.value)}
                  placeholder="Buscar refrigerante"
                  className="w-full border border-slate-200 rounded-lg pl-10 pr-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-2">
                {getFilteredBeverageProducts().map((drink) => (
                  <div
                    key={drink.id}
                    className="rounded-lg border border-slate-200 px-3 py-2 bg-white flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{drink.name}</p>
                      <p className="text-xs text-slate-500">{brl(Number(drink.price))}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateExtraDrinkQty(drink.id, -1)}
                        className="w-7 h-7 border border-slate-200 rounded-lg grid place-items-center"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <span className="w-6 text-center font-semibold text-sm">{extraDrinkQtyById[drink.id] || 0}</span>
                      <button
                        onClick={() => updateExtraDrinkQty(drink.id, 1)}
                        className="w-7 h-7 border border-slate-200 rounded-lg grid place-items-center"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {getFilteredBeverageProducts().length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Nenhum refrigerante encontrado.</p>
              ) : null}
            </div>

            <div className="p-4 border-t border-slate-200 flex items-center justify-between gap-3">
              <div className="text-sm text-slate-600">
                {getSelectedExtraDrinksSummary().length > 0 ? (
                  <>Selecionados: <strong>{getSelectedExtraDrinksSummary().join(' / ')}</strong></>
                ) : (
                  <>Nenhum refrigerante extra selecionado.</>
                )}
                <div className="text-xs text-slate-500 mt-1">
                  Subtotal dos refrigerantes: <strong>{brl(getExtraDrinksSubtotal())}</strong>
                </div>
              </div>
              <button
                onClick={() => setPizzaDrinkPickerOpen(false)}
                className="rounded-lg bg-rose-500 px-4 py-2 text-white font-semibold"
              >
                Confirmar refrigerantes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cartItemsCount > 0 ? (
        <button
          onClick={openCheckout}
          disabled={!tenant.storeOpen}
          className={cn(
            'fixed bottom-4 left-4 right-4 max-w-3xl mx-auto z-30 text-white rounded-2xl px-5 py-4 shadow-xl flex items-center justify-between',
            tenant.storeOpen ? 'bg-rose-500' : 'bg-slate-400 cursor-not-allowed',
          )}
        >
          <span className="font-bold">{cartItemsCount} item(ns)</span>
          <span className="font-black">{tenant.storeOpen ? brl(total) : 'Delivery OFF'}</span>
        </button>
      ) : null}

      {checkoutOpen ? (
        <div className="fixed inset-0 bg-black/50 z-50 p-3 overflow-y-auto">
          <div className="max-w-3xl mx-auto bg-white rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <button onClick={goBackStep} className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft className="w-4 h-4" /></button>
              <div className="text-center">
                <p className="text-sm font-bold text-slate-900">Finalizar pedido</p>
                <p className="text-xs text-slate-500">{checkoutStep === 'success' ? 'Pedido confirmado' : `Etapa ${Math.max(1, stepIndex(checkoutStep) + 1)} de ${checkoutSteps.length}`}</p>
              </div>
              <button onClick={closeCheckout} className="p-2 rounded-lg hover:bg-slate-100"><X className="w-4 h-4" /></button>
            </div>

            <div className="p-4 space-y-4">
              {checkoutStep === 'cart' ? (
                <section className="space-y-3">
                  {cart.map((item) => (
                    <article key={item.key} className="border border-slate-200 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h4 className="font-bold text-slate-900">{item.name}</h4>
                          <p className="text-xs text-slate-500">
                            {brl(
                              item.basePrice +
                                item.selectedOptions.reduce((sum, option) => sum + option.priceAddition, 0) +
                                (item.pizzaSelection?.borderPrice || 0) +
                                (item.pizzaSelection?.doughPrice || 0),
                            )}{' '}
                            por unidade
                          </p>
                          {item.pizzaSelection?.doughLabel ? (
                            <p className="text-xs text-slate-500 mt-1">
                              Massa: {item.pizzaSelection.doughLabel} {item.pizzaSelection.doughPrice > 0 ? `(+ ${brl(item.pizzaSelection.doughPrice)})` : ''}
                            </p>
                          ) : null}
                          {item.pizzaSelection?.giftDrinkName ? (
                            <p className="text-xs text-emerald-700 mt-1">
                              Brinde: {item.pizzaSelection.giftDrinkName} x{item.pizzaSelection.giftQuantity}
                            </p>
                          ) : null}
                          {item.pizzaSelection?.borderLabel ? (
                            <p className="text-xs text-slate-500 mt-1">
                              Borda: {item.pizzaSelection.borderLabel} (+ {brl(item.pizzaSelection.borderPrice)})
                            </p>
                          ) : null}
                          {item.selectedOptions.length > 0 ? <p className="text-xs text-slate-500 mt-1">Adicionais: {item.selectedOptions.map((option) => option.name).join(', ')}</p> : null}
                          {item.notes ? <p className="text-xs text-slate-500 mt-1">Obs: {item.notes}</p> : null}
                        </div>
                        <button onClick={() => removeCartItem(item.key)} className="text-rose-500 text-xs font-semibold">Remover</button>
                      </div>
                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button onClick={() => updateCartItemQty(item.key, -1)} className="w-7 h-7 border border-slate-200 rounded-lg grid place-items-center"><Minus className="w-4 h-4" /></button>
                          <span className="font-bold w-6 text-center">{item.quantity}</span>
                          <button onClick={() => updateCartItemQty(item.key, 1)} className="w-7 h-7 border border-slate-200 rounded-lg grid place-items-center"><Plus className="w-4 h-4" /></button>
                        </div>
                        <strong>
                          {brl(
                            (item.basePrice +
                              item.selectedOptions.reduce((sum, option) => sum + option.priceAddition, 0) +
                              (item.pizzaSelection?.borderPrice || 0) +
                              (item.pizzaSelection?.doughPrice || 0)) *
                              item.quantity,
                          )}
                        </strong>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}

              {checkoutStep === 'customer' ? (
                <section className="space-y-3">
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Celular</label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(maskPhone(e.target.value))}
                        className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm"
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    {customerLookupLoading ? (
                      <p className="text-xs text-slate-500 mt-1">Buscando cadastro...</p>
                    ) : customerLookupDone && customerLookupFound ? (
                      <p className="text-xs text-emerald-600 mt-1">
                        {savedAddresses.length > 0 ? 'Cliente encontrado com enderecos salvos.' : 'Cliente encontrado.'}
                      </p>
                    ) : customerLookupDone ? (
                      <p className="text-xs text-sky-700 mt-1">
                        Cliente novo. Informe o nome para criar o cadastro ao tocar em Proximo.
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">Nome</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        className="w-full border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-sm"
                        placeholder="Seu nome"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-slate-700">E-mail (opcional)</label>
                    <input
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                      placeholder="voce@email.com"
                    />
                  </div>
                </section>
              ) : null}

              {checkoutStep === 'address' ? (
                <section className="space-y-3">
                  <div className="grid md:grid-cols-3 gap-2">
                    <button onClick={() => selectOrderType('delivery')} className={cn('border rounded-lg p-2 text-sm font-semibold', orderType === 'delivery' ? 'border-rose-400 bg-rose-50' : 'border-slate-200')}>Entrega</button>
                    <button onClick={() => selectOrderType('pickup')} className={cn('border rounded-lg p-2 text-sm font-semibold', orderType === 'pickup' ? 'border-rose-400 bg-rose-50' : 'border-slate-200')}>Retirar na loja</button>
                    <button onClick={() => selectOrderType('table')} className={cn('border rounded-lg p-2 text-sm font-semibold', orderType === 'table' ? 'border-rose-400 bg-rose-50' : 'border-slate-200')}>Consumir no local</button>
                  </div>
                  {orderType === 'delivery' ? (
                    <div className="space-y-3">
                      <div className="space-y-2 rounded-xl border border-slate-200 p-3">
                        <p className="text-sm font-semibold text-slate-700">Enderecos cadastrados</p>
                        {savedAddresses.length === 0 ? (
                          <p className="text-xs text-slate-500">Nenhum endereco salvo. Cadastre um novo endereco abaixo.</p>
                        ) : (
                          savedAddresses.map((address) => {
                            const selectedAddress = addressEntryMode === 'saved' && selectedSavedAddressId === address.id;
                            const addressText = formatSavedAddress(address);
                            const isDeletingAddress = deletingAddressId === address.id;

                            return (
                              <div
                                key={address.id}
                                className={cn(
                                  'flex items-center gap-2 rounded-lg border p-2',
                                  selectedAddress ? 'border-rose-400 bg-rose-50' : 'border-slate-200 bg-white',
                                )}
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    addressEntryModeRef.current = 'saved';
                                    selectedSavedAddressIdRef.current = address.id;
                                    setAddressEntryMode('saved');
                                    setSelectedSavedAddressId(address.id);
                                    setDeliveryAddress(addressText);
                                  }}
                                  className="min-w-0 flex-1 rounded-md px-1 py-1 text-left"
                                  disabled={isDeletingAddress}
                                >
                                  <span className="block text-sm font-semibold text-slate-900">{address.label || 'Endereco salvo'}</span>
                                  <span className="block truncate text-xs text-slate-500">{addressText}</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openAddressDeleteConfirm(address)}
                                  disabled={isDeletingAddress}
                                  aria-label={`Remover endereco ${address.label || address.street}`}
                                  title="Remover endereco"
                                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-rose-100 bg-white text-rose-500 shadow-sm transition hover:border-rose-200 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isDeletingAddress ? <span className="text-xs font-bold">...</span> : <Trash2 className="h-4 w-4" />}
                                </button>
                              </div>
                            );
                          })
                        )}
                        <button
                          onClick={() => {
                            addressEntryModeRef.current = 'new';
                            selectedSavedAddressIdRef.current = '';
                            setAddressEntryMode('new');
                            setSelectedSavedAddressId('');
                            setDeliveryAddress('');
                            setAddressForm({ ...EMPTY_ADDRESS_FORM });
                            setAddressStreetMenuOpen(false);
                            setAddressStreetOptions([]);
                            setAddressStreetScopeState('');
                          }}
                          className={cn(
                            'w-full rounded-lg border px-3 py-2 text-sm font-semibold',
                            usingNewAddress ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600',
                          )}
                        >
                          + Novo endereco
                        </button>
                      </div>

                      {usingNewAddress ? (
                        <div className="space-y-2 border border-slate-200 rounded-xl p-3">
                          <p className="text-sm font-semibold text-slate-700">Novo endereco de entrega</p>
                          <input
                            value={addressForm.label}
                            onChange={(e) => setAddressForm((prev) => ({ ...prev, label: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="Apelido (Casa, Trabalho...)"
                          />
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div className="md:col-span-2" ref={addressStreetBoxRef}>
                              <input
                                value={addressForm.street}
                                onFocus={() => setAddressStreetMenuOpen(true)}
                                onChange={(e) => {
                                  setAddressStreetMenuOpen(true);
                                  setAddressForm((prev) => ({ ...prev, street: e.target.value }));
                                }}
                                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                                placeholder="Rua"
                                autoComplete="off"
                              />
                              {addressStreetMenuOpen && (addressStreetOptions.length > 0 || addressStreetLoading || addressForm.street.trim().length >= 2) ? (
                                <div className="relative">
                                  <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                                    {addressStreetLoading ? (
                                      <p className="px-3 py-2 text-xs text-slate-500">Buscando ruas...</p>
                                    ) : addressStreetOptions.length > 0 ? (
                                      addressStreetOptions.map((option, index) => (
                                        <button
                                          key={`${option.zipCode}-${option.street}-${index}`}
                                          type="button"
                                          className="block w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                                          onClick={() => {
                                            setAddressStreetMenuOpen(false);
                                            setAddressStreetOptions([]);
                                            setAddressForm((prev) => ({
                                              ...prev,
                                              street: option.street || prev.street,
                                              neighborhood: option.neighborhood || prev.neighborhood,
                                              city: option.city || prev.city,
                                              state: option.state || addressStreetScopeState || prev.state,
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
                                      <p className="px-3 py-2 text-xs text-slate-500">Nenhuma rua encontrada ainda. Continue digitando ou informe cidade para refinar.</p>
                                    )}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            <input
                              value={addressForm.number}
                              onChange={(e) => setAddressForm((prev) => ({ ...prev, number: e.target.value }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="Numero"
                            />
                          </div>
                          <input
                            value={addressForm.complement}
                            onChange={(e) => setAddressForm((prev) => ({ ...prev, complement: e.target.value }))}
                            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                            placeholder="Complemento"
                          />
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <input
                              value={addressForm.neighborhood}
                              onChange={(e) => setAddressForm((prev) => ({ ...prev, neighborhood: e.target.value }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="Bairro"
                            />
                            <input
                              value={addressForm.city}
                              onChange={(e) => setAddressForm((prev) => ({ ...prev, city: e.target.value }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="Cidade"
                            />
                            <input
                              value={addressForm.state}
                              onChange={(e) => setAddressForm((prev) => ({ ...prev, state: e.target.value.toUpperCase().slice(0, 2) }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm uppercase"
                              placeholder="UF"
                            />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <input
                              value={addressForm.zipCode}
                              onChange={(e) => setAddressForm((prev) => ({ ...prev, zipCode: e.target.value }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="CEP"
                            />
                            <input
                              value={addressForm.reference}
                              onChange={(e) => setAddressForm((prev) => ({ ...prev, reference: e.target.value }))}
                              className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                              placeholder="Referencia"
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">{orderType === 'pickup' ? 'Voce ira retirar seu pedido na loja.' : 'Seu pedido sera marcado para consumo no local.'}</p>
                  )}
                </section>
              ) : null}

                {checkoutStep === 'payment' ? (
                  <section className="space-y-3">
                    {availablePaymentMethods.length > 0 ? (
                      <div className="grid md:grid-cols-3 gap-2">
                        {availablePaymentMethods.map((method) => (
                          <button
                            key={method.id}
                            onClick={() => setSelectedPaymentMethodId(method.id)}
                            className={cn(
                              'border rounded-lg p-2 text-left text-sm font-semibold transition',
                              selectedPaymentMethod?.id === method.id ? 'border-rose-400 bg-rose-50' : 'border-slate-200',
                            )}
                          >
                            <div className="text-slate-900">{method.name}</div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
                        A loja ainda nao configurou formas de pagamento para este cardapio.
                      </div>
                    )}
                  {selectedPaymentMethod?.methodType === 'cash' ? <div><label className="text-sm font-semibold text-slate-700">Troco para quanto? (opcional)</label><input type="text" inputMode="decimal" value={changeFor} onChange={(e) => setChangeFor(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="0,00" /></div> : null}
                </section>
              ) : null}

              {checkoutStep === 'review' ? <section className="space-y-3"><div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm"><p><strong>Cliente:</strong> {customerName}</p><p><strong>Celular:</strong> {customerPhone}</p><p><strong>Tipo:</strong> {orderType === 'delivery' ? 'Entrega' : orderType === 'pickup' ? 'Retirar na loja' : 'Consumir no local'}</p>{orderType === 'delivery' ? <p><strong>Endereco:</strong> {effectiveDeliveryAddress}</p> : null}<p><strong>Pagamento:</strong> {selectedPaymentMethod?.name || 'Nao configurado'}</p>{selectedPaymentMethod?.methodType === 'cash' && changeFor.trim() && Number.isFinite(parsedChangeForAmount) ? <p><strong>Troco para:</strong> {brl(parsedChangeForAmount)}</p> : null}</div></section> : null}

              {checkoutStep === 'success' ? (
                <section className="py-8 text-center">
                  <h3 className="text-lg font-black text-emerald-600">Pedido enviado com sucesso</h3>
                  <p className="text-sm text-slate-500 mt-1">Codigo do pedido: {orderId.slice(0, 8)}</p>
                  <p className="text-sm text-slate-500">A empresa ja recebeu sua solicitacao.</p>
                  {submittedSnapshot?.trackingUrl ? (
                    <a href={submittedSnapshot.trackingUrl} className="mt-4 inline-flex px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold">
                      Acompanhar pedido
                    </a>
                  ) : null}
                  <button onClick={closeCheckout} className="mt-4 ml-2 px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold">Fechar</button>
                </section>
              ) : null}
            </div>

            {checkoutStep !== 'success' ? (
              <div className="border-t border-slate-200 p-4 space-y-2">
                <div className="text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-slate-500">Subtotal</span><span>{brl(subtotal)}</span></div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">
                      Taxa de entrega
                      {deliveryFeeQuote?.distanceKm ? ` (${deliveryFeeQuote.distanceKm.toFixed(2)} km de trajeto)` : ''}
                    </span>
                    <span>{deliveryFeeLoading ? 'Calculando...' : deliveryBlockedByDistance ? 'Indisponivel' : brl(deliveryFee)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-slate-900"><span>Total</span><span>{brl(total)}</span></div>
                </div>
                {deliveryMinimumMissing ? (
                  <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    Pedido minimo para entrega: {brl(deliveryMinOrderAmount)}. Faltam {brl(deliveryMinimumRemaining)} em produtos.
                  </p>
                ) : null}
                {deliveryBlockedByDistance ? (
                  <p className="text-xs font-semibold text-rose-600">
                    {deliveryFeeQuote?.deliveryUnavailableReason || 'Endereco fora da area de entrega da loja.'}
                  </p>
                ) : null}
                {orderType === 'delivery' && deliveryFeeQuote?.usedFallback ? (
                  <p className="text-xs text-amber-700">
                    Nao foi possivel calcular o trajeto agora. O sistema usou a taxa reserva da loja.
                  </p>
                ) : null}
                {needsDeliveryDistanceQuote && orderType === 'delivery' && checkoutStep === 'address' && !deliveryAddressReadyForQuote ? (
                  <p className="text-xs text-sky-700">
                    Complete rua, numero e cidade/UF ou CEP para calcular a taxa exata.
                  </p>
                ) : null}
                {formError ? <p className="text-sm text-rose-600">{formError}</p> : null}
                {checkoutStep === 'review' ? <button onClick={submitOrder} disabled={submitting} className="w-full py-3 rounded-xl bg-emerald-500 text-white font-bold disabled:opacity-60">{submitting ? 'Enviando pedido...' : 'Finalizar pedido'}</button> : <button onClick={goNextStep} disabled={portalSaving} className="w-full py-3 rounded-xl bg-rose-500 text-white font-bold disabled:opacity-60">{checkoutStep === 'customer' && portalSaving ? 'Salvando cliente...' : 'Proximo'}</button>}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {addressDeleteTarget ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600">
                  <Trash2 className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-rose-500">Excluir endereco</p>
                  <h3 className="mt-1 text-lg font-black text-slate-950">Remover este endereco salvo?</h3>
                  <p className="mt-1 text-sm text-slate-500">Ele sai do seu cadastro neste cardapio e nao aparece mais na proxima compra.</p>
                </div>
              </div>
            </div>

            <div className="space-y-3 px-5 py-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-sm font-bold text-slate-900">{addressDeleteTarget.label || 'Endereco salvo'}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{formatSavedAddress(addressDeleteTarget)}</p>
              </div>
              {addressDeleteError ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                  {addressDeleteError}
                </div>
              ) : null}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 px-5 py-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={closeAddressDeleteConfirm}
                disabled={Boolean(deletingAddressId)}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Manter endereco
              </button>
              <button
                type="button"
                onClick={() => void deleteSavedAddress(addressDeleteTarget)}
                disabled={Boolean(deletingAddressId)}
                className="rounded-xl bg-rose-600 px-4 py-3 text-sm font-black text-white shadow-lg shadow-rose-600/20 transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deletingAddressId ? 'Removendo...' : 'Sim, excluir'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
