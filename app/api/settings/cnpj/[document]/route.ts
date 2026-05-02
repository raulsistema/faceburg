import { NextResponse } from 'next/server';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function asCleanString(value: unknown) {
  return String(value ?? '').trim();
}

function asRecord(value: unknown) {
  if (!value || typeof value !== 'object') return {} as Record<string, unknown>;
  return value as Record<string, unknown>;
}

type IssuerLookupPayload = {
  issuerName: string;
  issuerTradeName: string;
  issuerStateRegistration: string;
  issuerEmail: string;
  issuerPhone: string;
  issuerZipCode: string;
  issuerStreet: string;
  issuerNumber: string;
  issuerComplement: string;
  issuerNeighborhood: string;
  issuerCity: string;
  issuerState: string;
};

function buildStreet(streetType: string, streetName: string) {
  return [asCleanString(streetType), asCleanString(streetName)]
    .filter(Boolean)
    .join(' ')
    .trim();
}

function firstFilled(...values: unknown[]) {
  for (const value of values) {
    const cleaned = asCleanString(value);
    if (cleaned) return cleaned;
  }
  return '';
}

function normalizeLookupPayload(payload: Partial<IssuerLookupPayload>): IssuerLookupPayload {
  return {
    issuerName: asCleanString(payload.issuerName),
    issuerTradeName: asCleanString(payload.issuerTradeName),
    issuerStateRegistration: asCleanString(payload.issuerStateRegistration),
    issuerEmail: asCleanString(payload.issuerEmail),
    issuerPhone: asCleanString(payload.issuerPhone),
    issuerZipCode: asCleanString(payload.issuerZipCode),
    issuerStreet: asCleanString(payload.issuerStreet),
    issuerNumber: asCleanString(payload.issuerNumber),
    issuerComplement: asCleanString(payload.issuerComplement),
    issuerNeighborhood: asCleanString(payload.issuerNeighborhood),
    issuerCity: asCleanString(payload.issuerCity),
    issuerState: asCleanString(payload.issuerState).toUpperCase(),
  };
}

function mergeLookupPayload(
  base: Partial<IssuerLookupPayload>,
  incoming: Partial<IssuerLookupPayload>,
): Partial<IssuerLookupPayload> {
  return {
    issuerName: firstFilled(base.issuerName, incoming.issuerName),
    issuerTradeName: firstFilled(base.issuerTradeName, incoming.issuerTradeName),
    issuerStateRegistration: firstFilled(base.issuerStateRegistration, incoming.issuerStateRegistration),
    issuerEmail: firstFilled(base.issuerEmail, incoming.issuerEmail),
    issuerPhone: firstFilled(base.issuerPhone, incoming.issuerPhone),
    issuerZipCode: firstFilled(base.issuerZipCode, incoming.issuerZipCode),
    issuerStreet: firstFilled(base.issuerStreet, incoming.issuerStreet),
    issuerNumber: firstFilled(base.issuerNumber, incoming.issuerNumber),
    issuerComplement: firstFilled(base.issuerComplement, incoming.issuerComplement),
    issuerNeighborhood: firstFilled(base.issuerNeighborhood, incoming.issuerNeighborhood),
    issuerCity: firstFilled(base.issuerCity, incoming.issuerCity),
    issuerState: firstFilled(base.issuerState, incoming.issuerState),
  };
}

function hasUsefulPayload(payload: Partial<IssuerLookupPayload>) {
  return Boolean(
    asCleanString(payload.issuerName) ||
      asCleanString(payload.issuerStreet) ||
      asCleanString(payload.issuerNumber) ||
      asCleanString(payload.issuerEmail),
  );
}

function mapBrasilApiToIssuer(data: Record<string, unknown>): Partial<IssuerLookupPayload> {
  return {
    issuerName: asCleanString(data.razao_social),
    issuerTradeName: asCleanString(data.nome_fantasia),
    issuerStateRegistration: asCleanString(data.inscricao_estadual),
    issuerEmail: asCleanString(data.email),
    issuerPhone: firstFilled(data.ddd_telefone_1, data.ddd_telefone_2),
    issuerZipCode: asCleanString(data.cep),
    issuerStreet: buildStreet(asCleanString(data.descricao_tipo_de_logradouro), asCleanString(data.logradouro)),
    issuerNumber: asCleanString(data.numero),
    issuerComplement: asCleanString(data.complemento),
    issuerNeighborhood: asCleanString(data.bairro),
    issuerCity: asCleanString(data.municipio),
    issuerState: asCleanString(data.uf).toUpperCase(),
  };
}

