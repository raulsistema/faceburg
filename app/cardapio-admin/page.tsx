'use client';

import { FormEvent, KeyboardEvent, ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  Beer,
  Blocks,
  ChefHat,
  Globe,
  LayoutGrid,
  PackageOpen,
  Pencil,
  Pizza,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Store,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import DashboardShell from '@/components/layout/DashboardShell';
import AppImage from '@/components/ui/AppImage';
import { cn } from '@/lib/utils';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Category = {
  id: string;
  name: string;
  icon: string | null;
  product_type: ProductType;
  active: boolean;
  display_order: number;
  product_count?: string;
};

type ProductType = 'prepared' | 'packaged' | 'size_based' | 'ingredient' | 'special';

type ProductOption = {
  id: string;
  name: string;
  imageUrl: string | null;
  priceAddition: number;
  active: boolean;
  displayOrder?: number;
};

type ProductOptionGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  displayOrder?: number;
  options: ProductOption[];
};

type Product = {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  description: string | null;
  price: string;
  image_url: string | null;
  available: boolean;
  sku: string | null;
  product_type: ProductType;
  product_meta: Record<string, unknown>;
  status: 'draft' | 'published';
  display_order: number;
  optionGroups?: ProductOptionGroup[];
};

type LinkData = {
  tenant: { name: string; slug: string };
  publicMenuUrl: string;
  publishedProducts: number;
};

type CardapioSettings = {
  prepTimeMinutes: number;
  deliveryFeeBase: number;
  storeOpen: boolean;
  coverImageUrl: string;
  whatsappPhone: string;
};

type MenuStory = {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  active: boolean;
  displayOrder: number;
  expiresAt: string | null;
};

type AdminDataResponse = {
  categories?: Category[];
  products?: Product[];
  linkData?: LinkData;
  settings?: CardapioSettings;
  stories?: MenuStory[];
  error?: string;
};

type ProductDraft = {
  categoryId: string;
  name: string;
  description: string;
  price: string;
  imageUrl: string;
  sku: string;
  status: 'draft' | 'published';
  available: boolean;
  productType: ProductType | null;
  packagedBrand: string;
  packagedVolume: string;
  packagedAlcoholic: boolean;
  sizeOptionsText: string;
  pizzaAllowHalfAndHalf: boolean;
  pizzaFlavorLimit: string;
  pizzaBordersText: string;
  pizzaDoughsText: string;
  pizzaGiftRulesText: string;
  ingredientUnit: string;
  ingredientCost: string;
  specialTag: string;
  optionGroups: ProductOptionGroupDraft[];
};

type ProductOptionDraft = {
  id?: string;
  name: string;
  imageUrl: string;
  priceAddition: string;
  active: boolean;
};

type ProductOptionGroupDraft = {
  id?: string;
  name: string;
  minSelect: string;
  maxSelect: string;
  required: boolean;
  options: ProductOptionDraft[];
};

type SectionTab = 'visao-geral' | 'produtos' | 'categorias' | 'publicacao' | 'configuracoes';

type CategoryDraft = {
  name: string;
  icon: string;
  productType: ProductType;
};

type CategoryEditDraft = CategoryDraft & {
  active: boolean;
};

type ProductTypeCard = {
  type: ProductType;
  title: string;
  description: string;
  icon: ReactNode;
};

type MenuStoryDraft = {
  id?: string;
  title: string;
  subtitle: string;
  imageUrl: string;
  active: boolean;
  displayOrder: string;
  expiresAt: string;
};

function createEmptyProductOptionDraft(): ProductOptionDraft {
  return {
    name: '',
    imageUrl: '',
    priceAddition: '0',
    active: true,
  };
}

function createEmptyMenuStoryDraft(order = 0): MenuStoryDraft {
  return {
    title: '',
    subtitle: '',
    imageUrl: '',
    active: true,
    displayOrder: String(order),
    expiresAt: '',
  };
}

function createEmptyProductOptionGroupDraft(): ProductOptionGroupDraft {
  return {
    name: '',
    minSelect: '0',
    maxSelect: '1',
    required: false,
    options: [createEmptyProductOptionDraft()],
  };
}

function createEmptyCategoryDraft(productType: ProductType = 'prepared'): CategoryDraft {
  return {
    name: '',
    icon: '',
    productType,
  };
}

const emptyProductDraft: ProductDraft = {
  categoryId: '',
  name: '',
  description: '',
  price: '',
  imageUrl: '',
  sku: '',
  status: 'draft',
  available: true,
  productType: null,
  packagedBrand: '',
  packagedVolume: '',
  packagedAlcoholic: false,
  sizeOptionsText: 'Broto|29.9\nMedia|39.9\nGrande|49.9',
  pizzaAllowHalfAndHalf: true,
  pizzaFlavorLimit: '2',
  pizzaBordersText: 'Catupiry|8\nCheddar|8\nChocolate|10',
  pizzaDoughsText: 'Tradicional|0\nFina|0\nPan|4',
  pizzaGiftRulesText: 'Broto|Dolli 1L|1\nGrande|Coca-Cola 2L|1',
  ingredientUnit: 'kg',
  ingredientCost: '',
  specialTag: '',
  optionGroups: [],
};

const sectionTabs: Array<{ id: SectionTab; label: string; icon: ReactNode }> = [
  { id: 'visao-geral', label: 'Visao geral', icon: <LayoutGrid className="h-4 w-4" /> },
  { id: 'produtos', label: 'Produtos', icon: <Store className="h-4 w-4" /> },
  { id: 'categorias', label: 'Categorias', icon: <Tag className="h-4 w-4" /> },
  { id: 'publicacao', label: 'Publicacao', icon: <Globe className="h-4 w-4" /> },
  { id: 'configuracoes', label: 'Configuracoes', icon: <Settings2 className="h-4 w-4" /> },
];

const productTypeCards: ProductTypeCard[] = [
  {
    type: 'prepared',
    title: 'Preparado',
    description: 'Lanches, porcoes e pratos feitos na cozinha.',
    icon: <ChefHat className="h-5 w-5 text-orange-600" />,
  },
  {
    type: 'packaged',
    title: 'Produto de Revenda',
    description: 'Bebidas e itens industrializados como coca, cerveja e agua.',
    icon: <Beer className="h-5 w-5 text-orange-600" />,
  },
  {
    type: 'size_based',
    title: 'Produto por Tamanho',
    description: 'Pizzas e itens com variacao por tamanho.',
    icon: <Pizza className="h-5 w-5 text-orange-600" />,
  },
  {
    type: 'ingredient',
    title: 'Materia-prima',
    description: 'Insumos internos que nao devem aparecer no cardapio publico.',
    icon: <PackageOpen className="h-5 w-5 text-orange-600" />,
  },
  {
    type: 'special',
    title: 'Especial da Casa',
    description: 'Pratos do dia, promocoes e itens sazonais.',
    icon: <Sparkles className="h-5 w-5 text-orange-600" />,
  },
];

function getTypeLabel(type: ProductType) {
  if (type === 'prepared') return 'Preparado';
  if (type === 'packaged') return 'Revenda';
  if (type === 'size_based') return 'Por tamanho';
  if (type === 'ingredient') return 'Materia-prima';
  return 'Especial';
}

function getTypeDescription(type: ProductType) {
  if (type === 'prepared') return 'Feito na cozinha';
  if (type === 'packaged') return 'Item industrializado';
  if (type === 'size_based') return 'Preco por tamanho';
  if (type === 'ingredient') return 'Uso interno';
  return 'Item diferenciado';
}

function buildProductMeta(draft: ProductDraft) {
  if (draft.productType === 'packaged') {
    return {
      packaged: {
        brand: draft.packagedBrand,
        volume: draft.packagedVolume,
        alcoholic: draft.packagedAlcoholic,
      },
    };
  }

  if (draft.productType === 'size_based') {
    const sizes = draft.sizeOptionsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, priceText] = line.split('|').map((part) => part.trim());
        return { label, price: Number(priceText || 0) };
      })
      .filter((item) => item.label && item.price > 0);

    const borders = draft.pizzaBordersText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, priceText] = line.split('|').map((part) => part.trim());
        return { label, price: Number(priceText || 0) };
      })
      .filter((item) => item.label && item.price >= 0);

    const doughs = draft.pizzaDoughsText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, priceText] = line.split('|').map((part) => part.trim());
        return { label, price: Number(priceText || 0) };
      })
      .filter((item) => item.label && item.price >= 0);

    const giftRules = draft.pizzaGiftRulesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sizeLabel, drinkName, quantityText] = line.split('|').map((part) => part.trim());
        return {
          sizeLabel,
          drinkName,
          quantity: Math.max(1, Number(quantityText || 1)),
        };
      })
      .filter((item) => item.sizeLabel && item.drinkName);

    return {
      sizes,
      pizzaConfig: {
        allowHalfAndHalf: draft.pizzaAllowHalfAndHalf,
        maxFlavors: Math.max(1, Number(draft.pizzaFlavorLimit || 2)),
        pricingStrategy: 'highest',
      },
      borders,
      doughs,
      giftRules,
    };
  }

  if (draft.productType === 'ingredient') {
    return {
      ingredient: {
        unit: draft.ingredientUnit,
        cost: Number(draft.ingredientCost || 0),
      },
    };
  }

  if (draft.productType === 'special') {
    return {
      special: {
        tag: draft.specialTag,
      },
    };
  }

  return {};
}

function buildProductOptionGroupsPayload(draft: ProductDraft) {
  if (draft.productType === 'ingredient') return [];

  return draft.optionGroups.map((group) => ({
    id: group.id,
    name: group.name,
    minSelect: Number(group.minSelect || 0),
    maxSelect: Number(group.maxSelect || 0),
    required: group.required,
    options: group.options.map((option) => ({
      id: option.id,
      name: option.name,
      imageUrl: option.imageUrl,
      priceAddition: Number(option.priceAddition || 0),
      active: option.active,
    })),
  }));
}

