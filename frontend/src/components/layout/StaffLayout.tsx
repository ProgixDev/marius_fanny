import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { 
  LogOut, 
  Menu, 
  X, 
  ChefHat, 
  UserCircle,
  LayoutDashboard
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface StaffLayoutProps {
  children: React.ReactNode;
  user: { firstName: string; lastName: string; role: string } | null;
  onLogout: () => void;
}

export function StaffLayout({ children, user, onLogout }: StaffLayoutProps) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();

  // Protections pour les icônes et labels
  const isKitchen = user?.role === 'kitchen_staff';
  const RoleIcon = isKitchen ? ChefHat : UserCircle;
  const roleLabel = isKitchen ? 'Cuisine & Production' : 'Service Client';

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-[#2D2A26]">
      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
        fixed inset-y-0 left-0 z-50 w-64 md:w-56 lg:w-72 max-w-[75vw] bg-linear-to-b from-[#2D2A26] to-[#1a1816] text-white flex flex-col shadow-2xl
        transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0
        ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
      `}
      >
        <div className="p-6 border-b border-gray-700/50 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-serif tracking-wide text-white">
              MARIUS & FANNY
            </h1>
            <p className="text-xs text-[#C5A065] mt-0.5 tracking-wider uppercase">
              {roleLabel}
            </p>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="md:hidden text-gray-400 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <Button 
            variant="ghost" 
            className="w-full justify-start text-white hover:text-[#C5A065] hover:bg-white/5"
            onClick={() => navigate('/staff/dashboard')}
          >
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Tableau de bord
          </Button>
        </nav>

        <div className="p-4 border-t border-gray-700/50 bg-black/20">
          <div className="mb-3 p-3 rounded-lg bg-gray-800/50 border border-gray-700/50 flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-[#C5A065] flex items-center justify-center">
              <RoleIcon size={20} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate">
                {/* Sécurité sur le nom */}
                {user?.firstName || "Utilisateur"} {user?.lastName || ""}
              </p>
              <p className="text-xs text-gray-400 truncate capitalize">
                {/* --- LA CORRECTION EST ICI (Ligne 83) --- */}
                {user?.role ? user.role.replace('_', ' ') : 'Staff'}
              </p>
            </div>
          </div>
          <Button 
            variant="destructive" 
            className="w-full justify-start bg-red-900/20 text-red-400 hover:bg-red-900/40 border-none"
            onClick={onLogout}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Déconnexion
          </Button>
        </div>
      </aside>
      {/* Main Content */}
      <main className="flex-1 overflow-auto flex flex-col">
        <div className="md:hidden bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-4 sticky top-0 z-30">
          <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -ml-2">
            <Menu size={28} className="text-[#2D2A26]" />
          </button>
          <span className="font-serif font-bold text-lg text-[#2D2A26]">Staff Dashboard</span>
        </div>

        <div className="flex-1 p-3 sm:p-4 md:p-8">
            {children}
        </div>
      </main>
    </div>
  );
}