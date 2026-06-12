import { useState, useEffect } from "react";
import {
  Users,
  Plus,
  Trash2,
  Mail,
  Phone,
  Briefcase,
  MoreVertical,
  Edit2,
  Lock,
  Eye,
  EyeOff,
} from "lucide-react";
import { DataTable } from "./ui/DataTable";
import { Modal } from "./ui/modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { normalizedApiUrl } from "../lib/AuthClient";
import { authHeaders } from "../utils/authHeaders";

interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: string;
  phone: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt?: string;
}

const ROLE_OPTIONS = [
  { value: "admin", label: "Administrateur" },
  { value: "deliveryDriver", label: "Livreur" },
  { value: "cuisinier", label: "Cuisinier" },
  { value: "patissier", label: "Pâtissier" },
  { value: "vendeur", label: "Vendeur" },
  { value: "pro", label: "Partenaire Pro" },
];

const getRoleLabel = (role: string) =>
  ROLE_OPTIONS.find((r) => r.value === role)?.label || role;

export default function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [deletingStaff, setDeletingStaff] = useState<StaffMember | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [formData, setFormData] = useState({
    email: "",
    name: "",
    password: "",
    role: "vendeur",
    phone: "",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  const fetchStaff = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${normalizedApiUrl}/api/users/staff`, {
        headers: authHeaders(),
        credentials: "include",
      });
      const result = await response.json();
      if (result.success) {
        setStaff(result.data || []);
      }
    } catch (e) {
      console.error("Failed to fetch staff:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  const resetForm = () => {
    setFormData({
      email: "",
      name: "",
      password: "",
      role: "vendeur",
      phone: "",
    });
    setEditingStaff(null);
    setShowPassword(false);
  };

  const showError = (msg: string) => {
    setErrorMessage(msg);
    setIsErrorModalOpen(true);
  };

  const validateForm = (isCreate: boolean): boolean => {
    if (!formData.email.trim() || !formData.email.includes("@")) {
      showError("Veuillez entrer une adresse email valide.");
      return false;
    }
    if (!formData.name.trim()) {
      showError("Veuillez entrer un nom complet.");
      return false;
    }
    if (!formData.role) {
      showError("Veuillez sélectionner un rôle.");
      return false;
    }
    if (isCreate) {
      if (!formData.password || formData.password.length < 6) {
        showError("Le mot de passe doit contenir au moins 6 caractères.");
        return false;
      }
    }
    return true;
  };

  const handleCreate = async () => {
    if (!validateForm(true)) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(`${normalizedApiUrl}/api/users/staff`, {
        method: "POST",
        credentials: "include",
        headers: authHeaders(),
        body: JSON.stringify({
          email: formData.email.trim().toLowerCase(),
          name: formData.name.trim(),
          password: formData.password,
          role: formData.role,
          phone: formData.phone.trim() || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || result.message || "Erreur lors de la création");
      }
      await fetchStaff();
      setIsCreateModalOpen(false);
      resetForm();
    } catch (e: any) {
      showError(e?.message || "Erreur lors de la création du membre");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (staffMember: StaffMember) => {
    setEditingStaff(staffMember);
    setFormData({
      email: staffMember.email,
      name: staffMember.name,
      password: "",
      role: staffMember.role,
      phone: staffMember.phone || "",
    });
    setIsEditModalOpen(true);
  };

  const handleEdit = async () => {
    if (!editingStaff) return;
    if (!validateForm(false)) return;

    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${normalizedApiUrl}/api/users/staff/${editingStaff.id}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formData.name.trim(),
            role: formData.role,
            phone: formData.phone.trim(),
          }),
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || result.message || "Erreur lors de la modification");
      }
      await fetchStaff();
      setIsEditModalOpen(false);
      resetForm();
    } catch (e: any) {
      showError(e?.message || "Erreur lors de la modification");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (staffMember: StaffMember) => {
    setDeletingStaff(staffMember);
    setIsDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingStaff) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(
        `${normalizedApiUrl}/api/users/staff/${deletingStaff.id}`,
        {
          method: "DELETE",
          headers: authHeaders(),
          credentials: "include",
        },
      );
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || result.message || "Erreur lors de la suppression");
      }
      await fetchStaff();
      setIsDeleteModalOpen(false);
      setDeletingStaff(null);
    } catch (e: any) {
      showError(e?.message || "Erreur lors de la suppression");
    } finally {
      setIsSubmitting(false);
    }
  };

  const columns = [
    {
      key: "name",
      label: "Nom",
      sortable: true,
      render: (item: StaffMember) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#C5A065] text-white flex items-center justify-center font-semibold text-sm">
            {(item.name || "?").charAt(0).toUpperCase()}
          </div>
          <span className="font-medium text-[#2D2A26]">{item.name}</span>
        </div>
      ),
    },
    {
      key: "email",
      label: "Email",
      sortable: true,
      render: (item: StaffMember) => (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Mail size={14} className="text-gray-400" />
          {item.email}
        </div>
      ),
    },
    {
      key: "phone",
      label: "Téléphone",
      sortable: false,
      render: (item: StaffMember) => (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Phone size={14} className="text-gray-400" />
          {item.phone || "—"}
        </div>
      ),
    },
    {
      key: "role",
      label: "Rôle",
      sortable: true,
      render: (item: StaffMember) => (
        <div className="flex items-center gap-2">
          <Briefcase size={14} className="text-[#C5A065]" />
          <span className="text-sm">{getRoleLabel(item.role)}</span>
        </div>
      ),
    },
    {
      key: "status",
      label: "Statut",
      sortable: true,
      render: (item: StaffMember) =>
        item.status === "active" ? (
          <span className="px-3 py-1 rounded-full text-xs font-semibold border bg-green-100 text-green-700 border-green-200">
            Actif
          </span>
        ) : (
          <span className="px-3 py-1 rounded-full text-xs font-semibold border bg-red-100 text-red-700 border-red-200">
            Inactif
          </span>
        ),
    },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      render: (item: StaffMember) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <MoreVertical className="w-4 h-4 text-gray-600" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => handleEditClick(item)}>
              <Edit2 className="w-4 h-4 mr-2" />
              Modifier
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleDeleteClick(item)}
              className="text-red-600"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const filters = [
    {
      key: "role",
      label: "Filtrer par rôle",
      options: [
        { value: "all", label: "Tous les rôles" },
        ...ROLE_OPTIONS.map((r) => ({ value: r.value, label: r.label })),
      ],
    },
    {
      key: "status",
      label: "Filtrer par statut",
      options: [
        { value: "all", label: "Tous les statuts" },
        { value: "active", label: "Actifs" },
        { value: "inactive", label: "Inactifs" },
      ],
    },
  ];

  return (
    <>
      <header className="p-4 md:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2
              className="text-4xl md:text-5xl mb-2"
              style={{ fontFamily: '"Great Vibes", cursive', color: "#C5A065" }}
            >
              Gestion du Personnel
            </h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Créer et gérer les comptes du personnel
            </p>
          </div>
          <button
            onClick={() => {
              resetForm();
              setIsCreateModalOpen(true);
            }}
            className="flex items-center gap-2 bg-[#C5A065] hover:bg-[#2D2A26] text-white font-bold px-4 md:px-6 py-2.5 md:py-3 rounded-xl transition-all duration-300 hover:shadow-lg text-sm md:text-base whitespace-nowrap"
          >
            <Plus size={20} />
            <span>Ajouter un membre</span>
          </button>
        </div>
      </header>

      <div className="p-4 md:p-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-[#C5A065] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <DataTable
            data={staff}
            columns={columns}
            filters={filters}
            searchPlaceholder="Rechercher un membre du personnel..."
            searchKeys={["name", "email", "phone"]}
            itemsPerPage={10}
            selectable={false}
          />
        )}
      </div>

      {/* Create Staff Modal */}
      <Modal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        type="form"
        title="Ajouter un membre du personnel"
        description="Créer un compte avec email, mot de passe et rôle. Le compte sera vérifié automatiquement."
        icon={<Users className="h-6 w-6 text-[#C5A065]" />}
        actions={{
          primary: {
            label: "Créer le compte",
            onClick: handleCreate,
            disabled: isSubmitting,
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsCreateModalOpen(false);
              resetForm();
            },
            disabled: isSubmitting,
          },
        }}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Nom complet <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              placeholder="Ex: Marie Dubois"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              placeholder="Ex: marie.dubois@mariusetfanny.com"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Mot de passe <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full p-3 pr-10 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
                placeholder="Min. 6 caractères"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-500 hover:text-[#C5A065]"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-stone-500 flex items-center gap-1">
              <Lock size={11} /> Le mot de passe sera utilisé pour la connexion
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Rôle <span className="text-red-500">*</span>
            </label>
            <select
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all cursor-pointer"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Téléphone
            </label>
            <input
              type="tel"
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              placeholder="Ex: 514-555-0101"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        type="form"
        title="Modifier le membre du personnel"
        description="Modifier les informations du compte"
        icon={<Edit2 className="h-6 w-6 text-blue-500" />}
        actions={{
          primary: {
            label: "Enregistrer",
            onClick: handleEdit,
            disabled: isSubmitting,
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsEditModalOpen(false);
              resetForm();
            },
            disabled: isSubmitting,
          },
        }}
      >
        <div className="space-y-5">
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Nom complet
            </label>
            <input
              type="text"
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Email
            </label>
            <input
              type="email"
              className="w-full p-3 bg-stone-100 border border-stone-200 rounded-xl text-sm text-stone-500 cursor-not-allowed"
              value={formData.email}
              disabled
            />
            <p className="text-xs text-stone-500">L'email ne peut pas être modifié</p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Rôle
            </label>
            <select
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all cursor-pointer"
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value })}
            >
              {ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-stone-600">
              Téléphone
            </label>
            <input
              type="tel"
              className="w-full p-3 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-[#C5A065] focus:border-transparent outline-none text-sm transition-all"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
            />
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        type="warning"
        title="Supprimer le membre du personnel"
        description={
          deletingStaff
            ? `Êtes-vous sûr de vouloir supprimer ${deletingStaff.name} ? Cette action est irréversible.`
            : ""
        }
        closable={!isSubmitting}
        actions={{
          primary: {
            label: "Supprimer",
            onClick: handleDelete,
            variant: "destructive",
            disabled: isSubmitting,
            loading: isSubmitting,
          },
          secondary: {
            label: "Annuler",
            onClick: () => {
              setIsDeleteModalOpen(false);
              setDeletingStaff(null);
            },
            disabled: isSubmitting,
          },
        }}
      >
        {deletingStaff && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Trash2 className="text-red-600 shrink-0 mt-0.5" size={20} />
              <div className="text-sm text-red-700 space-y-1">
                <p><strong>Nom:</strong> {deletingStaff.name}</p>
                <p><strong>Email:</strong> {deletingStaff.email}</p>
                <p><strong>Rôle:</strong> {getRoleLabel(deletingStaff.role)}</p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Error Modal */}
      <Modal
        open={isErrorModalOpen}
        onOpenChange={setIsErrorModalOpen}
        type="warning"
        title="Erreur"
        actions={{
          primary: {
            label: "OK",
            onClick: () => setIsErrorModalOpen(false),
          },
        }}
      >
        <p className="text-sm text-gray-700">{errorMessage}</p>
      </Modal>
    </>
  );
}
