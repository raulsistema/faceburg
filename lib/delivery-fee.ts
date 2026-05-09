type DeliveryFeeMode = 'fixed' | 'per_km' | 'distance_table';

export type DeliveryFeeTier = {
  upToMeters: number;
  fee: number;
};

export type TenantDeliveryFeeConfig = {
  slug?: string | null;
  issuerStreet?: string | null;
  issuerNumber?: string | null;
  issuerNeighborhood?: string | null;
  issuerCity?: string | null;
  issuerState?: string | null;
  issuerZipCode?: string | null;
  deliveryOriginUseIssuer?: boolean | string | number | null;
  deliveryOriginStreet?: string | null;
  deliveryOriginNumber?: string | null;
  deliveryOriginComplement?: string | null;
  deliveryOriginNeighborhood?: string | null;
  deliveryOriginCity?: string | null;
  deliveryOriginState?: string | null;
  deliveryOriginZipCode?: string | null;
  deliveryFeeBase?: number | string | null;
  deliveryFeeMode?: string | null;
  deliveryFeePerKm?: number | string | null;
  deliveryFeeTable?: unknown;
  deliveryMaxDistanceMeters?: number | string | null;
};

export type DeliveryAddressInput = {
  street?: string | null;
  number?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  reference?: string | null;
  freeform?: string | null;
};

export type DeliveryFeeQuote = {
  deliveryFeeAmount: number;
  distanceKm: number | null;
  deliveryFeeMode: DeliveryFeeMode;
  deliveryFeePerKm: number;
  deliveryMaxDistanceMeters: number;
  distanceMeters: number | null;
  matchedTier: DeliveryFeeTier | null;
  usedFallback: boolean;
  isDeliveryAvailable: boolean;
  deliveryUnavailableReason: string | null;
};

type Coordinates = {
  lat: number;
  lon: number;
};

type GeocodeResponseItem = {
  lat?: string;
  lon?: string;
};

type OsrmRouteResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
  }>;
};

declare global {
  var __faceburgGeocodeCache: Map<string, Coordinates | null> | undefined;
  var __faceburgRouteDistanceCache: Map<string, number | null> | undefined;
  var __faceburgGeocodeInflight: Map<string, Promise<Coordinates | null>> | undefined;
  var __faceburgRouteDistanceInflight: Map<string, Promise<number | null>> | undefined;
}

const geocodeCache = globalThis.__faceburgGeocodeCache ?? new Map<string, Coordinates | null>();
if (!globalThis.__faceburgGeocodeCache) {
  globalThis.__faceburgGeocodeCache = geocodeCache;
}

const routeDistanceCache = globalThis.__faceburgRouteDistanceCache ?? new Map<string, number | null>();
if (!globalThis.__faceburgRouteDistanceCache) {
  globalThis.__faceburgRouteDistanceCache = routeDistanceCache;
}

const geocodeInflight = globalThis.__faceburgGeocodeInflight ?? new Map<string, Promise<Coordinates | null>>();
if (!globalThis.__faceburgGeocodeInflight) {
  globalThis.__faceburgGeocodeInflight = geocodeInflight;
}

const routeDistanceInflight = globalThis.__faceburgRouteDistanceInflight ?? new Map<string, Promise<number | null>>();
if (!globalThis.__faceburgRouteDistanceInflight) {
  globalThis.__faceburgRouteDistanceInflight = routeDistanceInflight;
}

const DEFAULT_OSRM_ROUTE_URL = 'https://router.project-osrm.org';
const GEOCODE_TIMEOUT_MS = 3_500;
const ROUTE_TIMEOUT_MS = 3_500;
const MAX_DELIVERY_LOOKUP_CACHE_ENTRIES = 800;

export const DEFAULT_DELIVERY_FEE_TABLE: DeliveryFeeTier[] = [
  { upToMeters: 1500, fee: 3 },
  { upToMeters: 2000, fee: 4.5 },
  { upToMeters: 3000, fee: 4.5 },
  { upToMeters: 4000, fee: 6 },
  { upToMeters: 5000, fee: 7.5 },
  { upToMeters: 6000, fee: 9 },
  { upToMeters: 7000, fee: 10.5 },
  { upToMeters: 8000, fee: 12 },
  { upToMeters: 9000, fee: 13.5 },
  { upToMeters: 10000, fee: 15 },
  { upToMeters: 11000, fee: 16.5 },
  { upToMeters: 12000, fee: 18 },
  { upToMeters: 13000, fee: 19.5 },
  { upToMeters: 14000, fee: 21 },
  { upToMeters: 15000, fee: 22.5 },
  { upToMeters: 16000, fee: 24 },
  { upToMeters: 17000, fee: 25.5 },
];

