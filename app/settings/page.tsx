import DashboardShell from '@/components/layout/DashboardShell';
import { query } from '@/lib/db';
import { normalizePrintCopies, normalizePrintEvents, normalizeReceiptOptions, normalizeReceiptText, normalizeReceiptWidth } from '@/lib/print-settings';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import PrintAgentSettings from './PrintAgentSettings';
import WhatsAppAgentSettings from './WhatsAppAgentSettings';
import EmitenteSettings from './EmitenteSettings';

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

type PrintAgentRow = {
  enabled: boolean;
  agent_key: string | null;
  printer_name: string | null;
  receipt_width: number | null;
  print_copies: number | null;
  print_events: unknown | null;
  receipt_options: unknown | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  last_seen_at: string | null;
};

type WhatsAppAgentRow = {
  enabled: boolean;
  agent_key: string | null;
  session_status: string | null;
  qr_code: string | null;
  phone_number: string | null;
  last_seen_at: string | null;
};

export default async function SettingsPage() {
  const session = await getValidatedTenantSession();

  const [tenantResult, printResult, whatsappResult] = session
    ? await Promise.all([
        query<TenantRow>(
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
        ),
        query<PrintAgentRow>(
          `SELECT enabled,
                  agent_key,
                  printer_name,
                  receipt_width,
                  print_copies,
                  print_events,
                  receipt_options,
                  receipt_header,
                  receipt_footer,
                  last_seen_at
           FROM printer_agents
           WHERE tenant_id = $1
           LIMIT 1`,
          [session.tenantId],
        ),
        query<WhatsAppAgentRow>(
          `SELECT enabled, agent_key, session_status, qr_code, phone_number, last_seen_at
           FROM whatsapp_agents
           WHERE tenant_id = $1
           LIMIT 1`,
          [session.tenantId],
        ),
      ])
    : [null, null, null];

  const tenant = tenantResult?.rows[0] || null;
  const printAgent = printResult?.rows[0] || null;
  const whatsappAgent = whatsappResult?.rows[0] || null;

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

  const printInitialData = tenant
    ? {
        enabled: Boolean(printAgent?.enabled),
        hasAgentKey: Boolean(printAgent?.agent_key),
        agentKey: printAgent?.agent_key || '',
        printerName: printAgent?.printer_name || '',
        receiptWidth: normalizeReceiptWidth(printAgent?.receipt_width),
        printCopies: normalizePrintCopies(printAgent?.print_copies),
        printEvents: normalizePrintEvents(printAgent?.print_events),
        receiptOptions: normalizeReceiptOptions(printAgent?.receipt_options),
        receiptHeader: normalizeReceiptText(printAgent?.receipt_header),
        receiptFooter: normalizeReceiptText(printAgent?.receipt_footer),
        lastSeenAt: printAgent?.last_seen_at || null,
      }
    : null;

  const whatsappInitialData = tenant
    ? {
        enabled: Boolean(whatsappAgent?.enabled),
        hasAgentKey: Boolean(whatsappAgent?.agent_key),
        agentKey: whatsappAgent?.agent_key || '',
        sessionStatus: whatsappAgent?.session_status || 'disconnected',
        qrCode: whatsappAgent?.qr_code || '',
        phoneNumber: whatsappAgent?.phone_number || '',
        lastSeenAt: whatsappAgent?.last_seen_at || null,
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
        <PrintAgentSettings initialData={printInitialData} />
        <WhatsAppAgentSettings initialData={whatsappInitialData} />
      </div>
    </DashboardShell>
  );
}