function mapCnpjWsToIssuer(data: Record<string, unknown>): Partial<IssuerLookupPayload> {
  const estabelecimento = asRecord(data.estabelecimento);
  const estado = asRecord(estabelecimento.estado);
  const cidade = asRecord(estabelecimento.cidade);
  const inscricoes = Array.isArray(estabelecimento.inscricoes_estaduais)
    ? (estabelecimento.inscricoes_estaduais as unknown[])
    : [];

  const uf = firstFilled(estabelecimento.uf, estado.sigla, data.uf).toUpperCase();
  const phoneDdd = asCleanString(estabelecimento.ddd1);
  const phoneNumber = asCleanString(estabelecimento.telefone1);
  const phone = phoneDdd && phoneNumber ? `${phoneDdd}${phoneNumber}` : '';

  let stateRegistration = '';
  for (const item of inscricoes) {
    const row = asRecord(item);
    const rowState = asRecord(row.estado);
    const ie = asCleanString(row.inscricao_estadual);
    if (!ie) continue;
    if (asCleanString(rowState.sigla).toUpperCase() === uf) {
      stateRegistration = ie;
      break;
    }
    if (!stateRegistration) {
      stateRegistration = ie;
    }
  }

  return {
    issuerName: firstFilled(data.razao_social),
    issuerTradeName: firstFilled(estabelecimento.nome_fantasia, data.nome_fantasia),
    issuerStateRegistration: stateRegistration,
    issuerEmail: firstFilled(estabelecimento.email, data.email),
    issuerPhone: firstFilled(phone, data.ddd_telefone_1),
    issuerZipCode: firstFilled(estabelecimento.cep, data.cep),
    issuerStreet: buildStreet(asCleanString(estabelecimento.tipo_logradouro), asCleanString(estabelecimento.logradouro)),
    issuerNumber: firstFilled(estabelecimento.numero, data.numero),
    issuerComplement: firstFilled(estabelecimento.complemento, data.complemento),
    issuerNeighborhood: firstFilled(estabelecimento.bairro, data.bairro),
    issuerCity: firstFilled(cidade.nome, data.municipio),
    issuerState: uf,
  };
}

async function fetchProvider(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });

    let data: Record<string, unknown> = {};
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }

    if (!response.ok) {
      const message = asCleanString(data.message) || asCleanString(data.error) || `Falha ${response.status}`;
      return { ok: false, data, error: message, status: response.status };
    }

    return { ok: true, data, error: '', status: response.status };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, data: {}, error: 'Tempo esgotado na consulta.', status: 504 };
    }
    return { ok: false, data: {}, error: 'Falha de comunicacao na consulta.', status: 502 };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ document: string }> },
) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { document } = await context.params;
  const digits = onlyDigits(document);

  if (digits.length !== 14) {
    return NextResponse.json({ error: 'Informe um CNPJ com 14 digitos.' }, { status: 400 });
  }

  const providersTried: string[] = [];
  let mergedPayload: Partial<IssuerLookupPayload> = {};

  try {
    const brasilApi = await fetchProvider(`https://brasilapi.com.br/api/cnpj/v1/${digits}`);
    if (brasilApi.ok) {
      mergedPayload = mergeLookupPayload(mergedPayload, mapBrasilApiToIssuer(brasilApi.data));
    } else {
      providersTried.push(`BrasilAPI: ${brasilApi.error}`);
    }

    const shouldTryCnpjWs =
      !hasUsefulPayload(mergedPayload) ||
      !asCleanString(mergedPayload.issuerStreet) ||
      !asCleanString(mergedPayload.issuerNumber) ||
      !asCleanString(mergedPayload.issuerEmail);

    if (shouldTryCnpjWs) {
      const cnpjWs = await fetchProvider(`https://publica.cnpj.ws/cnpj/${digits}`);
      if (cnpjWs.ok) {
        mergedPayload = mergeLookupPayload(mergedPayload, mapCnpjWsToIssuer(cnpjWs.data));
      } else {
        providersTried.push(`CNPJ.ws: ${cnpjWs.error}`);
      }
    }

    if (!hasUsefulPayload(mergedPayload)) {
      const message =
        providersTried.length > 0
          ? `Nao foi possivel consultar o CNPJ. ${providersTried.join(' | ')}`
          : 'Nao foi possivel consultar o CNPJ.';
      return NextResponse.json({ error: message }, { status: 502 });
    }

    return NextResponse.json(normalizeLookupPayload(mergedPayload));
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Tempo esgotado ao consultar o CNPJ. Tente novamente em instantes.' },
        { status: 504 },
      );
    }

    return NextResponse.json(
      { error: 'Nao foi possivel consultar o CNPJ no momento.' },
      { status: 502 },
    );
  }
}