function draftFromProduct(product: Product): ProductDraft {
  const packagedMeta =
    product.product_meta && typeof product.product_meta.packaged === 'object' && product.product_meta.packaged
      ? (product.product_meta.packaged as Record<string, unknown>)
      : null;
  const ingredientMeta =
    product.product_meta && typeof product.product_meta.ingredient === 'object' && product.product_meta.ingredient
      ? (product.product_meta.ingredient as Record<string, unknown>)
      : null;
  const specialMeta =
    product.product_meta && typeof product.product_meta.special === 'object' && product.product_meta.special
      ? (product.product_meta.special as Record<string, unknown>)
      : null;
  const sizeMeta = Array.isArray(product.product_meta?.sizes)
    ? (product.product_meta.sizes as Array<{ label?: string; price?: number }>)
    : [];
  const pizzaConfig =
    product.product_meta && typeof product.product_meta.pizzaConfig === 'object' && product.product_meta.pizzaConfig
      ? (product.product_meta.pizzaConfig as Record<string, unknown>)
      : null;
  const pizzaBorders = Array.isArray(product.product_meta?.borders)
    ? (product.product_meta.borders as Array<{ label?: string; price?: number }>)
    : [];
  const pizzaDoughs = Array.isArray(product.product_meta?.doughs)
    ? (product.product_meta.doughs as Array<{ label?: string; price?: number }>)
    : [];
  const pizzaGiftRules = Array.isArray(product.product_meta?.giftRules)
    ? (product.product_meta.giftRules as Array<{ sizeLabel?: string; drinkName?: string; quantity?: number }>)
    : [];
  const optionGroups = Array.isArray(product.optionGroups) ? product.optionGroups : [];

  return {
    categoryId: product.category_id,
    name: product.name,
    description: product.description || '',
    price: product.price,
    imageUrl: product.image_url || '',
    sku: product.sku || '',
    status: product.status,
    available: product.available,
    productType: product.product_type,
    packagedBrand: String(packagedMeta?.brand || ''),
    packagedVolume: String(packagedMeta?.volume || ''),
    packagedAlcoholic: Boolean(packagedMeta?.alcoholic),
    sizeOptionsText:
      sizeMeta.length > 0
        ? sizeMeta.map((size) => `${String(size.label || '')}|${String(size.price || '')}`).join('\n')
        : emptyProductDraft.sizeOptionsText,
    pizzaAllowHalfAndHalf: pizzaConfig?.allowHalfAndHalf !== false,
    pizzaFlavorLimit: String(pizzaConfig?.maxFlavors || 2),
    pizzaBordersText:
      pizzaBorders.length > 0
        ? pizzaBorders.map((border) => `${String(border.label || '')}|${String(border.price || '')}`).join('\n')
        : emptyProductDraft.pizzaBordersText,
    pizzaDoughsText:
      pizzaDoughs.length > 0
        ? pizzaDoughs.map((dough) => `${String(dough.label || '')}|${String(dough.price || '')}`).join('\n')
        : emptyProductDraft.pizzaDoughsText,
    pizzaGiftRulesText:
      pizzaGiftRules.length > 0
        ? pizzaGiftRules
            .map((rule) => `${String(rule.sizeLabel || '')}|${String(rule.drinkName || '')}|${String(rule.quantity || 1)}`)
            .join('\n')
        : emptyProductDraft.pizzaGiftRulesText,
    ingredientUnit: String(ingredientMeta?.unit || 'kg'),
    ingredientCost: String(ingredientMeta?.cost || ''),
    specialTag: String(specialMeta?.tag || ''),
    optionGroups: optionGroups.map((group) => {
      const options = Array.isArray(group.options) ? group.options : [];
      return {
        id: group.id,
        name: group.name,
        minSelect: String(group.minSelect ?? 0),
        maxSelect: String(group.maxSelect ?? Math.max(options.length, 1)),
        required: Boolean(group.required),
        options: options.map((option) => ({
          id: option.id,
          name: option.name,
          imageUrl: option.imageUrl || '',
          priceAddition: String(option.priceAddition ?? 0),
          active: option.active !== false,
        })),
      };
    }),
  };
}

function formatCurrency(value: number | string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
}

