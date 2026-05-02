import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { Client } from 'pg';

const DEFAULT_PIZZA_SIZES = [
  { label: 'Broto', price: 29.9 },
  { label: 'Media', price: 39.9 },
  { label: 'Grande', price: 49.9 },
];

const CATEGORY_ORDER = [
  'Lanches',
  'Caseiro',
  'Esfihas',
  'Pasteis',
  'Combos',
  'Molhos',
  'Pizzas',
  'Bebidas',
  'Operacional',
  'Insumos',
];

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripDiacritics(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function normalizeLookupKey(value) {
  return stripDiacritics(normalizeWhitespace(value)).toLowerCase();
}

function cleanName(rawName, sourceType) {
  let value = normalizeWhitespace(String(rawName || ''));
  const prefixMatch = value.match(/^([A-Z]{2,3})\s+(.+)$/);

  if (prefixMatch) {
    const label = prefixMatch[2].trim();
    if (sourceType === 'ingredient' || sourceType === 'border') {
      value = label;
    } else if (sourceType === 'packaged' && /^(taxa|acrescimo|centavos|frutuba)\b/i.test(label)) {
      value = label;
    }
  }

  value = value.replace(/produto possui[\s\S]*$/i, '');
  return normalizeWhitespace(value);
}

function parseMoney(rawValue) {
  const cleaned = String(rawValue || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
}

function mapSourceType(rawType) {
  const normalized = stripDiacritics(normalizeWhitespace(rawType)).toLowerCase();
  if (normalized === 'preparado') return 'prepared';
  if (normalized === 'prod. acabado') return 'packaged';
  if (normalized === 'prod. tamanho') return 'size_based';
  if (normalized === 'materia prima') return 'ingredient';
  if (normalized === 'bordas') return 'border';
  return 'prepared';
}

function normalizeStatus(rawStatus) {
  return stripDiacritics(normalizeWhitespace(rawStatus)).toLowerCase();
}

function categoryForProduct(product) {
  const name = stripDiacritics(product.name).toLowerCase();

  if (product.type === 'size_based') return 'Pizzas';
  if (product.type === 'packaged') {
    if (/^(taxa|acrescimo|centavos)$/.test(name) || (name === 'frutuba' && !(product.price > 0))) {
      return 'Operacional';
    }
    return 'Bebidas';
  }
  if (product.type === 'ingredient') return 'Insumos';
  if (/^esfiha/.test(name)) return 'Esfihas';
  if (/^pastel/.test(name)) return 'Pasteis';
  if (/^molho/.test(name)) return 'Molhos';
  if (/^combo|^mega combo|^super combo|^barca|^\d+\s/.test(name)) return 'Combos';
  if (/baiao|tilapia|contra file|frango a passarinho|calabresa com fritas|porcao|cebola empanada|calabresa acebolada|mandioca|polenta|mix na caixa/.test(name)) {
    return 'Caseiro';
  }

  return 'Lanches';
}

function inferPackagedMeta(name) {
  const normalized = normalizeWhitespace(name);
  const volumeMatch = normalized.match(/(\d+(?:[.,]\d+)?\s*(?:ml|l|litro|litros))/i);
  const brandCandidates = [
    'Coca Cola Zero',
    'Coca Cola',
    'Fanta Uva',
    'Fanta Laranja',
    'Guarana',
    'Dolly Guarana',
    'Sukita',
    'Skol',
    'Itaipava',
    'Budweiser',
    'Heineken',
    'Brahma Duplo Malte',
    'Frutuba',
  ];
  const brand =
    brandCandidates.find((candidate) => normalized.toLowerCase().startsWith(candidate.toLowerCase())) ||
    normalized.split(/\s+/).slice(0, 2).join(' ');
  const alcoholic = /(skol|itaipava|budweiser|heineken|brahma)/i.test(normalized);

  return {
    packaged: {
      brand,
      volume: volumeMatch ? volumeMatch[1] : '',
      alcoholic,
    },
  };
}

function buildProductMeta(product, borderOptions) {
  if (product.type === 'size_based') {
    return {
      sizes: DEFAULT_PIZZA_SIZES,
      pizzaConfig: {
        allowHalfAndHalf: true,
        maxFlavors: 2,
        pricingStrategy: 'highest',
      },
      borders: borderOptions.map((border) => ({ label: border.label, price: border.price })),
      doughs: [],
      giftRules: [],
    };
  }

  if (product.type === 'packaged') {
    return inferPackagedMeta(product.name);
  }

  if (product.type === 'ingredient') {
    return {
      ingredient: {
        unit: 'un',
        cost: product.price > 0 ? product.price : 0,
      },
    };
  }

  return {};
}

function deriveVisibility(product) {
  const isActive = normalizeStatus(product.rawStatus) === 'ativo';

  if (product.type === 'ingredient') {
    return { available: false, status: 'draft' };
  }

  if (product.type === 'packaged' && (!(product.price > 0) || product.category === 'Operacional')) {
    return { available: false, status: 'draft' };
  }

  if (product.type === 'prepared' && !(product.price > 0)) {
    return { available: false, status: 'draft' };
  }

  return { available: isActive, status: isActive ? 'published' : 'draft' };
}

function buildBorderOptions(products) {
  const borderByLabel = new Map();

  for (const product of products) {
    if (product.sourceType !== 'border') continue;
    const label = product.name.replace(/^Borda\s+/i, '').trim();
    if (!label) continue;

    const current = borderByLabel.get(label);
    if (!current || product.price > current.price) {
      borderByLabel.set(label, {
        label,
        price: product.price > 0 ? product.price : 0,
      });
    }
  }

  return Array.from(borderByLabel.values());
}

function buildComplementBlueprints(products) {
  const ingredientProducts = products.filter((product) => product.type === 'ingredient' && product.price > 0);
  const ingredientByName = new Map(ingredientProducts.map((product) => [normalizeLookupKey(product.name), product]));
  const pick = (...names) => {
    for (const name of names) {
      const found = ingredientByName.get(normalizeLookupKey(name));
      if (found) {
        return {
          name: found.name,
          priceAddition: found.price,
        };
      }
    }
    return null;
  };

  const uniqueOptions = (options) => {
    const seen = new Set();
    return options.filter((option) => {
      if (!option) return false;
      const key = `${normalizeLookupKey(option.name)}::${Number(option.priceAddition).toFixed(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const savoryPremium = uniqueOptions([pick('Bacon'), pick('Catupiry'), pick('Cheddar')]);

  return {
    burgerExtras: uniqueOptions([...savoryPremium, pick('Ovo')]),
    snackExtras: savoryPremium,
    friesExtras: savoryPremium,
    pizzaExtras: savoryPremium,
    burgerMeats: uniqueOptions([pick('Hamburguer Normal'), pick('Hamburguer Artesanal')]),
    breadSwitches: uniqueOptions([pick('Trocar Pao Gergelim por Brioche'), pick('Trocar Pao Gergelim por Brioche')]),
  };
}

function buildOptionGroup(name, options, maxSelect) {
  if (!Array.isArray(options) || options.length === 0) return null;
  return {
    name,
    minSelect: 0,
    maxSelect: Math.max(1, Math.min(maxSelect, options.length)),
    required: false,
    options,
  };
}

function getComplementGroupsForProduct(product, blueprints) {
  const groups = [];
  const normalizedName = normalizeLookupKey(product.name);
  const isBurgerLike =
    product.type === 'prepared' &&
    (product.category === 'Lanches' || normalizedName.startsWith('x-')) &&
    !/(batata|frita|porcao|familia|mix na caixa|combo|barca|nuggets)/.test(normalizedName);
  const isSavorySnack =
    product.type === 'prepared' && (product.category === 'Esfihas' || product.category === 'Pasteis');
  const isFriesLike =
    product.type === 'prepared' && !/(combo|barca)/.test(normalizedName) && /(batata|frita)/.test(normalizedName);

  if (isBurgerLike) {
    const burgerExtrasGroup = buildOptionGroup('Turbine seu lanche', blueprints.burgerExtras, 10);
    const meatGroup = buildOptionGroup('Mais carne', blueprints.burgerMeats, 2);
    const breadGroup = buildOptionGroup('Troca de pao', blueprints.breadSwitches, 1);

    if (burgerExtrasGroup) groups.push(burgerExtrasGroup);
    if (meatGroup) groups.push(meatGroup);
    if (breadGroup) groups.push(breadGroup);
  } else if (isFriesLike) {
    const friesGroup = buildOptionGroup('Turbine sua batata', blueprints.friesExtras, 10);
    if (friesGroup) groups.push(friesGroup);
  } else if (isSavorySnack) {
    const snackGroup = buildOptionGroup('Adicionais', blueprints.snackExtras, 10);
    if (snackGroup) groups.push(snackGroup);
  } else if (product.type === 'size_based') {
    const pizzaGroup = buildOptionGroup('Adicionais da pizza', blueprints.pizzaExtras, 10);
    if (pizzaGroup) groups.push(pizzaGroup);
  }

  return groups;
}

async function insertOptionGroups(client, tenantId, productId, groups) {
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const group = groups[groupIndex];
    const groupId = crypto.randomUUID();

    await client.query(
      `INSERT INTO product_option_groups
       (id, tenant_id, product_id, name, min_select, max_select, required, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [groupId, tenantId, productId, group.name, group.minSelect, group.maxSelect, group.required, groupIndex],
    );

    for (let optionIndex = 0; optionIndex < group.options.length; optionIndex += 1) {
      const option = group.options[optionIndex];
      await client.query(
        `INSERT INTO product_options
         (id, tenant_id, group_id, name, price_addition, active, display_order)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)`,
        [crypto.randomUUID(), tenantId, groupId, option.name, option.priceAddition, optionIndex],
      );
    }
  }
}

function parseWorksheet(sheetXmlPath) {
  const xml = fs.readFileSync(sheetXmlPath, 'utf8');
  const rows = [...xml.matchAll(/<row\s+[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)];
  const products = [];

  for (const [, rowNumberText, rowBody] of rows) {
    const rowNumber = Number(rowNumberText);
    if (rowNumber < 3) continue;

    const values = {};
    for (const cellMatch of rowBody.matchAll(/<c([^>]*)\sr="([A-Z]+)\d+"[^>]*>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1] || '';
      const column = cellMatch[2];
      const inner = cellMatch[3] || '';
      let value = '';

      if (/t="inlineStr"/.test(attrs)) {
        const textMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = textMatch ? decodeXml(textMatch[1]) : '';
      } else {
        const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        value = valueMatch ? decodeXml(valueMatch[1]) : '';
      }

      values[column] = normalizeWhitespace(value);
    }

    const sourceType = mapSourceType(values.E || '');
    const normalizedType = sourceType === 'border' ? 'ingredient' : sourceType;
    const name = cleanName(values.B || '', sourceType);
    const price = parseMoney(values.D || '');

    const product = {
      rowNumber,
      sourceType,
      type: normalizedType,
      name,
      price,
      rawStatus: values.F || '',
    };

    product.category = categoryForProduct(product);
    Object.assign(product, deriveVisibility(product));

    products.push(product);
  }

  return products;
}

function summarizeImport(products) {
  return products.reduce(
    (summary, product) => {
      summary.total += 1;
      if (product.status === 'published') summary.published += 1;
      if (product.status === 'draft') summary.draft += 1;
      summary.byType[product.type] = (summary.byType[product.type] || 0) + 1;
      summary.byCategory[product.category] = (summary.byCategory[product.category] || 0) + 1;
      return summary;
    },
    { total: 0, published: 0, draft: 0, byType: {}, byCategory: {} },
  );
}

function extractWorkbook(workbookPath) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'faceburg-import-'));
  const zipPath = path.join(tempRoot, 'workbook.zip');
  const extractPath = path.join(tempRoot, 'unzipped');

  fs.copyFileSync(workbookPath, zipPath);
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${extractPath.replace(/'/g, "''")}' -Force`,
    ],
    { stdio: 'pipe' },
  );

  return { tempRoot, extractPath };
}

function removeDirectory(targetPath) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

async function importProducts({ tenantSlug, workbookPath }) {
  const envPath = path.join(process.cwd(), '.env.local');
  loadEnvFile(envPath);

  const { tempRoot, extractPath } = extractWorkbook(workbookPath);

  try {
    const sheetXmlPath = path.join(extractPath, 'xl', 'worksheets', 'sheet1.xml');
    const parsedProducts = parseWorksheet(sheetXmlPath);
    const borderOptions = buildBorderOptions(parsedProducts);

    const products = parsedProducts.map((product) => {
      const price = product.type === 'size_based' ? DEFAULT_PIZZA_SIZES[0].price : product.price;
      return {
        ...product,
        price,
        productMeta: buildProductMeta({ ...product, price }, borderOptions),
        sku: `XLS-${String(product.rowNumber).padStart(4, '0')}`,
      };
    });
    const complementBlueprints = buildComplementBlueprints(products);

    const client = new Client({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    await client.connect();

    try {
      await client.query('BEGIN');

      const tenantResult = await client.query(
        `SELECT id
         FROM tenants
         WHERE slug = $1
         LIMIT 1`,
        [tenantSlug],
      );

      if (!tenantResult.rowCount) {
        throw new Error(`Tenant ${tenantSlug} nao encontrado.`);
      }

      const tenantId = tenantResult.rows[0].id;
      const existingProducts = await client.query(
        `SELECT id
         FROM products
         WHERE tenant_id = $1`,
        [tenantId],
      );
      const productIds = existingProducts.rows.map((row) => row.id);

      if (productIds.length > 0) {
        await client.query(`DELETE FROM order_items WHERE product_id = ANY($1::text[])`, [productIds]);
        await client.query(`DELETE FROM pdv_tab_items WHERE tenant_id = $1`, [tenantId]);
        await client.query(`DELETE FROM product_options WHERE tenant_id = $1`, [tenantId]);
        await client.query(`DELETE FROM product_option_groups WHERE tenant_id = $1`, [tenantId]);
        await client.query(`DELETE FROM products WHERE tenant_id = $1`, [tenantId]);
      }

      const neededCategories = [];
      const seenCategoryKeys = new Set();
      for (const product of products) {
        const key = `${product.category}::${product.type}`;
        if (!seenCategoryKeys.has(key)) {
          seenCategoryKeys.add(key);
          neededCategories.push({ name: product.category, type: product.type });
        }
      }

      const existingCategories = await client.query(
        `SELECT id, name, product_type
         FROM categories
         WHERE tenant_id = $1`,
        [tenantId],
      );

      const categoryIdByKey = new Map();
      for (const row of existingCategories.rows) {
        categoryIdByKey.set(`${row.name}::${row.product_type}`, row.id);
      }

      for (const category of neededCategories) {
        const key = `${category.name}::${category.type}`;
        const displayOrder = CATEGORY_ORDER.indexOf(category.name);

        if (!categoryIdByKey.has(key)) {
          const categoryId = crypto.randomUUID();
          categoryIdByKey.set(key, categoryId);
          await client.query(
            `INSERT INTO categories (id, tenant_id, name, icon, product_type, active, display_order)
             VALUES ($1, $2, $3, NULL, $4, TRUE, $5)`,
            [categoryId, tenantId, category.name, category.type, displayOrder],
          );
        } else {
          await client.query(
            `UPDATE categories
             SET active = TRUE,
                 display_order = $3
             WHERE id = $1
               AND tenant_id = $2`,
            [categoryIdByKey.get(key), tenantId, displayOrder],
          );
        }
      }

      const insertedProducts = [];

      for (const product of products) {
        const categoryId = categoryIdByKey.get(`${product.category}::${product.type}`);
        if (!categoryId) {
          throw new Error(`Categoria nao resolvida para ${product.name}.`);
        }

        const productId = crypto.randomUUID();

        await client.query(
          `INSERT INTO products
           (id, tenant_id, category_id, name, description, price, image_url, available, sku, product_type, product_meta, status, display_order)
           VALUES
           ($1, $2, $3, $4, NULL, $5, NULL, $6, $7, $8, $9::jsonb, $10, $11)`,
          [
            productId,
            tenantId,
            categoryId,
            product.name,
            product.price,
            product.available,
            product.sku,
            product.type,
            JSON.stringify(product.productMeta),
            product.status,
            product.rowNumber,
          ],
        );

        insertedProducts.push({
          ...product,
          id: productId,
        });
      }

      const complementSummary = { products: 0, groups: 0, options: 0 };

      for (const product of insertedProducts) {
        const groups = getComplementGroupsForProduct(product, complementBlueprints);
        if (groups.length === 0) continue;

        await insertOptionGroups(client, tenantId, product.id, groups);
        complementSummary.products += 1;
        complementSummary.groups += groups.length;
        complementSummary.options += groups.reduce((sum, group) => sum + group.options.length, 0);
      }

      await client.query('COMMIT');

      return {
        tenantSlug,
        summary: summarizeImport(products),
        categories: neededCategories,
        complements: complementSummary,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.end();
    }
  } finally {
    removeDirectory(tempRoot);
  }
}

async function main() {
  const workbookArg = process.argv[2];
  const tenantSlug = process.argv[3] || 'face-burg';

  if (!workbookArg) {
    throw new Error('Uso: node scripts/import-products-from-xlsx.mjs <arquivo.xlsx> [tenant-slug]');
  }

  const workbookPath = path.resolve(process.cwd(), workbookArg);
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Arquivo nao encontrado: ${workbookPath}`);
  }

  const result = await importProducts({ tenantSlug, workbookPath });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

