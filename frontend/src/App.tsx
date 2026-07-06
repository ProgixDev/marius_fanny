import React, { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";

// Components
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import ParallaxSection from "./components/ParallaxSection";
import Time from "./components/Timeline";
import Footer from "./components/Footer";
import Shop from "./components/Shop";
import ProductSelection from "./components/ProductSelection";
import Politique from "./components/Politique";
import Video from "./components/Videoclient";
import GoldenBackground from "./components/GoldenBackground";
import CartDrawer from "./components/Cart";
import AuthPage from "./components/Autpage";
import AdminDashboard from "./components/Dashboard";
import Contact from "./components/Contact";
import MonCompte from "./components/Moncompte";
import DevenirPartenaire from "./components/DevenirPartenaire";
import ProDashboard from "./components/ProDashboard";
import CuisinierDashboard from "./components/CuisinierDashboard";
import PatissierDashboard from "./components/PatissierDashboard";
import VendeurDashboard from "./components/VendeurDashboard";

// Pages
import User from "./pages/user";
import VerifyEmailPage from "./pages/Emailverified";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import ResetPassword from "./pages/ResetPassword";
import StaffManagement from "./pages/Stuff";
import Checkout from "./pages/Checkout";
import DeliveryDashboard from "./pages/DeliveryDashboard";
import Invoice from "./pages/Invoice";
import Quote from "./pages/Quote";
import { RoleBasedRedirect } from "./components/RoleBasedRedirect";

// Utils
import { loadCart, saveCart } from "./utils/cartPersistence";
import { SettingsProvider } from "./lib/SettingsContext";

interface CartItem {
  id: number;
  name: string;
  price: number;
  image: string;
  quantity: number;
  cartItemKey?: string;
  selectedOptions?: Record<string, string>;
  availableDays?: number[];
  hasTaxes?: boolean;
  category?: string;
  productionType?: string;
  preparationTimeHours?: number;
  minOrderQuantity?: number;
}

interface HomePageProps {
  onCartClick: () => void;
  cartCount: number;
  onAddToCart: (product: any) => void;
}

const HomePage: React.FC<HomePageProps> = ({
  onCartClick,
  cartCount,
  onAddToCart,
}) => (
  <>
    <Navbar onCartClick={onCartClick} cartCount={cartCount} />
    <main className="relative z-10">
      <Hero />
      <section id="shop">
        <Shop onAddToCart={onAddToCart} />
      </section>

 
      <Video />
      <section id="timeline">
        <Time />
      </section>
      <ParallaxSection />
    </main>
    <Footer />
  </>
);

interface ProductsPageProps {
  onCartClick: () => void;
  cartCount: number;
  onAddToCart: (product: any) => void;
}

const ProductsPage: React.FC<ProductsPageProps> = ({
  onCartClick,
  cartCount,
  onAddToCart,
}) => (
  <>
    <Navbar onCartClick={onCartClick} cartCount={cartCount} />
    <main className="pt-24 min-h-screen relative z-10">
      <ProductSelection onAddToCart={onAddToCart} />
    </main>
    <Footer />
  </>
);

const App: React.FC = () => {
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    // Initialize cart state directly from localStorage
    const persistedCart = loadCart();
    console.log("🚀 [APP] Initializing cart from localStorage:", persistedCart);
    return persistedCart;
  });
  // Save cart to localStorage whenever it changes
  useEffect(() => {
    console.log("💾 [APP] Saving cart to localStorage:", cartItems);
    saveCart(cartItems);
  }, [cartItems]);

  // Filet de sécurité "paiement sans commande" : au chargement du site, on
  // renvoie automatiquement toute commande PAYÉE qui n'aurait pas pu être
  // enregistrée (coupure réseau pendant le checkout). Best effort, silencieux.
  useEffect(() => {
    (async () => {
      try {
        const { flushPendingOrders } = await import("./utils/orderRecovery");
        await flushPendingOrders();
      } catch {
        /* ignore — réessaiera au prochain chargement */
      }
    })();
  }, []);

  // Compter une visite du SITE (1 fois par session, pages publiques seulement).
  useEffect(() => {
    try {
      const path = window.location.pathname;
      const adminPaths = [
        "/dashboard", "/stuff", "/staff", "/user", "/pro",
        "/se-connecter", "/forgot_password", "/reset-password", "/verify-email",
      ];
      if (adminPaths.some((p) => path.startsWith(p))) return; // pas les pages admin/staff
      if (sessionStorage.getItem("mf_visit_tracked")) return; // 1 fois par session
      sessionStorage.setItem("mf_visit_tracked", "1");
      fetch("/api/visits/track", { method: "POST" }).catch(() => {});
    } catch {
      /* ignore */
    }
  }, []);

  // Listen for cart updates from other components
  useEffect(() => {
    const handleCartUpdate = () => {
      console.log("🔄 [APP] Cart updated event received, reloading cart");
      const updatedCart = loadCart();
      setCartItems(updatedCart);
    };

    window.addEventListener("cart:updated", handleCartUpdate);
    return () => window.removeEventListener("cart:updated", handleCartUpdate);
  }, []);

  // Keep the auth session warm: every 10 minutes we ping get-session so
  // better-auth rotates the bearer token before it goes stale. Also runs
  // when the tab regains focus (catches the "left tab open overnight"
  // case the admin reported).
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      if (cancelled) return;
      if (!localStorage.getItem("bearer_token")) return; // nothing to refresh
      try {
        const { getSessionUniversal } = await import("./utils/getSession");
        await getSessionUniversal();
      } catch {
        /* ignore — request errors will surface via API calls */
      }
    };
    ping();
    // Toutes les 5 min (les onglets en arrière-plan sont ralentis par le
    // navigateur, donc on complète avec focus + visibilitychange).
    const intervalId = window.setInterval(ping, 5 * 60 * 1000);
    const onFocus = () => ping();
    // visibilitychange = déclenché de façon fiable quand l'onglet redevient
    // visible (plus fiable que focus après une longue période en arrière-plan).
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const buildOptionsSignature = (options?: Record<string, string>) => {
    if (!options || Object.keys(options).length === 0) return "";
    return Object.entries(options)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}:${value}`)
      .join("|");
  };

  const buildCartItemKey = (product: {
    id: number;
    selectedOptions?: Record<string, string>;
  }) => `${product.id}::${buildOptionsSignature(product.selectedOptions)}`;

  const addToCart = (product: any) => {
    console.log("➕ [APP] Adding to cart:", product);
    setCartItems((prev) => {
      console.log("📦 [APP] Previous cart:", prev);
      const incomingKey = buildCartItemKey(product);
      const existing = prev.find(
        (item) => (item.cartItemKey || buildCartItemKey(item)) === incomingKey,
      );
      if (existing) {
        const newCart = prev.map((item) =>
          (item.cartItemKey || buildCartItemKey(item)) === incomingKey
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
        console.log("🔄 [APP] Updated existing item, new cart:", newCart);
        return newCart;
      }
      const newCart = [
        ...prev,
        {
          ...product,
          cartItemKey: incomingKey,
          selectedOptions: product.selectedOptions || undefined,
          quantity: 1,
          image: product.image || product.img,
        },
      ];
      console.log("🆕 [APP] Added new item, new cart:", newCart);
      return newCart;
    });
  };

  const updateQuantity = (cartItemKey: string, delta: number) => {
    setCartItems((prev) =>
      prev.map((item) => {
        if ((item.cartItemKey || buildCartItemKey(item)) === cartItemKey) {
          const minQty = item.minOrderQuantity || 1;
          const newQty = Math.max(minQty, item.quantity + delta);
          return { ...item, quantity: newQty };
        }
        return item;
      }),
    );
  };

  const removeItem = (cartItemKey: string) => {
    setCartItems((prev) =>
      prev.filter(
        (item) => (item.cartItemKey || buildCartItemKey(item)) !== cartItemKey,
      ),
    );
  };

  return (
    <SettingsProvider>
    <Router>
      <GoldenBackground />

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        items={cartItems}
        onUpdateQuantity={updateQuantity}
        onRemove={removeItem}
      />

      <div className="min-h-screen relative">
        <Routes>
          {/* Main Routes - Protected from delivery drivers */}
          <Route
            path="/"
            element={
              <RoleBasedRedirect>
                <HomePage
                  onCartClick={() => setIsCartOpen(true)}
                  cartCount={cartItems.reduce(
                    (sum, item) => sum + item.quantity,
                    0,
                  )}
                  onAddToCart={addToCart}
                />
              </RoleBasedRedirect>
            }
          />
          <Route
            path="/products"
            element={
              <RoleBasedRedirect>
                <ProductsPage
                  onCartClick={() => setIsCartOpen(true)}
                  cartCount={cartItems.reduce(
                    (sum, item) => sum + item.quantity,
                    0,
                  )}
                  onAddToCart={addToCart}
                />
              </RoleBasedRedirect>
            }
          />
          <Route
            path="/checkout"
            element={
              <RoleBasedRedirect>
                <Checkout />
              </RoleBasedRedirect>
            }
          />
          <Route
            path="/politique-retour"
            element={
              <RoleBasedRedirect>
                <Politique />
              </RoleBasedRedirect>
            }
          />
          <Route
            path="/contact"
            element={
              <RoleBasedRedirect>
                <Contact />
              </RoleBasedRedirect>
            }
          />
          <Route
            path="/dashboard"
            element={
              <RoleBasedRedirect>
                <AdminDashboard />
              </RoleBasedRedirect>
            }
          />
          <Route
            path="/mon-compte"
            element={
              <RoleBasedRedirect>
                <MonCompte />
              </RoleBasedRedirect>
            }
          />

          {/* Pro Partner Routes */}
          <Route
            path="/devenir-partenaire"
            element={
              <RoleBasedRedirect>
                <DevenirPartenaire
                  onCartClick={() => setIsCartOpen(true)}
                  cartCount={cartItems.reduce(
                    (sum, item) => sum + item.quantity,
                    0,
                  )}
                />
              </RoleBasedRedirect>
            }
          />
           <Route
             path="/pro"
             element={
               <RoleBasedRedirect>
                <ProDashboard
                  onCartClick={() => setIsCartOpen(true)}
                  cartCount={cartItems.reduce(
                    (sum, item) => sum + item.quantity,
                    0,
                  )}
                  onAddToCart={addToCart}
                />
               </RoleBasedRedirect>
             }
           />

          {/* Auth Routes */}
          <Route path="/se-connecter" element={<AuthPage />} />
          <Route
            path="/forgot_password"
            element={
              <ForgotPasswordPage
                onSuccess={(message: string) => alert(`Success: ${message}`)}
                onError={(error: string) => alert(`Error: ${error}`)}
              />
            }
          />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />

          <Route
            path="/user"
            element={
              <RoleBasedRedirect>
                <User />
              </RoleBasedRedirect>
            }
          />
          <Route
            path="/stuff"
            element={
              <RoleBasedRedirect>
                <StaffManagement />
              </RoleBasedRedirect>
            }
          />
          <Route path="/facture/:orderId" element={<Invoice />} />
          <Route path="/soumission/:quoteId" element={<Quote />} />
          <Route path="/staff/delivery" element={<DeliveryDashboard />} />
          <Route path="/staff/cuisinier" element={<CuisinierDashboard />} />
          <Route path="/staff/patissier" element={<PatissierDashboard />} />
          <Route path="/staff/vendeur" element={<VendeurDashboard />} />
          <Route path="/staff/four" element={<VendeurDashboard />} />
        </Routes>
      </div>
    </Router>
    </SettingsProvider>
  );
};

export default App;
