type DeliveryFeeMode = 'fixed' | 'per_km';

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
  usedFallback: boolean;
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
const GEOCODE_TIMEOUT_MS = 5_000;
const ROUTE_TIMEOUT_MS = 6_500;

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
  return String(value || '').trim().toLowerCase() === 'per_km' ? 'per_km' : 'fixed';
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
    if (coordinates) {
      geocodeCache.set(cacheKey, coordinates);
    }
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
      return null;
    }

    const distanceKm = Number((distanceMeters / 1000).toFixed(2));
    routeDistanceCache.set(cacheKey, distanceKm);
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

  if (deliveryFeeMode !== 'per_km' || deliveryFeePerKm <= 0) {
    return {
      deliveryFeeAmount: deliveryFeeBase,
      distanceKm: null,
      deliveryFeeMode,
      deliveryFeePerKm,
      usedFallback: false,
    };
  }

  const origin = buildTenantOriginAddress(config);
  if (!hasEnoughAddressData(origin) || !hasEnoughAddressData(destination)) {
    return {
      deliveryFeeAmount: deliveryFeeBase,
      distanceKm: null,
      deliveryFeeMode,
      deliveryFeePerKm,
      usedFallback: true,
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
      deliveryFeeMode,
      deliveryFeePerKm,
      usedFallback: true,
    };
  }

  const distanceKm = await routeDistanceKmBetween(originCoordinates, destinationCoordinates);
  if (!(distanceKm && distanceKm > 0)) {
    return {
      deliveryFeeAmount: deliveryFeeBase,
      distanceKm: null,
      deliveryFeeMode,
      deliveryFeePerKm,
      usedFallback: true,
    };
  }

  const calculatedFee = roundMoney(distanceKm * deliveryFeePerKm);

  return {
    deliveryFeeAmount: Math.max(deliveryFeeBase, calculatedFee),
    distanceKm,
    deliveryFeeMode,
    deliveryFeePerKm,
    usedFallback: false,
  };
}