function text(value: unknown) {
  return String(value ?? '').trim();
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function toMoney(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return roundMoney(Math.max(0, parsed));
}

export function normalizeDeliveryFeeMode(value: unknown): DeliveryFeeMode {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'per_km') return 'per_km';
  if (normalized === 'distance_table') return 'distance_table';
  return 'fixed';
}

export function normalizeDeliveryMaxDistanceMeters(value: unknown) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(200_000, Math.round(parsed));
}

export function normalizeDeliveryFeeTable(value: unknown): DeliveryFeeTier[] {
  const parsed = typeof value === 'string'
    ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return [];
        }
      })()
    : value;

  if (!Array.isArray(parsed)) return [];

  const tiersByMeters = new Map<number, number>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const upToMeters = Math.round(Number(record.upToMeters ?? record.up_to_meters ?? record.meters ?? 0));
    const fee = toMoney(record.fee ?? record.price ?? record.value ?? 0);
    if (upToMeters <= 0 || fee < 0) continue;
    tiersByMeters.set(upToMeters, fee);
  }

  return Array.from(tiersByMeters.entries())
    .map(([upToMeters, fee]) => ({ upToMeters, fee }))
    .sort((a, b) => a.upToMeters - b.upToMeters)
    .slice(0, 40);
}

export function findDeliveryFeeTier(distanceMeters: number, table: DeliveryFeeTier[]) {
  const normalizedDistance = Math.max(1, Math.ceil(distanceMeters));
  const normalizedTable = normalizeDeliveryFeeTable(table);
  if (!normalizedTable.length) return null;
  return normalizedTable.find((tier) => normalizedDistance <= tier.upToMeters) ?? normalizedTable[normalizedTable.length - 1];
}

