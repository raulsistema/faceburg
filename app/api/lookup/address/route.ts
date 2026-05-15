import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type ViaCepAddressSuggestion = {
  cep?: string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
};

type AddressSuggestion = {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  complement: string;
};

type NominatimSuggestion = {
  name?: string;
  display_name?: string;
  address?: Record<string, unknown>;
};

type PhotonFeature = {
  properties?: {
    name?: string;
    street?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
  };
};

type TenantStateRow = {
  id: string;
  status: string;
  issuer_state: string | null;
};

const STATE_NAME_TO_CODE: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeSearchText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function applyPortugueseAccentHints(value: string) {
  return value
    .replace(/\bsao\b/gi, 'são')
    .replace(/\bgoias\b/gi, 'goiás')
    .replace(/\bgoiania\b/gi, 'goiânia')
    .replace(/\bjose\b/gi, 'josé')
    .replace(/\bjoao\b/gi, 'joão')
    .replace(/\bbras\b/gi, 'brás')
    .replace(/\bagua\b/gi, 'água')
    .replace(/\bvitoria\b/gi, 'vitória')
    .replace(/\bparaiso\b/gi, 'paraíso')
    .replace(/\bconceicao\b/gi, 'conceição')
    .replace(/\bcoracao\b/gi, 'coração')
    .replace(/\bniteroi\b/gi, 'niterói');
}

function buildStreetSearchVariants(rawStreet: string) {
  const variants: string[] = [];
  const seen = new Set<string>();

  function pushVariant(value: string) {
    const normalized = collapseSpaces(value);
    if (normalized.length < 2) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(normalized);
  }

  function pushAccentInsensitiveVariants(value: string) {
    const normalized = collapseSpaces(value);
    const accentless = collapseSpaces(normalizeSearchText(normalized));
    const accentedHint = collapseSpaces(applyPortugueseAccentHints(accentless));
    pushVariant(accentless);
    pushVariant(accentedHint);
  }

  function pushLastWordPluralVariant(value: string) {
    const pluralized = collapseSpaces(value.replace(/(\S{3,})$/u, (word) => (/s$/i.test(word) ? word : `${word}s`)));
    if (pluralized !== collapseSpaces(value)) {
      pushVariant(pluralized);
      pushAccentInsensitiveVariants(pluralized);
    }
  }

  function expandLeadingType(value: string) {
    return collapseSpaces(
      value
        .replace(/^av\.?\s+/i, 'Avenida ')
        .replace(/^r\.?\s+/i, 'Rua ')
        .replace(/^tv\.?\s+/i, 'Travessa ')
        .replace(/^rod\.?\s+/i, 'Rodovia '),
    );
  }

  const street = collapseSpaces(rawStreet.replace(/\b\d{5}-?\d{3}\b/g, ' ').replace(/[;|]+/g, ' '));
  if (!street) return variants;

  pushVariant(street);
  pushAccentInsensitiveVariants(street);
  const expandedStreet = expandLeadingType(street);
  pushVariant(expandedStreet);
  pushAccentInsensitiveVariants(expandedStreet);
  pushLastWordPluralVariant(street);
  pushLastWordPluralVariant(expandedStreet);

  const beforeComma = collapseSpaces(street.split(',')[0] || '');
  pushVariant(beforeComma);
  pushAccentInsensitiveVariants(beforeComma);

  const withoutTrailingReference = collapseSpaces(
    street.replace(/\s+(?:n(?:[º°o]\.?|umero)?\.?\s*)?\d+[a-z0-9/-]*$/i, ''),
  );
  pushVariant(withoutTrailingReference);
  pushAccentInsensitiveVariants(withoutTrailingReference);

  const withoutLeadingType = collapseSpaces(
    street.replace(/^(rua|r\.?|avenida|av\.?|travessa|tv\.?|alameda|praça|praca|estrada|rodovia|rod\.?|largo)\s+/i, ''),
  );
  pushVariant(withoutLeadingType);
  pushAccentInsensitiveVariants(withoutLeadingType);

  const withoutTypeOrNumber = collapseSpaces(
    withoutTrailingReference.replace(
      /^(rua|r\.?|avenida|av\.?|travessa|tv\.?|alameda|praça|praca|estrada|rodovia|rod\.?|largo)\s+/i,
      '',
    ),
  );
  pushVariant(withoutTypeOrNumber);
  pushAccentInsensitiveVariants(withoutTypeOrNumber);

  return variants;
}

function makeSuggestionKey(item: AddressSuggestion) {
  return [
    normalizeSearchText(item.street),
    normalizeSearchText(item.neighborhood),
    normalizeSearchText(item.city),
    normalizeSearchText(item.state),
    normalizeSearchText(item.zipCode),
  ].join('|');
}

