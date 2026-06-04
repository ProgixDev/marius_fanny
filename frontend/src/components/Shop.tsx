import React, { useState, useEffect, useRef } from 'react';
import { categoryAPI } from '../lib/CategoryAPI';
import type { Category as CategoryType } from '../types';
import { getImageUrl } from '../utils/api';
import ProductSelection from './ProductSelection';

const styles = {
  cream: '#F9F7F2',
  text: '#2D2A26',
  gold: '#337957',
  emerald: '#337957',
  fontScript: '"Great Vibes", cursive',
  fontSans: '"Inter", sans-serif',
};

interface Category {
  id: number;
  title: string;
  image: string;
  size: 'large' | 'small';
  childTitles: string[];
}

interface ApiCategoryNode extends CategoryType {
  children?: ApiCategoryNode[];
}

interface CategoryShowcaseProps {
  onCategoryClick?: (categoryId: number, categoryTitle: string) => void;
  onAddToCart: (product: any) => void; // Changé en obligatoire pour ProductSelection
}

const Shop: React.FC<CategoryShowcaseProps> = ({ onCategoryClick, onAddToCart }) => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [banners, setBanners] = useState<CategoryType[]>([]); // Banner categories from admin
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // ÉTAT : Pour savoir quelle catégorie est sélectionnée
  const [selectedCat, setSelectedCat] = useState<{id: number | string, title: string} | null>(null);
  
  // RÉFÉRENCE : Pour le scroll automatique
  const productsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    try {
      setLoading(true);
      const response = await categoryAPI.getAllCategories();
      const flattenCategories = (nodes: ApiCategoryNode[] = []): ApiCategoryNode[] => {
        const result: ApiCategoryNode[] = [];
        const walk = (items: ApiCategoryNode[]) => {
          items.forEach((item) => {
            result.push(item);
            if (Array.isArray(item.children) && item.children.length > 0) walk(item.children);
          });
        };
        walk(nodes);
        return result;
      };

      const allNodes = flattenCategories((response.data.categories || []) as ApiCategoryNode[]);
      const byId = new Map<number, ApiCategoryNode & { children: ApiCategoryNode[] }>();
      allNodes.forEach((node) => {
        if (typeof node.id !== 'number') return;
        if (!byId.has(node.id)) byId.set(node.id, { ...node, children: [] });
      });
      byId.forEach((node) => {
        if (node.parentId && byId.has(node.parentId)) byId.get(node.parentId)!.children.push(node);
      });

      const rootCategories = Array.from(byId.values())
        .filter((node) => !node.parentId || !byId.has(node.parentId))
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name));

      // Include banners from all category levels (root and children)
      const bannerCategories = Array.from(byId.values())
        .filter((cat) => cat.isBanner === true)
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0) || a.name.localeCompare(b.name));
      setBanners(bannerCategories);

      // Keep all root categories in the main shop grid, including banner categories
      const regularCategories = rootCategories;

      const getAllChildTitles = (children: ApiCategoryNode[] = []): string[] => {
        const titles: string[] = [];
        const walk = (nodes: ApiCategoryNode[]) => {
          nodes.forEach((node) => {
            titles.push(node.name);
            if (Array.isArray(node.children) && node.children.length > 0) walk(node.children);
          });
        };
        walk(children);
        return titles;
      };
      
      const displayCategories: Category[] = regularCategories.map((cat) => ({
        id: cat.id,
        title: cat.name,
        image: cat.image || './gateau.jpg',
        size: 'small', // On force 'small' pour que tout soit uniforme et compact
        childTitles: getAllChildTitles(cat.children || []),
      }));
      setCategories(displayCategories);
    } catch (error: any) {
      setError(error?.message || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryClick = (categoryId: number | string, categoryTitle: string) => {
    setSelectedCat({ id: categoryId, title: categoryTitle });
    if (onCategoryClick) {
      // Only pass number to external handler
      if (typeof categoryId === 'number') {
        onCategoryClick(categoryId, categoryTitle);
      }
    }
    
    // Scroll vers les produits après un court délai
    setTimeout(() => {
      productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  };

  if (loading) return <div className="py-20 text-center">Chargement...</div>;

  return (
    <div className="flex flex-col bg-[#F9F7F2]">
      {/* SPECIAL OCCASION BANNERS */}
      {banners.length > 0 && (
        <section className="relative overflow-hidden py-8">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center mb-6 md:mb-8">
              <h2 className="text-3xl md:text-5xl" style={{ fontFamily: styles.fontScript, color: styles.emerald }}>
                Vos Événements Spéciaux
              </h2>
              <p className="mt-2 text-sm md:text-base" style={{ color: styles.emerald }}>
                Des collections saisonnières mises en avant pour vos occasions.
              </p>
            </div>
          </div>

          <div className="space-y-4 md:space-y-5">
            {banners.map((banner) => (
                <article
                  key={banner.id}
                  onClick={() => handleCategoryClick(banner.id, banner.name)}
                  className="group relative w-full min-h-75 h-[45vh] md:h-[52vh] max-h-140 cursor-pointer overflow-hidden"
                >
                  {/* Background media */}
                  {banner.image ? (
                    <img
                      src={getImageUrl(banner.image, '', 1200)}
                      alt={banner.name}
                      decoding="async"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div
                      className="absolute inset-0"
                      style={{
                        background: `linear-gradient(120deg, ${banner.bannerColor || '#337957'} 0%, #1A4A37 60%, #0E2C22 100%)`
                      }}
                    />
                  )}

                  {/* Overlay */}
                  <div className="absolute inset-0 bg-linear-to-r from-black/40 via-black/20 to-black/10 group-hover:from-black/30 group-hover:via-black/15 group-hover:to-black/5 transition-colors" />

                  {/* Content */}
                  <div className="relative z-10 h-full max-w-7xl mx-auto px-6 md:px-10 flex items-center justify-center text-center">
                    <div className="max-w-lg rounded-xl border border-[#337957]/20 bg-white/70 backdrop-blur-[2px] p-4 md:p-5 shadow-lg">

                      <h3 className="mt-2 text-3xl md:text-4xl font-semibold leading-tight" style={{ fontFamily: styles.fontScript, color: styles.emerald }}>
                        {banner.name.charAt(0).toUpperCase() + banner.name.slice(1).toLowerCase()}
                      </h3>
                      <p className="mt-2 text-sm leading-relaxed line-clamp-2" style={{ color: styles.emerald }}>
                        {banner.description || 'Découvrez notre sélection exclusive pour vos moments marquants.'}
                      </p>
                      <button className="mt-3 px-5 py-2 bg-white hover:bg-[#EAF6EF] rounded-full text-sm font-semibold transition-colors" style={{ color: styles.emerald }}>
                        Explorer la collection
                      </button>
                    </div>
                  </div>
                </article>
            ))}
          </div>
        </section>
      )}

      <section className="relative py-12 px-6">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-10 space-y-4">
            <h2 className="text-4xl md:text-5xl" style={{ fontFamily: styles.fontScript, color: styles.gold }}>
              Notre Boutique
            </h2>
            <p className="uppercase tracking-widest text-xs font-bold">Commandez avant 14h pour le lendemain</p>
          </div>

          {/* GRILLE COMPACTE */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            {categories.map((cat) => {
              const isSelected = selectedCat?.id === cat.id;
              return (
                <div
                  key={cat.id}
                  onClick={() => handleCategoryClick(cat.id, cat.title)}
                  className={`group relative h-32 md:h-40 overflow-hidden rounded-xl cursor-pointer transition-all duration-300 bg-stone-100
                    ${isSelected ? 'ring-4 ring-[#337957] shadow-inner' : 'hover:shadow-md'}`}
                >
                  <img
                    src={getImageUrl(cat.image, '', 400)}
                    alt={cat.title}
                    loading="lazy"
                    decoding="async"
                    className={`absolute inset-0 w-full h-full object-contain transition-all duration-500
                      ${isSelected ? 'scale-100' : 'group-hover:scale-105'}`}
                  />
                  <div className={`absolute inset-0 flex items-center justify-center p-2 transition-all duration-300 ${isSelected ? 'bg-[#337957]/60' : 'bg-black/30 group-hover:bg-black/20'}`}>
                    <h3 className="text-white text-sm md:text-base font-bold uppercase text-center drop-shadow-md">
                      {cat.title}
                    </h3>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ZONE D'AFFICHAGE DES PRODUITS */}
      {/* scroll-mt: laisse la hauteur de la navbar fixe (h-20 = 80px) au-dessus
          pour que le titre et le bouton Retour ne soient pas cachés au scroll */}
      <div ref={productsRef} className="scroll-mt-24">
        {selectedCat ? (
          typeof selectedCat.id === 'number' ? (
            <ProductSelection 
              categoryId={selectedCat.id} 
              categoryTitle={selectedCat.title}
              onAddToCart={onAddToCart}
              onBack={() => setSelectedCat(null)}
            />
          ) : (
            // Special occasion - show message or all products
            <div className="py-12 text-center">
              <h3 className="text-2xl" style={{ fontFamily: '"Great Vibes", cursive', color: '#C5A065' }}>
                {selectedCat.title}
              </h3>
              <p className="mt-4 text-gray-600">
                Bientôt disponible - Découvrez nos créations spéciales pour {selectedCat.title}!
              </p>
              <button 
                onClick={() => setSelectedCat(null)}
                className="mt-6 px-6 py-2 bg-[#C5A065] text-white rounded-full"
              >
                Retour aux catégories
              </button>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
};

export default Shop;