import { NextResponse } from 'next/server';
import { getPublicDeliveryTracking } from '@/lib/delivery-tracking';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tracking = await getPublicDeliveryTracking(token);
  if (!tracking) {
    return NextResponse.json({ error: 'Rastreamento nao encontrado.' }, { status: 404 });
  }

  return NextResponse.json({ tracking }, {
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  });
}
