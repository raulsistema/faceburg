import { randomUUID } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import { query } from '@/lib/db';

type QueryExecutor = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

type ProductOptionGroupRow = {
  id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: boolean;
  display_order: number;
};

type ProductOptionRow = {
  id: string;
  group_id: string;
  name: string;
  image_url: string | null;
  price_addition: string;
  active: boolean;
  display_order: number;
};

export type ProductOptionPayload = {
  id?: string;
  name: string;
  imageUrl?: string;
  priceAddition: number;
  active: boolean;
};

export type ProductOptionGroupPayload = {
  id?: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  options: ProductOptionPayload[];
};

export type ProductOptionDetail = {
  id: string;
  name: string;
  imageUrl: string | null;
  priceAddition: number;
  active: boolean;
  displayOrder: number;
};

export type ProductOptionGroupDetail = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  displayOrder: number;
  options: ProductOptionDetail[];
};

function normalizeInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function normalizeMoney(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Number(parsed.toFixed(2));
}

function normalizeId(value: unknown) {
  const nextValue = String(value || '').trim();
  return nextValue || undefined;
}

function normalizeImageUrl(value: unknown) {
  const nextValue = String(value || '').trim();
  return nextValue || undefined;
}

export function normalizeProductOptionGroups(value: unknown): ProductOptionGroupPayload[] {
  if (!Array.isArray(value)) return [];

  const normalizedGroups: ProductOptionGroupPayload[] = [];

  for (const rawGroup of value) {
    if (!rawGroup || typeof rawGroup !== 'object') continue;
    const groupRecord = rawGroup as Record<string, unknown>;
    const name = String(groupRecord.name || '').trim();
    const required = Boolean(groupRecord.required);

    const rawOptions = Array.isArray(groupRecord.options) ? groupRecord.options : [];
    const options: ProductOptionPayload[] = [];

    for (const rawOption of rawOptions) {
      if (!rawOption || typeof rawOption !== 'object') continue;
      const optionRecord = rawOption as Record<string, unknown>;
      const optionName = String(optionRecord.name || '').trim();
      if (!optionName) continue;

      options.push({
        id: normalizeId(optionRecord.id),
        name: optionName,
        imageUrl: normalizeImageUrl(optionRecord.imageUrl),
        priceAddition: normalizeMoney(optionRecord.priceAddition),
        active: optionRecord.active !== false,
      });
    }

    if (!name || options.length === 0) continue;

    let minSelect = Math.max(0, normalizeInteger(groupRecord.minSelect, 0));
    let maxSelect = Math.max(1, normalizeInteger(groupRecord.maxSelect, options.length));

    if (required && minSelect === 0) {
      minSelect = 1;
    }

    minSelect = Math.min(minSelect, options.length);
    maxSelect = Math.min(Math.max(maxSelect, minSelect), options.length);

    normalizedGroups.push({
      id: normalizeId(groupRecord.id),
      name,
      minSelect,
      maxSelect,
      required,
      options,
    });
  }

  return normalizedGroups;
}

export async function fetchProductOptionGroups(
  tenantId: string,
  productId: string,
  executor: QueryExecutor = { query },
) {
  const [groupsResult, optionsResult] = await Promise.all([
    executor.query<ProductOptionGroupRow>(
      `SELECT id, name, min_select, max_select, required, display_order
       FROM product_option_groups
       WHERE tenant_id = $1
         AND product_id = $2
       ORDER BY display_order ASC, name ASC`,
      [tenantId, productId],
    ),
    executor.query<ProductOptionRow>(
      `SELECT o.id, o.group_id, o.name, o.image_url, o.price_addition::text, o.active, o.display_order
       FROM product_options o
       INNER JOIN product_option_groups g ON g.id = o.group_id
       WHERE o.tenant_id = $1
         AND g.tenant_id = $1
         AND g.product_id = $2
       ORDER BY o.display_order ASC, o.name ASC`,
      [tenantId, productId],
    ),
  ]);

  const optionsByGroup = new Map<string, ProductOptionDetail[]>();
  for (const row of optionsResult.rows) {
    const current = optionsByGroup.get(row.group_id) || [];
    current.push({
      id: row.id,
      name: row.name,
      imageUrl: row.image_url,
      priceAddition: Number(row.price_addition || 0),
      active: row.active,
      displayOrder: row.display_order,
    });
    optionsByGroup.set(row.group_id, current);
  }

  return groupsResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    minSelect: row.min_select,
    maxSelect: row.max_select,
    required: row.required,
    displayOrder: row.display_order,
    options: optionsByGroup.get(row.id) || [],
  }));
}

