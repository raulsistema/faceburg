import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { enqueueOrderPrintJob } from '@/lib/printing';
import { notifyOrderEvent } from '@/lib/realtime';
import { enqueueOrderWhatsappJob } from '@/lib/whatsapp';

class CheckoutValidationError extends Error {}

type TenantRow = {
  id: string;
  status: string;
  store_open: boolean;
  delivery_fee_base: string;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  method_type: string;
};

type CustomerRow = {
  id: string;
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

function normalizePaymentMethod(value: string) {
  const method = value.trim().toLowerCase();
  if (method === 'cash' || method === 'card' || method === 'pix') {
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

function formatAddressLine(address: AddressRow) {
  const main = [address.street, address.number].filter(Boolean).join(', ');
  const area = [address.neighborhood, address.city, address.state].filter(Boolean).join(' - ');
  const extra = [address.complement, address.reference].filter(Boolean).join(' | ');
  return [main, area, extra].filter(Boolean).join(' | ');
}

function wasJobQueued(result: PromiseSettledResult<boolean>) {
  return result.status === 'fulfilled' && result.value === true;
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json();

  const customerName = String(body.customerName || '').trim();
  const customerPhone = String(body.customerPhone || '').trim();
  const customerPhoneDigits = normalizePhone(customerPhone);
  const customerEmail = String(body.customerEmail || '').trim();
  const customerIsCompany = Boolean(body.customerIsCompany);
  const customerCompanyName = String(body.customerCompanyName || '').trim();
  const customerDocumentNumber = String(body.customerDocumentNumber || '').trim();
  const deliveryAddress = String(body.deliveryAddress || '').trim();
  const selectedAddressId = String(body.selectedAddressId || '').trim();
  const addressPayload =
    body.address && typeof body.address === 'object'
      ? {
          label: String(body.address.label || '').trim(),
          street: String(body.address.street || '').trim(),
          number: String(body.address.number || '').trim(),
          complement: String(body.address.complement || '').trim(),
          neighborhood: String(body.address.neighborhood || '').trim(),
          city: String(body.address.city || '').trim(),
          state: String(body.address.state || '').trim(),
          zipCode: String(body.address.zipCode || '').trim(),
          reference: String(body.address.reference || '').trim(),
        }
      : null;
  const paymentMethod = normalizePaymentMethod(String(body.paymentMethod || 'pix'));
  const paymentMethodId = String(body.paymentMethodId || '').trim();
  const orderType = normalizeOrderType(String(body.orderType || 'delivery'));
  const changeForRaw = Number(body.changeFor || 0);
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
    `SELECT id, status, store_open, delivery_fee_base::text
     FROM tenants
     WHERE slug = $1
     LIMIT 1`,
    [slug],
  );
  if (!tenantResult.rowCount) {
    return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
  }

  const tenant = tenantResult.rows[0];
  if (tenant.status !== 'active') {
    return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403 });
  }
  if (!tenant.store_open) {
    return NextResponse.json({ error: 'Delivery indisponivel no momento. Tente novamente mais tarde.' }, { status: 403 });
  }

  const normalizedItems = items
    .map((item) => ({
      productId: String(item.productId || '').trim(),
      quantity: Number(item.quantity || 0),
      selectedOptionIds: Array.isArray(item.selectedOptionIds)
        ? item.selectedOptionIds.map((id) => String(id).trim()).filter(Boolean)
        : [],
      notes: String(item.notes || '').trim(),
      pizzaSelection:
        item.pizzaSelection && typeof item.pizzaSelection === 'object'
          ? {
              sizeLabel: String(item.pizzaSelection.sizeLabel || '').trim(),
              flavorIds: Array.isArray(item.pizzaSelection.flavorIds)
                ? item.pizzaSelection.flavorIds.map((id) => String(id).trim()).filter(Boolean)
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

  const optionIds = Array.from(new Set(normalizedItems.flatMap((item) => item.selectedOptionIds)));
  const optionsByProduct = new Map<string, OptionRow[]>();
  if (optionIds.length) {
    const optionsResult = await query<OptionRow>(
      `SELECT po.id, po.group_id, pog.product_id, po.name, po.price_addition::text, po.active
       FROM product_options po
       JOIN product_option_groups pog ON pog.id = po.group_id
       WHERE po.tenant_id = $1
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
      const flavorIds = item.pizzaSelection?.flavorIds?.length ? item.pizzaSelection.flavorIds : [product.id];
      const borderLabel = item.pizzaSelection?.borderLabel || '';
      const doughLabel = item.pizzaSelection?.doughLabel || '';
      if (!sizeLabel) {
        throw new CheckoutValidationError('Selecione o tamanho da pizza.');
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
  const deliveryFeeAmount = orderType === 'delivery' ? roundMoney(Number(tenant.delivery_fee_base || 0)) : 0;
  let selectedPaymentMethod: PaymentMethodRow | null = null;
  if (paymentMethodId) {
    const byId = await query<PaymentMethodRow>(
      `SELECT id, name, method_type
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
      `SELECT id, name, method_type
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

  const baseTotal = roundMoney(subtotalAmount + deliveryFeeAmount);
  const paymentFeeAmount = 0;
  const orderTotal = baseTotal;
  const paymentNetAmount = orderTotal;

  const resolvedPaymentMethod = selectedPaymentMethod.method_type;

  if (resolvedPaymentMethod === 'cash' && changeFor && changeFor < orderTotal) {
    return NextResponse.json({ error: 'Troco deve ser maior ou igual ao total.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existingCustomerResult = await client.query<CustomerRow>(
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
      await client.query(
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
      await client.query(
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
    if (orderType === 'delivery') {
      if (selectedAddressId) {
        const selectedAddressResult = await client.query<AddressRow>(
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
        resolvedDeliveryAddress = formatAddressLine(selectedAddressResult.rows[0]);
      } else if (addressPayload?.street) {
        if (!addressPayload.number.trim()) {
          throw new CheckoutValidationError('Numero do endereco obrigatorio para entrega.');
        }
        const firstAddressResult = await client.query<{ total: string }>(
          `SELECT COUNT(*)::text AS total
           FROM customer_addresses
           WHERE tenant_id = $1
             AND customer_id = $2
             AND active = TRUE`,
          [tenant.id, customerId],
        );
        const isFirst = Number(firstAddressResult.rows[0]?.total || 0) === 0;
        const insertedAddressResult = await client.query<AddressRow>(
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
        resolvedDeliveryAddress = formatAddressLine(insertedAddressResult.rows[0]);
      } else {
        resolvedDeliveryAddress = deliveryAddress;
        if (resolvedDeliveryAddress) {
          const existingAddressResult = await client.query<{ id: string }>(
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
            const firstAddressResult = await client.query<{ total: string }>(
              `SELECT COUNT(*)::text AS total
               FROM customer_addresses
               WHERE tenant_id = $1
                 AND customer_id = $2
                 AND active = TRUE`,
              [tenant.id, customerId],
            );
            const isFirst = Number(firstAddressResult.rows[0]?.total || 0) === 0;
            await client.query(
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

    const orderId = randomUUID();
    await client.query(
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
         updated_at
       )
       VALUES
       (
        $1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, 0, 0, $9, $10, $11, $12, $13, 'pending', $14, 'pending', NOW()
       )`,
      [
        orderId,
        tenant.id,
        customerName,
        customerPhoneDigits,
        orderType === 'delivery' ? resolvedDeliveryAddress : '',
        resolvedPaymentMethod,
        null,
        subtotalAmount,
        deliveryFeeAmount,
        paymentFeeAmount,
        paymentNetAmount,
        changeFor,
        orderTotal,
        orderType,
      ],
    );

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))`,
        [randomUUID(), orderId, item.productId, item.quantity, item.unitPrice, item.notes],
      );
    }

    await client.query('COMMIT');

    const [printDispatch, whatsappDispatch, orderEventDispatch] = await Promise.allSettled([
      enqueueOrderPrintJob(tenant.id, orderId, 'new_order'),
      enqueueOrderWhatsappJob(tenant.id, orderId, 'new_order'),
      notifyOrderEvent(tenant.id, 'created', orderId),
    ]);

    return NextResponse.json({
      ok: true,
      orderId,
      total: orderTotal,
      paymentMethodId: null,
      paymentFeeAmount,
      message: 'Pedido recebido com sucesso.',
      communication: {
        printQueued: wasJobQueued(printDispatch),
        whatsappQueued: wasJobQueued(whatsappDispatch),
        realtimeNotified: orderEventDispatch.status === 'fulfilled',
      },
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error instanceof CheckoutValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[public-checkout] failed to finalize order', error);
    return NextResponse.json({ error: 'Falha ao finalizar pedido.' }, { status: 500 });
  } finally {
    client.release();
  }
}
