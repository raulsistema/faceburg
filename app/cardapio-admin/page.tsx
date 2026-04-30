'use client';

import { FormEvent, ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
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
import { cn } from '@/lib/utils';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type Category = {
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
  display_order: number;
  product_count?: string;
};

type ProductType = 'prepared' | 'packaged' | 'size_based' | 'ingredient' | 'special';

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
  whatsappPhone: string;
};

type AdminDataResponse = {
  categories?: Category[];
  products?: Product[];
  linkData?: LinkData;
  settings?: CardapioSettings;
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
};

type SectionTab = 'visao-geral' | 'produtos' | 'categorias' | 'publicacao' | 'configuracoes';

type ProductTypeCard = {
  type: ProductType;
  title: string;
  description: string;
  icon: ReactNode;
};

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
  };
}

function formatCurrency(value: number | string) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value || 0));
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
  const [linkData, setLinkData] = useState<LinkData | null>(null);
  const [settings, setSettings] = useState<CardapioSettings>({
    prepTimeMinutes: 40,
    deliveryFeeBase: 5,
    storeOpen: true,
    whatsappPhone: '',
  });
  const [activeTab, setActiveTab] = useState<SectionTab>('visao-geral');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const [productModalLoading, setProductModalLoading] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft>(emptyProductDraft);
  const [categoryDraft, setCategoryDraft] = useState({ name: '', icon: '' });
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryDraft, setEditingCategoryDraft] = useState({
    name: '',
    icon: '',
    active: true,
  });
  const [productSearch, setProductSearch] = useState('');
  const [publicationSearch, setPublicationSearch] = useState('');
  const deferredProductSearch = useDeferredValue(productSearch);
  const deferredPublicationSearch = useDeferredValue(publicationSearch);

  const selectedTypeCard = useMemo(
    () => productTypeCards.find((card) => card.type === productDraft.productType) || null,
    [productDraft.productType],
  );

  const filteredProducts = useMemo(() => {
    const normalizedSearch = deferredProductSearch.trim().toLowerCase();
    if (!normalizedSearch) return products;
    return products.filter((product) =>
      [product.name, product.category_name, product.sku || '', getTypeLabel(product.product_type)]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [deferredProductSearch, products]);

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
      setLinkData(data.linkData || null);
      setSettings({
        prepTimeMinutes: Number(nextSettings?.prepTimeMinutes ?? 40),
        deliveryFeeBase: Number(nextSettings?.deliveryFeeBase ?? 0),
        storeOpen: Boolean(nextSettings?.storeOpen),
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

  function openCreateProductModal() {
    setProductModalLoading(false);
    setEditingProductId(null);
    setProductDraft({
      ...emptyProductDraft,
      categoryId: categories[0]?.id || '',
    });
    setShowProductModal(true);
  }

  async function openEditProductModal(product: Product) {
    resetMessages();
    setEditingProductId(product.id);
    setProductDraft(draftFromProduct(product));
    setProductModalLoading(true);
    setShowProductModal(true);

    try {
      const response = await fetch(`/api/products/${product.id}`, { cache: 'no-store' });
      const data = (await response.json()) as { product?: Product; error?: string };
      if (!response.ok || !data.product) {
        throw new Error(data.error || 'Falha ao carregar produto.');
      }

      setProductDraft(draftFromProduct(data.product));
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
    setProductDraft(emptyProductDraft);
  }

  function startEditCategory(category: Category) {
    setEditingCategoryId(category.id);
    setEditingCategoryDraft({
      name: category.name,
      icon: category.icon || '',
      active: category.active,
    });
  }

  function resetMessages() {
    setError(null);
    setSuccessMessage(null);
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

    setCategoryDraft({ name: '', icon: '' });
    setSuccessMessage('Categoria criada com sucesso.');
    await loadData();
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
          <div className="space-y-6">
            <SectionCard
              title="Produtos do sistema"
              description="Cadastre todos os produtos da empresa aqui. Depois decida se vao ou nao para o cardapio publico."
              action={
                <button type="button" onClick={openCreateProductModal} className="btn-primary">
                  <Plus className="h-4 w-4" />
                  Novo produto
                </button>
              }
            >
              <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs text-slate-500">Total</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-950">{products.length}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs text-slate-500">Publicados</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-950">{productStats.published}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs text-slate-500">Disponiveis</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-950">{productStats.available}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 p-4">
                      <div className="text-xs text-slate-500">Uso interno</div>
                      <div className="mt-2 text-2xl font-semibold text-slate-950">{productStats.internal}</div>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      value={productSearch}
                      onChange={(event) => setProductSearch(event.target.value)}
                      placeholder="Buscar por nome, categoria, SKU ou tipo"
                      className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-700 outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                    />
                  </div>

                  <div className="overflow-hidden rounded-3xl border border-slate-200">
                    <div className="grid grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_auto] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                      <span>Produto</span>
                      <span>Categoria</span>
                      <span>Status</span>
                      <span>Preco</span>
                      <span>Acoes</span>
                    </div>
                    <div className="divide-y divide-slate-200 bg-white">
                      {loading ? (
                        <div className="px-4 py-8 text-sm text-slate-500">Carregando produtos...</div>
                      ) : filteredProducts.length === 0 ? (
                        <div className="px-4 py-8 text-sm text-slate-500">Nenhum produto encontrado.</div>
                      ) : (
                        filteredProducts.map((product) => (
                          <div
                            key={product.id}
                            className="grid grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_auto] gap-3 px-4 py-4 text-sm"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="truncate font-semibold text-slate-950">{product.name}</p>
                                <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                                  {getTypeLabel(product.product_type)}
                                </span>
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
                                {product.available ? 'Disponivel' : 'Indisponivel'}
                              </div>
                            </div>
                            <div className="font-medium text-slate-900">{formatCurrency(product.price)}</div>
                            <div className="flex items-start justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => void openEditProductModal(product)}
                                className="rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50"
                                title="Editar produto"
                              >
                                <Pencil className="h-4 w-4" />
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
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
              </div>
            </SectionCard>
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

            <SectionCard
              title="Regras do cardapio publico"
              description="Visao operacional para manter a experiencia do cliente limpa e segura."
            >
              <div className="space-y-3">
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Publicacao controlada</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Produto so aparece ao cliente quando estiver publicado e disponivel.
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Isolamento SaaS</p>
                  <p className="mt-1 text-sm text-slate-500">
                    O tenant atual acessa apenas os proprios produtos, categorias, pedidos e link publico.
                  </p>
                </div>
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm font-semibold text-slate-900">Itens internos protegidos</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Materia-prima continua fora do cardapio e do PDV publico para nao misturar operacao com venda.
                  </p>
                </div>
              </div>
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
                        onClick={() =>
                          setProductDraft((current) => ({
                            ...current,
                            productType: card.type,
                            status: card.type === 'ingredient' ? 'draft' : current.status,
                            available: card.type === 'ingredient' ? false : current.available,
                          }))
                        }
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
                      <label className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
                        Categoria
                      </label>
                      <select
                        value={productDraft.categoryId}
                        onChange={(event) =>
                          setProductDraft((current) => ({ ...current, categoryId: event.target.value }))
                        }
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                        required
                      >
                        <option value="">Selecione uma categoria</option>
                        {categories.map((category) => (
                          <option key={category.id} value={category.id}>
                            {category.name}
                          </option>
                        ))}
                      </select>
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
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          void onSelectProductImage(file);
                        }}
                        className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none transition focus:border-orange-300 focus:ring-4 focus:ring-orange-100"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        {imageUploading
                          ? 'Carregando imagem...'
                          : productDraft.imageUrl
                            ? 'Imagem pronta para salvar (armazenada no banco).'
                            : 'Selecione uma imagem de ate 5 MB.'}
                      </p>
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