export async function syncProductOptionGroups(
  tenantId: string,
  productId: string,
  groups: ProductOptionGroupPayload[],
  executor: QueryExecutor,
) {
  const normalizedGroups = normalizeProductOptionGroups(groups);

  const [existingGroupsResult, existingOptionsResult] = await Promise.all([
    executor.query<{ id: string }>(
      `SELECT id
       FROM product_option_groups
       WHERE tenant_id = $1
         AND product_id = $2`,
      [tenantId, productId],
    ),
    executor.query<{ id: string; group_id: string }>(
      `SELECT o.id, o.group_id
       FROM product_options o
       INNER JOIN product_option_groups g ON g.id = o.group_id
       WHERE o.tenant_id = $1
         AND g.tenant_id = $1
         AND g.product_id = $2`,
      [tenantId, productId],
    ),
  ]);

  const existingGroupIds = new Set(existingGroupsResult.rows.map((row) => row.id));
  const existingOptionIdsByGroup = new Map<string, Set<string>>();

  for (const row of existingOptionsResult.rows) {
    const current = existingOptionIdsByGroup.get(row.group_id) || new Set<string>();
    current.add(row.id);
    existingOptionIdsByGroup.set(row.group_id, current);
  }

  const keptGroupIds: string[] = [];

  for (let groupIndex = 0; groupIndex < normalizedGroups.length; groupIndex += 1) {
    const group = normalizedGroups[groupIndex];
    const groupId = group.id && existingGroupIds.has(group.id) ? group.id : randomUUID();
    keptGroupIds.push(groupId);

    await executor.query(
      `INSERT INTO product_option_groups
       (id, tenant_id, product_id, name, min_select, max_select, required, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE
           SET name = EXCLUDED.name,
               min_select = EXCLUDED.min_select,
               max_select = EXCLUDED.max_select,
               required = EXCLUDED.required,
               display_order = EXCLUDED.display_order`,
      [groupId, tenantId, productId, group.name, group.minSelect, group.maxSelect, group.required, groupIndex],
    );

    const existingOptionIds = existingOptionIdsByGroup.get(groupId) || new Set<string>();
    const keptOptionIds: string[] = [];

    for (let optionIndex = 0; optionIndex < group.options.length; optionIndex += 1) {
      const option = group.options[optionIndex];
      const optionId = option.id && existingOptionIds.has(option.id) ? option.id : randomUUID();
      keptOptionIds.push(optionId);

      await executor.query(
        `INSERT INTO product_options
         (id, tenant_id, group_id, name, image_url, price_addition, active, display_order)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8)
         ON CONFLICT (id) DO UPDATE
             SET group_id = EXCLUDED.group_id,
                 name = EXCLUDED.name,
                 image_url = EXCLUDED.image_url,
                 price_addition = EXCLUDED.price_addition,
                 active = EXCLUDED.active,
                 display_order = EXCLUDED.display_order`,
        [optionId, tenantId, groupId, option.name, option.imageUrl || '', option.priceAddition, option.active, optionIndex],
      );
    }

    if (keptOptionIds.length > 0) {
      await executor.query(
        `DELETE FROM product_options
         WHERE tenant_id = $1
           AND group_id = $2
           AND NOT (id = ANY($3::text[]))`,
        [tenantId, groupId, keptOptionIds],
      );
    } else {
      await executor.query(
        `DELETE FROM product_options
         WHERE tenant_id = $1
           AND group_id = $2`,
        [tenantId, groupId],
      );
    }
  }

  const staleGroupIds = existingGroupsResult.rows
    .map((row) => row.id)
    .filter((groupId) => !keptGroupIds.includes(groupId));

  if (staleGroupIds.length > 0) {
    await executor.query(
      `DELETE FROM product_options
       WHERE tenant_id = $1
         AND group_id = ANY($2::text[])`,
      [tenantId, staleGroupIds],
    );

    await executor.query(
      `DELETE FROM product_option_groups
       WHERE tenant_id = $1
         AND product_id = $2
         AND id = ANY($3::text[])`,
      [tenantId, productId, staleGroupIds],
    );
  }

  return await fetchProductOptionGroups(tenantId, productId, executor);
}