function dedupeSuggestions(items: AddressSuggestion[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = makeSuggestionKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function detectRequestedStreetType(rawStreet: string) {
  const normalized = normalizeSearchText(rawStreet);
  if (/^(av\.?|avenida)\b/.test(normalized)) return 'avenida';
  if (/^(r\.?|rua)\b/.test(normalized)) return 'rua';
  if (/^(tv\.?|travessa)\b/.test(normalized)) return 'travessa';
  if (/^(rod\.?|rodovia)\b/.test(normalized)) return 'rodovia';
  return '';
}

function stripLeadingStreetType(rawStreet: string) {
  return normalizeSearchText(rawStreet)
    .replace(/^(av\.?|avenida|r\.?|rua|tv\.?|travessa|rod\.?|rodovia)\s+/, '')
    .trim();
}

function streetNameMatchesRequestedType(streetName: string, requestedType: string) {
  if (!requestedType) return true;
  const normalized = normalizeSearchText(streetName);
  if (requestedType === 'avenida') return /^(av\.?|avenida)\b/.test(normalized);
  if (requestedType === 'rua') return /^(r\.?|rua)\b/.test(normalized);
  if (requestedType === 'travessa') return /^(tv\.?|travessa)\b/.test(normalized);
  if (requestedType === 'rodovia') return /^(rod\.?|rodovia)\b/.test(normalized);
  return true;
}

function buildPhotonStreetQueries(state: string, rawStreet: string, streetVariants: string[]) {
  const seen = new Set<string>();
  const queries: string[] = [];
  const requestedType = detectRequestedStreetType(rawStreet);
  const requestedName = stripLeadingStreetType(rawStreet);

  function pushQuery(value: string) {
    const normalized = collapseSpaces(value);
    if (normalized.length < 3) return;
    const key = normalizeSearchText(normalized);
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(`${normalized} ${state}`);
  }

  pushQuery(rawStreet);
  for (const streetVariant of streetVariants) {
    pushQuery(streetVariant);
  }
  if (!requestedType && requestedName.length >= 3) {
    pushQuery(`Rua ${requestedName}`);
    pushQuery(`Avenida ${requestedName}`);
    pushQuery(`Travessa ${requestedName}`);
  }

  return queries;
}

function sortSuggestionsForStreet(items: AddressSuggestion[], rawStreet: string) {
  const requestedType = detectRequestedStreetType(rawStreet);
  const requestedName = stripLeadingStreetType(rawStreet);

  return [...items].sort((a, b) => {
    const streetA = normalizeSearchText(a.street);
    const streetB = normalizeSearchText(b.street);
    const typeScoreA = requestedType && !streetA.startsWith(requestedType) ? 50 : 0;
    const typeScoreB = requestedType && !streetB.startsWith(requestedType) ? 50 : 0;
    const nameScoreA = requestedName && !streetA.includes(requestedName) ? 10 : 0;
    const nameScoreB = requestedName && !streetB.includes(requestedName) ? 10 : 0;
    return typeScoreA + nameScoreA - (typeScoreB + nameScoreB);
  });
}

function getUniqueCityScopes(items: AddressSuggestion[]) {
  const seen = new Set<string>();
  const scopes: Array<{ city: string; state: string }> = [];
  for (const item of items) {
    const city = text(item.city);
    const state = text(item.state).toUpperCase();
    if (city.length < 3 || state.length !== 2) continue;
    const key = `${normalizeSearchText(city)}|${state}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scopes.push({ city, state });
  }
  return scopes;
}

async function loadViaCepSuggestions(state: string, city: string, street: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `https://viacep.com.br/ws/${encodeURIComponent(state)}/${encodeURIComponent(city)}/${encodeURIComponent(street)}/json/`,
      {
        cache: 'no-store',
        headers: {
          accept: 'application/json',
        },
        signal: controller.signal,
      },
    );

    let data: unknown = [];
    try {
      data = await response.json();
    } catch {
      data = [];
    }

    if (!response.ok) {
      return [];
    }

    return dedupeSuggestions(
      Array.isArray(data)
        ? data
            .map((item) => {
              const row = item as ViaCepAddressSuggestion;
              return {
                street: text(row.logradouro),
                neighborhood: text(row.bairro),
                city: text(row.localidade),
                state: text(row.uf).toUpperCase(),
                zipCode: text(row.cep),
                complement: text(row.complemento),
              };
            })
            .filter((item) => item.street)
        : [],
    );
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRemoteSuggestionsWithVariants(state: string, city: string, streetVariants: string[]) {
  const items: AddressSuggestion[] = [];
  for (const streetVariant of streetVariants) {
    const batch = await loadViaCepSuggestions(state, city, streetVariant);
    items.push(...batch);
    if (dedupeSuggestions(items).length >= 8) {
      break;
    }
  }
  return dedupeSuggestions(items);
}

function stateCodeFromNominatimAddress(address: Record<string, unknown>) {
  const isoCode = text(address['ISO3166-2-lvl4']).toUpperCase();
  const isoMatch = isoCode.match(/^BR-([A-Z]{2})$/);
  if (isoMatch?.[1]) return isoMatch[1];

  const stateName = normalizeSearchText(text(address.state));
  return STATE_NAME_TO_CODE[stateName] || '';
}

function stateCodeFromPhotonState(value: unknown) {
  const raw = text(value).toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return STATE_NAME_TO_CODE[normalizeSearchText(text(value))] || '';
}

function isPhotonBrazilResult(value: unknown) {
  const country = normalizeSearchText(text(value));
  return country === 'brasil' || country === 'brazil';
}

function mapNominatimSuggestion(item: NominatimSuggestion): AddressSuggestion | null {
  const address = item.address || {};
  const street = text(address.road) || text(address.pedestrian) || text(address.footway) || text(item.name);
  if (!street) return null;

  const state = stateCodeFromNominatimAddress(address);
  const city = text(address.city) || text(address.town) || text(address.municipality) || text(address.city_district);

  return {
    street,
    neighborhood: text(address.suburb) || text(address.neighbourhood) || text(address.quarter) || text(address.city_district),
    city,
    state,
    zipCode: text(address.postcode),
    complement: '',
  };
}

async function loadNominatimSuggestions(state: string, city: string, streetVariants: string[]) {
  const items: AddressSuggestion[] = [];
  const requestedType = detectRequestedStreetType(streetVariants[0] || '');
  for (const streetVariant of streetVariants.slice(0, 4)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        addressdetails: '1',
        limit: '8',
        countrycodes: 'br',
        'accept-language': 'pt-BR',
      });

      if (city) {
        params.set('street', streetVariant);
        params.set('city', city);
        if (state) params.set('state', state);
        params.set('country', 'Brasil');
      } else {
        params.set('q', [streetVariant, state, 'Brasil'].filter(Boolean).join(', '));
      }

      const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'accept-language': 'pt-BR',
          'user-agent': 'Faceburg Address Lookup/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) continue;

      let data: unknown = [];
      try {
        data = await response.json();
      } catch {
        data = [];
      }

      if (Array.isArray(data)) {
        items.push(
          ...data
            .map((entry) => mapNominatimSuggestion(entry as NominatimSuggestion))
            .filter((entry): entry is AddressSuggestion => Boolean(entry))
            .filter((entry) => !state || entry.state === state),
        );
      }

      const dedupedItems = dedupeSuggestions(items);
      const hasRequestedTypeMatch = Boolean(
        requestedType && dedupedItems.some((item) => normalizeSearchText(item.street).startsWith(requestedType)),
      );
      if (hasRequestedTypeMatch || (!requestedType && dedupedItems.length >= 8)) {
        break;
      }
    } catch {
      // Mantem a busca principal por ViaCEP mesmo se a busca ampla falhar.
    } finally {
      clearTimeout(timeout);
    }
  }

  return dedupeSuggestions(items);
}

