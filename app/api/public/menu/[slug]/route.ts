import { NextResponse } from 'next/server';
import { getPublicMenuData, PUBLIC_MENU_CACHE_HEADERS, PUBLIC_MENU_PRODUCT_PAGE_SIZE } from '@/lib/public-menu-data';

function getProductQuery(request: Request) {
  const url = new URL(request.url);
  return {
    limit: Number(url.searchParams.get('limit') || PUBLIC_MENU_PRODUCT_PAGE_SIZE),
    offset: Number(url.searchParams.get('offset') || 0),
    search: url.searchParams.get('search') || '',
    categoryId: url.searchParams.get('categoryId') || '',
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const result = await getPublicMenuData(slug, getProductQuery(request));

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.data, { headers: PUBLIC_MENU_CACHE_HEADERS });
  } catch (error) {
    console.error('[public-menu] failed to load menu', error);
    return NextResponse.json({ error: 'Falha ao carregar cardapio.' }, { status: 500 });
  }
}
