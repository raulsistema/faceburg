import { NextResponse } from 'next/server';

function onlyDigits(value: string) {
  return value.replace(/\D/g, '');
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ zip: string }> },
) {
  const { zip } = await context.params;
  const digits = onlyDigits(zip);

  if (digits.length !== 8) {
    return NextResponse.json({ error: 'Informe um CEP com 8 digitos.' }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
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
      return NextResponse.json({ error: 'Nao foi possivel consultar o CEP.' }, { status: 502 });
    }

    if (data.erro) {
      return NextResponse.json({ error: 'CEP nao encontrado.' }, { status: 404 });
    }

    return NextResponse.json({
      zipCode: text(data.cep),
      street: text(data.logradouro),
      neighborhood: text(data.bairro),
      city: text(data.localidade),
      state: text(data.uf).toUpperCase(),
      complement: text(data.complemento),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Tempo esgotado ao consultar o CEP. Tente novamente.' },
        { status: 504 },
      );
    }

    return NextResponse.json({ error: 'Nao foi possivel consultar o CEP.' }, { status: 502 });
  } finally {
    clearTimeout(timeout);
  }
}
