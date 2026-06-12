import { useState, useEffect, useRef } from "react";
import {
  Plus,
  Search,
  MoreVertical,
  Eye,
  Edit,
  Trash2,
  Package,
  DollarSign,
  Tag,
  ShoppingBag,
  Check,
  X,
  ImageIcon,
  Filter,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { DataTable } from "./ui/DataTable";
import { Modal } from "./ui/modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ImageUpload } from "./ImageUpload";
import type { Product, Category } from "../types";
import { productAPI } from "../lib/ProductAPI";
import { categoryAPI } from "../lib/CategoryAPI";
import { getImageUrl, API_URL } from "../utils/api";
import { bearerHeader } from "../utils/authHeaders";
import {
  formatChoiceDisplay,
  formatChoiceForSaving,
  parseChoiceInput,
} from "../utils/customOptions";

type CustomOptionChoice = {
  label: string;
  price: string;
};

type CustomOptionField = {
  name: string;
  type: "choice" | "text";
  choices: CustomOptionChoice[];
};

type ProductFormState = {
  name: string;
  category: string[];
  price: string;
  discountPercentage: string;
  availableDays: number[];
  description: string;
  image: string;
  images: string[];
  available: boolean;
  minOrderQuantity: string;
  maxOrderQuantity: string;
  preparationTimeHours: string;
  hasTaxes: boolean;
  allergens: string;
  productionType: "patisserie" | "cuisinier" | "four";
  targetAudience: "clients" | "pro";
  customOptions: CustomOptionField[];
  recommendations: number[]; // IDs des produits recommandés
};

const buildPayloadOptions = (options: CustomOptionField[]) =>
  options
    .map((opt) => ({
      name: opt.name.trim(),
      type: opt.type,
      choices: opt.choices
        .map((choice) =>
          formatChoiceForSaving(choice.label, choice.price || undefined),
        )
        .filter((choice) => choice.length > 0),
    }))
    .filter(
      (opt) =>
        opt.name &&
        (opt.type === "text" || opt.choices.length > 0),
    );

const createDefaultProductForm = (category: string[] = []): ProductFormState => ({
  name: "",
  category,
  price: "",
  discountPercentage: "0",
  availableDays: [],
  description: "",
  image: "",
  images: [],
  available: true,
  minOrderQuantity: "1",
  maxOrderQuantity: "10",
  preparationTimeHours: "",
  hasTaxes: true,
  allergens: "",
  productionType: "patisserie",
  targetAudience: "clients",
  customOptions: [],
  recommendations: [],
});

const DAY_OPTIONS = [
  { value: 0, label: "Dim" },
  { value: 1, label: "Lun" },
  { value: 2, label: "Mar" },
  { value: 3, label: "Mer" },
  { value: 4, label: "Jeu" },
  { value: 5, label: "Ven" },
  { value: 6, label: "Sam" },
];

const mapStoredOptionsToForm = (options?: Product["customOptions"]): CustomOptionField[] =>
  options?.map((opt) => ({
    name: opt.name,
    type: opt.type || "choice",
    choices: opt.choices.map((choice) => {
      const parsed = parseChoiceInput(choice);
      return {
        label: parsed.label,
        price: parsed.price !== null ? parsed.price.toFixed(2) : "",
      };
    }),
  })) || [];

export function ProductManagement() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEnablingClientAllergyField, setIsEnablingClientAllergyField] = useState(false);
  const [uploadingExtra, setUploadingExtra] = useState(false);
  const extraImageInputRef = useRef<HTMLInputElement>(null);

  // Reorder mode
  const [reorderMode, setReorderMode] = useState(false);
  const [reorderList, setReorderList] = useState<Product[]>([]);
  const [isSavingOrder, setIsSavingOrder] = useState(false);
  const dragIndexRef = useRef<number | null>(null);
  const dragOverIndexRef = useRef<number | null>(null);

  const handleExtraImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) return;
    setUploadingExtra(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await fetch(`${API_URL}/api/upload/single`, { method: 'POST', headers: bearerHeader(), body: formData, credentials: 'include' });
      const data = await res.json();
      if (res.ok && data.url) {
        setProductForm(f => ({ ...f, images: [...f.images, getImageUrl(data.url)] }));
      } else {
        console.error('Upload failed:', data.error || 'Unknown error');
        alert(`Erreur lors de l'upload: ${data.error || 'Erreur inconnue'}`);
      }
    } catch (err) {
      console.error('Upload error:', err);
      alert('Erreur lors de l\'upload de l\'image');
    } finally {
      setUploadingExtra(false);
      if (extraImageInputRef.current) extraImageInputRef.current.value = '';
    }
  };

  const [productForm, setProductForm] = useState<ProductFormState>(
    createDefaultProductForm(),
  );

  useEffect(() => {
    fetchData();
  }, []);

  // Close category filter on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryFilterRef.current && !categoryFilterRef.current.contains(e.target as Node)) {
        setShowCategoryFilter(false);
        setExpandedParent(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const flattenCategoriesWithIndentation = (cats: any[] = [], level: number = 0): Array<{ id: number; name: string; display: string }> => {
    const result: Array<{ id: number; name: string; display: string }> = [];
    const indent = '  '.repeat(level) + (level > 0 ? '> ' : '');
    
    cats.forEach(cat => {
      result.push({
        id: cat.id,
        name: cat.name,
        display: indent + cat.name
      });
      if (cat.children && Array.isArray(cat.children)) {
        result.push(...flattenCategoriesWithIndentation(cat.children, level + 1));
      }
    });
    
    return result;
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [productsRes, categoriesRes] = await Promise.all([
        productAPI.getAllProducts(1, 1000),
        categoryAPI.getAllCategories(),
      ]);
      setProducts(productsRes.data.products);
      setCategories(categoriesRes.data.categories);
      if (categoriesRes.data.categories.length > 0) {
        const flattened = flattenCategoriesWithIndentation(categoriesRes.data.categories);
        if (flattened.length > 0) {
          setProductForm(prev => ({
            ...prev,
            category: [flattened[0].name],
          }));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  const getAvailabilityBadge = (available: boolean) => {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
          available ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
        }`}
      >
        {available ? (
          <>
            <Check size={12} />
            En stock
          </>
        ) : (
          <>
            <X size={12} />
            Épuisé
          </>
        )}
      </span>
    );
  };

  const formatCurrency = (amount: number) => {
    return amount.toLocaleString("fr-CA", {
      style: "currency",
      currency: "CAD",
    });
  };

  const getDiscountedPrice = (price: number, discountPercentage?: number) => {
    const discount = discountPercentage ?? 0;
    if (discount <= 0) return price;
    return price * (1 - discount / 100);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Category filter
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all");
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const [expandedParent, setExpandedParent] = useState<string | null>(null);
  const categoryFilterRef = useRef<HTMLDivElement>(null);

  const getCategoryAndDescendantNames = (catName: string, cats: any[]): string[] => {
    const names: string[] = [];
    const findAndCollect = (list: any[]): boolean => {
      for (const cat of list) {
        if (cat.name.toLowerCase() === catName.toLowerCase()) {
          const collectAll = (c: any) => {
            names.push(c.name.toLowerCase());
            if (c.children) c.children.forEach(collectAll);
          };
          collectAll(cat);
          return true;
        }
        if (cat.children && findAndCollect(cat.children)) {
          return true;
        }
      }
      return false;
    };
    findAndCollect(cats);
    return names;
  };

  const filteredProductsByCategory = selectedCategoryFilter === "all"
    ? products
    : (() => {
        const allowedNames = getCategoryAndDescendantNames(selectedCategoryFilter, categories);
        return products.filter((p) => {
          const cats = Array.isArray(p.category) ? p.category : [p.category];
          return cats.some((cat) => allowedNames.includes(String(cat).toLowerCase()));
        });
      })();

  const filters = [
    {
      key: "available",
      label: "Disponibilité",
      options: [
        { value: "all", label: "Tous" },
        { value: "true", label: "Disponibles" },
        { value: "false", label: "Indisponibles" },
      ],
    },
  ];

  const handleViewDetails = (product: Product) => {
    setSelectedProduct(product);
    setIsDetailsModalOpen(true);
  };

  const handleEdit = (product: Product) => {
    setSelectedProduct(product);
    setProductForm({
      name: product.name,
      category: product.category,
      price: product.price.toString(),
      discountPercentage: (product.discountPercentage ?? 0).toString(),
      availableDays: product.availableDays || [],
      description: product.description || "",
      image: product.image || "",
      images: product.images || [],
      available: product.available,
      minOrderQuantity: product.minOrderQuantity.toString(),
      maxOrderQuantity: product.maxOrderQuantity.toString(),
      preparationTimeHours: product.preparationTimeHours?.toString() || "",
      hasTaxes: product.hasTaxes ?? true,
      allergens: product.allergens || "",
      productionType: product.productionType,
      targetAudience: product.targetAudience,
      customOptions: mapStoredOptionsToForm(product.customOptions),
      recommendations: product.recommendations || [],
    });
    setIsEditModalOpen(true);
  };

  const handleDeleteClick = (product: Product) => {
    setProductToDelete(product);
    setIsDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!productToDelete) return;
    setIsSubmitting(true);
    try {
      await productAPI.deleteProduct(productToDelete.id);
      setProducts(products.filter((p) => p.id !== productToDelete.id));
      setIsDeleteModalOpen(false);
      setProductToDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete product');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async () => {
    setIsSubmitting(true);
    try {
      const productData = {
        name: productForm.name,
        category: productForm.category,
        price: parseFloat(productForm.price),
        discountPercentage: parseFloat(productForm.discountPercentage) || 0,
        availableDays: productForm.availableDays.length > 0 ? productForm.availableDays : undefined,
        description: productForm.description || undefined,
        image: productForm.image || undefined,
        images: productForm.images.length > 0 ? productForm.images : undefined,
        available: productForm.available,
        minOrderQuantity: parseInt(productForm.minOrderQuantity),
        maxOrderQuantity: parseInt(productForm.maxOrderQuantity),
        preparationTimeHours: productForm.preparationTimeHours
          ? parseInt(productForm.preparationTimeHours)
          : undefined,
        hasTaxes: productForm.hasTaxes,
        allergens: productForm.allergens || undefined,
        productionType: productForm.productionType,
        targetAudience: productForm.targetAudience,
        customOptions: buildPayloadOptions(productForm.customOptions),
        recommendations: productForm.recommendations.length > 0 ? productForm.recommendations : undefined,
      };

      const response = await productAPI.createProduct(productData);
      await fetchData();
      setIsCreateModalOpen(false);
      setProductForm(
        createDefaultProductForm(
          categories.length > 0 ? [categories[0].name] : [],
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create product');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!selectedProduct) return;
    setIsSubmitting(true);
    try {
      const productData = {
        name: productForm.name,
        category: productForm.category,
        price: parseFloat(productForm.price),
        discountPercentage: parseFloat(productForm.discountPercentage) || 0,
        availableDays: productForm.availableDays.length > 0 ? productForm.availableDays : undefined,
        description: productForm.description || undefined,
        image: productForm.image || undefined,
        images: productForm.images.length > 0 ? productForm.images : undefined,
        available: productForm.available,
        minOrderQuantity: parseInt(productForm.minOrderQuantity),
        maxOrderQuantity: parseInt(productForm.maxOrderQuantity),
        preparationTimeHours:
          productForm.preparationTimeHours === ""
            ? null
            : parseInt(productForm.preparationTimeHours),
        hasTaxes: productForm.hasTaxes,
        allergens: productForm.allergens || undefined,
        productionType: productForm.productionType,
        targetAudience: productForm.targetAudience,
        customOptions: buildPayloadOptions(productForm.customOptions),
        recommendations: productForm.recommendations.length > 0 ? productForm.recommendations : undefined,
      };

      const response = await productAPI.updateProduct(selectedProduct.id, productData);
      await fetchData();
      setIsEditModalOpen(false);
      setSelectedProduct(null);
      setProductForm(
        createDefaultProductForm(
          categories.length > 0 ? [categories[0].name] : [],
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update product');
    } finally {
      setIsSubmitting(false);
    }
  };

  const enterReorderMode = () => {
    const sorted = [...products].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
    setReorderList(sorted);
    setReorderMode(true);
  };

  const handleDragStart = (index: number) => {
    dragIndexRef.current = index;
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndexRef.current === null || dragIndexRef.current === index) return;
    dragOverIndexRef.current = index;
    const newList = [...reorderList];
    const [moved] = newList.splice(dragIndexRef.current, 1);
    newList.splice(index, 0, moved);
    dragIndexRef.current = index;
    setReorderList(newList);
  };

  const saveReorder = async () => {
    setIsSavingOrder(true);
    try {
      const orders = reorderList.map((p, i) => ({ id: p.id, displayOrder: i }));
      await productAPI.reorderProducts(orders);
      setProducts(reorderList.map((p, i) => ({ ...p, displayOrder: i })));
      setReorderMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la sauvegarde de l\'ordre');
    } finally {
      setIsSavingOrder(false);
    }
  };

  const toggleAvailability = async (product: Product) => {
    try {
      const response = await productAPI.toggleProductAvailability(product.id);
      setProducts(
        products.map((p) =>
          p.id === product.id ? response.data! : p,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle product availability');
    }
  };

  const handleEnableClientAllergyField = async () => {
    setIsEnablingClientAllergyField(true);
    setError(null);
    try {
      const response = await productAPI.enableClientAllergyTextField();
      await fetchData();
      const count = response.data?.modifiedCount ?? 0;
      alert(`Zone allergènes client ajoutée sur ${count} produit(s).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'activation du champ allergènes client");
    } finally {
      setIsEnablingClientAllergyField(false);
    }
  };

  const columns = [
    {
      key: "name",
      label: "Produit",
      sortable: true,
      render: (product: Product) => (
        <div className="flex items-center gap-3">
          {product.image ? (
            <img
              src={getImageUrl(product.image)}
              alt={product.name}
              className="w-12 h-12 rounded-lg object-cover"
            />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-gray-100 flex items-center justify-center">
              <ImageIcon size={20} className="text-gray-400" />
            </div>
          )}
          <div className="font-medium text-[#2D2A26]">{product.name}</div>
        </div>
      ),
    },
    {
      key: "category",
      label: "Catégorie",
      sortable: true,
      render: (product: Product) => (
        <div className="flex items-center gap-2">
          <Tag size={14} className="text-gray-400" />
          <span className="text-sm text-gray-600">{product.category.join(", ")}</span>
        </div>
      ),
    },
    {
      key: "price",
      label: "Prix",
      sortable: true,
      render: (product: Product) => (
        <div className="font-medium">
          {product.discountPercentage && product.discountPercentage > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 line-through">
                {formatCurrency(product.price)}
              </span>
              <span>{formatCurrency(getDiscountedPrice(product.price, product.discountPercentage))}</span>
              <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                -{product.discountPercentage}%
              </span>
            </div>
          ) : (
            <span>{formatCurrency(product.price)}</span>
          )}
        </div>
      ),
    },
    {
      key: "preparationTime",
      label: "préparation",
      sortable: true,
      render: (product: Product) => (
        <div className="text-sm text-gray-600">
          {product.preparationTimeHours ? (
            <span
              className={`flex justify-center items-center px-2 py-1 rounded-full text-xs font-medium ${
                product.preparationTimeHours >= 24
                  ? "bg-red-100 text-red-700"
                  : product.preparationTimeHours >= 12
                    ? "bg-orange-100 text-orange-700"
                    : "bg-blue-100 text-blue-700"
              }`}
            >
              {product.preparationTimeHours}h
            </span>
          ) : (
            <span className="text-gray-400">Immédiat</span>
          )}
        </div>
      ),
    },
    {
      key: "available",
      label: "Disponibilité",
      sortable: true,
      render: (product: Product) => getAvailabilityBadge(product.available),
    },
    {
      key: "actions",
      label: "Actions",
      render: (product: Product) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => toggleAvailability(product)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              product.available
                ? "bg-orange-100 text-orange-700 hover:bg-orange-200"
                : "bg-green-100 text-green-700 hover:bg-green-200"
            }`}
          >
            {product.available ? "Marquer épuisé" : "Remettre en stock"}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                <MoreVertical className="w-4 h-4 text-gray-600" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => handleViewDetails(product)}>
                <Eye className="w-4 h-4 mr-2" />
                Voir les détails
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleEdit(product)}>
                <Edit className="w-4 h-4 mr-2" />
                Modifier
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleDeleteClick(product)}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Supprimer
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <div className="h-full overflow-auto">
      <header className="p-4 md:p-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2
              className="text-4xl md:text-5xl mb-2"
              style={{ fontFamily: '"Great Vibes", cursive', color: "#337957" }}
            >
              Gestion des Produits
            </h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Gérer votre catalogue de produits
            </p>
          </div>
          <div className="flex gap-2">
            {reorderMode ? (
              <>
                <button
                  onClick={() => setReorderMode(false)}
                  className="bg-stone-200 text-stone-700 font-bold px-5 py-3 rounded-xl transition-all hover:bg-stone-300 flex items-center gap-2"
                >
                  Annuler
                </button>
                <button
                  onClick={saveReorder}
                  disabled={isSavingOrder}
                  className="bg-[#337957] hover:bg-[#2D2A26] text-white font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:shadow-lg flex items-center gap-2 disabled:opacity-60"
                >
                  {isSavingOrder ? 'Sauvegarde...' : '✓ Sauvegarder l\'ordre'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleEnableClientAllergyField}
                  disabled={isEnablingClientAllergyField}
                  className="bg-[#2D2A26] hover:bg-[#337957] disabled:opacity-60 text-white font-bold px-5 py-3 rounded-xl transition-all duration-300"
                >
                  {isEnablingClientAllergyField ? "Activation..." : "Activer zone allergènes client (tous produits)"}
                </button>
                <button
                  onClick={enterReorderMode}
                  className="bg-stone-100 border border-stone-300 text-stone-700 font-bold px-5 py-3 rounded-xl transition-all hover:bg-stone-200 flex items-center gap-2"
                >
                  <span className="text-lg leading-none">⠿</span>
                  Réordonner
                </button>
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="bg-[#337957] hover:bg-[#2D2A26] text-white font-bold px-6 py-3 rounded-xl transition-all duration-300 hover:shadow-lg flex items-center gap-2"
                >
                  <Plus size={20} />
                  Ajouter un produit
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="p-4 md:p-8">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#337957]"></div>
            <span className="ml-2 text-gray-600">Chargement des produits...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <div className="flex items-center">
              <X className="w-5 h-5 text-red-500 mr-2" />
              <span className="text-red-800">{error}</span>
            </div>
            <button
              onClick={fetchData}
              className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
            >
              Réessayer
            </button>
          </div>
        )}

        {!loading && !error && !reorderMode && (
          <>
          <div className="relative mb-4" ref={categoryFilterRef}>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setShowCategoryFilter(!showCategoryFilter); setExpandedParent(null); }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                  selectedCategoryFilter !== "all"
                    ? "bg-[#C5A065] text-white border-[#C5A065]"
                    : "bg-white text-stone-600 border-gray-200 hover:bg-gray-50"
                }`}
              >
                <Filter size={16} />
                {selectedCategoryFilter === "all" ? "Catégories" : selectedCategoryFilter}
              </button>
              {selectedCategoryFilter !== "all" && (
                <button
                  onClick={() => { setSelectedCategoryFilter("all"); setShowCategoryFilter(false); setExpandedParent(null); }}
                  className="p-1.5 rounded-full hover:bg-stone-100 text-stone-400 hover:text-stone-600"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {showCategoryFilter && (
              <div className="absolute top-full left-0 mt-2 bg-white rounded-xl shadow-xl border border-gray-200 z-50 min-w-[200px] sm:min-w-[250px] max-w-[90vw] overflow-hidden">
                {expandedParent === null ? (
                  <>
                    <div className="px-4 py-2.5 bg-stone-50 border-b text-xs font-bold uppercase tracking-wider text-stone-400">
                      Catégories
                    </div>
                    <button
                      onClick={() => { setSelectedCategoryFilter("all"); setShowCategoryFilter(false); }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-stone-50 transition-colors ${selectedCategoryFilter === "all" ? "font-bold text-[#C5A065]" : "text-stone-700"}`}
                    >
                      Toutes les catégories
                    </button>
                    {categories.map((cat: any) => {
                      const children = (cat.children || []).filter((c: any) => c.active !== false);
                      return (
                        <button
                          key={cat.id}
                          onClick={() => {
                            if (children.length > 0) {
                              setExpandedParent(cat.name);
                            } else {
                              setSelectedCategoryFilter(cat.name);
                              setShowCategoryFilter(false);
                              setExpandedParent(null);
                            }
                          }}
                          className={`w-full text-left px-4 py-2.5 text-sm hover:bg-stone-50 transition-colors flex items-center justify-between ${
                            selectedCategoryFilter.toLowerCase() === cat.name.toLowerCase() ? "font-bold text-[#C5A065]" : "text-stone-700"
                          }`}
                        >
                          <span>{cat.name}</span>
                          {children.length > 0 && <ChevronRight size={14} className="text-stone-400" />}
                        </button>
                      );
                    })}
                  </>
                ) : (
                  <>
                    <div className="px-4 py-2.5 bg-stone-50 border-b flex items-center gap-2">
                      <button onClick={() => setExpandedParent(null)} className="text-stone-400 hover:text-stone-600">
                        <ChevronLeft size={16} />
                      </button>
                      <span className="text-xs font-bold uppercase tracking-wider text-stone-400">{expandedParent}</span>
                    </div>
                    <button
                      onClick={() => { setSelectedCategoryFilter(expandedParent); setShowCategoryFilter(false); setExpandedParent(null); }}
                      className={`w-full text-left px-4 py-2.5 text-sm hover:bg-stone-50 transition-colors ${
                        selectedCategoryFilter.toLowerCase() === expandedParent.toLowerCase() ? "font-bold text-[#C5A065]" : "text-stone-700"
                      }`}
                    >
                      Tous — {expandedParent}
                    </button>
                    {((categories.find((c: any) => c.name === expandedParent) as any)?.children || [])
                      .filter((c: any) => c.active !== false)
                      .map((sub: any) => (
                        <button
                          key={sub.id}
                          onClick={() => { setSelectedCategoryFilter(sub.name); setShowCategoryFilter(false); setExpandedParent(null); }}
                          className={`w-full text-left px-4 py-2.5 text-sm hover:bg-stone-50 transition-colors ${
                            selectedCategoryFilter.toLowerCase() === sub.name.toLowerCase() ? "font-bold text-[#C5A065]" : "text-stone-700"
                          }`}
                        >
                          {sub.name}
                        </button>
                      ))}
                  </>
                )}
              </div>
            )}
          </div>
          <DataTable
            data={[...filteredProductsByCategory].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))}
            columns={columns}
            filters={filters}
            searchPlaceholder="Rechercher un produit..."
            searchKeys={["name", "category"]}
            itemsPerPage={10}
          />
          </>
        )}

        {!loading && !error && reorderMode && (() => {
          // Group products by category while preserving displayOrder within each group
          const categoryNames = Array.from(
            new Set(reorderList.map((p) => p.category[0] || "")),
          ).filter(Boolean);
          return (
            <div className="space-y-4">
              <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3">
                <span className="text-amber-700 text-sm font-medium">⠿ Glissez-déposez les produits pour les réordonner au sein de chaque catégorie. L'ordre sera respecté sur la boutique.</span>
              </div>
              {categoryNames.map((catName) => {
                const catProducts = reorderList.filter((p) => (p.category[0] || "") === catName);
                return (
                  <div key={catName} className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
                    <div className="px-6 py-3 bg-stone-50 border-b border-stone-200 flex items-center gap-2">
                      <Tag size={14} className="text-[#337957]" />
                      <span className="font-semibold text-[#2D2A26] text-sm">{catName}</span>
                      <span className="ml-auto text-xs text-stone-400">{catProducts.length} produit{catProducts.length > 1 ? 's' : ''}</span>
                    </div>
                    <ul className="divide-y divide-stone-100">
                      {catProducts.map((product) => {
                        const globalIndex = reorderList.indexOf(product);
                        const catIndex = catProducts.indexOf(product);
                        return (
                          <li
                            key={product.id}
                            draggable
                            onDragStart={() => handleDragStart(globalIndex)}
                            onDragOver={(e) => handleDragOver(e, globalIndex)}
                            onDragEnd={() => { dragIndexRef.current = null; }}
                            className="flex items-center gap-4 px-6 py-3 cursor-grab active:cursor-grabbing hover:bg-stone-50 transition-colors select-none"
                          >
                            <span className="text-stone-400 text-xl shrink-0">⠿</span>
                            <span className="w-7 h-7 rounded-full bg-stone-100 text-stone-500 text-xs font-bold flex items-center justify-center shrink-0">
                              {catIndex + 1}
                            </span>
                            {product.image ? (
                              <img
                                src={getImageUrl(product.image)}
                                alt={product.name}
                                className="w-10 h-10 rounded-lg object-cover shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center shrink-0">
                                <Package size={16} className="text-stone-400" />
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-[#2D2A26] truncate">{product.name}</p>
                            </div>
                            <span className="text-sm font-medium text-stone-600 shrink-0">
                              {product.price.toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' })}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>

      {/* Create Product Modal */}
      <Modal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        type="form"
        title="Ajouter un produit"
        description="Créer un nouveau produit dans votre catalogue"
        actions={{
          primary: {
            label: "Créer le produit",
            onClick: handleCreate,
            variant: "default",
            disabled: !productForm.name || !productForm.price,
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsCreateModalOpen(false);
              setProductForm(
                createDefaultProductForm(
                  categories.length > 0 ? [categories[0].name] : [],
                ),
              );
            },
            disabled: isSubmitting,
          },
        }}
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">
                Nom du produit *
              </label>
              <input
                type="text"
                value={productForm.name}
                onChange={(e) =>
                  setProductForm({ ...productForm, name: e.target.value })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="Ex: Croissant Pur Beurre"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <ImageUpload
                value={productForm.image}
                onChange={(url) => setProductForm({ ...productForm, image: url })}
              />
            </div>

            {/* PHOTOS SUPPLÉMENTAIRES */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Photos supplémentaires</label>
              <input ref={extraImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleExtraImageUpload} />
              <div className="flex flex-wrap gap-2 mt-2">
                {productForm.images.map((img, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setProductForm(f => ({ ...f, images: f.images.filter((_, i) => i !== idx) }))} className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600"><X size={10} /></button>
                  </div>
                ))}
                <button type="button" onClick={() => extraImageInputRef.current?.click()} disabled={uploadingExtra} className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center hover:border-[#C5A065] transition-colors text-gray-400 hover:text-[#C5A065] disabled:opacity-50">
                  {uploadingExtra ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#C5A065]" /> : <><Plus size={18} /><span className="text-[10px] mt-1">Ajouter</span></>}
                </button>
              </div>
              <p className="text-xs text-gray-500">Ajoutez jusqu'à 5 photos supplémentaires</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Catégorie *
              </label>
              <select
                multiple
                value={productForm.category}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions).map(
                    (opt) => opt.value,
                  );
                  setProductForm({ ...productForm, category: values });
                }}
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none h-32"
              >
                {flattenCategoriesWithIndentation(categories).map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.display}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                Vous pouvez sélectionner plusieurs catégories (Ctrl/⌘ + clic).
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Prix (CAD) *
              </label>
              <input
                type="number"
                step="0.01"
                value={productForm.price}
                onChange={(e) =>
                  setProductForm({ ...productForm, price: e.target.value })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Discount (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={productForm.discountPercentage}
                onChange={(e) =>
                  setProductForm({ ...productForm, discountPercentage: e.target.value })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="0"
              />
              <p className="text-xs text-gray-500">
                Ex: 25 pour afficher un produit a -25%
              </p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">
                Jours disponibles (laisser vide = tous les jours)
              </label>
              <div className="flex flex-wrap gap-2">
                {DAY_OPTIONS.map((day) => {
                  const checked = productForm.availableDays.includes(day.value);
                  return (
                    <label
                      key={`create-day-${day.value}`}
                      className={`px-3 py-1 rounded-full text-xs border cursor-pointer transition-colors ${
                        checked
                          ? "bg-[#337957] text-white border-[#337957]"
                          : "bg-white text-stone-600 border-stone-300 hover:border-[#337957]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? productForm.availableDays.filter((d) => d !== day.value)
                            : [...productForm.availableDays, day.value].sort((a, b) => a - b);
                          setProductForm({ ...productForm, availableDays: next });
                        }}
                      />
                      {day.label}
                    </label>
                  );
                })}
              </div>
            </div>


            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Temps de préparation
              </label>
              <select
                value={productForm.preparationTimeHours}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    preparationTimeHours: e.target.value,
                  })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
              >
                <option value="">Immédiat (pas de préparation)</option>
                <option value="24">24 heures (1 jour)</option>
                <option value="48">48 heures (2 jours)</option>
                <option value="72">72 heures (3 jours)</option>
                <option value="168">7 jours</option>
              </select>
              <p className="text-xs text-gray-500">
                Délai nécessaire pour préparer ce produit
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Quantité minimale par commande *
              </label>
              <input
                type="number"
                value={productForm.minOrderQuantity}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    minOrderQuantity: e.target.value,
                  })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="1"
                min="1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Quantité maximale par commande *
              </label>
              <input
                type="number"
                value={productForm.maxOrderQuantity}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    maxOrderQuantity: e.target.value,
                  })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="10"
                min="1"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                value={productForm.description}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    description: e.target.value,
                  })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="Description du produit..."
                rows={6}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={productForm.available}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      available: e.target.checked,
                    })
                  }
                  className="w-5 h-5 text-[#337957] border-gray-300 rounded focus:ring-[#337957]"
                />
                <span className="text-sm font-medium text-gray-700">
                  Produit disponible à la commande
                </span>
              </label>
            </div>

            <div className="space-y-4 md:col-span-2 pt-4 border-t border-gray-100">
              <h4 className="font-semibold text-gray-900">Options supplémentaires</h4>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="create-has-taxes"
                  checked={productForm.hasTaxes}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      hasTaxes: e.target.checked,
                    })
                  }
                  className="w-5 h-5 text-[#337957] border-gray-300 rounded focus:ring-[#337957]"
                />
                <label htmlFor="create-has-taxes" className="text-sm font-medium text-gray-700 cursor-pointer">
                  Appliquer les taxes
                </label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Allergènes
                </label>
                <input
                  type="text"
                  value={productForm.allergens}
                  onChange={(e) =>
                    setProductForm({ ...productForm, allergens: e.target.value })
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                  placeholder="Ex: Gluten, Lactose, Noix"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Type de Production *
                </label>
                <select
                  value={productForm.productionType}
                  onChange={(e) =>
                    setProductForm({ ...productForm, productionType: e.target.value as "patisserie" | "cuisinier" | "four" })
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                >
                  <option value="patisserie">Pâtisserie</option>
                  <option value="cuisinier">Cuisinier</option>
                  <option value="four">Autre</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Public Cible *
                </label>
                <select
                  value={productForm.targetAudience}
                  onChange={(e) =>
                    setProductForm({ ...productForm, targetAudience: e.target.value as "clients" | "pro" })
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                >
                  <option value="clients">Clients uniquement</option>
                  <option value="pro">Professionnels uniquement</option>
                </select>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">
                    Options personnalisables (ex: Taille, Tranchage)
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const newOpts = [
                          ...productForm.customOptions,
                          {
                            name: "",
                            type: "choice" as const,
                            choices: [{ label: "", price: "" }],
                          },
                        ];
                        setProductForm({ ...productForm, customOptions: newOpts });
                      }}
                      className="text-sm text-[#337957] hover:underline flex items-center gap-1"
                    >
                      <Plus size={14} /> Ajouter une option
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newOpts = [
                          ...productForm.customOptions,
                          { name: "", type: "text" as const, choices: [] },
                        ];
                        setProductForm({ ...productForm, customOptions: newOpts });
                      }}
                      className="text-sm text-[#2D2A26] hover:underline"
                    >
                      + Ajouter écriture
                    </button>
                  </div>
                </div>

                {productForm.customOptions.map((opt, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Nom de l'option (ex: Taille)"
                        value={opt.name}
                        onChange={(e) => {
                          const newOpts = [...productForm.customOptions];
                          newOpts[idx] = { ...newOpts[idx], name: e.target.value };
                          setProductForm({ ...productForm, customOptions: newOpts });
                        }}
                        className="flex-1 p-2 border border-gray-200 rounded outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newOpts = productForm.customOptions.filter((_, i) => i !== idx);
                          setProductForm({ ...productForm, customOptions: newOpts });
                        }}
                        className="p-2 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {opt.type === "text" ? (
                        <p className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded p-2">
                          Champ libre: le client verra une ligne d'écriture pour saisir (ex: prénom, nom, message).
                        </p>
                      ) : (
                        <>
                          <p className="text-xs font-medium text-gray-500 uppercase">Choix possibles</p>
                          {opt.choices.map((choice, cidx) => (
                        <div key={cidx} className="flex flex-wrap gap-2 items-center">
                          <input
                            type="text"
                            placeholder="Choix (ex: 12 personnes)"
                            value={choice.label}
                            onChange={(e) => {
                              const newOpts = [...productForm.customOptions];
                              const newChoices = [...newOpts[idx].choices];
                              newChoices[cidx] = { ...newChoices[cidx], label: e.target.value };
                              newOpts[idx] = { ...newOpts[idx], choices: newChoices };
                              setProductForm({ ...productForm, customOptions: newOpts });
                            }}
                            className="flex-1 p-2 border border-gray-200 rounded outline-none text-sm"
                          />
                          <input
                            type="text"
                            placeholder="Prix (ex: 45.00)"
                            value={choice.price}
                            onChange={(e) => {
                              const newOpts = [...productForm.customOptions];
                              const newChoices = [...newOpts[idx].choices];
                              newChoices[cidx] = { ...newChoices[cidx], price: e.target.value };
                              newOpts[idx] = { ...newOpts[idx], choices: newChoices };
                              setProductForm({ ...productForm, customOptions: newOpts });
                            }}
                            className="w-24 sm:w-32 p-2 border border-gray-200 rounded outline-none text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const newOpts = [...productForm.customOptions];
                              const newChoices = opt.choices.filter((_, i) => i !== cidx);
                              newOpts[idx] = { ...newOpts[idx], choices: newChoices };
                              setProductForm({ ...productForm, customOptions: newOpts });
                            }}
                            className="p-2 text-gray-400 hover:text-red-500"
                          >
                            <X size={14} />
                          </button>
                        </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              const newOpts = [...productForm.customOptions];
                              const newChoices = [
                                ...newOpts[idx].choices,
                                { label: "", price: "" },
                              ];
                              newOpts[idx] = { ...newOpts[idx], choices: newChoices };
                              setProductForm({ ...productForm, customOptions: newOpts });
                            }}
                            className="text-xs text-[#337957] hover:underline"
                          >
                            + Ajouter un choix
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Recommendations Section */}
              <div className="space-y-3 md:col-span-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">
                    Produits recommandés (optionnel)
                  </label>
                  <span className="text-xs text-gray-500">
                    {productForm.recommendations.length} sélectionné(s)
                  </span>
                </div>
                
                {/* Selected recommendations display */}
                {productForm.recommendations.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {productForm.recommendations.map((recId) => {
                      const recProduct = products.find(p => p.id === recId);
                      return (
                        <div key={recId} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-sm">
                          <span className="text-amber-800">
                            {recProduct ? recProduct.name : `Produit #${recId}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const newRecs = productForm.recommendations.filter(id => id !== recId);
                              setProductForm({ ...productForm, recommendations: newRecs });
                            }}
                            className="text-amber-600 hover:text-amber-800"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Dropdown to add recommendations */}
                <select
                  value=""
                  onChange={(e) => {
                    const selectedId = parseInt(e.target.value);
                    if (selectedId && !productForm.recommendations.includes(selectedId)) {
                      setProductForm({
                        ...productForm,
                        recommendations: [...productForm.recommendations, selectedId]
                      });
                    }
                    e.target.value = ""; // Reset select
                  }}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                >
                  <option value="">+ Ajouter un produit recommandé</option>
                  {products
                    .filter(p =>
                      // Exclude current product being edited/created
                      p.id !== selectedProduct?.id &&
                      // Exclude already selected recommendations
                      !productForm.recommendations.includes(p.id)
                    )
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} - ${p.price.toFixed(2)}
                      </option>
                    ))}
                </select>
                
                {products.filter(p => p.id !== selectedProduct?.id && !productForm.recommendations.includes(p.id)).length === 0 && (
                  <p className="text-xs text-gray-500 italic">
                    Tous les produits disponibles ont été ajoutés
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Edit Product Modal */}
      <Modal
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        type="form"
        title="Modifier le produit"
        description="Mettre à jour les informations du produit"
        actions={{
          primary: {
            label: "Enregistrer",
            onClick: handleUpdate,
            variant: "default",
            disabled: !productForm.name || !productForm.price,
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsEditModalOpen(false);
              setSelectedProduct(null);
              setProductForm(
                createDefaultProductForm(
                  categories.length > 0 ? [categories[0].name] : [],
                ),
              );
            },
            disabled: isSubmitting,
          },
        }}
      >
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">
                Nom du produit *
              </label>
              <input
                type="text"
                value={productForm.name}
                onChange={(e) =>
                  setProductForm({ ...productForm, name: e.target.value })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="Ex: Croissant Pur Beurre"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <ImageUpload
                value={productForm.image}
                onChange={(url) => setProductForm({ ...productForm, image: url })}
              />
            </div>

            {/* PHOTOS SUPPLÉMENTAIRES */}
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">Photos supplémentaires</label>
              <input ref={extraImageInputRef} type="file" accept="image/*" className="hidden" onChange={handleExtraImageUpload} />
              <div className="flex flex-wrap gap-2 mt-2">
                {productForm.images.map((img, idx) => (
                  <div key={idx} className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200">
                    <img src={img} alt="" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setProductForm(f => ({ ...f, images: f.images.filter((_, i) => i !== idx) }))} className="absolute top-0.5 right-0.5 bg-red-500 text-white rounded-full p-0.5 hover:bg-red-600"><X size={10} /></button>
                  </div>
                ))}
                <button type="button" onClick={() => extraImageInputRef.current?.click()} disabled={uploadingExtra} className="w-20 h-20 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center hover:border-[#C5A065] transition-colors text-gray-400 hover:text-[#C5A065] disabled:opacity-50">
                  {uploadingExtra ? <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#C5A065]" /> : <><Plus size={18} /><span className="text-[10px] mt-1">Ajouter</span></>}
                </button>
              </div>
              <p className="text-xs text-gray-500">Ajoutez jusqu'à 5 photos supplémentaires</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Catégorie *
              </label>
              <select
                multiple
                value={productForm.category}
                onChange={(e) => {
                  const values = Array.from(e.target.selectedOptions).map(
                    (opt) => opt.value,
                  );
                  setProductForm({ ...productForm, category: values });
                }}
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none h-32"
              >
                {flattenCategoriesWithIndentation(categories).map((cat) => (
                  <option key={cat.id} value={cat.name}>
                    {cat.display}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                Vous pouvez sélectionner plusieurs catégories (Ctrl/⌘ + clic).
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Prix (CAD) *
              </label>
              <input
                type="number"
                step="0.01"
                value={productForm.price}
                onChange={(e) =>
                  setProductForm({ ...productForm, price: e.target.value })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="0.00"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Discount (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={productForm.discountPercentage}
                onChange={(e) =>
                  setProductForm({ ...productForm, discountPercentage: e.target.value })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="0"
              />
              <p className="text-xs text-gray-500">
                Ex: 25 pour afficher un produit a -25%
              </p>
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">
                Jours disponibles (laisser vide = tous les jours)
              </label>
              <div className="flex flex-wrap gap-2">
                {DAY_OPTIONS.map((day) => {
                  const checked = productForm.availableDays.includes(day.value);
                  return (
                    <label
                      key={`edit-day-${day.value}`}
                      className={`px-3 py-1 rounded-full text-xs border cursor-pointer transition-colors ${
                        checked
                          ? "bg-[#337957] text-white border-[#337957]"
                          : "bg-white text-stone-600 border-stone-300 hover:border-[#337957]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="hidden"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? productForm.availableDays.filter((d) => d !== day.value)
                            : [...productForm.availableDays, day.value].sort((a, b) => a - b);
                          setProductForm({ ...productForm, availableDays: next });
                        }}
                      />
                      {day.label}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Temps de préparation
              </label>
              <select
                value={productForm.preparationTimeHours}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    preparationTimeHours: e.target.value,
                  })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
              >
                <option value="">Immédiat (pas de préparation)</option>
                <option value="24">24 heures (1 jour)</option>
                <option value="48">48 heures (2 jours)</option>
                <option value="72">72 heures (3 jours)</option>
                <option value="168">7 jours</option>
              </select>
              <p className="text-xs text-gray-500">
                Délai nécessaire pour préparer ce produit
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Quantité minimale par commande *
              </label>
              <input
                type="number"
                value={productForm.minOrderQuantity}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    minOrderQuantity: e.target.value,
                  })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="1"
                min="1"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Quantité maximale par commande *
              </label>
              <input
                type="number"
                value={productForm.maxOrderQuantity}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    maxOrderQuantity: e.target.value,
                  })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="10"
                min="1"
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                value={productForm.description}
                onChange={(e) =>
                  setProductForm({
                    ...productForm,
                    description: e.target.value,
                  })
                }
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                placeholder="Description du produit..."
                rows={6}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <label className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={productForm.available}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      available: e.target.checked,
                    })
                  }
                  className="w-5 h-5 text-[#337957] border-gray-300 rounded focus:ring-[#337957]"
                />
                <span className="text-sm font-medium text-gray-700">
                  Produit disponible à la commande
                </span>
              </label>
            </div>

            <div className="space-y-4 md:col-span-2 pt-4 border-t border-gray-100">
              <h4 className="font-semibold text-gray-900">Options supplémentaires</h4>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="edit-has-taxes"
                  checked={productForm.hasTaxes}
                  onChange={(e) =>
                    setProductForm({
                      ...productForm,
                      hasTaxes: e.target.checked,
                    })
                  }
                  className="w-5 h-5 text-[#337957] border-gray-300 rounded focus:ring-[#337957]"
                />
                <label htmlFor="edit-has-taxes" className="text-sm font-medium text-gray-700 cursor-pointer">
                  Appliquer les taxes
                </label>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Allergènes
                </label>
                <input
                  type="text"
                  value={productForm.allergens}
                  onChange={(e) =>
                    setProductForm({ ...productForm, allergens: e.target.value })
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                  placeholder="Ex: Gluten, Lactose, Noix"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Type de Production *
                </label>
                <select
                  value={productForm.productionType}
                  onChange={(e) =>
                    setProductForm({ ...productForm, productionType: e.target.value as "patisserie" | "cuisinier" | "four" })
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                >
                  <option value="patisserie">Pâtisserie</option>
                  <option value="cuisinier">Cuisinier</option>
                  <option value="four">Autre</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Public Cible *
                </label>
                <select
                  value={productForm.targetAudience}
                  onChange={(e) =>
                    setProductForm({ ...productForm, targetAudience: e.target.value as "clients" | "pro" })
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                >
                  <option value="clients">Clients uniquement</option>
                  <option value="pro">Professionnels uniquement</option>
                </select>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">
                    Options personnalisables (ex: Taille, Tranchage)
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        const newOpts = [
                          ...productForm.customOptions,
                          {
                            name: "",
                            type: "choice" as const,
                            choices: [{ label: "", price: "" }],
                          },
                        ];
                        setProductForm({ ...productForm, customOptions: newOpts });
                      }}
                      className="text-sm text-[#337957] hover:underline flex items-center gap-1"
                    >
                      <Plus size={14} /> Ajouter une option
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const newOpts = [
                          ...productForm.customOptions,
                          { name: "", type: "text" as const, choices: [] },
                        ];
                        setProductForm({ ...productForm, customOptions: newOpts });
                      }}
                      className="text-sm text-[#2D2A26] hover:underline"
                    >
                      + Ajouter écriture
                    </button>
                  </div>
                </div>

                {productForm.customOptions.map((opt, idx) => (
                  <div key={idx} className="p-4 bg-gray-50 rounded-lg space-y-3 border border-gray-200">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Nom de l'option (ex: Taille)"
                        value={opt.name}
                        onChange={(e) => {
                          const newOpts = [...productForm.customOptions];
                          newOpts[idx] = { ...newOpts[idx], name: e.target.value };
                          setProductForm({ ...productForm, customOptions: newOpts });
                        }}
                        className="flex-1 p-2 border border-gray-200 rounded outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const newOpts = productForm.customOptions.filter((_, i) => i !== idx);
                          setProductForm({ ...productForm, customOptions: newOpts });
                        }}
                        className="p-2 text-red-500 hover:bg-red-50 rounded"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="space-y-2">
                      {opt.type === "text" ? (
                        <p className="text-xs text-gray-500 bg-blue-50 border border-blue-200 rounded p-2">
                          Champ libre: le client verra une ligne d'écriture pour saisir (ex: prénom, nom, message).
                        </p>
                      ) : (
                        <>
                          <p className="text-xs font-medium text-gray-500 uppercase">Choix possibles</p>
                          {opt.choices.map((choice, cidx) => (
                        <div key={cidx} className="flex flex-wrap gap-2 items-center">
                          <input
                            type="text"
                            placeholder="Choix (ex: 12 personnes)"
                            value={choice.label}
                            onChange={(e) => {
                              const newOpts = [...productForm.customOptions];
                              const newChoices = [...newOpts[idx].choices];
                              newChoices[cidx] = { ...newChoices[cidx], label: e.target.value };
                              newOpts[idx] = { ...newOpts[idx], choices: newChoices };
                              setProductForm({ ...productForm, customOptions: newOpts });
                            }}
                            className="flex-1 p-2 border border-gray-200 rounded outline-none text-sm"
                          />
                          <input
                            type="text"
                            placeholder="Prix (ex: 45.00)"
                            value={choice.price}
                            onChange={(e) => {
                              const newOpts = [...productForm.customOptions];
                              const newChoices = [...newOpts[idx].choices];
                              newChoices[cidx] = { ...newChoices[cidx], price: e.target.value };
                              newOpts[idx] = { ...newOpts[idx], choices: newChoices };
                              setProductForm({ ...productForm, customOptions: newOpts });
                            }}
                            className="w-24 sm:w-32 p-2 border border-gray-200 rounded outline-none text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const newOpts = [...productForm.customOptions];
                              const newChoices = opt.choices.filter((_, i) => i !== cidx);
                              newOpts[idx] = { ...newOpts[idx], choices: newChoices };
                              setProductForm({ ...productForm, customOptions: newOpts });
                            }}
                            className="p-2 text-gray-400 hover:text-red-500"
                          >
                            <X size={14} />
                          </button>
                        </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              const newOpts = [...productForm.customOptions];
                              const newChoices = [
                                ...newOpts[idx].choices,
                                { label: "", price: "" },
                              ];
                              newOpts[idx] = { ...newOpts[idx], choices: newChoices };
                              setProductForm({ ...productForm, customOptions: newOpts });
                            }}
                            className="text-xs text-[#337957] hover:underline"
                          >
                            + Ajouter un choix
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Recommendations Section - Edit Modal */}
              <div className="space-y-3 md:col-span-2 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium text-gray-700">
                    Produits recommandés (optionnel)
                  </label>
                  <span className="text-xs text-gray-500">
                    {productForm.recommendations.length} sélectionné(s)
                  </span>
                </div>
                
                {/* Selected recommendations display */}
                {productForm.recommendations.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {productForm.recommendations.map((recId) => {
                      const recProduct = products.find(p => p.id === recId);
                      return (
                        <div key={recId} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-sm">
                          <span className="text-amber-800">
                            {recProduct ? recProduct.name : `Produit #${recId}`}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              const newRecs = productForm.recommendations.filter(id => id !== recId);
                              setProductForm({ ...productForm, recommendations: newRecs });
                            }}
                            className="text-amber-600 hover:text-amber-800"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Dropdown to add recommendations */}
                <select
                  value=""
                  onChange={(e) => {
                    const selectedId = parseInt(e.target.value);
                    if (selectedId && !productForm.recommendations.includes(selectedId)) {
                      setProductForm({
                        ...productForm,
                        recommendations: [...productForm.recommendations, selectedId]
                      });
                    }
                    e.target.value = ""; // Reset select
                  }}
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#337957]/50 outline-none"
                >
                  <option value="">+ Ajouter un produit recommandé</option>
                  {products
                    .filter(p => 
                      p.id !== selectedProduct?.id && 
                      !productForm.recommendations.includes(p.id)
                    )
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} - ${p.price.toFixed(2)}
                      </option>
                    ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      </Modal>

      {/* Product Details Modal */}
      <Modal
        open={isDetailsModalOpen}
        onOpenChange={setIsDetailsModalOpen}
        type="details"
        title="Détails du produit"
        description={selectedProduct?.name || ""}
        actions={{
          secondary: {
            label: "Fermer",
            onClick: () => {
              setIsDetailsModalOpen(false);
              setSelectedProduct(null);
            },
          },
        }}
      >
        {selectedProduct && (
          <div className="space-y-6">
            {selectedProduct.image ? (
              <div className="flex justify-center mb-4">
                <img
                  src={getImageUrl(selectedProduct.image)}
                  alt={selectedProduct.name}
                  className="max-w-xs rounded-lg shadow-md"
                />
              </div>
            ) : (
              <div className="flex justify-center mb-4">
                <div className="w-48 h-48 rounded-lg bg-gray-100 flex items-center justify-center">
                  <ImageIcon size={64} className="text-gray-400" />
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Nom du produit
                </label>
                <p className="text-base text-[#2D2A26] mt-1">
                  {selectedProduct.name}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Catégorie
                </label>
                <p className="text-base text-[#2D2A26] mt-1">
                  {selectedProduct.category.join(", ")}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Prix
                </label>
                {selectedProduct.discountPercentage && selectedProduct.discountPercentage > 0 ? (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm text-gray-400 line-through">
                      {formatCurrency(selectedProduct.price)}
                    </span>
                    <span className="text-base text-[#2D2A26] font-medium">
                      {formatCurrency(getDiscountedPrice(selectedProduct.price, selectedProduct.discountPercentage))}
                    </span>
                    <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                      -{selectedProduct.discountPercentage}%
                    </span>
                  </div>
                ) : (
                  <p className="text-base text-[#2D2A26] mt-1 font-medium">
                    {formatCurrency(selectedProduct.price)}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Disponibilité
                </label>
                <div className="mt-1">
                  {getAvailabilityBadge(selectedProduct.available)}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Quantité minimale
                </label>
                <p className="text-base text-[#2D2A26] mt-1">
                  {selectedProduct.minOrderQuantity}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Quantité maximale
                </label>
                <p className="text-base text-[#2D2A26] mt-1">
                  {selectedProduct.maxOrderQuantity}
                </p>
              </div>
              {selectedProduct.description && (
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-500">
                    Description
                  </label>
                  <p className="text-base text-[#2D2A26] mt-1 whitespace-pre-line">
                    {selectedProduct.description}
                  </p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Date de création
                </label>
                <p className="text-base text-[#2D2A26] mt-1">
                  {formatDate(selectedProduct.createdAt)}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Dernière modification
                </label>
                <p className="text-base text-[#2D2A26] mt-1">
                  {formatDate(selectedProduct.updatedAt)}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Taxes
                </label>
                <p className="text-base text-[#2D2A26] mt-1">
                  {selectedProduct.hasTaxes ? "Taxes applicables" : "Sans taxes"}
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-500">
                  Jours disponibles
                </label>
                <p className="text-base text-[#2D2A26] mt-1">
                  {selectedProduct.availableDays && selectedProduct.availableDays.length > 0
                    ? selectedProduct.availableDays
                        .sort((a, b) => a - b)
                        .map((day) => DAY_OPTIONS.find((d) => d.value === day)?.label || day)
                        .join(", ")
                    : "Tous les jours"}
                </p>
              </div>
              {selectedProduct.allergens && (
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-500">
                    Allergènes
                  </label>
                  <p className="text-base text-[#2D2A26] mt-1">
                    {selectedProduct.allergens}
                  </p>
                </div>
              )}
              {selectedProduct.customOptions && selectedProduct.customOptions.length > 0 && (
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-500">
                    Options supplémentaires
                  </label>
                  <div className="mt-2 space-y-2">
                    {selectedProduct.customOptions.map((opt, idx) => (
                      <div key={idx} className="p-2 bg-gray-50 rounded border border-gray-100">
                        <p className="font-semibold text-sm">{opt.name}</p>
                        <div className="text-sm text-stone-600 space-y-1">
                          {opt.choices.map((choice, choiceIdx) => (
                            <p key={choiceIdx}>{formatChoiceDisplay(choice)}</p>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Affichage des recommandations */}
              {selectedProduct.recommendations && selectedProduct.recommendations.length > 0 && (
                <div className="md:col-span-2">
                  <label className="text-sm font-medium text-gray-500">
                    Produits recommandés
                  </label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selectedProduct.recommendations.map((recId) => {
                      // Convert to number for comparison (backend might return strings)
                      const numericRecId = typeof recId === 'string' ? parseInt(recId) : recId;
                      const recProduct = products.find(p => p.id === numericRecId);
                      if (!recProduct) {
                        // Show ID if product not found in list yet
                        return (
                          <div key={recId} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-sm">
                            <span className="text-gray-600">Produit ID: {recId}</span>
                          </div>
                        );
                      }
                      return (
                        <div key={recId} className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full text-sm">
                          <span className="text-amber-800">{recProduct.name}</span>
                          <span className="text-amber-600">${recProduct.price.toFixed(2)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Product Modal */}
      <Modal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        type="warning"
        title="Supprimer le produit"
        description="Êtes-vous sûr de vouloir supprimer ce produit ? Cette action est irréversible."
        actions={{
          primary: {
            label: "Supprimer",
            onClick: handleDelete,
            variant: "destructive",
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsDeleteModalOpen(false);
              setProductToDelete(null);
            },
            disabled: isSubmitting,
          },
        }}
      >
        {productToDelete && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <p className="text-sm text-red-800">
              <strong>Produit :</strong> {productToDelete.name}
              <br />
              <strong>Catégorie :</strong> {productToDelete.category.join(", ")}
              <br />
              <strong>Prix :</strong> {formatCurrency(productToDelete.price)}
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