async function loadPhotonSuggestionsByState(state: string, rawStreet: string, streetVariants: string[]) {
  if (!/^[A-Z]{2}$/.test(state)) return [];

  const queries = buildPhotonStreetQueries(state, rawStreet, streetVariants).slice(0, 4);
  const requestedType = detectRequestedStreetType(rawStreet);
  const requestedName = stripLeadingStreetType(rawStreet);
  const suggestions: AddressSuggestion[] = [];
  const seen = new Set<string>();

  for (const queryText of queries) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const params = new URLSearchParams({ q: queryText, limit: '10' });
      const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
        cache: 'no-store',
        headers: {
          accept: 'application/json',
          'user-agent': 'Faceburg Address Lookup/1.0',
        },
        signal: controller.signal,
      });

      if (!response.ok) continue;

      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      const features = Array.isArray((data as { features?: unknown[] } | null)?.features)
        ? ((data as { features?: PhotonFeature[] }).features || [])
        : [];
      for (const feature of features) {
        const props = feature.properties || {};
        const name = text(props.name) || text(props.street);
        const normalizedName = normalizeSearchText(name);
        const highwayValue = text(props.osm_value);
        if (
          !name ||
          props.osm_key !== 'highway' ||
          ['bus_stop', 'crossing', 'traffic_signals', 'street_lamp'].includes(highwayValue) ||
          !isPhotonBrazilResult(props.country) ||
          stateCodeFromPhotonState(props.state) !== state ||
          !streetNameMatchesRequestedType(name, requestedType) ||
          (requestedName && !normalizedName.includes(requestedName))
        ) {
          continue;
        }
        const key = normalizedName;
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push({
          street: name,
          neighborhood: '',
          city: text(props.city),
          state,
          zipCode: text(props.postcode),
          complement: '',
        });
        if (suggestions.length >= 8) break;
      }

      if (suggestions.length >= 8) break;
    } catch {
      // Busca auxiliar: se falhar, mantem os provedores principais.
    } finally {
      clearTimeout(timeout);
    }
  }

  return suggestions;
}

