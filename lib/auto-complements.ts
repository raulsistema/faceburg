import type { ProductOptionGroupDetail, ProductOptionGroupPayload } from '@/lib/product-options';

export type AutoComplementProductType = 'prepared' | 'packaged' | 'size_based' | 'ingredient' | 'special';

export type AutoComplementProduct = {
  id: string;
  name: string;
  categoryName: string;
  productType: AutoComplementProductType;
  price: number;
  productMeta: Record<string, unknown>;
};

type AutoComplementOption = {
  name: string;
  priceAddition: number;
  active: true;
};

type BorderOption = {
  label: string;
  price: number;
};

export type AutoComplementPresets = {
  burgerExtras: AutoComplementOption[];
  burgerMeats: AutoComplementOption[];
  breadSwitches: AutoComplementOption[];
  snackExtras: AutoComplementOption[];
  friesExtras: AutoComplementOption[];
  pizzaExtras: AutoComplementOption[];
  borderOptions: BorderOption[];
};

const MANAGED_GROUP_NAMES = [
  'Turbine seu lanche',
  'Mais carne',
  'Troca de pao',
  'Adicionais',
  'Turbine sua batata',
  'Adicionais da pizza',
] as const;

export function normalizeLookupKey(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function isManagedAutoComplementGroupName(name: string) {
  return MANAGED_GROUP_NAMES.some((groupName) => normalizeLookupKey(groupName) === normalizeLookupKey(name));
}

function uniqueOptions(options: Array<AutoComplementOption | null>) {
  const seen = new Set<string>();
  return options.filter((option): option is AutoComplementOption => {
    if (!option) return false;
    const key = `${normalizeLookupKey(option.name)}::${option.priceAddition.toFixed(2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function createOption(name: string, priceAddition: number): AutoComplementOption {
  return {
    name,
    priceAddition: Number(priceAddition.toFixed(2)),
    active: true,
  };
}

function toProductOption(name: string, price: number) {
  if (!name || !(price >= 0)) return null;
  return createOption(name, price);
}

function buildOptionGroup(name: string, options: AutoComplementOption[], maxSelect: number): ProductOptionGroupPayload | null {
  if (options.length === 0) return null;
  return {
    name,
    minSelect: 0,
    maxSelect: Math.max(1, Math.min(maxSelect, options.length)),
    required: false,
    options,
  };
}

export function buildAutoComplementPresets(products: AutoComplementProduct[]): AutoComplementPresets {
  const ingredientProducts = products.filter((product) => product.productType === 'ingredient');
  const pricedIngredients = ingredientProducts.filter((product) => product.price > 0);
  const ingredientByName = new Map(pricedIngredients.map((product) => [normalizeLookupKey(product.name), product]));

  const pick = (...names: string[]) => {
    for (const name of names) {
      const product = ingredientByName.get(normalizeLookupKey(name));
      if (product) {
        return toProductOption(product.name, product.price);
      }
    }
    return null;
  };

  const borderByLabel = new Map<string, BorderOption>();
  for (const product of ingredientProducts) {
    const normalizedName = normalizeLookupKey(product.name);
    if (!normalizedName.startsWith('borda ')) continue;
    const label = product.name.replace(/^borda\s+/i, '').trim();
    if (!label) continue;
    const current = borderByLabel.get(normalizeLookupKey(label));
    if (!current || product.price > current.price) {
      borderByLabel.set(normalizeLookupKey(label), {
        label,
        price: product.price > 0 ? Number(product.price.toFixed(2)) : 0,
      });
    }
  }

  const savoryPremium = uniqueOptions([pick('Bacon'), pick('Catupiry'), pick('Cheddar')]);

  return {
    burgerExtras: uniqueOptions([...savoryPremium, pick('Ovo')]),
    burgerMeats: uniqueOptions([pick('Hamburguer Normal'), pick('Hamburguer Artesanal')]),
    breadSwitches: uniqueOptions([
      pick('Trocar Pão Gergelim por Brioche'),
      pick('Trocar Pao Gergelim por Brioche'),
    ]),
    snackExtras: savoryPremium,
    friesExtras: savoryPremium,
    pizzaExtras: savoryPremium,
    borderOptions: Array.from(borderByLabel.values()),
  };
}

function isComboLike(normalizedName: string) {
  return /(combo|barca)/.test(normalizedName);
}

function isBurgerLikeProduct(product: AutoComplementProduct) {
  if (product.productType !== 'prepared') return false;
  const normalizedName = normalizeLookupKey(product.name);
  if (isComboLike(normalizedName)) return false;
  if (/(batata|frita|porcao|porcao mix|familia)/.test(normalizedName)) return false;
  return product.categoryName === 'Lanches' || normalizedName.startsWith('x-');
}

function isSavorySnackProduct(product: AutoComplementProduct) {
  if (product.productType !== 'prepared') return false;
  return product.categoryName === 'Esfihas' || product.categoryName === 'Pasteis';
}

function isFriesLikeProduct(product: AutoComplementProduct) {
  if (product.productType !== 'prepared') return false;
  const normalizedName = normalizeLookupKey(product.name);
  if (isComboLike(normalizedName)) return false;
  return /(batata|frita)/.test(normalizedName);
}

export function buildAutoComplementGroupsForProduct(
  product: AutoComplementProduct,
  presets: AutoComplementPresets,
): ProductOptionGroupPayload[] {
  const groups: Array<ProductOptionGroupPayload | null> = [];

  if (product.productType === 'size_based') {
    groups.push(buildOptionGroup('Adicionais da pizza', presets.pizzaExtras, 10));
  } else if (isFriesLikeProduct(product)) {
    groups.push(buildOptionGroup('Turbine sua batata', presets.friesExtras, 10));
  } else if (isBurgerLikeProduct(product)) {
    groups.push(buildOptionGroup('Turbine seu lanche', presets.burgerExtras, 10));
    groups.push(buildOptionGroup('Mais carne', presets.burgerMeats, 2));
    groups.push(buildOptionGroup('Troca de pao', presets.breadSwitches, 1));
  } else if (isSavorySnackProduct(product)) {
    groups.push(buildOptionGroup('Adicionais', presets.snackExtras, 10));
  }

  return groups.filter((group): group is ProductOptionGroupPayload => Boolean(group));
}

export function buildProductMetaWithAutoBorders(
  product: AutoComplementProduct,
  presets: AutoComplementPresets,
) {
  if (product.productType !== 'size_based' || presets.borderOptions.length === 0) {
    return product.productMeta || {};
  }

  return {
    ...(product.productMeta || {}),
    borders: presets.borderOptions.map((border) => ({
      label: border.label,
      price: border.price,
    })),
  };
}

export function toProductOptionGroupPayload(group: ProductOptionGroupDetail): ProductOptionGroupPayload {
  return {
    id: group.id,
    name: group.name,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
    required: group.required,
    options: group.options.map((option) => ({
      id: option.id,
      name: option.name,
      priceAddition: option.priceAddition,
      active: option.active,
    })),
  };
}

export function serializeOptionGroups(groups: ProductOptionGroupPayload[]) {
  return JSON.stringify(
    groups.map((group) => ({
      name: normalizeLookupKey(group.name),
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      required: group.required,
      options: group.options.map((option) => ({
        name: normalizeLookupKey(option.name),
        priceAddition: Number(option.priceAddition.toFixed(2)),
        active: option.active !== false,
      })),
    })),
  );
}
