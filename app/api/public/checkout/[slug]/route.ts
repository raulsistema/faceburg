import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { quoteDeliveryFee } from '@/lib/delivery-fee';
import { parseMoneyInput } from '@/lib/finance-utils';
import { enqueueOrderPrintJob } from '@/lib/printing';
import { notifyOrderEvent } from '@/lib/realtime';
import { enqueueOrderWhatsappJob } from '@/lib/whatsapp';

class CheckoutValidationError extends Error {}

type TenantRow = {
  id: string;
  slug: string;
  status: string;
  store_open: boolean;
  delivery_fee_base: string;
  delivery_fee_mode: string;
  delivery_fee_per_km: string;
  issuer_street: string | null;
  issuer_number: string | null;
  issuer_neighborhood: string | null;
  issuer_city: string | null;
  issuer_state: string | null;
  issuer_zip_code: string | null;
  delivery_origin_use_issuer: boolean;
  delivery_origin_street: string | null;
  delivery_origin_number: string | null;
  delivery_origin_complement: string | null;
  delivery_origin_neighborhood: string | null;
  delivery_origin_city: string | null;
  delivery_origin_state: string | null;
  delivery_origin_zip_code: string | null;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  method_type: string;
  fee_percent: string;
  fee_fixed: string;
};

type CustomerRow = {
  id: string;
};

type ExistingCheckoutOrderRow = {
  id: string;
  total: string;
  delivery_fee_amount: string;
};

type AddressRow = {
  id: string;
  label: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  reference: string | null;
  is_default: boolean;
};

type ProductRow = {
  id: string;
  category_id: string;
  name: string;
  price: string;
  available: boolean;
  product_type: string;
  product_meta: Record<string, unknown>;
};

type OptionRow = {
  id: string;
  group_id: string;
  product_id: string;
  name: string;
  price_addition: string;
  active: boolean;
};

type OptionGroupRow = {
  id: string;
  product_id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: boolean;
};

type CheckoutItemInput = {
  productId: string;
  quantity: number;
  selectedOptionIds?: string[];
  notes?: string;
  pizzaSelection?: {
    sizeLabel?: string;
    flavorIds?: string[];
    borderLabel?: string;
    doughLabel?: string;
    giftDrinkId?: string;
  } | null;
};

let checkoutKeySchemaPromise: Promise<void> | null = null;

function getDatabaseErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return '';
  return String((error as { code?: unknown }).code || '');
}

function isUniqueViolation(error: unknown) {
  return getDatabaseErrorCode(error) === '23505';
}

async function ensureCheckoutKeySchema() {
  if (!checkoutKeySchemaPromise) {
    checkoutKeySchemaPromise = (async () => {
      await query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'public_checkout_key'
          ) THEN
            ALTER TABLE orders ADD COLUMN public_checkout_key TEXT;
          END IF;
        END $$;
      `);
      await query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            WHERE c.relkind = 'i'
              AND c.relname = 'idx_orders_tenant_public_checkout_key'
          ) THEN
            EXECUTE 'CREATE UNIQUE INDEX idx_orders_tenant_public_checkout_key ON orders(tenant_id, public_checkout_key) WHERE public_checkout_key IS NOT NULL';
          END IF;
        END $$;
      `);
    })().catch((error) => {
      checkoutKeySchemaPromise = null;
      throw error;
    });
  }

  await checkoutKeySchemaPromise;
}

function getSizePrice(
  productMeta: Record<string, unknown>,
  sizeLabel: string,
) {
  if (!Array.isArray(productMeta?.sizes)) return 0;
  for (const size of productMeta.sizes) {
    if (!size || typeof size !== 'object') continue;
    const record = size as Record<string, unknown>;
    if (String(record.label || '').trim() === sizeLabel) {
      const price = Number(record.price || 0);
      return price > 0 ? price : 0;
    }
  }
  return 0;
}

function getBorderPrice(productMeta: Record<string, unknown>, borderLabel: string) {
  if (!Array.isArray(productMeta?.borders)) return 0;
  for (const border of productMeta.borders) {
    if (!border || typeof border !== 'object') continue;
    const record = border as Record<string, unknown>;
    if (String(record.label || '').trim() === borderLabel) {
      const price = Number(record.price || 0);
      return price >= 0 ? price : 0;
    }
  }
  return -1;
}

