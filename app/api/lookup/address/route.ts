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

type TenantStateRow = {
  id: string;
  status: string;
  issuer_city: string | null;
  issuer_state: string | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function collapseSpaces(value: string) {
  return value.replace(/\s+/g, ' ').trim();
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

  const street = collapseSpaces(rawStreet.replace(/\b\d{5}-?\d{3}\b/g, ' ').replace(/[;|]+/g, ' '));
  if (!street) return variants;

  pushVariant(street);

  const beforeComma = collapseSpaces(street.split(',')[0] || '');
  pushVariant(beforeComma);

  const withoutTrailingReference = collapseSpaces(
    street.replace(/\s+(?:n(?:[º°o]\.?|umero)?\.?\s*)?\d+[a-z0-9/-]*$/i, ''),
  );
  pushVariant(withoutTrailingReference);

  const withoutLeadingType = collapseSpaces(
    street.replace(/^(rua|r\.?|avenida|av\.?|travessa|tv\.?|alameda|praça|praca|estrada|rodovia|rod\.?|largo)\s+/i, ''),
  );
  pushVariant(withoutLeadingType);

  const withoutTypeOrNumber = collapseSpaces(
    withoutTrailingReference.replace(
      /^(rua|r\.?|avenida|av\.?|travessa|tv\.?|alameda|praça|praca|estrada|rodovia|rod\.?|largo)\s+/i,
      '',
    ),
  );
  pushVariant(withoutTypeOrNumber);

  return variants;
}

function makeSuggestionKey(item: AddressSuggestion) {
  return [
    item.street.toLowerCase(),
    item.neighborhood.toLowerCase(),
    item.city.toLowerCase(),
    item.state.toLowerCase(),
    item.zipCode.toLowerCase(),
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
          `SELECT id, status, issuer_city, issuer_state
           FROM tenants
           WHERE id = $1
           LIMIT 1`,
          [session.tenantId],
        )
      : slug
        ? await query<TenantStateRow>(
            `SELECT id, status, issuer_city, issuer_state
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
    const tenantCity = text(tenant.issuer_city);
    const isPublicMenuLookup = !session && Boolean(slug);
    const effectiveState = isPublicMenuLookup ? tenantState : tenantState || requestedState;
    const effectiveCity = isPublicMenuLookup ? tenantCity : requestedCity || tenantCity;
    const streetVariants = buildStreetSearchVariants(street);

    let remoteSuggestions: AddressSuggestion[] = [];
    if (streetVariants.some((streetVariant) => streetVariant.length >= 3) && effectiveCity.length >= 3 && effectiveState.length === 2) {
      remoteSuggestions = await loadRemoteSuggestionsWithVariants(effectiveState, effectiveCity, streetVariants);
    }

    return NextResponse.json({
      effectiveCity,
      effectiveState,
      suggestions: dedupeSuggestions(remoteSuggestions).slice(0, 8),
    });
  } catch {
    return NextResponse.json({ error: 'Nao foi possivel pesquisar o endereco.' }, { status: 502 });
  }
}