export async function GET(request: NextRequest) {
  const requestedState = text(request.nextUrl.searchParams.get('state')).toUpperCase();
  const requestedCity = text(request.nextUrl.searchParams.get('city'));
  const street = text(request.nextUrl.searchParams.get('street'));
  const slug = text(request.nextUrl.searchParams.get('slug'));

  if (street.length < 2) {
    return NextResponse.json({ error: 'Informe a rua com pelo menos 2 caracteres.' }, { status: 400 });
  }

  try {
    const session = await getValidatedTenantSession();
    const tenantResult = session
      ? await query<TenantStateRow>(
          `SELECT id, status, issuer_state
           FROM tenants
           WHERE id = $1
           LIMIT 1`,
          [session.tenantId],
        )
      : slug
        ? await query<TenantStateRow>(
            `SELECT id, status, issuer_state
             FROM tenants
             WHERE slug = $1
             LIMIT 1`,
            [slug],
          )
        : null;

    if (!tenantResult?.rowCount) {
      return NextResponse.json({ error: session ? 'Tenant not found' : 'Unauthorized' }, { status: session ? 404 : 401 });
    }

    const tenant = tenantResult.rows[0];
    if (!session && tenant.status !== 'active') {
      return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403 });
    }

    const tenantState = text(tenant.issuer_state).toUpperCase();
    const isPublicMenuLookup = !session && Boolean(slug);
    const effectiveState = isPublicMenuLookup ? tenantState || requestedState : requestedState || tenantState;
    const effectiveCity = isPublicMenuLookup ? '' : requestedCity;
    const streetVariants = buildStreetSearchVariants(street);

    let remoteSuggestions: AddressSuggestion[] = [];
    if (streetVariants.some((streetVariant) => streetVariant.length >= 3) && effectiveCity.length >= 3 && effectiveState.length === 2) {
      remoteSuggestions = await loadRemoteSuggestionsWithVariants(effectiveState, effectiveCity, streetVariants);
    }

    if (streetVariants.some((streetVariant) => streetVariant.length >= 3) && effectiveState.length === 2 && remoteSuggestions.length < 8) {
      const stateOnlyShortSearch = !effectiveCity && stripLeadingStreetType(street).length <= 5;
      const earlyPhotonSuggestions = stateOnlyShortSearch
        ? await loadPhotonSuggestionsByState(effectiveState, street, streetVariants)
        : [];
      const wideSuggestions = earlyPhotonSuggestions.length > 0
        ? []
        : await loadNominatimSuggestions(effectiveState, effectiveCity, streetVariants);
      const latePhotonSuggestions =
        !effectiveCity && !stateOnlyShortSearch && remoteSuggestions.length + wideSuggestions.length < 8
          ? await loadPhotonSuggestionsByState(effectiveState, street, streetVariants)
          : [];
      const officialSuggestionsFromInferredCities: AddressSuggestion[] = [];
      if (!effectiveCity && wideSuggestions.length > 0 && wideSuggestions.length < 8) {
        for (const scope of getUniqueCityScopes(wideSuggestions).slice(0, 3)) {
          officialSuggestionsFromInferredCities.push(
            ...(await loadRemoteSuggestionsWithVariants(scope.state, scope.city, streetVariants)),
          );
        }
      }
      remoteSuggestions = dedupeSuggestions([
        ...remoteSuggestions,
        ...officialSuggestionsFromInferredCities,
        ...wideSuggestions,
        ...earlyPhotonSuggestions,
        ...latePhotonSuggestions,
      ]);
    }

    return NextResponse.json({
      effectiveCity,
      effectiveState,
      suggestions: sortSuggestionsForStreet(dedupeSuggestions(remoteSuggestions), street).slice(0, 8),
    });
  } catch {
    return NextResponse.json({ error: 'Nao foi possivel pesquisar o endereco.' }, { status: 502 });
  }
}