function getDoughPrice(productMeta: Record<string, unknown>, doughLabel: string) {
  if (!Array.isArray(productMeta?.doughs)) return 0;
  for (const dough of productMeta.doughs) {
    if (!dough || typeof dough !== 'object') continue;
    const record = dough as Record<string, unknown>;
    if (String(record.label || '').trim() === doughLabel) {
      const price = Number(record.price || 0);
      return price >= 0 ? price : 0;
    }
  }
  return -1;
}

function getGiftRule(
  productMeta: Record<string, unknown>,
  sizeLabel: string,
) {
  if (!Array.isArray(productMeta?.giftRules)) return null;
  for (const rule of productMeta.giftRules) {
    if (!rule || typeof rule !== 'object') continue;
    const record = rule as Record<string, unknown>;
    if (String(record.sizeLabel || '').trim() === sizeLabel) {
      const drinkName = String(record.drinkName || '').trim();
      const quantity = Math.max(1, Number(record.quantity || 1));
      if (!drinkName) return null;
      return { drinkName, quantity };
    }
  }
  return null;
}

function getPizzaConfig(productMeta: Record<string, unknown>) {
  const fallback = {
    allowHalfAndHalf: false,
    maxFlavors: 1,
  };
  if (!productMeta || typeof productMeta.pizzaConfig !== 'object' || !productMeta.pizzaConfig) {
    return fallback;
  }

  const config = productMeta.pizzaConfig as Record<string, unknown>;
  const maxFlavors = Math.max(1, Number(config.maxFlavors || 2));
  return {
    allowHalfAndHalf: config.allowHalfAndHalf !== false,
    maxFlavors,
  };
}

