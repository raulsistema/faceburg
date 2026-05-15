import DashboardShell from '@/components/layout/DashboardShell';
import { query } from '@/lib/db';
import { ensureOrderSequenceSchema } from '@/lib/order-sequence';
import { ensureStoreHoursSchema, isMenuOpenNow } from '@/lib/store-hours';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import EmitenteSettings from './EmitenteSettings';
import HubAutomationSettings from './HubAutomationSettings';
import MenuHoursSettings from './MenuHoursSettings';
import OrderSoundSettings from './OrderSoundSettings';
import OrderSequenceSettings from './OrderSequenceSettings';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  logo_url: string | null;
  prep_time_minutes: number;
  delivery_fee_base: string;
  store_open: boolean;
  menu_open_mode: string | null;
  menu_hours: unknown;
  order_notification_sound: string | null;
  order_sequence_start: number | null;
  whatsapp_phone: string | null;
  issuer_name: string | null;
  issuer_trade_name: string | null;
  issuer_document: string | null;
  issuer_state_registration: string | null;
  issuer_email: string | null;
  issuer_phone: string | null;
  issuer_zip_code: string | null;
  issuer_street: string | null;
  issuer_number: string | null;
  issuer_complement: string | null;
  issuer_neighborhood: string | null;
  issuer_city: string | null;
  issuer_state: string | null;
};

export default async function SettingsPage() {
  const session = await getValidatedTenantSession();
  if (session) {
    await Promise.all([ensureOrderSequenceSchema(), ensureStoreHoursSchema()]);
  }

  const tenantResult = session
    ? await query<TenantRow>(
        `SELECT
          id,
          name,
          slug,
          plan,
          status,
          logo_url,
          prep_time_minutes,
          delivery_fee_base::text,
          store_open,
          menu_open_mode,
          menu_hours,
          order_notification_sound,
          order_sequence_start,
          whatsapp_phone,
          issuer_name,
          issuer_trade_name,
          issuer_document,
          issuer_state_registration,
          issuer_email,
          issuer_phone,
          issuer_zip_code,
          issuer_street,
          issuer_number,
          issuer_complement,
          issuer_neighborhood,
          issuer_city,
          issuer_state
         FROM tenants
         WHERE id = $1
         LIMIT 1`,
        [session.tenantId],
      )
    : null;

  const tenant = tenantResult?.rows[0] || null;

  const shellData = session && tenant
    ? {
        authenticated: true,
        user: {
          id: session.userId,
          name: session.name,
          email: session.email,
          role: session.role,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          plan: tenant.plan,
        },
      }
    : null;

  const emitenteInitialData = tenant
    ? {
        prepTimeMinutes: Number(tenant.prep_time_minutes || 40),
        deliveryFeeBase: Number(tenant.delivery_fee_base || 0),
        storeOpen: Boolean(tenant.store_open),
        logoUrl: tenant.logo_url || '',
        whatsappPhone: tenant.whatsapp_phone || '',
        issuerName: tenant.issuer_name || '',
        issuerTradeName: tenant.issuer_trade_name || '',
        issuerDocument: tenant.issuer_document || '',
        issuerStateRegistration: tenant.issuer_state_registration || '',
        issuerEmail: tenant.issuer_email || '',
        issuerPhone: tenant.issuer_phone || '',
        issuerZipCode: tenant.issuer_zip_code || '',
        issuerStreet: tenant.issuer_street || '',
        issuerNumber: tenant.issuer_number || '',
        issuerComplement: tenant.issuer_complement || '',
        issuerNeighborhood: tenant.issuer_neighborhood || '',
        issuerCity: tenant.issuer_city || '',
        issuerState: tenant.issuer_state || '',
      }
    : null;

  const orderSoundInitialData = tenant
    ? {
        orderNotificationSound: tenant.order_notification_sound || 'classic',
      }
    : null;

  const menuHoursInitialData = tenant
    ? {
        storeOpen: Boolean(tenant.store_open),
        effectiveStoreOpen: isMenuOpenNow({
          manualOpen: Boolean(tenant.store_open),
          mode: tenant.menu_open_mode,
          hours: tenant.menu_hours,
        }),
        menuOpenMode: tenant.menu_open_mode === 'schedule' ? 'schedule' as const : 'manual' as const,
        menuHours: tenant.menu_hours as
          | {
              days: Record<string, { enabled: boolean; open: string; close: string }>;
            }
          | undefined,
      }
    : null;

  const orderSequenceInitialData = tenant
    ? {
        orderSequenceStart: tenant.order_sequence_start ?? null,
      }
    : null;

  return (
    <DashboardShell initialData={shellData}>
      <div className="max-w-5xl space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-2">Configuracoes da Empresa</h2>
          <p className="text-sm text-slate-500">Area inicial para gestao SaaS por tenant.</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-sm uppercase tracking-widest text-slate-500 font-bold mb-4">Tenant</h3>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-500">Empresa</p>
              <p className="font-semibold text-slate-900">{tenant?.name || '-'}</p>
            </div>
            <div>
              <p className="text-slate-500">Slug</p>
              <p className="font-semibold text-slate-900">{tenant?.slug || '-'}</p>
            </div>
            <div>
              <p className="text-slate-500">Plano</p>
              <p className="font-semibold text-slate-900">{tenant?.plan || '-'}</p>
            </div>
            <div>
              <p className="text-slate-500">Status</p>
              <p className="font-semibold text-slate-900">{tenant?.status || '-'}</p>
            </div>
          </div>
        </div>

        <EmitenteSettings initialData={emitenteInitialData} />
        <MenuHoursSettings initialData={menuHoursInitialData} />
        <OrderSoundSettings initialData={orderSoundInitialData} />
        <HubAutomationSettings />
        <OrderSequenceSettings initialData={orderSequenceInitialData} />
      </div>
    </DashboardShell>
  );
}