function escapeCsvValue(value: string | number | null | undefined) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function fromMenuStory(story: MenuStory): MenuStoryDraft {
  return {
    id: story.id,
    title: story.title,
    subtitle: story.subtitle,
    imageUrl: story.imageUrl,
    active: story.active,
    displayOrder: String(story.displayOrder),
    expiresAt: toLocalDateTimeInput(story.expiresAt),
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler imagem.'));
    reader.readAsDataURL(file);
  });
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.35)]">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function CardapioAdminPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [menuStories, setMenuStories] = useState<MenuStoryDraft[]>([]);
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [settings, setSettings] = useState<CardapioSettings>({
    prepTimeMinutes: 40,
    deliveryFeeBase: 5,
    storeOpen: true,
    coverImageUrl: '',
    whatsappPhone: '',
  });
  const [activeTab, setActiveTab] = useState<SectionTab>('visao-geral');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [autoComplementsLoading, setAutoComplementsLoading] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [coverImageUploading, setCoverImageUploading] = useState(false);
  const [optionImageUploadingKey, setOptionImageUploadingKey] = useState<string | null>(null);
  const [storyImageUploadingKey, setStoryImageUploadingKey] = useState<number | null>(null);
  const [storiesSaving, setStoriesSaving] = useState(false);
  const [productModalLoading, setProductModalLoading] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProductDraft);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>(createEmptyCategoryDraft());
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryDraft, setEditingCategoryDraft] = useState<CategoryEditDraft>({
    ...createEmptyCategoryDraft(),
    active: true,
  });
  const [showQuickCategoryForm, setShowQuickCategoryForm] = useState(false);
  const [quickCategoryDraft, setQuickCategoryDraft] = useState<CategoryDraft>(createEmptyCategoryDraft());
  const [productSearch, setProductSearch] = useState('');
  const [productTypeFilter, setProductTypeFilter] = useState<ProductType | 'all'>('all');
  const [productStatusFilter, setProductStatusFilter] = useState<'all' | 'published' | 'draft'>('all');
  const [productAvailabilityFilter, setProductAvailabilityFilter] = useState<'all' | 'available' | 'unavailable'>('all');
  const [productCategoryFilter, setProductCategoryFilter] = useState('all');
  const [publicationSearch, setPublicationSearch] = useState('');
  const deferredProductSearch = useDeferredValue(productSearch);
  const deferredPublicationSearch = useDeferredValue(publicationSearch);

  const selectedTypeCard = useMemo(
    () => productTypeCards.find((card) => card.type === productDraft.productType) || null,
    [productDraft.productType],
  );

  const canManageOptionGroups = productDraft.productType !== null && productDraft.productType !== 'ingredient';
  const categoriesForSelectedType = useMemo(() => {
    if (!productDraft.productType) return [];
    return categories.filter(
      (category) =>
        category.product_type === productDraft.productType && (category.active || category.id === productDraft.categoryId),
    );
  }, [categories, productDraft.categoryId, productDraft.productType]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = deferredProductSearch.trim().toLowerCase();
    return products.filter((product) => {
      const matchesSearch = normalizedSearch
        ? [product.name, product.category_name, product.sku || '', getTypeLabel(product.product_type)]
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearch)
        : true;
      const matchesType = productTypeFilter === 'all' ? true : product.product_type === productTypeFilter;
      const matchesStatus = productStatusFilter === 'all' ? true : product.status === productStatusFilter;
      const matchesAvailability =
        productAvailabilityFilter === 'all'
          ? true
          : productAvailabilityFilter === 'available'
            ? product.available
            : !product.available;
      const matchesCategory = productCategoryFilter === 'all' ? true : product.category_id === productCategoryFilter;

      return matchesSearch && matchesType && matchesStatus && matchesAvailability && matchesCategory;
    });
  }, [
    deferredProductSearch,
    productAvailabilityFilter,
    productCategoryFilter,
    productStatusFilter,
    productTypeFilter,
    products,
  ]);

  const publicationProducts = useMemo(() => {
    const normalizedSearch = deferredPublicationSearch.trim().toLowerCase();
    const visibleProducts = products.filter((product) => product.product_type !== 'ingredient');
    if (!normalizedSearch) return visibleProducts;
    return visibleProducts.filter((product) =>
      [product.name, product.category_name, product.sku || ''].join(' ').toLowerCase().includes(normalizedSearch),
    );
  }, [deferredPublicationSearch, products]);

  const productStats = useMemo(() => {
    const published = products.filter((product) => product.status === 'published').length;
    const available = products.filter((product) => product.available).length;
    const hidden = products.filter((product) => product.status !== 'published').length;
    const internal = products.filter((product) => product.product_type === 'ingredient').length;
    return { published, available, hidden, internal };
  }, [products]);

  const productTypeSummary = useMemo(
    () =>
      productTypeCards.map((card) => ({
        ...card,
        count: products.filter((product) => product.product_type === card.type).length,
      })),
    [products],
  );

  const menuStoryStats = useMemo(() => {
    const now = Date.now();
    const active = menuStories.filter((story) => story.active).length;
    const withExpiration = menuStories.filter((story) => story.expiresAt).length;
    const expiringSoon = menuStories.filter((story) => {
      if (!story.expiresAt) return false;
      const expiresAt = new Date(story.expiresAt).getTime();
      return Number.isFinite(expiresAt) && expiresAt > now && expiresAt - now <= 1000 * 60 * 60 * 48;
    }).length;
    return {
      total: menuStories.length,
      active,
      withExpiration,
      expiringSoon,
    };
  }, [menuStories]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/cardapio/admin-data', { cache: 'no-store' });
      const data = (await response.json()) as AdminDataResponse;

      if (!response.ok) {
        throw new Error(data.error || 'Falha ao carregar o cardapio admin.');
      }

      const nextCategories = Array.isArray(data.categories) ? data.categories : [];
      const nextProducts = Array.isArray(data.products) ? data.products : [];
      const nextSettings = data.settings;

      setCategories(nextCategories);
      setProducts(nextProducts);
      setMenuStories(
        Array.isArray(data.stories)
          ? data.stories
              .map((story) => fromMenuStory(story))
              .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0))
          : [],
      );
      setLinkData(data.linkData || null);
      setSettings({
        prepTimeMinutes: Number(nextSettings?.prepTimeMinutes ?? 40),
        deliveryFeeBase: Number(nextSettings?.deliveryFeeBase ?? 0),
        storeOpen: Boolean(nextSettings?.storeOpen),
        coverImageUrl: nextSettings?.coverImageUrl || '',
        whatsappPhone: nextSettings?.whatsappPhone || '',
      });

      setProductDraft((current) => {
        if (current.categoryId || !nextCategories.length) return current;
        return { ...current, categoryId: nextCategories[0].id };
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Erro ao carregar o cardapio admin.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  function applyProductType(type: ProductType) {
    setProductDraft((current) => {
      const matchingCategories = categories.filter(
        (category) => category.product_type === type && (category.active || category.id === current.categoryId),
      );
      const keepCurrentCategory = matchingCategories.some((category) => category.id === current.categoryId);

      return {
        ...current,
        productType: type,
        categoryId: keepCurrentCategory ? current.categoryId : matchingCategories[0]?.id || '',
        status: type === 'ingredient' ? 'draft' : current.status,
        available: type === 'ingredient' ? false : current.available,
      };
    });

    setQuickCategoryDraft(createEmptyCategoryDraft(type));
  }

  function openCreateProductModal() {
    setProductModalLoading(false);
    setEditingProductId(null);
    setProductDraft({
      ...emptyProductDraft,
      categoryId: '',
    });
    setShowQuickCategoryForm(false);
    setQuickCategoryDraft(createEmptyCategoryDraft());
    setShowProductModal(true);
  }

  async function openEditProductModal(product: Product) {
    resetMessages();
    setEditingProductId(product.id);
    setProductDraft(draftFromProduct(product));
    setProductModalLoading(true);
    setShowProductModal(true);
    setShowQuickCategoryForm(false);
    setQuickCategoryDraft(createEmptyCategoryDraft(product.product_type));

    try {
      const response = await fetch(`/api/products/${product.id}`, { cache: 'no-store' });
      const data = (await response.json()) as { product?: Product; error?: string };
      if (!response.ok || !data.product) {
        throw new Error(data.error || 'Falha ao carregar produto.');
      }

      setProductDraft(draftFromProduct(data.product));
      setQuickCategoryDraft(createEmptyCategoryDraft(data.product.product_type));
    } catch (productError) {
      closeProductModal();
      setError(productError instanceof Error ? productError.message : 'Falha ao carregar produto.');
    } finally {
      setProductModalLoading(false);
    }
  }

  function closeProductModal() {
    setProductModalLoading(false);
    setShowProductModal(false);
    setEditingProductId(null);
    setOptionImageUploadingKey(null);
    setProductDraft(emptyProductDraft);
    setShowQuickCategoryForm(false);
    setQuickCategoryDraft(createEmptyCategoryDraft());
  }

  function addOptionGroup() {
    setProductDraft((current) => ({
      ...current,
      optionGroups: [...current.optionGroups, createEmptyProductOptionGroupDraft()],
    }));
  }

  function updateOptionGroup(index: number, changes: Partial<ProductOptionGroupDraft>) {
    setProductDraft((current) => ({
      ...current,
      optionGroups: current.optionGroups.map((group, groupIndex) =>
        groupIndex === index ? { ...group, ...changes } : group,
      ),
    }));
  }

  function removeOptionGroup(index: number) {
    setProductDraft((current) => ({
      ...current,
      optionGroups: current.optionGroups.filter((_, groupIndex) => groupIndex !== index),
    }));
  }

  function addOptionToGroup(groupIndex: number) {
    setProductDraft((current) => ({
      ...current,
      optionGroups: current.optionGroups.map((group, currentGroupIndex) =>
        currentGroupIndex === groupIndex
          ? { ...group, options: [...group.options, createEmptyProductOptionDraft()] }
          : group,
      ),
    }));
  }

  function updateOptionInGroup(groupIndex: number, optionIndex: number, changes: Partial<ProductOptionDraft>) {
    setProductDraft((current) => ({
      ...current,
      optionGroups: current.optionGroups.map((group, currentGroupIndex) =>
        currentGroupIndex === groupIndex
          ? {
              ...group,
              options: group.options.map((option, currentOptionIndex) =>
                currentOptionIndex === optionIndex ? { ...option, ...changes } : option,
              ),
            }
          : group,
      ),
    }));
  }

  function removeOptionFromGroup(groupIndex: number, optionIndex: number) {
    setProductDraft((current) => ({
      ...current,
      optionGroups: current.optionGroups.map((group, currentGroupIndex) =>
        currentGroupIndex === groupIndex
          ? {
              ...group,
              options: group.options.filter((_, currentOptionIndex) => currentOptionIndex !== optionIndex),
            }
          : group,
      ),
    }));
  }

  function startEditCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingCategoryDraft({
      name: category.name,
      icon: category.icon || '',
      productType: category.product_type,
      active: category.active,
    });
  }

  function resetMessages() {
    setError(null);
    setSuccessMessage(null);
  }

  function addMenuStory() {
    resetMessages();
    setMenuStories((current) => [...current, createEmptyMenuStoryDraft(current.length)]);
  }

  function updateMenuStory(index: number, patch: Partial<MenuStoryDraft>) {
    setMenuStories((current) =>
      current.map((story, storyIndex) => (storyIndex === index ? { ...story, ...patch } : story)),
    );
  }

  function removeMenuStory(index: number) {
    resetMessages();
    setMenuStories((current) => current.filter((_, storyIndex) => storyIndex !== index));
  }

  async function onSelectStoryImage(index: number, file: File | null) {
    if (!file) return;
    resetMessages();
    if (!file.type.startsWith('image/')) {
      setError('Selecione um arquivo de imagem valido.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('A imagem deve ter no maximo 5 MB.');
      return;
    }
    setStoryImageUploadingKey(index);
    try {
      const dataUrl = await fileToDataUrl(file);
      updateMenuStory(index, { imageUrl: dataUrl });
      setSuccessMessage('Imagem do story carregada.');
    } catch {
      setError('Falha ao carregar imagem do story.');
    } finally {
      setStoryImageUploadingKey((current) => (current === index ? null : current));
    }
  }

  async function onSaveStories() {
    resetMessages();
    setStoriesSaving(true);

    const payload = {
      stories: menuStories.map((story, index) => ({
        id: story.id,
        title: story.title,
        subtitle: story.subtitle,
        imageUrl: story.imageUrl,
        active: story.active,
        displayOrder: Number(story.displayOrder || index),
        expiresAt: story.expiresAt ? new Date(story.expiresAt).toISOString() : null,
      })),
    };

    try {
      const response = await fetch('/api/cardapio/stories', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { stories?: MenuStory[]; error?: string };
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar stories da loja.');
        return;
      }

      setMenuStories(
        Array.isArray(data.stories)
          ? data.stories
              .map((story) => fromMenuStory(story))
              .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0))
          : [],
      );
      setSuccessMessage('Stories da loja salvos com sucesso.');
    } catch {
      setError('Falha ao salvar stories da loja.');
    } finally {
      setStoriesSaving(false);
    }
  }

  async function onSaveProduct(event: FormEvent) {
    event.preventDefault();
    resetMessages();

    if (!productDraft.productType) {
      setError('Selecione o tipo de produto antes de salvar.');
      return;
    }

    const payload = {
      categoryId: productDraft.categoryId,
      name: productDraft.name,
      description: productDraft.description,
      price: Number(productDraft.price),
      imageUrl: productDraft.imageUrl,
      sku: productDraft.sku,
      status: productDraft.status,
      available: productDraft.available,
      productType: productDraft.productType,
      productMeta: buildProductMeta(productDraft),
      optionGroups: buildProductOptionGroupsPayload(productDraft),
    };

    const response = await fetch(editingProductId ? `/api/products/${editingProductId}` : '/api/products', {
      method: editingProductId ? 'PATCH' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao salvar produto.');
      return;
    }

    setSuccessMessage(editingProductId ? 'Produto atualizado com sucesso.' : 'Produto criado com sucesso.');
    closeProductModal();
    await loadData();
  }

  async function onSelectProductImage(file: File | null) {
    if (!file) return;
    resetMessages();
    if (!file.type.startsWith('image/')) {
      setError('Selecione um arquivo de imagem valido.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('A imagem deve ter no maximo 5 MB.');
      return;
    }
    setImageUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setProductDraft((current) => ({ ...current, imageUrl: dataUrl }));
      setSuccessMessage('Imagem carregada no banco (ate 5 MB).');
    } catch {
      setError('Falha ao carregar imagem.');
    } finally {
      setImageUploading(false);
    }
  }

  async function onSelectCoverImage(file: File | null) {
    if (!file) return;
    resetMessages();
    if (!file.type.startsWith('image/')) {
      setError('Selecione um arquivo de imagem valido.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('A imagem deve ter no maximo 5 MB.');
      return;
    }
    setCoverImageUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setSettings((current) => ({ ...current, coverImageUrl: dataUrl }));
      setSuccessMessage('Capa carregada no banco (ate 5 MB).');
    } catch {
      setError('Falha ao carregar imagem da capa.');
    } finally {
      setCoverImageUploading(false);
    }
  }

  async function onSelectOptionImage(groupIndex: number, optionIndex: number, file: File | null) {
    if (!file) return;
    resetMessages();
    if (!file.type.startsWith('image/')) {
      setError('Selecione um arquivo de imagem valido.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError('A imagem deve ter no maximo 5 MB.');
      return;
    }
    const uploadKey = `${groupIndex}:${optionIndex}`;
    setOptionImageUploadingKey(uploadKey);
    try {
      const dataUrl = await fileToDataUrl(file);
      updateOptionInGroup(groupIndex, optionIndex, { imageUrl: dataUrl });
      setSuccessMessage('Imagem do complemento carregada.');
    } catch {
      setError('Falha ao carregar imagem do complemento.');
    } finally {
      setOptionImageUploadingKey((current) => (current === uploadKey ? null : current));
    }
  }

  async function onTogglePublication(product: Product) {
    resetMessages();

    const response = await fetch(`/api/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: product.status === 'published' ? 'draft' : 'published',
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao atualizar publicacao do produto.');
      return;
    }

    setSuccessMessage(
      product.status === 'published'
        ? 'Produto removido do cardapio publico.'
        : 'Produto publicado no cardapio publico.',
    );
    await loadData();
  }

  async function onToggleAvailability(product: Product) {
    resetMessages();

    const response = await fetch(`/api/products/${product.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        available: !product.available,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao atualizar disponibilidade.');
      return;
    }

    setSuccessMessage(product.available ? 'Produto marcado como indisponivel.' : 'Produto marcado como disponivel.');
    await loadData();
  }

  async function onCreateCategory(event: FormEvent) {
    event.preventDefault();
    resetMessages();

    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(categoryDraft),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao criar categoria.');
      return;
    }

    setCategoryDraft(createEmptyCategoryDraft(categoryDraft.productType));
    setSuccessMessage('Categoria criada com sucesso.');
    await loadData();
  }

  async function onQuickCreateCategory(event?: FormEvent) {
    event?.preventDefault();
    resetMessages();

    if (!productDraft.productType) {
      setError('Selecione o tipo do produto antes de criar uma categoria.');
      return;
    }

    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...quickCategoryDraft,
        productType: productDraft.productType,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao criar categoria.');
      return;
    }

    await loadData();
    setProductDraft((current) => ({
      ...current,
      categoryId: data.category?.id || current.categoryId,
    }));
    setQuickCategoryDraft(createEmptyCategoryDraft(productDraft.productType));
    setShowQuickCategoryForm(false);
    setSuccessMessage('Categoria criada e vinculada ao tipo do produto.');
  }

  function onQuickCategoryInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void onQuickCreateCategory();
  }

  async function onSaveCategory(event: FormEvent) {
    event.preventDefault();
    if (!editingCategoryId) return;
    resetMessages();

    const response = await fetch(`/api/categories/${editingCategoryId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(editingCategoryDraft),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao atualizar categoria.');
      return;
    }

    setEditingCategoryId(null);
    setSuccessMessage('Categoria atualizada com sucesso.');
    await loadData();
  }

  async function onDeleteCategory(category: Category) {
    const confirmed = window.confirm(`Excluir a categoria "${category.name}"?`);
    if (!confirmed) return;

    resetMessages();
    const response = await fetch(`/api/categories/${category.id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao excluir categoria.');
      return;
    }

    setSuccessMessage('Categoria excluida com sucesso.');
    await loadData();
  }

  async function onSaveSettings(event: FormEvent) {
    event.preventDefault();
    resetMessages();

    const response = await fetch('/api/cardapio/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao salvar configuracoes.');
      return;
    }

    setSuccessMessage('Configuracoes do cardapio salvas com sucesso.');
    await loadData();
  }

  async function copyPublicMenuLink() {
    if (!linkData?.publicMenuUrl) return;

    try {
      await navigator.clipboard.writeText(linkData.publicMenuUrl);
      setCopyStatus('Link copiado com sucesso.');
      window.setTimeout(() => setCopyStatus(null), 2500);
    } catch {
      setCopyStatus('Nao foi possivel copiar. Copie manualmente.');
    }
  }

  function openPublicMenu() {
    if (!linkData?.publicMenuUrl) return;
    window.open(linkData.publicMenuUrl, '_blank', 'noopener,noreferrer');
  }

  function exportProductsCsv() {
    if (!filteredProducts.length) {
      setError('Nao ha produtos para exportar com os filtros atuais.');
      return;
    }

    const header = ['Nome', 'Categoria', 'Tipo', 'SKU', 'Status catalogo', 'Disponibilidade', 'Preco'];
    const rows = filteredProducts.map((product) => [
      product.name,
      product.category_name,
      getTypeLabel(product.product_type),
      product.sku || '',
      product.status === 'published' ? 'Publicado' : 'Rascunho',
      product.available ? 'Disponivel' : 'Indisponivel',
      Number(product.price || 0).toFixed(2).replace('.', ','),
    ]);

    const csvContent = [header, ...rows]
      .map((row) => row.map((value) => escapeCsvValue(value)).join(';'))
      .join('\n');

    const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `catalogo-${linkData?.tenant.slug || 'tenant'}-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSuccessMessage(`Exportacao pronta com ${filteredProducts.length} produto(s).`);
  }

  async function applyAutoComplements() {
    resetMessages();
    setAutoComplementsLoading(true);

    try {
      const response = await fetch('/api/cardapio/auto-complements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const data = (await response.json()) as {
        error?: string;
        summary?: {
          productsTouched: number;
          groupsApplied: number;
          optionsApplied: number;
          pizzaBordersUpdated: number;
          customGroupsPreserved: number;
        };
      };

      if (!response.ok || !data.summary) {
        throw new Error(data.error || 'Falha ao aplicar complementos automáticos.');
      }

      setSuccessMessage(
        `Complementos aplicados em ${data.summary.productsTouched} produto(s), com ${data.summary.groupsApplied} grupo(s), ${data.summary.optionsApplied} opcao(oes) e ${data.summary.pizzaBordersUpdated} pizza(s) com borda revisada.`,
      );
      await loadData();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : 'Falha ao aplicar complementos automáticos.');
    } finally {
      setAutoComplementsLoading(false);
    }
  }

  const overviewStats = [
    {
      label: 'Produtos totais',
      value: String(products.length),
      helper: 'Somente desta empresa',
      accent: 'from-orange-500/20 to-amber-500/10',
    },
    {
      label: 'Publicados',
      value: String(productStats.published),
      helper: 'Visiveis no cardapio',
      accent: 'from-emerald-500/20 to-emerald-400/10',
    },
    {
      label: 'Categorias',
      value: String(categories.length),
      helper: 'Organizacao do menu',
      accent: 'from-sky-500/20 to-cyan-400/10',
    },
    {
      label: 'Uso interno',
      value: String(productStats.internal),
      helper: 'Nao aparecem ao cliente',
      accent: 'from-slate-400/30 to-slate-300/10',
    },
  ];

  return (
    <DashboardShell>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-[32px] border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-orange-950 text-white shadow-[0_24px_80px_-56px_rgba(15,23,42,0.75)]">
          <div className="grid gap-8 px-6 py-7 lg:grid-cols-[1.35fr_0.9fr] lg:px-8">
            <div className="space-y-5">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/12 px-3 py-1 text-xs font-medium text-orange-100">
                <Blocks className="h-3.5 w-3.5" />
                Gestao do catalogo separada por empresa
              </div>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">Cardapio Admin profissional</h2>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-200">
                  Produtos, categorias, publicacao e configuracoes agora ficam organizados em areas
                  separadas. Tudo que aparece aqui pertence somente ao tenant{' '}
                  <span className="font-semibold text-white">{linkData?.tenant.slug || '...'}</span>.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {overviewStats.map((item) => (
                  <div
                    key={item.label}
                    className={cn(
                      'rounded-2xl border border-white/10 bg-gradient-to-br p-4',
                      item.accent,
                    )}
                  >
                    <div className="text-xs uppercase tracking-[0.18em] text-slate-300">{item.label}</div>
                    <div className="mt-3 text-3xl font-semibold text-white">{item.value}</div>
                    <div className="mt-1 text-xs text-slate-200">{item.helper}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/10 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-orange-100">Link publico</div>
                  <div className="mt-2 text-xl font-semibold text-white">{linkData?.tenant.name || 'Loja'}</div>
                  <div className="mt-1 text-sm text-slate-200">Cliente acessa por este link exclusivo.</div>
                </div>
                <BadgeCheck className="h-8 w-8 text-emerald-300" />
              </div>
              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/35 p-3">
                <div className="text-xs text-slate-300">URL do cardapio</div>
                <div className="mt-2 break-all text-sm font-medium text-white">
                  {linkData?.publicMenuUrl || 'Carregando...'}
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={copyPublicMenuLink} className="btn-primary justify-center">
                  Copiar link
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('publicacao')}
                  className="inline-flex items-center justify-center rounded-xl border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-white/15"
                >
                  Gerenciar publicacao
                </button>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-300">
                <span>Produtos publicados: {linkData?.publishedProducts ?? 0}</span>
                <span>{settings.storeOpen ? 'Loja aberta' : 'Loja fechada'}</span>
              </div>
              {copyStatus ? <p className="mt-3 text-xs text-emerald-300">{copyStatus}</p> : null}
            </div>
          </div>
        </section>

        <div className="rounded-[26px] border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap gap-2">
            {sectionTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-medium transition',
                  activeTab === tab.id
                    ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/15'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {successMessage ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {successMessage}
          </div>
        ) : null}

        {activeTab === 'visao-geral' ? (
          <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
            <SectionCard
              title="Operacao do catalogo"
              description="A gestao ficou separada para facilitar manutencao e evitar mistura entre cadastro, publicacao e categorias."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">Produtos</div>
                  <p className="mt-2 text-sm text-slate-500">
                    Todos os produtos da empresa ficam em um cadastro unico, inclusive insumos e itens internos.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('produtos')}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-orange-700"
                  >
                    Abrir gestao de produtos
                  </button>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">Publicacao</div>
                  <p className="mt-2 text-sm text-slate-500">
                    O cliente so enxerga itens publicados e disponiveis. Insumos nunca vazam para o cardapio.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('publicacao')}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-orange-700"
                  >
                    Ajustar publicacao
                  </button>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">Categorias</div>
                  <p className="mt-2 text-sm text-slate-500">
                    Categorias ficam separadas para manter o menu limpo e preparado para multiplas empresas.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('categorias')}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-orange-700"
                  >
                    Organizar categorias
                  </button>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">Configuracoes</div>
                  <p className="mt-2 text-sm text-slate-500">
                    Tempo de preparo, taxa de entrega e status da loja ficam centralizados em um so lugar.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('configuracoes')}
                    className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-orange-700"
                  >
                    Abrir configuracoes
                  </button>
                </div>
                <div className="rounded-3xl border border-orange-200 bg-orange-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">Complementos automáticos</div>
                  <p className="mt-2 text-sm text-slate-600">
                    Reaplica adicionais de lanche, batata, esfiha, pastel e pizza usando os insumos com valor da empresa.
                  </p>
                  <button
                    type="button"
                    onClick={() => void applyAutoComplements()}
                    disabled={autoComplementsLoading}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {autoComplementsLoading ? 'Aplicando...' : 'Aplicar em lote'}
                  </button>
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Resumo da empresa"
              description="Painel rapido para acompanhar o que ja esta pronto para o cliente."
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 p-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Produtos disponiveis</p>
                    <p className="text-xs text-slate-500">Itens ativos para operacao</p>
                  </div>
                  <span className="text-2xl font-semibold text-slate-950">{productStats.available}</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-slate-200 p-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Ocultos do cardapio</p>
                    <p className="text-xs text-slate-500">Draft ou ainda nao publicados</p>
                  </div>
                  <span className="text-2xl font-semibold text-slate-950">{productStats.hidden}</span>
                </div>
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
                  Cada empresa enxerga apenas os proprios produtos, categorias e configuracoes. O isolamento
                  continua sendo feito pela sessao do tenant em todas as APIs.
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'produtos' ? (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <SectionCard
              title="Gerenciar produtos"
              description="Base principal do catalogo, com filtros mais operacionais e atalhos parecidos com o sistema de referencia."
              action={
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={exportProductsCsv}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                  >
                    Exportar CSV
                  </button>
                  <button
                    type="button"
                    onClick={() => void applyAutoComplements()}
                    disabled={autoComplementsLoading}
                    className="inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-orange-50 px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {autoComplementsLoading ? 'Aplicando...' : 'Complementos em lote'}
                  </button>
                  <button type="button" onClick={openCreateProductModal} className="btn-primary">
                    <Plus className="h-4 w-4" />
                    Add Produto
                  </button>
                </div>
              }
            >
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Total</div>
                    <div className="mt-3 text-3xl font-semibold text-slate-950">{products.length}</div>
                    <div className="mt-1 text-xs text-slate-500">Produtos cadastrados</div>
                  </div>
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">Publicado</div>
                    <div className="mt-3 text-3xl font-semibold text-emerald-950">{productStats.published}</div>
                    <div className="mt-1 text-xs text-emerald-700/80">Ativos no cardapio</div>
                  </div>
                  <div className="rounded-3xl border border-sky-200 bg-sky-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-700">Disponivel</div>
                    <div className="mt-3 text-3xl font-semibold text-sky-950">{productStats.available}</div>
                    <div className="mt-1 text-xs text-sky-700/80">Liberados para venda</div>
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-white p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">Em foco</div>
                    <div className="mt-3 text-3xl font-semibold text-slate-950">{filteredProducts.length}</div>
                    <div className="mt-1 text-xs text-slate-500">Resultado dos filtros</div>
                  </div>
                </div>

                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Filtros operacionais</p>
                      <p className="text-xs text-slate-500">Refine por associacao, categoria, status do catalogo e disponibilidade.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProductSearch('');
                        setProductTypeFilter('all');
                        setProductStatusFilter('all');
                        setProductAvailabilityFilter('all');
                        setProductCategoryFilter('all');
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                    >
                      Limpar filtros
                    </button>
                  </div>
                  <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_repeat(3,minmax(0,0.7fr))]">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        value={productSearch}
                        onChange={(event) => setProductSearch(event.target.value)}
                        placeholder="Pesquisar produtos"
                        className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      />
                    </div>
                    <select
                      value={productTypeFilter}
                      onChange={(event) => setProductTypeFilter(event.target.value as ProductType | 'all')}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                    >
                      <option value="all">Selecione uma associacao</option>
                      {productTypeCards.map((card) => (
                        <option key={card.type} value={card.type}>
                          {card.title}
                        </option>
                      ))}
                    </select>
                    <select
                      value={productCategoryFilter}
                      onChange={(event) => setProductCategoryFilter(event.target.value)}
                      className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                    >
                      <option value="all">Selecione uma categoria</option>
                      {categories
                        .filter((category) => (productTypeFilter === 'all' ? true : category.product_type === productTypeFilter))
                        .map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                    </select>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                      <select
                        value={productStatusFilter}
                        onChange={(event) => setProductStatusFilter(event.target.value as 'all' | 'published' | 'draft')}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      >
                        <option value="all">Status catalogo</option>
                        <option value="published">Publicado</option>
                        <option value="draft">Rascunho</option>
                      </select>
                      <select
                        value={productAvailabilityFilter}
                        onChange={(event) =>
                          setProductAvailabilityFilter(event.target.value as 'all' | 'available' | 'unavailable')
                        }
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      >
                        <option value="all">Status venda</option>
                        <option value="available">Disponivel</option>
                        <option value="unavailable">Indisponivel</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-[28px] border border-slate-200">
                  <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Produtos cadastrados</div>
                      <p className="mt-1 text-sm text-slate-600">Visualize, publique e ajuste a disponibilidade sem sair desta tela.</p>
                    </div>
                    <div className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                      {filteredProducts.length} resultado(s)
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_120px_220px] gap-3 border-b border-slate-200 bg-white px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                    <span>Produto</span>
                    <span>Categoria</span>
                    <span>Status</span>
                    <span>Preco</span>
                    <span className="text-right">Acoes</span>
                  </div>
                  <div className="divide-y divide-slate-200 bg-white">
                    {loading ? (
                      <div className="px-4 py-10 text-sm text-slate-500">Carregando produtos...</div>
                    ) : filteredProducts.length === 0 ? (
                      <div className="px-4 py-10 text-sm text-slate-500">Nenhum produto encontrado com os filtros atuais.</div>
                    ) : (
                      filteredProducts.map((product) => (
                        <div
                          key={product.id}
                          className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,0.95fr)_minmax(0,0.95fr)_120px_220px] gap-3 px-4 py-4 text-sm"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-semibold text-slate-950">{product.name}</p>
                              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                                {getTypeLabel(product.product_type)}
                              </span>
                              {product.sku ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                                  SKU {product.sku}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                              {product.description || getTypeDescription(product.product_type)}
                            </p>
                          </div>
                          <div className="text-slate-600">{product.category_name}</div>
                          <div className="space-y-1">
                            <span
                              className={cn(
                                'inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium',
                                product.status === 'published'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-slate-100 text-slate-600',
                              )}
                            >
                              {product.status === 'published' ? 'Publicado' : 'Rascunho'}
                            </span>
                            <div className="text-xs text-slate-500">
                              {product.available ? 'Disponivel para venda' : 'Indisponivel no momento'}
                            </div>
                          </div>
                          <div className="font-semibold text-slate-900">{formatCurrency(product.price)}</div>
                          <div className="flex items-start justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => onToggleAvailability(product)}
                              className={cn(
                                'rounded-xl border px-3 py-2 text-xs font-semibold transition',
                                product.available
                                  ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                              )}
                            >
                              {product.available ? 'Ativo' : 'Inativo'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onTogglePublication(product)}
                              className={cn(
                                'rounded-xl px-3 py-2 text-xs font-semibold transition',
                                product.status === 'published'
                                  ? 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                                  : 'bg-slate-950 text-white hover:bg-slate-800',
                              )}
                            >
                              {product.status === 'published' ? 'Ocultar' : 'Publicar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void openEditProductModal(product)}
                              className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50"
                              title="Editar produto"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </SectionCard>

            <div className="space-y-6">
              <SectionCard
                title="Operacao rapida"
                description="Atalhos para o fluxo mais usado do catalogo."
              >
                <div className="grid gap-3">
                  <button
                    type="button"
                    onClick={openCreateProductModal}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-orange-200 hover:bg-orange-50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Add Produto</p>
                      <p className="mt-1 text-xs text-slate-500">Cadastro rapido para novos itens.</p>
                    </div>
                    <Plus className="h-4 w-4 text-orange-600" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('publicacao')}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-orange-200 hover:bg-orange-50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Status catalogo</p>
                      <p className="mt-1 text-xs text-slate-500">Publicar, ocultar e revisar itens do menu.</p>
                    </div>
                    <Globe className="h-4 w-4 text-orange-600" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('categorias')}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-orange-200 hover:bg-orange-50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Categorias</p>
                      <p className="mt-1 text-xs text-slate-500">Organize associacoes e grupos da vitrine.</p>
                    </div>
                    <Tag className="h-4 w-4 text-orange-600" />
                  </button>
                  <button
                    type="button"
                    onClick={openPublicMenu}
                    className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-orange-200 hover:bg-orange-50"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Abrir cardapio</p>
                      <p className="mt-1 text-xs text-slate-500">Ver a vitrine publica com o que ja foi liberado.</p>
                    </div>
                    <Store className="h-4 w-4 text-orange-600" />
                  </button>
                </div>
              </SectionCard>

              <SectionCard
                title="Associacao dos produtos"
                description="Mesmo conceito do sistema de referencia: filtrar por tipo ajuda a operar mais rapido."
              >
                <div className="space-y-3">
                  {productTypeSummary.map((item) => (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => setProductTypeFilter((current) => (current === item.type ? 'all' : item.type))}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-2xl border px-4 py-3 text-left transition',
                        productTypeFilter === item.type
                          ? 'border-orange-200 bg-orange-50'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                      )}
                    >
                      <div className="mt-0.5 rounded-xl bg-slate-100 p-2 text-slate-700">{item.icon}</div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                          <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                            {item.count}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-500">{item.description}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </SectionCard>

              <SectionCard
                title="Canal publico"
                description="Resumo do que ja esta pronto para o cliente ver."
              >
                <div className="space-y-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Link do cardapio</div>
                    <p className="mt-2 break-all text-sm font-medium text-slate-900">{linkData?.publicMenuUrl || 'Carregando...'}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs text-slate-500">Publicados</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-950">{linkData?.publishedProducts ?? 0}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs text-slate-500">Ocultos</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-950">{productStats.hidden}</div>
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button type="button" onClick={copyPublicMenuLink} className="btn-primary justify-center">
                      Copiar link
                    </button>
                    <button
                      type="button"
                      onClick={openPublicMenu}
                      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                    >
                      Abrir cardapio
                    </button>
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>
        ) : null}

        {activeTab === 'categorias' ? (
          <div className="grid gap-6 xl:grid-cols-[0.78fr_1.22fr]">
            <SectionCard
              title="Nova categoria"
              description="Crie categorias separadas para organizar o menu desta empresa."
            >
              <form onSubmit={onCreateCategory} className="space-y-4">
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nome</label>
                  <input
                    value={categoryDraft.name}
                    onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ex: Lanches, Bebidas, Pizzas"
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    Tipo de cadastro
                  </label>
                  <select
                    value={categoryDraft.productType}
                    onChange={(event) =>
                      setCategoryDraft((current) => ({
                        ...current,
                        productType: event.target.value as ProductType,
                      }))
                    }
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  >
                    {productTypeCards.map((card) => (
                      <option key={card.type} value={card.type}>
                        {card.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Icone</label>
                  <input
                    value={categoryDraft.icon}
                    onChange={(event) => setCategoryDraft((current) => ({ ...current, icon: event.target.value }))}
                    placeholder="Opcional"
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  />
                </div>
                <button type="submit" className="btn-primary w-full justify-center">
                  <Plus className="h-4 w-4" />
                  Criar categoria
                </button>
              </form>
            </SectionCard>

            <SectionCard
              title="Categorias da empresa"
              description="Ative, edite ou remova categorias sem impactar outras empresas do SaaS."
            >
              <div className="space-y-3">
                {loading ? (
                  <div className="rounded-2xl border border-slate-200 px-4 py-6 text-sm text-slate-500">
                    Carregando categorias...
                  </div>
                ) : categories.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 px-4 py-6 text-sm text-slate-500">
                    Nenhuma categoria cadastrada ainda.
                  </div>
                ) : (
                  categories.map((category) => (
                    <div key={category.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                      {editingCategoryId === category.id ? (
                        <form onSubmit={onSaveCategory} className="space-y-3">
                          <div className="grid gap-3 md:grid-cols-2">
                            <input
                              value={editingCategoryDraft.name}
                              onChange={(event) =>
                                setEditingCategoryDraft((current) => ({ ...current, name: event.target.value }))
                              }
                              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                              required
                            />
                            <input
                              value={editingCategoryDraft.icon}
                              onChange={(event) =>
                                setEditingCategoryDraft((current) => ({ ...current, icon: event.target.value }))
                              }
                              className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                              placeholder="Icone opcional"
                            />
                          </div>
                          <select
                            value={editingCategoryDraft.productType}
                            onChange={(event) =>
                              setEditingCategoryDraft((current) => ({
                                ...current,
                                productType: event.target.value as ProductType,
                              }))
                            }
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                          >
                            {productTypeCards.map((card) => (
                              <option key={card.type} value={card.type}>
                                {card.title}
                              </option>
                            ))}
                          </select>
                          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={editingCategoryDraft.active}
                              onChange={(event) =>
                                setEditingCategoryDraft((current) => ({
                                  ...current,
                                  active: event.target.checked,
                                }))
                              }
                            />
                            Categoria ativa no painel
                          </label>
                          <div className="flex flex-wrap gap-2">
                            <button type="submit" className="btn-primary">
                              Salvar categoria
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCategoryId(null)}
                              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600"
                            >
                              Cancelar
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-base font-semibold text-slate-950">{category.name}</p>
                              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                                {getTypeLabel(category.product_type)}
                              </span>
                              <span
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                                  category.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
                                )}
                              >
                                {category.active ? 'Ativa' : 'Inativa'}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-slate-500">
                              {Number(category.product_count || 0)} produto(s) vinculados a esta categoria
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEditCategory(category)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              <Pencil className="h-4 w-4" />
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteCategory(category)}
                              className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4" />
                              Excluir
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'publicacao' ? (
          <SectionCard
            title="Publicacao no cardapio"
            description="Aqui voce escolhe exatamente o que o cliente vai ver. Produtos internos nao aparecem nesta lista."
          >
            <div className="space-y-4">
              <div className="relative max-w-xl">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={publicationSearch}
                  onChange={(event) => setPublicationSearch(event.target.value)}
                  placeholder="Buscar produto para publicar ou ocultar"
                  className="w-full rounded-2xl border border-slate-200 py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {loading ? (
                  <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500">Carregando...</div>
                ) : publicationProducts.length === 0 ? (
                  <div className="rounded-2xl border border-slate-200 p-4 text-sm text-slate-500">
                    Nenhum produto encontrado para publicar.
                  </div>
                ) : (
                  publicationProducts.map((product) => (
                    <div key={product.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-base font-semibold text-slate-950">{product.name}</p>
                          <p className="mt-1 text-sm text-slate-500">{product.category_name}</p>
                        </div>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                          {getTypeLabel(product.product_type)}
                        </span>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Cardapio</div>
                          <div
                            className={cn(
                              'mt-2 text-sm font-semibold',
                              product.status === 'published' ? 'text-emerald-700' : 'text-slate-600',
                            )}
                          >
                            {product.status === 'published' ? 'Publicado' : 'Oculto'}
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="text-xs uppercase tracking-[0.14em] text-slate-400">Operacao</div>
                          <div
                            className={cn(
                              'mt-2 text-sm font-semibold',
                              product.available ? 'text-sky-700' : 'text-amber-700',
                            )}
                          >
                            {product.available ? 'Disponivel' : 'Indisponivel'}
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => onTogglePublication(product)}
                          className={cn(
                            'inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition',
                            product.status === 'published'
                              ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                              : 'bg-slate-950 text-white hover:bg-slate-800',
                          )}
                        >
                          {product.status === 'published' ? 'Ocultar do cardapio' : 'Publicar no cardapio'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onToggleAvailability(product)}
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                        >
                          {product.available ? 'Marcar indisponivel' : 'Marcar disponivel'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600 shadow-sm">
                      <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                      Stories da loja
                    </div>
                    <h3 className="mt-3 text-lg font-semibold text-slate-950">Destaques no topo do catalogo</h3>
                    <p className="mt-1 max-w-2xl text-sm text-slate-500">
                      Use para promo do dia, frete gratis, novidade ou recado rapido. So aparecem no cardapio publico quando estiverem ativos e dentro da validade.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={addMenuStory}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      <Plus className="h-4 w-4" />
                      Novo story
                    </button>
                    <button
                      type="button"
                      onClick={() => void onSaveStories()}
                      disabled={storiesSaving}
                      className="btn-primary"
                    >
                      {storiesSaving ? 'Salvando...' : 'Salvar stories'}
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Total</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-950">{menuStoryStats.total}</div>
                    <div className="mt-1 text-xs text-slate-500">Stories cadastrados</div>
                  </div>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Ativos</div>
                    <div className="mt-2 text-2xl font-semibold text-emerald-950">{menuStoryStats.active}</div>
                    <div className="mt-1 text-xs text-emerald-700/80">Ja liberados no topo</div>
                  </div>
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-700">Expiram em breve</div>
                    <div className="mt-2 text-2xl font-semibold text-amber-950">{menuStoryStats.expiringSoon}</div>
                    <div className="mt-1 text-xs text-amber-700/80">Dentro das proximas 48 horas</div>
                  </div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Com validade</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-950">{menuStoryStats.withExpiration}</div>
                    <div className="mt-1 text-xs text-slate-500">Campanhas com data de saida</div>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  {menuStories.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-8 text-center text-sm text-slate-500">
                      Nenhum story cadastrado ainda. Adicione imagem, titulo e expiracao para destacar o cardapio.
                    </div>
                  ) : (
                    menuStories.map((story, index) => (
                      <div key={story.id || `story-${index}`} className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                          <div className="space-y-3">
                            <div className="relative h-48 overflow-hidden rounded-[22px] border border-slate-200 bg-slate-100">
                              {story.imageUrl ? (
                                <AppImage
                                  src={story.imageUrl}
                                  alt={story.title || `Story ${index + 1}`}
                                  fill
                                  sizes="220px"
                                  className="absolute inset-0 h-full w-full object-cover"
                                />
                              ) : (
                                <div className="grid h-full place-items-center px-4 text-center text-sm text-slate-400">
                                  Nenhuma imagem enviada. O destaque vai usar esta arte no topo do cardapio.
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100">
                                Escolher imagem
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  onChange={(event) => {
                                    const file = event.target.files?.[0] || null;
                                    void onSelectStoryImage(index, file);
                                    event.currentTarget.value = '';
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => updateMenuStory(index, { imageUrl: '' })}
                                disabled={!story.imageUrl}
                                className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Remover imagem
                              </button>
                            </div>
                            <p className="text-xs text-slate-500">
                              {storyImageUploadingKey === index ? 'Carregando imagem...' : 'Use arte vertical ou quadrada para chamar mais atencao no topo do catalogo.'}
                            </p>
                          </div>

                          <div className="space-y-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-slate-950">Story {index + 1}</p>
                                <p className="text-xs text-slate-500">Cliente ve esse destaque no topo do cardapio publico.</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeMenuStory(index)}
                                className="inline-flex items-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
                              >
                                <Trash2 className="h-4 w-4" />
                                Remover
                              </button>
                            </div>

                            <div className="grid gap-4 md:grid-cols-2">
                              <div>
                                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Titulo</label>
                                <input
                                  value={story.title}
                                  onChange={(event) => updateMenuStory(index, { title: event.target.value })}
                                  placeholder="Ex: Frete gratis hoje"
                                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                />
                              </div>
                              <div>
                                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Data de expiracao</label>
                                <input
                                  type="datetime-local"
                                  value={story.expiresAt}
                                  onChange={(event) => updateMenuStory(index, { expiresAt: event.target.value })}
                                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                />
                              </div>
                              <div className="md:col-span-2">
                                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Texto de apoio</label>
                                <textarea
                                  value={story.subtitle}
                                  onChange={(event) => updateMenuStory(index, { subtitle: event.target.value })}
                                  placeholder="Ex: Burger em dobro no jantar ou aviso rapido da loja."
                                  rows={3}
                                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                />
                              </div>
                            </div>

                            <div className="grid gap-4 md:grid-cols-[160px_minmax(0,1fr)]">
                              <div>
                                <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Ordem</label>
                                <input
                                  type="number"
                                  min={0}
                                  value={story.displayOrder}
                                  onChange={(event) => updateMenuStory(index, { displayOrder: event.target.value })}
                                  className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                />
                              </div>
                              <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={story.active}
                                  onChange={(event) => updateMenuStory(index, { active: event.target.checked })}
                                  className="h-4 w-4 rounded border-slate-300 text-orange-500 focus:ring-orange-400"
                                />
                                Story ativo no catalogo
                              </label>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </SectionCard>
        ) : null}

        {activeTab === 'configuracoes' ? (
          <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
            <SectionCard
              title="Configuracoes do cardapio"
              description="Esses dados alimentam a vitrine publica da empresa."
            >
              <form onSubmit={onSaveSettings} className="space-y-4">
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    Capa do cardapio
                  </label>
                  <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50">
                    <div className="relative h-44 w-full bg-slate-100">
                      {settings.coverImageUrl ? (
                        <AppImage
                          src={settings.coverImageUrl}
                          alt="Capa do cardapio"
                          fill
                          sizes="(max-width: 1280px) 100vw, 50vw"
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <div className="grid h-full place-items-center px-4 text-center text-sm text-slate-400">
                          Nenhuma capa definida. Essa imagem aparece no topo do cardapio publico.
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-3 border-t border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-xs text-slate-500">
                        {coverImageUploading
                          ? 'Carregando imagem da capa...'
                          : settings.coverImageUrl
                            ? 'Capa pronta para salvar.'
                            : 'Selecione uma imagem de ate 5 MB.'}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-orange-200 hover:bg-orange-50">
                          Escolher imagem
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0] || null;
                              void onSelectCoverImage(file);
                              event.currentTarget.value = '';
                            }}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            resetMessages();
                            setSettings((current) => ({ ...current, coverImageUrl: '' }));
                          }}
                          className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!settings.coverImageUrl}
                        >
                          Remover capa
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                      Tempo de espera
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="180"
                      value={settings.prepTimeMinutes}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          prepTimeMinutes: Number(event.target.value),
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                      Taxa base de entrega
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={settings.deliveryFeeBase}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          deliveryFeeBase: Number(event.target.value),
                        }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                    WhatsApp da loja
                  </label>
                  <input
                    value={settings.whatsappPhone}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, whatsappPhone: event.target.value }))
                    }
                    placeholder="(11) 98888-7777"
                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={settings.storeOpen}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, storeOpen: event.target.checked }))
                    }
                  />
                  Loja aberta no momento
                </label>
                <button type="submit" className="btn-primary">
                  Salvar configuracoes
                </button>
              </form>
            </SectionCard>

          </div>
        ) : null}

        {showProductModal ? (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 p-4">
            <div className="mx-auto max-w-5xl rounded-[32px] border border-slate-200 bg-white shadow-[0_24px_90px_-58px_rgba(15,23,42,0.55)]">
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    {editingProductId ? 'Editar produto' : 'Novo produto'}
                  </p>
                  <h3 className="mt-1 text-2xl font-semibold text-slate-950">
                    {editingProductId ? 'Atualize o cadastro do produto' : 'Escolha o tipo e cadastre o item'}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={closeProductModal}
                  className="rounded-2xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="relative grid gap-6 px-6 py-6 xl:grid-cols-[0.88fr_1.12fr]">
                {productModalLoading ? (
                  <div className="absolute inset-0 z-10 grid place-items-center rounded-b-[32px] bg-white/82 backdrop-blur-[2px]">
                    <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-600 shadow-sm">
                      Carregando dados completos do produto...
                    </div>
                  </div>
                ) : null}
                <div className="space-y-3">
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">
                    Tipo de cadastro
                  </div>
                  <div className="space-y-3">
                    {productTypeCards.map((card) => (
                      <button
                        key={card.type}
                        type="button"
                        onClick={() => applyProductType(card.type)}
                        className={cn(
                          'w-full rounded-3xl border p-4 text-left transition',
                          productDraft.productType === card.type
                            ? 'border-orange-300 bg-orange-50 shadow-sm'
                            : 'border-slate-200 bg-white hover:bg-slate-50',
                        )}
                      >
                        <div className="flex gap-3">
                          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white shadow-sm">
                            {card.icon}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900">{card.title}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-500">{card.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <form onSubmit={onSaveProduct} className="space-y-4">
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      {selectedTypeCard?.icon || <Store className="h-4 w-4 text-orange-600" />}
                      {selectedTypeCard ? selectedTypeCard.title : 'Selecione um tipo'}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {selectedTypeCard
                        ? selectedTypeCard.description
                        : 'Primeiro escolha como este item deve ser cadastrado.'}
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                          Categoria
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            setShowQuickCategoryForm((current) => !current);
                            setQuickCategoryDraft(createEmptyCategoryDraft(productDraft.productType || 'prepared'));
                          }}
                          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-orange-200 hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!productDraft.productType}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Nova categoria
                        </button>
                      </div>
                      <select
                        value={productDraft.categoryId}
                        onChange={(event) =>
                          setProductDraft((current) => ({ ...current, categoryId: event.target.value }))
                        }
                        disabled={!productDraft.productType || categoriesForSelectedType.length === 0}
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        required
                      >
                        <option value="">
                          {productDraft.productType
                            ? categoriesForSelectedType.length > 0
                              ? 'Selecione uma categoria'
                              : 'Nenhuma categoria deste tipo'
                            : 'Selecione primeiro o tipo do produto'}
                        </option>
                        {categoriesForSelectedType.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
                      <p className="mt-2 text-xs text-slate-500">
                        {productDraft.productType
                          ? `Mostrando categorias do tipo ${getTypeLabel(productDraft.productType)}.`
                          : 'O tipo do produto define quais categorias ficam disponiveis aqui.'}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Nome</label>
                      <input
                        value={productDraft.name}
                        onChange={(event) => setProductDraft((current) => ({ ...current, name: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        placeholder="Nome do produto"
                        required
                      />
                    </div>
                  </div>

                  {showQuickCategoryForm ? (
                    <div className="rounded-3xl border border-dashed border-orange-300 bg-orange-50/60 p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">Nova categoria rapida</div>
                          <p className="mt-1 text-xs text-slate-500">
                            Esta categoria sera criada ja vinculada ao tipo{' '}
                            <span className="font-semibold text-slate-700">
                              {productDraft.productType ? getTypeLabel(productDraft.productType) : 'selecionado'}
                            </span>
                            .
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowQuickCategoryForm(false)}
                          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                        >
                          Fechar
                        </button>
                      </div>

                      <div className="mt-4 space-y-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          <input
                            value={quickCategoryDraft.name}
                            onChange={(event) =>
                              setQuickCategoryDraft((current) => ({ ...current, name: event.target.value }))
                            }
                            onKeyDown={onQuickCategoryInputKeyDown}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                            placeholder="Nome da categoria"
                            required
                          />
                          <input
                            value={quickCategoryDraft.icon}
                            onChange={(event) =>
                              setQuickCategoryDraft((current) => ({ ...current, icon: event.target.value }))
                            }
                            onKeyDown={onQuickCategoryInputKeyDown}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                            placeholder="Icone opcional"
                          />
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setShowQuickCategoryForm(false)}
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            Cancelar
                          </button>
                          <button type="button" onClick={() => void onQuickCreateCategory()} className="btn-primary">
                            Criar categoria
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div>
                    <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                      Descricao
                    </label>
                    <textarea
                      rows={3}
                      value={productDraft.description}
                      onChange={(event) =>
                        setProductDraft((current) => ({ ...current, description: event.target.value }))
                      }
                      className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      placeholder="Descreva o item para a equipe e para o cliente"
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div>
                      <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                        Preco base
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={productDraft.price}
                        onChange={(event) => setProductDraft((current) => ({ ...current, price: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">SKU</label>
                      <input
                        value={productDraft.sku}
                        onChange={(event) => setProductDraft((current) => ({ ...current, sku: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        placeholder="Opcional"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                        Imagem
                      </label>
                      <div className="mt-2 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50">
                        <div className="relative h-36 w-full bg-slate-100">
                          {productDraft.imageUrl ? (
                            <AppImage
                              src={productDraft.imageUrl}
                              alt={`Foto do produto ${productDraft.name || 'sem nome'}`}
                              fill
                              sizes="(max-width: 768px) 100vw, 33vw"
                              className="absolute inset-0 h-full w-full object-cover"
                            />
                          ) : (
                            <div className="grid h-full place-items-center px-4 text-center text-sm text-slate-400">
                              A foto escolhida vai aparecer aqui antes de salvar o produto.
                            </div>
                          )}
                        </div>
                        <div className="border-t border-slate-200 bg-white p-4">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(event) => {
                              const file = event.target.files?.[0] || null;
                              void onSelectProductImage(file);
                              event.currentTarget.value = '';
                            }}
                            className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                          />
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs text-slate-500">
                              {imageUploading
                                ? 'Carregando imagem...'
                                : 'Selecione uma imagem de ate 5 MB.'}
                            </p>
                            <button
                              type="button"
                              onClick={() => {
                                resetMessages();
                                setProductDraft((current) => ({ ...current, imageUrl: '' }));
                              }}
                              className="rounded-2xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={!productDraft.imageUrl}
                            >
                              Remover foto
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {productDraft.productType === 'packaged' ? (
                    <div className="grid gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-3">
                      <input
                        value={productDraft.packagedBrand}
                        onChange={(event) =>
                          setProductDraft((current) => ({ ...current, packagedBrand: event.target.value }))
                        }
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        placeholder="Marca"
                      />
                      <input
                        value={productDraft.packagedVolume}
                        onChange={(event) =>
                          setProductDraft((current) => ({ ...current, packagedVolume: event.target.value }))
                        }
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        placeholder="Volume"
                      />
                      <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                        <input
                          type="checkbox"
                          checked={productDraft.packagedAlcoholic}
                          onChange={(event) =>
                            setProductDraft((current) => ({
                              ...current,
                              packagedAlcoholic: event.target.checked,
                            }))
                          }
                        />
                        Bebida alcoolica
                      </label>
                    </div>
                  ) : null}

                  {productDraft.productType === 'size_based' ? (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-semibold text-slate-900">Tamanhos e precos</div>
                      <p className="mt-1 text-xs text-slate-500">
                        Use uma linha por tamanho no formato `Nome|Preco`. Esse cadastro serve para pizza e outros
                        itens por tamanho.
                      </p>
                      <textarea
                        rows={5}
                        value={productDraft.sizeOptionsText}
                        onChange={(event) =>
                          setProductDraft((current) => ({ ...current, sizeOptionsText: event.target.value }))
                        }
                        className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      />
                      <div className="mt-4 grid gap-4 md:grid-cols-2">
                        <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={productDraft.pizzaAllowHalfAndHalf}
                            onChange={(event) =>
                              setProductDraft((current) => ({
                                ...current,
                                pizzaAllowHalfAndHalf: event.target.checked,
                              }))
                            }
                          />
                          Permitir pizza meio a meio
                        </label>
                        <div>
                          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                            Maximo de sabores
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="4"
                            value={productDraft.pizzaFlavorLimit}
                            onChange={(event) =>
                              setProductDraft((current) => ({
                                ...current,
                                pizzaFlavorLimit: event.target.value,
                              }))
                            }
                            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                          />
                        </div>
                      </div>
                      <div className="mt-4">
                        <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                          Bordas recheadas
                        </label>
                        <p className="mt-1 text-xs text-slate-500">
                          Use uma linha por borda no formato `Nome|Preco`. Se nao quiser borda, deixe vazio.
                        </p>
                        <textarea
                          rows={4}
                          value={productDraft.pizzaBordersText}
                          onChange={(event) =>
                            setProductDraft((current) => ({
                              ...current,
                              pizzaBordersText: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        />
                      </div>
                      <div className="mt-4">
                        <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                          Massas da pizza
                        </label>
                        <p className="mt-1 text-xs text-slate-500">
                          Use uma linha por massa no formato `Nome|Preco`. Exemplo: `Pan|4`.
                        </p>
                        <textarea
                          rows={4}
                          value={productDraft.pizzaDoughsText}
                          onChange={(event) =>
                            setProductDraft((current) => ({
                              ...current,
                              pizzaDoughsText: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        />
                      </div>
                      <div className="mt-4">
                        <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                          Regras de brinde (refrigerante)
                        </label>
                        <p className="mt-1 text-xs text-slate-500">
                          Use uma linha por regra no formato `Tamanho|Bebida|Quantidade`. Exemplo:
                          `Broto|Dolli 1L|1`.
                        </p>
                        <textarea
                          rows={4}
                          value={productDraft.pizzaGiftRulesText}
                          onChange={(event) =>
                            setProductDraft((current) => ({
                              ...current,
                              pizzaGiftRulesText: event.target.value,
                            }))
                          }
                          className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        />
                      </div>
                      <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-3 text-xs text-slate-500">
                        Regra aplicada ao cliente: ele escolhe o tamanho e pode combinar sabores da mesma categoria.
                        No meio a meio, o sistema usa o maior preco entre os sabores selecionados naquele tamanho.
                      </div>
                    </div>
                  ) : null}

                  {productDraft.productType === 'ingredient' ? (
                    <div className="grid gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                      <select
                        value={productDraft.ingredientUnit}
                        onChange={(event) =>
                          setProductDraft((current) => ({ ...current, ingredientUnit: event.target.value }))
                        }
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      >
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                        <option value="l">l</option>
                        <option value="ml">ml</option>
                        <option value="un">un</option>
                      </select>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={productDraft.ingredientCost}
                        onChange={(event) =>
                          setProductDraft((current) => ({ ...current, ingredientCost: event.target.value }))
                        }
                        className="rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        placeholder="Custo unitario"
                      />
                    </div>
                  ) : null}

                  {productDraft.productType === 'special' ? (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <input
                        value={productDraft.specialTag}
                        onChange={(event) =>
                          setProductDraft((current) => ({ ...current, specialTag: event.target.value }))
                        }
                        className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        placeholder="Tag especial, ex: prato do dia"
                      />
                    </div>
                  ) : null}

                  {canManageOptionGroups ? (
                    <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                            <Blocks className="h-4 w-4 text-orange-600" />
                            Complementos e adicionais
                          </div>
                          <p className="mt-1 text-xs leading-5 text-slate-500">
                            Crie grupos para o cliente escolher no cardapio, como extras, molhos e troca de pao.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={addOptionGroup}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-orange-200 bg-white px-4 py-2 text-sm font-medium text-orange-700 transition hover:bg-orange-50"
                        >
                          <Plus className="h-4 w-4" />
                          Adicionar grupo
                        </button>
                      </div>

                      {productDraft.optionGroups.length === 0 ? (
                        <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-5 text-sm text-slate-500">
                          Nenhum grupo cadastrado ainda. Exemplo: `Turbine seu lanche`, `Escolha o molho`,
                          `Troca de pao`.
                        </div>
                      ) : (
                        <div className="mt-4 space-y-4">
                          {productDraft.optionGroups.map((group, groupIndex) => (
                            <div
                              key={group.id || `group-${groupIndex}`}
                              className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm"
                            >
                              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                  <BadgeCheck className="h-4 w-4 text-emerald-600" />
                                  Grupo {groupIndex + 1}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeOptionGroup(groupIndex)}
                                  className="inline-flex items-center gap-2 rounded-2xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                  Remover grupo
                                </button>
                              </div>

                              <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_0.7fr_0.7fr]">
                                <div>
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                                    Nome do grupo
                                  </label>
                                  <input
                                    value={group.name}
                                    onChange={(event) =>
                                      updateOptionGroup(groupIndex, { name: event.target.value })
                                    }
                                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                    placeholder="Ex.: Turbine seu lanche"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                                    Minimo
                                  </label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={group.minSelect}
                                    onChange={(event) =>
                                      updateOptionGroup(groupIndex, { minSelect: event.target.value })
                                    }
                                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                  />
                                </div>
                                <div>
                                  <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                                    Maximo
                                  </label>
                                  <input
                                    type="number"
                                    min="1"
                                    value={group.maxSelect}
                                    onChange={(event) =>
                                      updateOptionGroup(groupIndex, { maxSelect: event.target.value })
                                    }
                                    className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                  />
                                </div>
                              </div>

                              <label className="mt-4 inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={group.required}
                                  onChange={(event) =>
                                    updateOptionGroup(groupIndex, { required: event.target.checked })
                                  }
                                />
                                Grupo obrigatorio
                              </label>

                              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                                    Itens do grupo
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => addOptionToGroup(groupIndex)}
                                    className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                                  >
                                    <Plus className="h-4 w-4" />
                                    Adicionar item
                                  </button>
                                </div>

                                {group.options.length === 0 ? (
                                  <div className="mt-3 rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-4 text-sm text-slate-500">
                                    Adicione pelo menos um item neste grupo.
                                  </div>
                                ) : (
                                  <div className="mt-3 space-y-3">
                                    {group.options.map((option, optionIndex) => (
                                      <div
                                        key={option.id || `group-${groupIndex}-option-${optionIndex}`}
                                        className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 lg:grid-cols-[1.45fr_0.8fr_1.1fr_auto_auto]"
                                      >
                                        <div>
                                          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                                            Nome do item
                                          </label>
                                          <input
                                            value={option.name}
                                            onChange={(event) =>
                                              updateOptionInGroup(groupIndex, optionIndex, {
                                                name: event.target.value,
                                              })
                                            }
                                            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                            placeholder="Ex.: Bacon"
                                          />
                                        </div>
                                        <div>
                                          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                                            Valor extra
                                          </label>
                                          <input
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={option.priceAddition}
                                            onChange={(event) =>
                                              updateOptionInGroup(groupIndex, optionIndex, {
                                                priceAddition: event.target.value,
                                              })
                                            }
                                            className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                                          />
                                        </div>
                                        <div>
                                          <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                                            Foto do complemento
                                          </label>
                                          <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                                            <div className="flex items-center gap-3">
                                              <div className="relative h-16 w-16 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                                {option.imageUrl ? (
                                                  <AppImage
                                                    src={option.imageUrl}
                                                    alt={option.name || 'Complemento'}
                                                    fill
                                                    sizes="64px"
                                                    className="absolute inset-0 h-full w-full object-cover"
                                                  />
                                                ) : (
                                                  <div className="grid h-full place-items-center text-[10px] font-medium uppercase tracking-[0.16em] text-slate-400">
                                                    Sem foto
                                                  </div>
                                                )}
                                              </div>
                                              <div className="min-w-0 flex-1">
                                                <div className="text-xs text-slate-500">
                                                  {optionImageUploadingKey === `${groupIndex}:${optionIndex}`
                                                    ? 'Carregando imagem...'
                                                    : option.imageUrl
                                                      ? 'Imagem pronta para o cardapio.'
                                                      : 'A foto ajuda o cliente a visualizar o adicional.'}
                                                </div>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                  <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100">
                                                    Escolher imagem
                                                    <input
                                                      type="file"
                                                      accept="image/*"
                                                      className="hidden"
                                                      onChange={(event) => {
                                                        const file = event.target.files?.[0] || null;
                                                        void onSelectOptionImage(groupIndex, optionIndex, file);
                                                        event.currentTarget.value = '';
                                                      }}
                                                    />
                                                  </label>
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      updateOptionInGroup(groupIndex, optionIndex, {
                                                        imageUrl: '',
                                                      })
                                                    }
                                                    className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                                                    disabled={!option.imageUrl}
                                                  >
                                                    Remover foto
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                        <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 lg:mt-7">
                                          <input
                                            type="checkbox"
                                            checked={option.active}
                                            onChange={(event) =>
                                              updateOptionInGroup(groupIndex, optionIndex, {
                                                active: event.target.checked,
                                              })
                                            }
                                          />
                                          Ativo
                                        </label>
                                        <button
                                          type="button"
                                          onClick={() => removeOptionFromGroup(groupIndex, optionIndex)}
                                          className="inline-flex items-center justify-center rounded-2xl border border-rose-200 px-3 py-3 text-rose-600 transition hover:bg-rose-50 lg:mt-7"
                                          aria-label="Remover item"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : productDraft.productType === 'ingredient' ? (
                    <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      Produto interno de estoque nao aparece no cardapio, entao nao precisa de complemento.
                    </div>
                  ) : null}

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                        Publicacao
                      </label>
                      <select
                        value={productDraft.status}
                        onChange={(event) =>
                          setProductDraft((current) => ({
                            ...current,
                            status: event.target.value as 'draft' | 'published',
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      >
                        <option value="draft">Nao publicar agora</option>
                        <option value="published">Publicar no cardapio</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                        Disponibilidade
                      </label>
                      <select
                        value={productDraft.available ? 'true' : 'false'}
                        onChange={(event) =>
                          setProductDraft((current) => ({
                            ...current,
                            available: event.target.value === 'true',
                          }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      >
                        <option value="true">Disponivel</option>
                        <option value="false">Indisponivel</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={closeProductModal}
                      className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600"
                    >
                      Cancelar
                    </button>
                    <button type="submit" className="btn-primary">
                      {editingProductId ? 'Salvar alteracoes' : 'Criar produto'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}

