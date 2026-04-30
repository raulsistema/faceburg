import { NextResponse } from 'next/server';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function asCleanString(value: unknown) {
  return String(value ?? '').trim();
}

function buildStreet(data: Record<string, unknown>) {
  return [asCleanString(data.descricao_tipo_de_logradouro), asCleanString(data.logradouro)]
    .filter(Boolean)
    .join(' ')
    .trim();
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      cache: 'no-store',
      headers: {
        accept: 'application/json',
      },
      signal: controller.signal,
    });

    let data: Record<string, unknown> = {};
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      data = {};
    }

    if (!response.ok) {
      const message = asCleanString(data.message) || asCleanString(data.error) || 'Nao foi possivel consultar o CNPJ.';
      return NextResponse.json(
        { error: message },
        { status: response.status >= 500 ? 502 : response.status },
      );
    }

    return NextResponse.json({
      issuerName: asCleanString(data.razao_social),
      issuerTradeName: asCleanString(data.nome_fantasia),
      issuerStateRegistration: asCleanString(data.inscricao_estadual),
      issuerEmail: asCleanString(data.email),
      issuerPhone: asCleanString(data.ddd_telefone_1),
      issuerZipCode: asCleanString(data.cep),
      issuerStreet: buildStreet(data),
      issuerNumber: asCleanString(data.numero),
      issuerComplement: asCleanString(data.complemento),
      issuerNeighborhood: asCleanString(data.bairro),
      issuerCity: asCleanString(data.municipio),
      issuerState: asCleanString(data.uf).toUpperCase(),
    });
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
  } finally {
    clearTimeout(timeout);
  }
}
