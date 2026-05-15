import PublicMenuClient from '@/components/public-menu/PublicMenuClient';
import { getPublicMenuData } from '@/lib/public-menu-data';

type PublicMenuPageProps = {
  params: Promise<{ tenantSlug: string }>;
};

export default async function PublicMenuPage({ params }: PublicMenuPageProps) {
  const { tenantSlug } = await params;
  const result = await getPublicMenuData(tenantSlug);

  return (
    <PublicMenuClient
      tenantSlug={tenantSlug}
      initialData={result.ok ? result.data : null}
    />
  );
}