function normalizePaymentMethod(value: string) {
  const method = value.trim().toLowerCase();
  if (['cash', 'card', 'pix', 'bank_slip', 'wallet', 'other'].includes(method)) {
    return method;
  }
  return 'pix';
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function normalizeOrderType(value: string) {
  const type = value.trim().toLowerCase();
  if (type === 'delivery' || type === 'pickup' || type === 'table') {
    return type;
  }
  return 'delivery';
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

function normalizeCheckoutKey(value: unknown) {
  const key = String(value || '').trim();
  if (!key) return '';
  return key.replace(/[^a-zA-Z0-9:_-]/g, '').slice(0, 96);
}

function formatAddressLine(address: AddressRow) {
  const main = [address.street, address.number].filter(Boolean).join(', ');
  const area = [address.neighborhood, address.city, address.state].filter(Boolean).join(' - ');
  const extra = [address.complement, address.reference].filter(Boolean).join(' | ');
  return [main, area, extra].filter(Boolean).join(' | ');
}

async function findExistingCheckoutOrder(tenantId: string, checkoutKey: string) {
  if (!checkoutKey) return null;
  await ensureCheckoutKeySchema();
  const result = await query<ExistingCheckoutOrderRow>(
    `SELECT id, total::text, delivery_fee_amount::text
     FROM orders
     WHERE tenant_id = $1
       AND public_checkout_key = $2
     LIMIT 1`,
    [tenantId, checkoutKey],
  );
  return result.rows[0] || null;
}

function serializeExistingCheckoutOrder(row: ExistingCheckoutOrderRow) {
  return NextResponse.json({
    ok: true,
    orderId: row.id,
    total: roundMoney(Number(row.total || 0)),
    deliveryFeeAmount: roundMoney(Number(row.delivery_fee_amount || 0)),
    reused: true,
    message: 'Pedido recebido com sucesso.',
    communication: {
      printQueued: false,
      whatsappQueued: false,
      realtimeNotified: false,
    },
  });
}

function wasJobQueued(result: PromiseSettledResult<boolean>) {
  return result.status === 'fulfilled' && result.value === true;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  let client: PoolClient | null = null;
  let checkoutKey = '';
  let checkoutTenantId = '';

  try {
    const { slug } = await params;
    let body: Record<string, unknown> = {};

    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Corpo da requisicao invalido.' }, { status: 400 });
    }

    const customerName = String(body.customerName || '').trim();
    const customerPhone = String(body.customerPhone || '').trim();
    const customerPhoneDigits = normalizePhone(customerPhone);
    const customerEmail = String(body.customerEmail || '').trim();
    const customerIsCompany = Boolean(body.customerIsCompany);
    const customerCompanyName = String(body.customerCompanyName || '').trim();
    const customerDocumentNumber = String(body.customerDocumentNumber || '').trim();
    checkoutKey = normalizeCheckoutKey(body.checkoutKey);
    const deliveryAddress = String(body.deliveryAddress || '').trim();
    const selectedAddressId = String(body.selectedAddressId || '').trim();
    const addressRecord = body.address && typeof body.address === 'object' ? (body.address as Record<string, unknown>) : null;
    const addressPayload =
      addressRecord
        ? {
            label: String(addressRecord.label || '').trim(),
            street: String(addressRecord.street || '').trim(),
            number: String(addressRecord.number || '').trim(),
            complement: String(addressRecord.complement || '').trim(),
            neighborhood: String(addressRecord.neighborhood || '').trim(),
            city: String(addressRecord.city || '').trim(),
            state: String(addressRecord.state || '').trim(),
            zipCode: String(addressRecord.zipCode || '').trim(),
            reference: String(addressRecord.reference || '').trim(),
          }
        : null;
    const paymentMethod = normalizePaymentMethod(String(body.paymentMethod || 'pix'));
    const paymentMethodId = String(body.paymentMethodId || '').trim();
    const orderType = normalizeOrderType(String(body.orderType || 'delivery'));
    const changeForRaw = parseMoneyInput(body.changeFor);
    const changeFor = Number.isFinite(changeForRaw) && changeForRaw > 0 ? changeForRaw : null;
    const items = (body.items || []) as CheckoutItemInput[];

    if (!customerName || customerPhoneDigits.length < 10) {
      return NextResponse.json({ error: 'Nome e celular sao obrigatorios.' }, { status: 400 });
    }

    if (orderType === 'delivery' && !selectedAddressId && !(addressPayload?.street || deliveryAddress)) {
      return NextResponse.json({ error: 'Endereco obrigatorio para entrega.' }, { status: 400 });
    }

    if (orderType === 'delivery' && !selectedAddressId && !addressPayload?.number.trim()) {
      return NextResponse.json({ error: 'Numero do endereco obrigatorio para entrega.' }, { status: 400 });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Carrinho vazio.' }, { status: 400 });
    }

    const tenantResult = await query<TenantRow>(
      `SELECT id, slug, status, store_open, delivery_fee_base::text, delivery_fee_mode, delivery_fee_per_km::text, issuer_street, issuer_number, issuer_neighborhood, issuer_city, issuer_state, issuer_zip_code, delivery_origin_use_issuer, delivery_origin_street, delivery_origin_number, delivery_origin_complement, delivery_origin_neighborhood, delivery_origin_city, delivery_origin_state, delivery_origin_zip_code
       FROM tenants
       WHERE slug = $1
       LIMIT 1`,
      [slug],
    );
    if (!tenantResult.rowCount) {
      return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
    }

    const tenant = tenantResult.rows[0];
    checkoutTenantId = tenant.id;
    if (tenant.status !== 'active') {
      return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403 });
    }
    if (!tenant.store_open) {
      return NextResponse.json({ error: 'Delivery indisponivel no momento. Tente novamente mais tarde.' }, { status: 403 });
    }

    await ensureCheckoutKeySchema();
    const existingCheckoutOrder = await findExistingCheckoutOrder(tenant.id, checkoutKey);
    if (existingCheckoutOrder) {
      return serializeExistingCheckoutOrder(existingCheckoutOrder);
    }

    const normalizedItems = items
      .map((item) => ({
        productId: String(item.productId || '').trim(),
        quantity: Number(item.quantity || 0),
        selectedOptionIds: Array.isArray(item.selectedOptionIds)
          ? Array.from(new Set(item.selectedOptionIds.map((id) => String(id).trim()).filter(Boolean)))
          : [],
        notes: String(item.notes || '').trim(),
        pizzaSelection:
          item.pizzaSelection && typeof item.pizzaSelection === 'object'
            ? {
                sizeLabel: String(item.pizzaSelection.sizeLabel || '').trim(),
                flavorIds: Array.isArray(item.pizzaSelection.flavorIds)
                  ? Array.from(new Set(item.pizzaSelection.flavorIds.map((id) => String(id).trim()).filter(Boolean)))
                  : [],
                borderLabel: String(item.pizzaSelection.borderLabel || '').trim(),
                doughLabel: String(item.pizzaSelection.doughLabel || '').trim(),
                giftDrinkId: String(item.pizzaSelection.giftDrinkId || '').trim(),
              }
            : null,
      }))
      .filter((item) => item.productId && item.quantity > 0);

    if (!normalizedItems.length) {
      return NextResponse.json({ error: 'Itens invalidos.' }, { status: 400 });
    }

    const productIds = Array.from(
      new Set(
        normalizedItems.flatMap((item) => [
          item.productId,
          ...(item.pizzaSelection?.flavorIds || []),
          ...(item.pizzaSelection?.giftDrinkId ? [item.pizzaSelection.giftDrinkId] : []),
        ]),
      ),
    );
    const productsResult = await query<ProductRow>(
      `SELECT id, category_id, name, price::text, available, product_type, product_meta
       FROM products
       WHERE tenant_id = $1
         AND id = ANY($2::text[])
         AND status = 'published'`,
      [tenant.id, productIds],
    );

    const productMap = new Map(productsResult.rows.map((row) => [row.id, row]));

    const cartProductIds = Array.from(new Set(normalizedItems.map((item) => item.productId)));
    const optionGroupsByProduct = new Map<string, OptionGroupRow[]>();
    if (cartProductIds.length) {
      const optionGroupsResult = await query<OptionGroupRow>(
        `SELECT id, product_id, name, min_select, max_select, required
         FROM product_option_groups
         WHERE tenant_id = $1
           AND product_id = ANY($2::text[])`,
        [tenant.id, cartProductIds],
      );

      for (const group of optionGroupsResult.rows) {
        const current = optionGroupsByProduct.get(group.product_id) || [];
        current.push(group);
        optionGroupsByProduct.set(group.product_id, current);
      }
    }

    const optionIds = Array.from(new Set(normalizedItems.flatMap((item) => item.selectedOptionIds)));
    const optionsByProduct = new Map<string, OptionRow[]>();
    if (optionIds.length) {
      const optionsResult = await query<OptionRow>(
        `SELECT po.id, po.group_id, pog.product_id, po.name, po.price_addition::text, po.active
         FROM product_options po
         JOIN product_option_groups pog ON pog.id = po.group_id
         WHERE po.tenant_id = $1
           AND pog.tenant_id = $1
           AND po.id = ANY($2::text[])
           AND po.active = TRUE`,
        [tenant.id, optionIds],
      );

      for (const option of optionsResult.rows) {
        const current = optionsByProduct.get(option.product_id) || [];
        current.push(option);
        optionsByProduct.set(option.product_id, current);
      }
    }

    let total = 0;
    const resolvedItems = normalizedItems.map((item) => {
      const product = productMap.get(item.productId);
      if (!product || !product.available) {
        throw new CheckoutValidationError(`Produto invalido: ${item.productId}`);
      }

      const validOptions = optionsByProduct.get(item.productId) || [];
      const selectedOptions = validOptions.filter((option) => item.selectedOptionIds.includes(option.id));
      const selectedOptionIdsSet = new Set(selectedOptions.map((option) => option.id));
      for (const selectedOptionId of item.selectedOptionIds) {
        if (!selectedOptionIdsSet.has(selectedOptionId)) {
          throw new CheckoutValidationError(`Opcao invalida: ${selectedOptionId}`);
        }
      }

      const optionGroups = optionGroupsByProduct.get(item.productId) || [];
      const selectedCountByGroup = new Map<string, number>();
      for (const option of selectedOptions) {
        selectedCountByGroup.set(option.group_id, (selectedCountByGroup.get(option.group_id) || 0) + 1);
      }
      for (const group of optionGroups) {
        const selectedCount = selectedCountByGroup.get(group.id) || 0;
        const minSelect = Math.max(0, Number(group.min_select || 0));
        const requiredMin = group.required ? Math.max(1, minSelect) : minSelect;
        const maxSelect = Math.max(0, Number(group.max_select || 0));
        if (selectedCount < requiredMin) {
          throw new CheckoutValidationError(
            `Selecione pelo menos ${requiredMin} opcao(oes) em "${group.name}".`,
          );
        }
        if (maxSelect > 0 && selectedCount > maxSelect) {
          throw new CheckoutValidationError(
            `Selecione no maximo ${maxSelect} opcao(oes) em "${group.name}".`,
          );
        }
      }

      let basePrice = Number(product.price);
      let pizzaPayload: {
        sizeLabel: string;
        flavors: Array<{ id: string; name: string }>;
        border: { label: string; price: number } | null;
        dough: { label: string; price: number } | null;
        gift: { id: string; name: string; quantity: number } | null;
      } | null = null;

      if (product.product_type === 'size_based') {
        const sizeLabel = item.pizzaSelection?.sizeLabel || '';
        const pizzaConfig = getPizzaConfig(product.product_meta);
        const flavorIds = item.pizzaSelection?.flavorIds?.length
          ? Array.from(new Set(item.pizzaSelection.flavorIds))
          : [product.id];
        const borderLabel = item.pizzaSelection?.borderLabel || '';
        const doughLabel = item.pizzaSelection?.doughLabel || '';
        if (!sizeLabel) {
          throw new CheckoutValidationError('Selecione o tamanho da pizza.');
        }
        if (flavorIds.length > pizzaConfig.maxFlavors) {
          throw new CheckoutValidationError(`Esta pizza permite no maximo ${pizzaConfig.maxFlavors} sabor(es).`);
        }
        if (!pizzaConfig.allowHalfAndHalf && flavorIds.length > 1) {
          throw new CheckoutValidationError('Esta pizza permite apenas um sabor.');
        }

        const flavorProducts = flavorIds.map((flavorId) => productMap.get(flavorId));
        if (flavorProducts.some((flavor) => !flavor || !flavor.available)) {
          throw new CheckoutValidationError('Um dos sabores selecionados nao esta disponivel.');
        }

        const safeFlavorProducts = flavorProducts.filter((flavor): flavor is ProductRow => Boolean(flavor));
        if (safeFlavorProducts.some((flavor) => flavor.product_type !== 'size_based')) {
          throw new CheckoutValidationError('Sabores invalidos para pizza.');
        }
        if (safeFlavorProducts.some((flavor) => flavor.category_id !== product.category_id)) {
          throw new CheckoutValidationError('Os sabores devem ser da mesma categoria.');
        }

        const sizePrices = safeFlavorProducts.map((flavor) => getSizePrice(flavor.product_meta, sizeLabel));
        if (sizePrices.some((price) => !(price > 0))) {
          throw new CheckoutValidationError('Tamanho invalido para um dos sabores selecionados.');
        }

        basePrice = Math.max(...sizePrices);
        const borderPrice = borderLabel ? getBorderPrice(product.product_meta, borderLabel) : 0;
        if (borderLabel && borderPrice < 0) {
          throw new CheckoutValidationError('Borda invalida para esta pizza.');
        }
        const doughPrice = doughLabel ? getDoughPrice(product.product_meta, doughLabel) : 0;
        if (doughLabel && doughPrice < 0) {
          throw new CheckoutValidationError('Massa invalida para esta pizza.');
        }

        const giftRule = getGiftRule(product.product_meta, sizeLabel);
        let giftPayload: { id: string; name: string; quantity: number } | null = null;
        if (giftRule) {
          giftPayload = {
            id: '',
            name: giftRule.drinkName,
            quantity: giftRule.quantity,
          };
        }

        basePrice += Math.max(0, borderPrice) + Math.max(0, doughPrice);
        pizzaPayload = {
          sizeLabel,
          flavors: safeFlavorProducts.map((flavor) => ({
            id: flavor.id,
            name: flavor.name,
          })),
          border: borderLabel
            ? {
                label: borderLabel,
                price: Math.max(0, borderPrice),
              }
            : null,
          dough: doughLabel
            ? {
                label: doughLabel,
                price: Math.max(0, doughPrice),
              }
            : null,
          gift: giftPayload,
        };
      }

      const optionsTotal = selectedOptions.reduce((sum, option) => sum + Number(option.price_addition), 0);
      const unitPrice = basePrice + optionsTotal;
      const lineTotal = unitPrice * item.quantity;
      total += lineTotal;

      const notesPayload = {
        notes: item.notes || null,
        pizza: pizzaPayload,
        options: selectedOptions.map((option) => ({
          id: option.id,
          name: option.name,
          priceAddition: Number(option.price_addition),
        })),
      };

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        notes: JSON.stringify(notesPayload),
      };
    });

    if (!(total > 0)) {
      return NextResponse.json({ error: 'Total invalido.' }, { status: 400 });
    }

    const subtotalAmount = roundMoney(total);
    let selectedPaymentMethod: PaymentMethodRow | null = null;
    if (paymentMethodId) {
      const byId = await query<PaymentMethodRow>(
        `SELECT id, name, method_type, fee_percent::text, fee_fixed::text
         FROM payment_methods
         WHERE tenant_id = $1
           AND id = $2
           AND active = TRUE
         LIMIT 1`,
        [tenant.id, paymentMethodId],
      );
      selectedPaymentMethod = byId.rows[0] || null;
      if (!selectedPaymentMethod) {
        return NextResponse.json({ error: 'Forma de pagamento invalida ou inativa.' }, { status: 400 });
      }
    } else {
      const byType = await query<PaymentMethodRow>(
        `SELECT id, name, method_type, fee_percent::text, fee_fixed::text
         FROM payment_methods
         WHERE tenant_id = $1
           AND method_type = $2
           AND active = TRUE
         ORDER BY created_at ASC
         LIMIT 1`,
        [tenant.id, paymentMethod],
      );
      selectedPaymentMethod = byType.rows[0] || null;
    }

    if (!selectedPaymentMethod) {
      return NextResponse.json(
        { error: 'A loja ainda nao configurou uma forma de pagamento valida para este pedido.' },
        { status: 400 },
      );
    }

    const resolvedPaymentMethod = selectedPaymentMethod.method_type;
    if (
      resolvedPaymentMethod === 'cash' &&
      String(body.changeFor ?? '').trim() &&
      (!Number.isFinite(changeForRaw) || changeForRaw < 0)
    ) {
      throw new CheckoutValidationError('Informe um valor valido para troco.');
    }

    const dbClient = await pool.connect();
    client = dbClient;
    await dbClient.query('BEGIN');

    const existingCustomerResult = await dbClient.query<CustomerRow>(
      `SELECT id
       FROM customers
       WHERE tenant_id = $1
         AND regexp_replace(phone, '\D', '', 'g') = $2
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenant.id, customerPhoneDigits],
    );

    let customerId = '';
    if (existingCustomerResult.rowCount) {
      customerId = existingCustomerResult.rows[0].id;
      await dbClient.query(
        `UPDATE customers
         SET name = $3,
             phone = $4,
             email = NULLIF($5, ''),
             is_company = $6,
             company_name = NULLIF($7, ''),
             document_number = NULLIF($8, ''),
             status = 'active'
         WHERE id = $1 AND tenant_id = $2`,
        [
          customerId,
          tenant.id,
          customerName,
          customerPhoneDigits,
          customerEmail,
          customerIsCompany,
          customerCompanyName,
          customerDocumentNumber,
        ],
      );
    } else {
      customerId = randomUUID();
      await dbClient.query(
        `INSERT INTO customers (id, tenant_id, name, phone, email, is_company, company_name, document_number, status)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, NULLIF($7, ''), NULLIF($8, ''), 'active')`,
        [
          customerId,
          tenant.id,
          customerName,
          customerPhoneDigits,
          customerEmail,
          customerIsCompany,
          customerCompanyName,
          customerDocumentNumber,
        ],
      );
    }

    let resolvedDeliveryAddress = '';
    let resolvedDeliveryAddressInput:
      | {
          street: string;
          number: string;
          neighborhood: string;
          city: string;
          state: string;
          zipCode: string;
          reference: string;
          freeform: string;
        }
      | { freeform: string }
      | null = null;
    if (orderType === 'delivery') {
      if (selectedAddressId) {
        const selectedAddressResult = await dbClient.query<AddressRow>(
          `SELECT id, label, street, number, complement, neighborhood, city, state, zip_code, reference, is_default
           FROM customer_addresses
           WHERE id = $1
             AND tenant_id = $2
             AND customer_id = $3
             AND active = TRUE
           LIMIT 1`,
          [selectedAddressId, tenant.id, customerId],
        );
        if (!selectedAddressResult.rowCount) {
          throw new CheckoutValidationError('Endereco selecionado nao encontrado.');
        }
        if (!String(selectedAddressResult.rows[0].number || '').trim()) {
          throw new CheckoutValidationError('Endereco selecionado precisa ter numero.');
        }
        const selectedAddress = selectedAddressResult.rows[0];
        resolvedDeliveryAddress = formatAddressLine(selectedAddress);
        resolvedDeliveryAddressInput = {
          street: String(selectedAddress.street || '').trim(),
          number: String(selectedAddress.number || '').trim(),
          neighborhood: String(selectedAddress.neighborhood || '').trim(),
          city: String(selectedAddress.city || '').trim(),
          state: String(selectedAddress.state || '').trim().toUpperCase(),
          zipCode: String(selectedAddress.zip_code || '').trim(),
          reference: String(selectedAddress.reference || '').trim(),
          freeform: resolvedDeliveryAddress,
        };
      } else if (addressPayload?.street) {
        if (!addressPayload.number.trim()) {
          throw new CheckoutValidationError('Numero do endereco obrigatorio para entrega.');
        }
        const firstAddressResult = await dbClient.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total
           FROM customer_addresses
           WHERE tenant_id = $1
             AND customer_id = $2
             AND active = TRUE`,
          [tenant.id, customerId],
        );
        const isFirst = Number(firstAddressResult.rows[0]?.total || 0) === 0;
        const insertedAddressResult = await dbClient.query<AddressRow>(
          `INSERT INTO customer_addresses
            (id, tenant_id, customer_id, label, street, number, complement, neighborhood, city, state, zip_code, reference, active, is_default)
           VALUES
            ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), TRUE, $13)
           RETURNING id, label, street, number, complement, neighborhood, city, state, zip_code, reference, is_default`,
          [
            randomUUID(),
            tenant.id,
            customerId,
            addressPayload.label,
            addressPayload.street,
            addressPayload.number,
            addressPayload.complement,
            addressPayload.neighborhood,
            addressPayload.city,
            addressPayload.state,
            addressPayload.zipCode,
            addressPayload.reference,
            isFirst,
          ],
        );
        const insertedAddress = insertedAddressResult.rows[0];
        resolvedDeliveryAddress = formatAddressLine(insertedAddress);
        resolvedDeliveryAddressInput = {
          street: String(insertedAddress.street || '').trim(),
          number: String(insertedAddress.number || '').trim(),
          neighborhood: String(insertedAddress.neighborhood || '').trim(),
          city: String(insertedAddress.city || '').trim(),
          state: String(insertedAddress.state || '').trim().toUpperCase(),
          zipCode: String(insertedAddress.zip_code || '').trim(),
          reference: String(insertedAddress.reference || '').trim(),
          freeform: resolvedDeliveryAddress,
        };
      } else {
        resolvedDeliveryAddress = deliveryAddress;
        resolvedDeliveryAddressInput = {
          freeform: resolvedDeliveryAddress,
        };
        if (resolvedDeliveryAddress) {
          const existingAddressResult = await dbClient.query<{ id: string }>(
            `SELECT id
             FROM customer_addresses
             WHERE tenant_id = $1
               AND customer_id = $2
               AND active = TRUE
               AND lower(trim(street)) = lower(trim($3))
             LIMIT 1`,
            [tenant.id, customerId, resolvedDeliveryAddress],
          );
          if (!existingAddressResult.rowCount) {
            const firstAddressResult = await dbClient.query<{ total: string }>(
              `SELECT COUNT(*)::text AS total
               FROM customer_addresses
               WHERE tenant_id = $1
                 AND customer_id = $2
                 AND active = TRUE`,
              [tenant.id, customerId],
            );
            const isFirst = Number(firstAddressResult.rows[0]?.total || 0) === 0;
            await dbClient.query(
              `INSERT INTO customer_addresses
                (id, tenant_id, customer_id, label, street, number, complement, neighborhood, city, state, zip_code, reference, active, is_default)
               VALUES
                ($1, $2, $3, 'Endereco entrega', $4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, TRUE, $5)`,
              [randomUUID(), tenant.id, customerId, resolvedDeliveryAddress, isFirst],
            );
          }
        }
      }
    }

    const deliveryFeeQuote =
      orderType === 'delivery'
        ? await quoteDeliveryFee(
            {
              slug: tenant.slug,
              issuerStreet: tenant.issuer_street,
              issuerNumber: tenant.issuer_number,
              issuerNeighborhood: tenant.issuer_neighborhood,
              issuerCity: tenant.issuer_city,
              issuerState: tenant.issuer_state,
              issuerZipCode: tenant.issuer_zip_code,
              deliveryOriginUseIssuer: tenant.delivery_origin_use_issuer,
              deliveryOriginStreet: tenant.delivery_origin_street,
              deliveryOriginNumber: tenant.delivery_origin_number,
              deliveryOriginComplement: tenant.delivery_origin_complement,
              deliveryOriginNeighborhood: tenant.delivery_origin_neighborhood,
              deliveryOriginCity: tenant.delivery_origin_city,
              deliveryOriginState: tenant.delivery_origin_state,
              deliveryOriginZipCode: tenant.delivery_origin_zip_code,
              deliveryFeeBase: tenant.delivery_fee_base,
              deliveryFeeMode: tenant.delivery_fee_mode,
              deliveryFeePerKm: tenant.delivery_fee_per_km,
            },
            resolvedDeliveryAddressInput || {
              freeform: resolvedDeliveryAddress,
            },
          )
        : null;

    const deliveryFeeAmount = orderType === 'delivery' ? deliveryFeeQuote?.deliveryFeeAmount ?? roundMoney(Number(tenant.delivery_fee_base || 0)) : 0;
    const baseTotal = roundMoney(subtotalAmount + deliveryFeeAmount);
    const feePercent = Number(selectedPaymentMethod.fee_percent || 0);
    const feeFixed = Number(selectedPaymentMethod.fee_fixed || 0);
    const paymentFeeAmount = roundMoney(baseTotal * (feePercent / 100) + feeFixed);
    const orderTotal = baseTotal;
    const paymentNetAmount = roundMoney(orderTotal - paymentFeeAmount);

    if (paymentNetAmount < 0) {
      throw new CheckoutValidationError('A taxa configurada para essa forma excede o valor do pedido.');
    }

    if (resolvedPaymentMethod === 'cash' && changeFor && changeFor < orderTotal) {
      throw new CheckoutValidationError('Troco deve ser maior ou igual ao total.');
    }

    const orderId = randomUUID();
    await dbClient.query(
      `INSERT INTO orders
       (
         id,
         tenant_id,
         customer_name,
         customer_phone,
         delivery_address,
         payment_method,
         payment_method_id,
         subtotal_amount,
         discount_amount,
         surcharge_amount,
         delivery_fee_amount,
         payment_fee_amount,
         payment_net_amount,
         change_for,
         total,
         status,
         type,
         payment_status,
         cash_session_id,
         public_checkout_key,
         updated_at
       )
       VALUES
       (
        $1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, 0, 0, $9, $10, $11, $12, $13, 'pending', $14, 'pending', $15, NULLIF($16, ''), NOW()
       )`,
      [
        orderId,
        tenant.id,
        customerName,
        customerPhoneDigits,
        orderType === 'delivery' ? resolvedDeliveryAddress : '',
        resolvedPaymentMethod,
        selectedPaymentMethod.id,
        subtotalAmount,
        deliveryFeeAmount,
        paymentFeeAmount,
        paymentNetAmount,
        changeFor,
        orderTotal,
        orderType,
        null,
        checkoutKey,
      ],
    );

    for (const item of resolvedItems) {
      await dbClient.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))`,
        [randomUUID(), orderId, item.productId, item.quantity, item.unitPrice, item.notes],
      );
    }

    await dbClient.query('COMMIT');

    const [printDispatch, whatsappDispatch, orderEventDispatch] = await Promise.allSettled([
      enqueueOrderPrintJob(tenant.id, orderId, 'new_order'),
      enqueueOrderWhatsappJob(tenant.id, orderId, 'new_order'),
      notifyOrderEvent(tenant.id, 'created', orderId),
    ]);

    return NextResponse.json({
      ok: true,
      orderId,
      total: orderTotal,
      deliveryFeeAmount,
      distanceKm: deliveryFeeQuote?.distanceKm ?? null,
      paymentMethodId: selectedPaymentMethod.id,
      paymentFeeAmount,
      message: 'Pedido recebido com sucesso.',
      communication: {
        printQueued: wasJobQueued(printDispatch),
        whatsappQueued: wasJobQueued(whatsappDispatch),
        realtimeNotified: orderEventDispatch.status === 'fulfilled',
      },
    });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignora falhas de rollback para preservar o erro original.
      }
    }
    if (error instanceof CheckoutValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (checkoutTenantId && checkoutKey && isUniqueViolation(error)) {
      const existingCheckoutOrder = await findExistingCheckoutOrder(checkoutTenantId, checkoutKey).catch(() => null);
      if (existingCheckoutOrder) {
        return serializeExistingCheckoutOrder(existingCheckoutOrder);
      }
    }
    console.error('[public-checkout] failed to finalize order', error);
    return NextResponse.json({ error: 'Falha ao finalizar pedido.' }, { status: 500 });
  } finally {
    client?.release();
  }
}
