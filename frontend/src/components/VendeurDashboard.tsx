import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, LogOut, Menu, Package, Users, X, Lock } from "lucide-react";
import { authClient } from "../lib/AuthClient";
import GoldenBackground from "./GoldenBackground";
import { OrderManagement } from "./OrderManagement";
import InventaireJournalier from "./InventaireJournalier";
import InventaireFrais from "./InventaireFour";
import Fermeture from "./Fermeture";
import ClientManagement from "./ClientManagement";

type ViewMode = "orders" | "inventaire" | "inventaire-frais" | "clients" | "fermeture";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, active = false, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-3 w-full p-3 rounded-xl transition-all duration-200
        relative group
        ${
          active
            ? "bg-[#C5A065] text-white shadow-lg"
            : "text-stone-700 hover:bg-[#C5A065] hover:text-white"
        }
      `}
    >
      <span className={`${active ? "scale-110" : "group-hover:scale-110"} transition-transform`}>
        {icon}
      </span>
      <span className="font-medium text-sm">{label}</span>
      {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-[#A88445] rounded-r-full" />}
    </button>
  );
}

export default function VendeurDashboard() {
  const [viewMode, setViewMode] = useState<ViewMode>("orders");
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      await authClient.signOut();
    } catch (error) {
      console.error("Logout network call failed (continuing anyway):", error);
    }
    try {
      localStorage.removeItem("bearer_token");
    } catch {
      /* ignore */
    }
    navigate("/se-connecter");
  };

  return (
    <div className="relative flex h-screen bg-[#F9F7F2] font-sans text-stone-800">
      <div className="fixed inset-0 z-0 opacity-30">
        <GoldenBackground />
      </div>

      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <aside
        className={`
        fixed md:relative inset-y-0 left-0 z-50 md:z-20
        w-64 md:w-56 lg:w-72 max-w-[75vw] bg-white text-stone-800 flex flex-col shadow-2xl border-r border-stone-200
        transform transition-transform duration-300 ease-in-out
        ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
      `}
      >
        <div className="p-6 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h1 className="text-2xl mb-1" style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}>
              Marius & Fanny
            </h1>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Espace Vendeur
            </p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden text-stone-500 hover:text-stone-800 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          <NavItem
            icon={<ClipboardList size={20} />}
            label="Commandes"
            active={viewMode === "orders"}
            onClick={() => {
              setViewMode("orders");
              setIsMobileMenuOpen(false);
            }}
          />
          <NavItem
            icon={<Package size={20} />}
            label="Inventaire journalier"
            active={viewMode === "inventaire"}
            onClick={() => {
              setViewMode("inventaire");
              setIsMobileMenuOpen(false);
            }}
          />
          <NavItem
            icon={<Package size={20} />}
            label="Inventaire frais"
            active={viewMode === "inventaire-frais"}
            onClick={() => {
              setViewMode("inventaire-frais");
              setIsMobileMenuOpen(false);
            }}
          />
          <NavItem
            icon={<Users size={20} />}
            label="Clients"
            active={viewMode === "clients"}
            onClick={() => {
              setViewMode("clients");
              setIsMobileMenuOpen(false);
            }}
          />
          <NavItem
            icon={<Lock size={20} />}
            label="Fermeture"
            active={viewMode === "fermeture"}
            onClick={() => {
              setViewMode("fermeture");
              setIsMobileMenuOpen(false);
            }}
          />
        </nav>

        <div className="p-4 border-t border-stone-200">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full p-3 rounded-xl text-stone-700 hover:bg-[#C5A065] hover:text-white transition-all border border-stone-200"
          >
            <LogOut size={20} />
            <span className="font-medium">Déconnexion</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto relative z-10">
        <div className="md:hidden bg-white/80 backdrop-blur-md border-b border-stone-200 px-4 py-3 flex items-center justify-between sticky top-0 z-30">
          <button onClick={() => setIsMobileMenuOpen(true)} className="text-stone-600 hover:text-[#337957] p-2 -ml-2">
            <Menu size={28} />
          </button>
          <h1 className="text-2xl" style={{ fontFamily: '"Great Vibes", cursive', color: "#337957" }}>
            Espace Vendeur
          </h1>
          <div className="w-8" />
        </div>

        {viewMode === "orders" && <OrderManagement />}
        {viewMode === "inventaire" && <InventaireJournalier />}
        {viewMode === "inventaire-frais" && <InventaireFrais />}
        {viewMode === "clients" && <ClientManagement />}
        {viewMode === "fermeture" && <Fermeture />}
      </main>
    </div>
  );
}