function formatDeliveryMaxDistance(meters: number) {
  const kilometers = meters / 1000;
  return `${kilometers.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
}

export function normalizeDeliveryOriginUseIssuer(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = text(value).toLowerCase();
  if (!normalized) return true;
  return normalized !== 'false' && normalized !== '0' && normalized !== 'nao' && normalized !== 'não';
}

function buildStreetWithNumber(street?: string | null, number?: string | null) {
  return [text(street), text(number)].filter(Boolean).join(', ');
}

function buildAddressLabel(parts: Array<string | null | undefined>) {
  return parts.map((part) => text(part)).filter(Boolean).join(', ');
}

function buildGeocodeQuery(address: DeliveryAddressInput) {
  const freeform = text(address.freeform);
  if (freeform) {
    return freeform;
  }

  return buildAddressLabel([
    buildStreetWithNumber(address.street, address.number),
    address.neighborhood,
    address.city,
    address.state,
    address.zipCode,
    'Brasil',
  ]);
}

function hasStructuredAddress(address: DeliveryAddressInput) {
  return Boolean(text(address.street) && text(address.city) && text(address.state));
}

function hasEnoughAddressData(address: DeliveryAddressInput) {
  if (text(address.freeform).length >= 12) return true;
  return hasStructuredAddress(address);
}

function makeCacheKey(address: DeliveryAddressInput) {
  return buildGeocodeQuery(address).toLowerCase();
}

function buildRouteCacheKey(origin: Coordinates, destination: Coordinates) {
  return [
    text(process.env.OSRM_ROUTE_URL || DEFAULT_OSRM_ROUTE_URL).toLowerCase(),
    text(process.env.OSRM_ROUTE_PROFILE || 'driving').toLowerCase(),
    `${origin.lon.toFixed(6)},${origin.lat.toFixed(6)}`,
    `${destination.lon.toFixed(6)},${destination.lat.toFixed(6)}`,
  ].join('|');
}

function getOsrmBaseUrl() {
  return text(process.env.OSRM_ROUTE_URL || DEFAULT_OSRM_ROUTE_URL).replace(/\/+$/, '');
}

function getOsrmProfile() {
  return text(process.env.OSRM_ROUTE_PROFILE || 'driving').toLowerCase() || 'driving';
}

function toCoordinates(item: GeocodeResponseItem | null | undefined) {
  const lat = Number(item?.lat);
  const lon = Number(item?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function rememberCacheValue<T>(cache: Map<string, T>, key: string, value: T) {
  cache.set(key, value);
  if (cache.size <= MAX_DELIVERY_LOOKUP_CACHE_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey) cache.delete(oldestKey);
}

async function geocodeAddress(address: DeliveryAddressInput) {
  const cacheKey = makeCacheKey(address);
  if (!cacheKey) return null;

  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey) ?? null;
  }

  const existingLookup = geocodeInflight.get(cacheKey);
  if (existingLookup) {
    return existingLookup;
  }

  const params = new URLSearchParams({
    format: 'jsonv2',
    limit: '1',
    countrycodes: 'br',
    'accept-language': 'pt-BR',
  });

  if (hasStructuredAddress(address)) {
    const street = buildStreetWithNumber(address.street, address.number);
    if (street) params.set('street', street);
    if (text(address.city)) params.set('city', text(address.city));
    if (text(address.state)) params.set('state', text(address.state));
    if (text(address.zipCode)) params.set('postalcode', text(address.zipCode));
    params.set('country', 'Brasil');
  } else {
    params.set('q', buildGeocodeQuery(address));
  }

  if (process.env.NOMINATIM_CONTACT_EMAIL) {
    params.set('email', process.env.NOMINATIM_CONTACT_EMAIL);
  }

  const lookupPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);
    try {
    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'accept-language': 'pt-BR',
        'user-agent': 'Faceburg Delivery Fee Lookup/1.0',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    let data: unknown = [];
    try {
      data = await response.json();
    } catch {
      data = [];
    }

    const coordinates = Array.isArray(data) ? toCoordinates((data[0] as GeocodeResponseItem | undefined) ?? null) : null;
    rememberCacheValue(geocodeCache, cacheKey, coordinates);
    return coordinates;
  } catch {
    return null;
    } finally {
      clearTimeout(timeout);
      geocodeInflight.delete(cacheKey);
    }
  })();

  geocodeInflight.set(cacheKey, lookupPromise);
  return lookupPromise;
}

async function routeDistanceKmBetween(origin: Coordinates, destination: Coordinates) {
  const cacheKey = buildRouteCacheKey(origin, destination);
  if (routeDistanceCache.has(cacheKey)) {
    return routeDistanceCache.get(cacheKey) ?? null;
  }

  const existingLookup = routeDistanceInflight.get(cacheKey);
  if (existingLookup) {
    return existingLookup;
  }

  const lookupPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ROUTE_TIMEOUT_MS);
    try {
    const response = await fetch(
      `${getOsrmBaseUrl()}/route/v1/${encodeURIComponent(getOsrmProfile())}/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=false&alternatives=false&steps=false`,
      {
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'user-agent': 'Faceburg Delivery Fee Lookup/1.0',
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return null;
    }

    let data: OsrmRouteResponse | null = null;
    try {
      data = (await response.json()) as OsrmRouteResponse;
    } catch {
      data = null;
    }

    const distanceMeters = Number(data?.code === 'Ok' ? data.routes?.[0]?.distance : 0);
    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      rememberCacheValue(routeDistanceCache, cacheKey, null);
      return null;
    }

    const distanceKm = Number((distanceMeters / 1000).toFixed(2));
    rememberCacheValue(routeDistanceCache, cacheKey, distanceKm);
    return distanceKm;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
      routeDistanceInflight.delete(cacheKey);
  }
  })();

  routeDistanceInflight.set(cacheKey, lookupPromise);
  return lookupPromise;
}

export function buildTenantOriginAddress(config: TenantDeliveryFeeConfig): DeliveryAddressInput {
  if (!normalizeDeliveryOriginUseIssuer(config.deliveryOriginUseIssuer)) {
    return {
      street: text(config.deliveryOriginStreet),
      number: text(config.deliveryOriginNumber),
      neighborhood: text(config.deliveryOriginNeighborhood),
      city: text(config.deliveryOriginCity),
      state: text(config.deliveryOriginState).toUpperCase(),
      zipCode: text(config.deliveryOriginZipCode),
    };
  }

  return {
    street: text(config.issuerStreet),
    number: text(config.issuerNumber),
    neighborhood: text(config.issuerNeighborhood),
    city: text(config.issuerCity),
    state: text(config.issuerState).toUpperCase(),
    zipCode: text(config.issuerZipCode),
  };
}

export async function quoteDeliveryFee(
  config: TenantDeliveryFeeConfig,
  destination: DeliveryAddressInput,
): Promise<DeliveryFeeQuote> {
  const deliveryFeeMode = normalizeDeliveryFeeMode(config.deliveryFeeMode);
  const deliveryFeeBase = toMoney(config.deliveryFeeBase);
  const deliveryFeePerKm = toMoney(config.deliveryFeePerKm);
  const deliveryMaxDistanceMeters = normalizeDeliveryMaxDistanceMeters(config.deliveryMaxDistanceMeters);
  const deliveryFeeTable = normalizeDeliveryFeeTable(config.deliveryFeeTable);
  const needsDistanceLookup =
    deliveryMaxDistanceMeters > 0 ||
    (deliveryFeeMode === 'per_km' && deliveryFeePerKm > 0) ||
    (deliveryFeeMode === 'distance_table' && deliveryFeeTable.length > 0);

  if (!needsDistanceLookup) {
    return {
      deliveryFeeAmount: deliveryFeeBase,
      distanceKm: null,
      distanceMeters: null,
      deliveryFeeMode,
      deliveryFeePerKm,
      deliveryMaxDistanceMeters,
      matchedTier: null,
      usedFallback: false,
      isDeliveryAvailable: true,
      deliveryUnavailableReason: null,
    };
  }

  const origin = buildTenantOriginAddress(config);
  if (!hasEnoughAddressData(origin) || !hasEnoughAddressData(destination)) {
    return {
      deliveryFeeAmount: deliveryFeeBase,
      distanceKm: null,
      distanceMeters: null,
      deliveryFeeMode,
      deliveryFeePerKm,
      deliveryMaxDistanceMeters,
      matchedTier: null,
      usedFallback: true,
      isDeliveryAvailable: true,
      deliveryUnavailableReason: null,
    };
  }

  const [originCoordinates, destinationCoordinates] = await Promise.all([
    geocodeAddress(origin),
    geocodeAddress(destination),
  ]);

  if (!originCoordinates || !destinationCoordinates) {
    return {
      deliveryFeeAmount: deliveryFeeBase,
      distanceKm: null,
      distanceMeters: null,
      deliveryFeeMode,
      deliveryFeePerKm,
      deliveryMaxDistanceMeters,
      matchedTier: null,
      usedFallback: true,
      isDeliveryAvailable: true,
      deliveryUnavailableReason: null,
    };
  }

  const distanceKm = await routeDistanceKmBetween(originCoordinates, destinationCoordinates);
  if (!(distanceKm && distanceKm > 0)) {
    return {
      deliveryFeeAmount: deliveryFeeBase,
      distanceKm: null,
      distanceMeters: null,
      deliveryFeeMode,
      deliveryFeePerKm,
      deliveryMaxDistanceMeters,
      matchedTier: null,
      usedFallback: true,
      isDeliveryAvailable: true,
      deliveryUnavailableReason: null,
    };
  }

  const distanceMeters = Math.ceil(distanceKm * 1000);
  if (deliveryMaxDistanceMeters > 0 && distanceMeters > deliveryMaxDistanceMeters) {
    return {
      deliveryFeeAmount: 0,
      distanceKm,
      distanceMeters,
      deliveryFeeMode,
      deliveryFeePerKm,
      deliveryMaxDistanceMeters,
      matchedTier: null,
      usedFallback: false,
      isDeliveryAvailable: false,
      deliveryUnavailableReason: `Endereco fora do raio de entrega. Entregamos ate ${formatDeliveryMaxDistance(deliveryMaxDistanceMeters)}.`,
    };
  }

  if (deliveryFeeMode === 'fixed') {
    return {
      deliveryFeeAmount: deliveryFeeBase,
      distanceKm,
      distanceMeters,
      deliveryFeeMode,
      deliveryFeePerKm,
      deliveryMaxDistanceMeters,
      matchedTier: null,
      usedFallback: false,
      isDeliveryAvailable: true,
      deliveryUnavailableReason: null,
    };
  }

  if (deliveryFeeMode === 'distance_table') {
    const matchedTier = findDeliveryFeeTier(distanceMeters, deliveryFeeTable);
    if (matchedTier) {
      return {
        deliveryFeeAmount: matchedTier.fee,
        distanceKm,
        distanceMeters,
        deliveryFeeMode,
        deliveryFeePerKm,
        deliveryMaxDistanceMeters,
        matchedTier,
        usedFallback: false,
        isDeliveryAvailable: true,
        deliveryUnavailableReason: null,
      };
    }
  }

  const calculatedFee = roundMoney(distanceKm * deliveryFeePerKm);

  return {
    deliveryFeeAmount: Math.max(deliveryFeeBase, calculatedFee),
    distanceKm,
    distanceMeters,
    deliveryFeeMode,
    deliveryFeePerKm,
    deliveryMaxDistanceMeters,
    matchedTier: null,
    usedFallback: false,
    isDeliveryAvailable: true,
    deliveryUnavailableReason: null,
  };
}
