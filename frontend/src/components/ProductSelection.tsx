import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { productAPI } from '../lib/ProductAPI';
import { categoryAPI } from '../lib/CategoryAPI';
import type { Product, Category as CategoryType } from '../types';
import { getImageUrl } from '../utils/api';
import {
  calculatePriceWithOptions,
  formatChoiceDisplay,
} from '../utils/customOptions';

const styles = {
  gold: '#337957',
  dark: '#2D2A26',
  fontSans: '"Century Gothic", sans-serif',
};

interface ApiCategoryNode extends CategoryType {
  children?: ApiCategoryNode[];
}

interface ProductSelectionProps {
  categoryId?: number;
  categoryTitle?: string;
  onBack?: () => void;
  onAddToCart: (product: any) => void;
}

const ProductSelection: React.FC<ProductSelectionProps> = ({
  categoryId,
  categoryTitle = '',
  onBack,
  onAddToCart,
}) => {
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categoryTree, setCategoryTree] = useState<ApiCategoryNode[]>([]);
  const [subCategory, setSubCategory] = useState<{id: number; title: string;} | null>(null);
  // Ref + handler to scroll down to the products when a sub-category is picked,
  // mirroring the category-click behavior on the shop page.
  const productsRef = useRef<HTMLDivElement>(null);
  const handleSubCategoryClick = (id: number, title: string) => {
    setSubCategory({ id, title });
    setTimeout(() => {
      productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };
  const [childCategories, setChildCategories] = useState<ApiCategoryNode[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [recommendationNotif, setRecommendationNotif] = useState<Product[]>([]);
  const [showRecommendationNotif, setShowRecommendationNotif] = useState(false);
  const [modalMainImage, setModalMainImage] = useState('');

  // States pour les options
  const [quantity, setQuantity] = useState(1);
  const [selectedBread, setSelectedBread] = useState<string>("Baguette");
  const [isSliced, setIsSliced] = useState<boolean>(false);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const currentWeekDay = new Date().getDay();

  const normalizeOptionName = (s: string) =>
    s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const isAllergyOptionName = (name: string) =>
    normalizeOptionName(name).includes("allerg");

  const getMissingRequiredOptions = (
    product: Product | null,
    options: Record<string, string>,
  ) => {
    if (!product?.customOptions?.length) return [] as string[];

    return product.customOptions
      .filter((option) => !isAllergyOptionName(option.name))
      .filter((option) => !String(options[option.name] || "").trim())
      .map((option) => option.name);
  };

  const missingRequiredOptions = getMissingRequiredOptions(
    selectedProduct,
    selectedOptions,
  );
  const hasMissingRequiredOptions = missingRequiredOptions.length > 0;

  // Logique de filtrage (Backend-logic preserved)
  const normalizeStr = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalizeCategoryKey = (s: string) =>
    normalizeStr(s)
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const singularizeToken = (token: string) => {
    if (token === "plateaux") return "plateau";
    if (token.endsWith("s") && token.length > 3) return token.slice(0, -1);
    return token;
  };
  const normalizeCategoryToken = (token: string) => {
    // Common short forms used in product categories
    if (token === "dej" || token === "deje") return "dejeuner";
    if (token === "ptit" || token === "tit" || token === "petit") return "petit";
    return token;
  };
  const categoryTokens = (value: string) =>
    normalizeCategoryKey(value)
      .split(" ")
      .filter(Boolean)
      .map(singularizeToken);
  const categoryMatches = (productCategory: string, selectedCategory: string) => {
    const productTokens = categoryTokens(productCategory).map(normalizeCategoryToken);
    const selectedTokens = categoryTokens(selectedCategory).map(normalizeCategoryToken);

    if (!productTokens.length || !selectedTokens.length) return false;

    // Exact match first
    const productJoined = productTokens.join(" ");
    const selectedJoined = selectedTokens.join(" ");
    if (productJoined === selectedJoined) return true;

    // For subset match: require bidirectional overlap (both sides must have matching tokens)
    // This prevents "salade" from matching "salade repas"
    const meaningfulProductTokens = productTokens.filter(t => t.length > 2);
    const meaningfulSelectedTokens = selectedTokens.filter(t => t.length > 2);
    if (meaningfulProductTokens.length > 0 && meaningfulSelectedTokens.length > 0) {
      // Check if there's significant overlap in both directions
      const productInSelected = meaningfulProductTokens.filter(t => meaningfulSelectedTokens.includes(t));
      const selectedInProduct = meaningfulSelectedTokens.filter(t => meaningfulProductTokens.includes(t));
      // Both must have at least one meaningful token in common, and the overlap should be substantial
      if (productInSelected.length > 0 && selectedInProduct.length > 0 && 
          productInSelected.length === meaningfulProductTokens.length &&
          selectedInProduct.length === meaningfulSelectedTokens.length) {
        return true;
      }
    }

    // Secondary tolerant match: same token set (order-insensitive) only.
    if (productTokens.length !== selectedTokens.length) return false;
    return selectedTokens.every((t) => productTokens.includes(t));
  };
  const isLunchCategory = (category: string) => {
    const n = normalizeStr(category);
    return n.includes("lunch") || n.includes("salade repas") || n.includes("plateau repas");
  };

  const asCategoryArray = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map((v) => String(v));
    if (typeof value === "string") return [value];
    return [];
  };

  const flattenTree = (nodes: ApiCategoryNode[]): ApiCategoryNode[] => {
    const result: ApiCategoryNode[] = [];
    const walk = (items: ApiCategoryNode[]) => {
      items.forEach((item) => {
        result.push(item);
        if (item.children?.length) walk(item.children);
      });
    };
    walk(nodes);
    return result;
  };

  // Fetch data ONCE on mount — switching categories only re-filters locally (instant)
  useEffect(() => {
    fetchData();
  }, []);

  // Reset subcategory when parent category changes
  useEffect(() => {
    setSubCategory(null);
  }, [categoryId, categoryTitle]);

  useEffect(() => {
    if (selectedProduct) setModalMainImage(selectedProduct.image || '');
  }, [selectedProduct]);

  useEffect(() => {
    if (!selectedProduct) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [selectedProduct]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [catRes, prodRes, allProdRes] = await Promise.all([
        categoryAPI.getAllCategories(),
        productAPI.getAllProducts(1, 1000, "clients"),
        productAPI.getAllProducts(1, 1000),
      ]);

      const rawNodes = (catRes.data.categories || []) as ApiCategoryNode[];
      const allFlat = flattenTree(rawNodes);
      const byId = new Map<number, ApiCategoryNode>();
      allFlat.forEach((n) => { if (typeof n.id === 'number') byId.set(n.id, { ...n, children: [] }); });
      byId.forEach((node) => {
        if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children!.push(node);
      });
      const roots = Array.from(byId.values()).filter(n => !n.parentId || !byId.has(n.parentId));
      
      setCategoryTree(roots);
      setProducts(prodRes.data.products);
      setAllProducts(allProdRes.data.products);
      setSubCategory(null);
    } catch (err) {
      setError('Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  // Filtrage des produits
  useEffect(() => {
    const currentName = (subCategory?.title || categoryTitle || "").toLowerCase();
    const allNodes = flattenTree(categoryTree);
    const currentNode = allNodes.find(c => c.name.toLowerCase() === currentName);
    const children = currentNode?.children || [];

    // If we're on a sub-category that has no children, show its SIBLINGS
    // (i.e. the other sub-categories under the same parent) so the user can
    // navigate between them without going back.
    let categoriesToDisplay = children;
    if (subCategory && children.length === 0 && currentNode?.parentId) {
      const parent = allNodes.find(c => c.id === currentNode.parentId);
      if (parent?.children && parent.children.length > 0) {
        categoriesToDisplay = parent.children;
      }
    }
    setChildCategories(categoriesToDisplay);

    if (products.length === 0) return;

    // When a parent category has sub-categories and none is selected yet,
    // show nothing — user must pick a sub-category first.
    if (!subCategory && children.length > 0) {
      setFilteredProducts([]);
      return;
    }

    // Collect all category names in the current subtree (handles sub-sub-categories)
    const getNamesInSubtree = (node: ApiCategoryNode): string[] => {
      const names: string[] = [node.name.toLowerCase()];
      (node.children || []).forEach(child => names.push(...getNamesInSubtree(child)));
      return names;
    };
    const namesToMatch = currentNode
      ? getNamesInSubtree(currentNode)
      : currentName ? [currentName] : [];

    const filtered = namesToMatch.length > 0
      ? products.filter((p) =>
          p.available &&
          namesToMatch.some((name) =>
            asCategoryArray((p as any).category).some((c) => categoryMatches(c, name)),
          ),
        )
      : products.filter((p) => p.available);

    setFilteredProducts(filtered);
  }, [categoryId, categoryTitle, subCategory, products, categoryTree]);

  const getCurrentPrice = () => {
    if (!selectedProduct) return 0;

    return calculatePriceWithOptions(
      selectedProduct.price,
      selectedProduct.customOptions || [],
      selectedOptions,
    );
  };

  const getDiscountedPrice = (price: number, discount: number = 0) => {
    return price * (1 - discount / 100);
  };

  const getRelatedProducts = (product: Product): Product[] => {
    if (!product.recommendations || product.recommendations.length === 0) return [];
    return product.recommendations
      .map((id) => allProducts.find((p) => p.id === id))
      .filter((p): p is Product => !!p);
  };

  const getPreparationBadge = (hours: number) => {
    if (hours >= 168) {
      return {
        text: '7j',
        bgColor: 'bg-amber-100',
        textColor: 'text-amber-800',
        borderColor: 'border-amber-300',
      };
    } else if (hours >= 48) {
      return {
        text: `${hours}h`,
        bgColor: 'bg-amber-100',
        textColor: 'text-amber-800',
        borderColor: 'border-amber-300',
      };
    } else if (hours >= 24) {
      return {
        text: '24h',
        bgColor: 'bg-yellow-100',
        textColor: 'text-yellow-800',
        borderColor: 'border-yellow-300',
      };
    }
    return null;
  };

  const handleProductClick = (product: Product) => {
    setSelectedProduct(product);
    // Réinitialiser toutes les options
    setQuantity(Math.max(product.minOrderQuantity || 1, 1));
    setSelectedBread("Baguette");
    setIsSliced(false);
    // Pré-sélectionner le 1er choix (valeur par défaut) de chaque option à
    // choix. Sinon l'option n'est pas enregistrée tant qu'on ne clique pas
    // dessus → elle n'apparaît pas dans la liste de production.
    const defaults: Record<string, string> = {};
    for (const option of ((product.customOptions || []) as any[])) {
      if (option?.type !== "text" && Array.isArray(option?.choices) && option.choices.length > 0) {
        defaults[option.name] = option.choices[0];
      }
    }
    setSelectedOptions(defaults);
  };

  const handleAddToCart = () => {
    if (selectedProduct) {
      if (hasMissingRequiredOptions) {
        alert(
          `Veuillez choisir ou remplir l'option obligatoire "${missingRequiredOptions[0]}".`,
        );
        return;
      }

      const totalPrice = getCurrentPrice();
      const discountedPrice = totalPrice * (1 - (selectedProduct.discountPercentage || 0) / 100);

      const p: any = { 
        ...selectedProduct, 
        price: discountedPrice,
        selectedOptions: selectedOptions 
      };
      for (let i = 0; i < quantity; i++) onAddToCart(p);

      // Afficher les recommandations comme notification
      const related = getRelatedProducts(selectedProduct);
      if (related.length > 0) {
        setRecommendationNotif(related);
        setShowRecommendationNotif(true);
        setTimeout(() => setShowRecommendationNotif(false), 12000);
      }

      setSelectedProduct(null);
    }
  };

  if (loading) return <div className="py-10 text-center">Chargement des produits...</div>;

  return (
    <div className="py-8 px-4 md:px-8 bg-white/50 backdrop-blur-sm animate-in fade-in duration-500" style={{ fontFamily: '"Century Gothic", sans-serif' }}>

      {/* NOTIFICATION RECOMMANDATIONS - AGRANDIE */}
      {showRecommendationNotif && recommendationNotif.length > 0 && (
        <div className="fixed inset-0 z-[12000] pointer-events-none flex items-center justify-center px-4 py-8">
        <div className="pointer-events-auto w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-stone-100 overflow-hidden animate-in zoom-in-95 fade-in duration-300">
          <div className="bg-gradient-to-r from-[#2D2A26] to-[#337957] px-6 py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl animate-bounce">✨</span>
              <div>
                <p className="text-white text-sm font-bold uppercase tracking-widest">Vous aimerez aussi!</p>
                <p className="text-white/80 text-xs mt-1">Nos recommandations pour vous</p>
              </div>
            </div>
            <button
              onClick={() => setShowRecommendationNotif(false)}
              className="text-white/60 hover:text-white transition-colors text-2xl leading-none flex-shrink-0"
            >
              ✕
            </button>
          </div>
          <div className="p-6 space-y-3 max-h-96 overflow-y-auto">
            {recommendationNotif.map((rec) => {
              const recPrice = getDiscountedPrice(rec.price, rec.discountPercentage);
              return (
                <div key={rec.id} className="flex items-center gap-4 bg-gradient-to-r from-stone-50 to-white rounded-2xl p-4 hover:from-stone-100 hover:to-stone-50 transition-all border border-stone-200 cursor-pointer group">
                  <img
                    src={getImageUrl(rec.image)}
                    alt={rec.name}
                    className="w-20 h-20 rounded-xl object-cover shrink-0 group-hover:scale-110 transition-transform shadow-md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-base font-bold text-[#2D2A26]">{rec.name}</p>
                    <p className="text-sm text-stone-600 mt-1 line-clamp-2">{rec.description || 'Délicieux produit'}</p>
                    <p className="text-lg font-bold text-[#337957] mt-2">{recPrice.toFixed(2)} $</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (rec.customOptions?.length) {
                        setSelectedProduct(rec);
                        setQuantity(1);
                        setSelectedBread("Baguette");
                        setIsSliced(false);
                        const recDefaults: Record<string, string> = {};
                        for (const option of ((rec.customOptions || []) as any[])) {
                          if (option?.type !== "text" && Array.isArray(option?.choices) && option.choices.length > 0) {
                            recDefaults[option.name] = option.choices[0];
                          }
                        }
                        setSelectedOptions(recDefaults);
                      } else {
                        onAddToCart({ ...rec, price: recPrice, selectedOptions: {} });
                      }
                      setShowRecommendationNotif(false);
                    }}
                    className="shrink-0 px-5 py-3 text-xs font-bold uppercase tracking-wider rounded-xl bg-[#337957] text-white hover:bg-[#2D2A26] transition-all shadow-lg hover:shadow-xl transform hover:scale-105"
                  >
                    {rec.customOptions?.length ? "Configurer" : "+ Panier"}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="bg-stone-50 px-6 py-4 border-t border-stone-100 flex items-center justify-between">
            <p className="text-sm text-stone-600 font-medium">Cette notification disparaîtra automatiquement</p>
            <button
              onClick={() => setShowRecommendationNotif(false)}
              className="text-xs font-semibold text-stone-600 hover:text-[#337957] transition-colors"
            >
              Fermer
            </button>
          </div>
        </div>
        </div>
      )}
      <div className="max-w-7xl mx-auto">
        
        <header className="mb-12 mt-6 md:mt-8">
          <div className="relative flex items-center justify-center min-h-[48px]">
            <button onClick={subCategory ? () => setSubCategory(null) : onBack} className="absolute left-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#337957] text-white text-sm font-bold uppercase tracking-wide shadow-md hover:bg-[#2D2A26] transition-colors">
              ← Retour
            </button>
            <h2 className="text-2xl md:text-3xl font-medium text-dark text-center" style={{ fontFamily: '"Century Gothic", sans-serif' }}>
              {subCategory ? subCategory.title : categoryTitle}
            </h2>
          </div>
          <div className="w-16 h-1 bg-gold mx-auto rounded-full mt-3"></div>
        </header>

        {/* Sous-catégories (toujours visibles, avec surbrillance sur la sélection active) */}
        {childCategories.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
            {childCategories.map(child => {
              const isActive = subCategory?.id === child.id;
              return (
                <div
                  key={child.id}
                  onClick={() => handleSubCategoryClick(child.id, child.name)}
                  className={`cursor-pointer group relative h-40 md:h-48 rounded-lg overflow-hidden transition-all ${
                    isActive
                      ? "ring-4 ring-[#337957] shadow-lg scale-[1.02]"
                      : "border border-stone-100 hover:shadow-md"
                  }`}
                >
                  <img src={getImageUrl(child.image, '', 400)} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-110 transition-transform" alt=""/>
                  <div className={`absolute inset-0 flex items-center justify-center ${isActive ? "bg-[#337957]/60" : "bg-black/40"}`}>
                    <span className="text-white text-xs font-bold uppercase">{child.name}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

   

        {/* Liste des produits */}
        <div ref={productsRef} className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 scroll-mt-24">
          {filteredProducts.map(product => {
            const prepBadge = product.preparationTimeHours ? getPreparationBadge(product.preparationTimeHours) : null;
            const hasDiscount = Number(product.discountPercentage) > 0;
            const discountedPrice = hasDiscount
              ? product.price * (1 - product.discountPercentage! / 100)
              : product.price;
            const showPrice = product.price > 0;

            return (
              <div
                key={product.id}
                onClick={() => handleProductClick(product)}
                className="relative overflow-hidden rounded-2xl cursor-pointer shadow-md bg-stone-200"
                style={{ aspectRatio: '3/4' }}
              >
                <img
                  src={getImageUrl(product.image, '', 500)}
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover brightness-105 contrast-[1.03]"
                  alt={product.name}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                  {hasDiscount && (
                    <span className="text-xs font-bold bg-red-500 text-white px-2 py-1 rounded-full shadow tracking-wide">
                      -{product.discountPercentage}%
                    </span>
                  )}
                  {prepBadge && (
                    <span className={`text-xs font-bold px-2 py-1 rounded-full shadow tracking-wide ${prepBadge.bgColor} ${prepBadge.textColor}`}>
                      ⏱ {prepBadge.text}
                    </span>
                  )}
                </div>
                <div className="absolute bottom-0 left-0 right-0 p-3 md:p-4">
                  <h3
                    className="text-white font-bold text-sm md:text-base leading-tight mb-1.5 drop-shadow-lg line-clamp-2"
                    style={{ fontFamily: '"Century Gothic", sans-serif' }}
                  >
                    {product.name}
                  </h3>
                  {showPrice && (
                    <div className="flex items-center gap-2">
                      {hasDiscount && (
                        <span className="text-white/60 line-through text-xs md:text-sm">
                          {product.price.toFixed(2)}$
                        </span>
                      )}
                      <span className="text-white font-bold text-sm md:text-base drop-shadow">
                        {discountedPrice.toFixed(2)} $
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODAL PRODUIT - SANS FOND NOIR */}

      {selectedProduct && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Fond transparent au lieu de noir */}
          <div
            className="absolute inset-0 bg-black/25 backdrop-blur-[2px]"
            onClick={() => setSelectedProduct(null)}
          />

          <div className="relative bg-white w-full md:max-w-6xl max-h-[95vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row">
            
            <button
              onClick={() => setSelectedProduct(null)}
              className="absolute top-4 right-4 z-20 w-10 h-10 bg-white/80 backdrop-blur rounded-full flex items-center justify-center shadow-md hover:bg-[#337957] hover:text-white transition-all text-lg font-bold"
            >
              ✕
            </button>

            <div className="w-full md:w-1/2 shrink-0 flex flex-col">
              <div className="relative flex-1 h-56 md:h-auto min-h-0">
                <img
                  src={getImageUrl(modalMainImage || selectedProduct.image, '', 800)}
                  alt={selectedProduct.name}
                  decoding="async"
                  className="w-full h-full object-cover"
                />
                
                {/* Étiquette sur l'image de la modal */}
                {selectedProduct.preparationTimeHours && selectedProduct.preparationTimeHours >= 24 && (
                  <div className="absolute top-4 left-4 bg-amber-100 text-amber-800 text-sm font-bold px-4 py-2 rounded-sm border border-amber-300 shadow-md uppercase tracking-wider">
                    {selectedProduct.preparationTimeHours >= 168 ? '7j' : selectedProduct.preparationTimeHours >= 48 ? `${selectedProduct.preparationTimeHours}h` : '24h'}
                  </div>
                )}
                
                <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent md:hidden"></div>
              </div>

              {/* Galerie de photos supplémentaires */}
              {selectedProduct.images && selectedProduct.images.length > 0 && (
                <div className="flex gap-2 p-2 bg-gray-50 overflow-x-auto shrink-0">
                  {/* Miniature de la photo principale */}
                  <button
                    type="button"
                    onClick={() => setModalMainImage(selectedProduct.image || '')}
                    className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${
                      (modalMainImage === selectedProduct.image || (!modalMainImage && true))
                        ? 'border-[#337957]'
                        : 'border-gray-200'
                    }`}
                  >
                    <img src={getImageUrl(selectedProduct.image, '', 120)} loading="lazy" decoding="async" alt="" className="w-full h-full object-cover" />
                  </button>
                  {/* Miniatures des photos supplémentaires */}
                  {selectedProduct.images.map((img, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setModalMainImage(img)}
                      className={`w-14 h-14 rounded-lg overflow-hidden border-2 transition-all shrink-0 ${
                        modalMainImage === img ? 'border-[#337957]' : 'border-gray-200'
                      }`}
                    >
                      <img src={getImageUrl(img, '', 120)} loading="lazy" decoding="async" alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-full md:w-1/2 flex flex-col h-[60vh] md:h-[85vh] overflow-hidden">
              
              <div 
                className="flex-1 overflow-y-auto p-6 md:p-8" 
                style={{ 
                  WebkitOverflowScrolling: 'touch',
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#337957 #f1f1f1'
                }}
              >
                
                <span className="text-[#337957] text-xs font-bold uppercase tracking-widest mb-2 block">
                  Artisan Pâtissier
                </span>
                
                <h2 className="text-2xl md:text-3xl font-medium mb-2 text-[#2D2A26]" style={{ fontFamily: '"Century Gothic", sans-serif' }}>
                  {selectedProduct.name}
                </h2>
                
                <div className="text-2xl font-medium text-[#337957] mb-6">
                  {/* Prix — reflète l'option choisie (ex. 6 / 12 personnes) */}
                  <div className="mb-2">
                    {selectedProduct.discountPercentage && selectedProduct.discountPercentage > 0 ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base text-stone-400 line-through">
                          {getCurrentPrice().toFixed(2)} $
                        </span>
                        <span>
                          {getDiscountedPrice(getCurrentPrice(), selectedProduct.discountPercentage).toFixed(2)} $
                        </span>
                        <span className="text-[11px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                          -{selectedProduct.discountPercentage}%
                        </span>
                      </div>
                    ) : (
                      <span>{getCurrentPrice().toFixed(2)} $</span>
                    )}
                    {selectedProduct.hasTaxes && (
                      <span className="text-xs text-stone-400 ml-2 font-normal">
                        + taxes
                      </span>
                    )}
                  </div>
                </div>

                {/* JOURS DE DISPONIBILITÉ — affiché en premier pour bien le voir */}
                {selectedProduct.availableDays && selectedProduct.availableDays.length > 0 && (
                  <div className="mb-4 p-4 rounded-lg border border-blue-200 bg-blue-50">
                    <span className="text-xs font-bold uppercase tracking-widest text-blue-700 block mb-2">
                      Disponible uniquement
                    </span>
                    <p className="text-sm font-medium text-blue-800">
                      {selectedProduct.availableDays
                        .slice()
                        .sort((a, b) => a - b)
                        .map((d) => ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"][d])
                        .join(", ")}
                    </p>
                  </div>
                )}

                {/* ALLERGÈNES (SI SPÉCIFIÉ DANS LE PRODUIT) */}
                {selectedProduct.allergens && (
                  <div className="mb-4 flex items-center gap-2 text-red-600 bg-red-50 p-2 rounded border border-red-100">
                    <span className="text-xs font-bold uppercase">Allergènes :</span>
                    <span className="text-sm">{selectedProduct.allergens}</span>
                  </div>
                )}

                {/* OPTIONS DYNAMIQUES DU PRODUIT */}
                {selectedProduct.customOptions && selectedProduct.customOptions.length > 0 && (
                  <div className="space-y-6 mb-6">
                    {selectedProduct.customOptions.map((option, idx) => (
                      <div key={idx}>
                        <h4 className={`text-xs font-bold uppercase mb-2 flex items-center gap-2 ${
                          missingRequiredOptions.includes(option.name)
                            ? "text-red-600"
                            : "text-stone-500"
                        }`}>
                          <span className="w-1 h-4 bg-[#337957] rounded-full"></span>
                          {option.name}{!isAllergyOptionName(option.name) ? " *" : ""}
                        </h4>
                        {option.type === "text" ? (
                          <input
                            type="text"
                            value={selectedOptions[option.name] || ""}
                            onChange={(e) =>
                              setSelectedOptions((prev) => ({
                                ...prev,
                                [option.name]: e.target.value,
                              }))
                            }
                            className={`w-full p-3 border rounded-lg text-sm focus:outline-none bg-stone-50 ${
                              missingRequiredOptions.includes(option.name)
                                ? "border-red-300 focus:border-red-500"
                                : "border-stone-200 focus:border-[#337957]"
                            }`}
                            placeholder={`Écrire ${option.name.toLowerCase()}...`}
                          />
                        ) : (
                        <div className="flex gap-2 flex-wrap">
                          {(option.choices || []).map((choice) => {
                            const displayText = formatChoiceDisplay(choice) || choice;

                            return (
                              <button
                                key={`${option.name}-${displayText}`}
                                type="button"
                                onClick={() =>
                                  setSelectedOptions((prev) => ({
                                    ...prev,
                                    [option.name]: choice,
                                  }))
                                }
                                className={`flex-1 py-3 px-2 rounded text-sm font-medium transition-all min-w-[100px] ${
                                  selectedOptions[option.name] === choice
                                    ? "bg-[#337957] text-white shadow-md"
                                    : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
                                }`}
                              >
                                <div>{displayText}</div>
                              </button>
                            );
                          })}
                        </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* OPTIONS POUR LES PAINS (Legacy support if not using customOptions) */}
                {asCategoryArray((selectedProduct as any).category).includes("Pains") && !selectedProduct.customOptions?.length && (
                  <>
                    <div className="mb-6">
                      <h4 className="text-xs font-bold uppercase mb-2 text-stone-500 flex items-center gap-2">
                        <span className="w-1 h-4 bg-[#337957] rounded-full"></span>
                        Tranché ?
                      </h4>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setIsSliced(true)}
                          className={`flex-1 py-3 px-2 rounded text-sm font-medium transition-all ${
                            isSliced
                              ? "bg-[#337957] text-white shadow-md"
                              : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
                          }`}
                        >
                          Tranché
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsSliced(false)}
                          className={`flex-1 py-3 px-2 rounded text-sm font-medium transition-all ${
                            !isSliced
                              ? "bg-[#337957] text-white shadow-md"
                              : "bg-white border border-stone-200 text-stone-600 hover:bg-stone-50"
                          }`}
                        >
                          Non tranché
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <p className="text-stone-600 mb-6 font-light leading-relaxed text-sm md:text-base whitespace-pre-line">
                  {selectedProduct.description}
                </p>

                {/* TEMPS DE PRÉPARATION */}
                {selectedProduct.preparationTimeHours && selectedProduct.preparationTimeHours > 0 && (
                  <div
                    className="mb-6 p-4 rounded-lg border"
                    style={{
                      backgroundColor:
                        selectedProduct.preparationTimeHours >= 168
                          ? "#fffbeb"
                          : selectedProduct.preparationTimeHours >= 48
                          ? "#fffbeb"
                          : selectedProduct.preparationTimeHours >= 24
                          ? "#fefce8"
                          : selectedProduct.preparationTimeHours >= 12
                          ? "#fffbeb"
                          : "#f0fdf4",
                      borderColor:
                        selectedProduct.preparationTimeHours >= 168
                          ? "#fcd34d"
                          : selectedProduct.preparationTimeHours >= 48
                          ? "#fcd34d"
                          : selectedProduct.preparationTimeHours >= 24
                          ? "#fde047"
                          : selectedProduct.preparationTimeHours >= 12
                          ? "#fde68a"
                          : "#bbf7d0",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="text-xs font-bold uppercase tracking-widest"
                        style={{
                          color:
                            selectedProduct.preparationTimeHours >= 168
                              ? "#b45309"
                              : selectedProduct.preparationTimeHours >= 48
                              ? "#b45309"
                              : selectedProduct.preparationTimeHours >= 24
                              ? "#a16207"
                              : selectedProduct.preparationTimeHours >= 12
                              ? "#d97706"
                              : "#16a34a",
                        }}
                      >
                        Préparation requise
                      </span>
                    </div>
                    <p
                      className="text-sm font-medium"
                      style={{
                        color:
                          selectedProduct.preparationTimeHours >= 168
                            ? "#b45309"
                            : selectedProduct.preparationTimeHours >= 48
                            ? "#b45309"
                            : selectedProduct.preparationTimeHours >= 24
                            ? "#a16207"
                            : selectedProduct.preparationTimeHours >= 12
                            ? "#d97706"
                            : "#16a34a",
                      }}
                    >
                      {selectedProduct.preparationTimeHours >= 48
                        ? `Commande à passer ${selectedProduct.preparationTimeHours / 24} jour${selectedProduct.preparationTimeHours / 24 > 1 ? "s" : ""} à l'avance minimum`
                        : selectedProduct.preparationTimeHours >= 24
                        ? `Préparation en ${selectedProduct.preparationTimeHours} heures - planifiez à l'avance`
                        : selectedProduct.preparationTimeHours >= 12
                        ? `Préparation en ${selectedProduct.preparationTimeHours} heures - commandez tôt`
                        : `Prêt en ${selectedProduct.preparationTimeHours} heure${selectedProduct.preparationTimeHours > 1 ? "s" : ""}`}
                    </p>
                  </div>
                )}

                {/* JOURS DE DISPONIBILITÉ déplacé en haut (déjà affiché avant allergènes) */}

                {hasMissingRequiredOptions && (
                  <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    Veuillez compléter toutes les options obligatoires avant d'ajouter ce produit au panier.
                  </div>
                )}



                {/* ESPACE SUPPLÉMENTAIRE POUR LE SCROLL */}
                <div className="h-12 md:h-8"></div>
              </div>

              {/* BOUTONS FIXES EN BAS */}
              <div className="bg-white border-t border-stone-100 p-4 md:p-6 shrink-0">
                <div className="flex gap-4">
                  <div className="flex items-center border border-stone-200 rounded-lg h-14 shrink-0">
                    <button
                      onClick={() => setQuantity(Math.max(selectedProduct?.minOrderQuantity || 1, quantity - 1))}
                      className="px-4 h-full hover:bg-stone-50 text-xl text-stone-500 transition-colors"
                    >
                      -
                    </button>
                    <span className="px-3 font-bold min-w-[3rem] text-center text-[#2D2A26]">
                      {quantity}
                    </span>
                    <button
                      onClick={() => setQuantity(quantity + 1)}
                      className="px-4 h-full hover:bg-stone-50 text-xl text-stone-500 transition-colors"
                    >
                      +
                    </button>
                  </div>
                  
                  <button
                    onClick={handleAddToCart}
                    disabled={hasMissingRequiredOptions}
                    className="flex-1 bg-[#2D2A26] text-white h-14 rounded-lg font-bold uppercase tracking-widest text-xs transition-all shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed enabled:hover:bg-[#337957]"
                  >
                    Ajouter
                    <span className="ml-2 opacity-70 font-normal normal-case hidden sm:inline">
                      au panier
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      , document.body)}
    </div>
  );
};

export default ProductSelection;
