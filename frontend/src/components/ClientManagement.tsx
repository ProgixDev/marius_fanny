import { useState, useEffect } from "react";
import {
  Plus,
  Eye,
  Edit,
  Trash2,
  MoreVertical,
  UserCheck,
  UserX,
  Mail,
  Phone,
  MapPin,
  Calendar,
  ShoppingBag,
  UserCircle,
  Package,
  DollarSign,
  Edit2,
  Download,
} from "lucide-react";
import { DataTable } from "./ui/DataTable";
import { Modal } from "./ui/modal";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import type { Client, ClientFormData, Order } from "../types";
import { MOCK_CLIENTS } from "../data";
import { clientAPI, type Client as ClientType } from "../lib/ClientAPI";

function ClientManagement() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const data = await clientAPI.getClients(1, 100);
      console.log("Clients fetched successfully:", data);
      setClients(data.clients || []);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch clients - full error:", err);
      setError("Erreur lors du chargement des clients");
      // Fallback to mock data if API fails
      setClients([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [viewingClient, setViewingClient] = useState<Client | null>(null);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    status: "active" as "active" | "inactive" | "placeholder",
    billingKind: "standard" as "standard" | "representant" | "gouvernement",
    billingOrganization: "",
    billingInvoiceEmail: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);

  const resetForm = () => {
    setFormData({
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      status: "active",
      billingKind: "standard",
      billingOrganization: "",
      billingInvoiceEmail: "",
    });
  };

  const handleInputChange = (field: keyof typeof formData, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const validateForm = (): string | null => {
    if (!formData.firstName.trim()) {
      return "Le prénom est requis";
    }
    if (!formData.lastName.trim()) {
      return "Le nom de famille est requis";
    }
    // Phone is no longer strictly required at creation — clients who self-sign
    // up online rarely give one, and we only need it later if/when sending a
    // Square payment link by SMS. Admin can always come back and add it.
    if (formData.status !== "placeholder" && !formData.email.trim()) {
      return "L'email est requis pour les clients actifs";
    }
    if (
      formData.status !== "placeholder" &&
      formData.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)
    ) {
      return "Email invalide";
    }
    if (formData.billingKind === "gouvernement" && !formData.billingOrganization.trim()) {
      return "L'organisation est requise pour un client gouvernemental";
    }
    return null;
  };

  const handleCreate = async () => {
    const error = validateForm();
    if (error) {
      setErrorMessage(error);
      setIsErrorModalOpen(true);
      return;
    }

    setIsSubmitting(true);
    try {
      await clientAPI.createClient({
        email: formData.email,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        status: formData.status,
        billing: {
          kind: formData.billingKind,
          organization: formData.billingOrganization || undefined,
          invoiceEmail: formData.billingInvoiceEmail || undefined,
        },
      });
      setIsCreateModalOpen(false);
      resetForm();
      await fetchClients();
    } catch (err) {
      console.error("Failed to create client:", err);
      setErrorMessage("Erreur lors de la création du client");
      setIsErrorModalOpen(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditClick = (client: Client) => {
    setEditingClient(client);
    setFormData({
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      phone: client.phone,
      status: client.status,
      billingKind: client.billing?.kind || "standard",
      billingOrganization: client.billing?.organization || "",
      billingInvoiceEmail: client.billing?.invoiceEmail || "",
    });
    setIsEditModalOpen(true);
  };

  const handleEdit = async () => {
    if (!editingClient) return;

    const error = validateForm();
    if (error) {
      setErrorMessage(error);
      setIsErrorModalOpen(true);
      return;
    }

    setIsSubmitting(true);
    try {
      await clientAPI.updateClient(editingClient.id, {
        email: formData.email,
        firstName: formData.firstName,
        lastName: formData.lastName,
        phone: formData.phone,
        status: formData.status,
        billing: {
          kind: formData.billingKind,
          organization: formData.billingOrganization || undefined,
          invoiceEmail: formData.billingInvoiceEmail || undefined,
        },
      });
      setClients(
        clients.map((client) =>
          client.id === editingClient.id
            ? {
                ...client,
                firstName: formData.firstName,
                lastName: formData.lastName,
                email: formData.email,
                phone: formData.phone,
                status: formData.status,
                billing: {
                  kind: formData.billingKind,
                  organization: formData.billingOrganization || undefined,
                  invoiceEmail: formData.billingInvoiceEmail || undefined,
                  paymentTermsDays: formData.billingKind === "gouvernement" ? 180 : 0,
                  allowUnpaidOrders: formData.billingKind !== "standard",
                },
                updatedAt: new Date().toISOString(),
              }
            : client,
        ),
      );
      setIsEditModalOpen(false);
      setEditingClient(null);
      resetForm();
    } catch (err: any) {
      setErrorMessage(err.message || "Erreur lors de la modification du client");
      setIsErrorModalOpen(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteClick = (client: Client) => {
    setDeletingClient(client);
    setIsDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!deletingClient) return;

    setIsSubmitting(true);
    try {
      await clientAPI.deleteClient(deletingClient.id);
      setClients(clients.filter((client) => client.id !== deletingClient.id));
      setIsDeleteModalOpen(false);
      setDeletingClient(null);
    } catch (err: any) {
      setErrorMessage(err.message || "Erreur lors de la suppression du client");
      setIsErrorModalOpen(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDetailsClick = (client: Client) => {
    setViewingClient(client);
    setIsDetailsModalOpen(true);
  };

  const handleToggleStatus = async (client: Client) => {
    const newStatus = client.status === "active" ? "inactive" : "active";
    try {
      await clientAPI.updateClient(client.id, { status: newStatus });
      setClients(
        clients.map((c) =>
          c.id === client.id
            ? {
                ...c,
                status: newStatus,
                updatedAt: new Date().toISOString(),
              }
            : c,
        ),
      );
    } catch (err: any) {
      setErrorMessage(err.message || "Erreur lors du changement de statut");
      setIsErrorModalOpen(true);
    }
  };

  const getFullName = (client: Client) => {
    return `${client.firstName} ${client.lastName}`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("fr-CA", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const getOrderStatusLabel = (status: Order["status"]) => {
    const labels: Record<Order["status"], string> = {
      pending: "En attente",
      confirmed: "Confirmée",
      in_production: "En production",
      ready: "Prête",
      completed: "Complétée",
      cancelled: "Annulée",
      delivered: "Livrée",
    };
    return labels[status];
  };

  const getOrderStatusColor = (status: Order["status"]) => {
    const colors: Record<Order["status"], string> = {
      pending: "bg-yellow-100 text-yellow-800",
      confirmed: "bg-blue-100 text-blue-800",
      in_production: "bg-purple-100 text-purple-800",
      ready: "bg-green-100 text-green-800",
      completed: "bg-gray-100 text-gray-800",
      cancelled: "bg-red-100 text-red-800",
      delivered: "bg-teal-100 text-teal-800",
    };
    return colors[status];
  };

  const isArchivedOrderStatus = (status: Order["status"]) =>
    status === "completed" || status === "delivered";

  const clientOrders = Array.isArray(viewingClient?.orders) ? viewingClient?.orders : [];
  const activeOrders = clientOrders.filter((order: any) => !isArchivedOrderStatus(order.status));
  const archivedOrders = clientOrders.filter((order: any) => isArchivedOrderStatus(order.status));

  const columns = [
    {
      key: "name",
      label: "Nom",
      sortable: true,
      render: (client: Client) => (
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-[#C5A065] bg-opacity-20 flex items-center justify-center">
            <UserCircle size={14} className="text-[#C5A065]" />
          </div>
          <div>
            <div>
              <div className="font-medium text-[#2D2A26]">
                {getFullName(client)}
              </div>
              {client.status === "placeholder" && (
                <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full inline-block mt-1">
                  Placeholder
                </span>
              )}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: "email",
      label: "Email",
      sortable: true,
      render: (client: Client) => (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Mail size={14} className="text-gray-400" />
          <span>{client.email}</span>
        </div>
      ),
    },
    {
      key: "phone",
      label: "Téléphone",
      sortable: true,
      render: (client: Client) => (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <Phone size={14} className="text-gray-400" />
          <span>{client.phone}</span>
        </div>
      ),
    },
    {
      key: "billing",
      label: "Paiement",
      sortable: true,
      render: (client: Client) => {
        const kind = client.billing?.kind || "standard";
        const label =
          kind === "representant"
            ? "Représentant (jour même)"
            : kind === "gouvernement"
              ? `Gouvernemental (60j)${client.billing?.organization ? ` • ${client.billing.organization}` : ""}`
              : "Standard";
        const classes =
          kind === "representant"
            ? "bg-blue-50 text-blue-700 border-blue-200"
            : kind === "gouvernement"
              ? "bg-purple-50 text-purple-700 border-purple-200"
              : "bg-stone-50 text-stone-700 border-stone-200";
        return (
          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold border ${classes}`}>
            {label}
          </span>
        );
      },
    },
    {
      key: "orders",
      label: "Commandes",
      sortable: true,
      render: (client: Client) => (
        <div className="flex items-center gap-2">
          <Package size={14} className="text-[#C5A065]" />
          <span className="font-medium text-[#2D2A26]">
            {(client.orders || []).length}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      label: "Statut",
      sortable: true,
      render: (client: Client) => (
        <button
          onClick={() => handleToggleStatus(client)}
          className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
            client.status === "active"
              ? "bg-green-100 text-green-800 hover:bg-green-200"
              : client.status === "placeholder"
                ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                : "bg-gray-100 text-gray-800 hover:bg-gray-200"
          }`}
        >
          {client.status === "active"
            ? "Actif"
            : client.status === "placeholder"
              ? "Placeholder"
              : "Inactif"}
        </button>
      ),
    },
    {
      key: "actions",
      label: "Actions",
      sortable: false,
      render: (client: Client) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
              <MoreVertical className="w-4 h-4 text-gray-600" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => handleDetailsClick(client)}>
              <Eye className="w-4 h-4 mr-2" />
              Voir détails
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleEditClick(client)}>
              <Edit2 className="w-4 h-4 mr-2" />
              Modifier
            </DropdownMenuItem>
            {client.status !== "placeholder" && (
              <DropdownMenuItem
                onClick={() => handleToggleStatus(client)}
                className="text-orange-600"
              >
                <UserCircle className="w-4 h-4 mr-2" />
                {client.status === "active" ? "Désactiver" : "Activer"}
              </DropdownMenuItem>
            )}
            {client.status === "placeholder" && (
              <DropdownMenuItem
                onClick={() => {
                  setClients(
                    clients.map((c) =>
                      c.id === client.id
                        ? {
                            ...c,
                            status: "active",
                            updatedAt: new Date().toISOString(),
                          }
                        : c,
                    ),
                  );
                }}
                className="text-green-600"
              >
                <UserCircle className="w-4 h-4 mr-2" />
                Convertir en client actif
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => handleDeleteClick(client)}
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
      key: "status",
      label: "Filtrer par statut du compte",
      options: [
        { value: "all", label: "Tous les statuts" },
        { value: "active", label: "Comptes actifs" },
        { value: "placeholder", label: "Placeholders" },
        { value: "inactive", label: "Comptes inactifs" },
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
              Gestion des Clients
            </h2>
            <p className="text-[9px] font-black uppercase tracking-[0.3em] text-stone-500">
              Gérer les clients et les placeholders
            </p>
          </div>
          <div className="flex items-center gap-3">
          <button
            onClick={async () => {
              const XLSX = await import("xlsx");
              const data = clients.map((c) => ({
                "Nom": c.lastName,
                "Prénom": c.firstName,
                "Email": c.email,
                "Téléphone": c.phone,
                "Statut": c.status,
                "Type": c.billing?.kind || "standard",
                "Date création": new Date(c.createdAt).toLocaleDateString("fr-CA"),
              }));
              const ws = XLSX.utils.json_to_sheet(data);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, "Clients");
              XLSX.writeFile(wb, `clients_${new Date().toISOString().split("T")[0]}.xlsx`);
            }}
            className="flex items-center gap-2 bg-white border border-stone-200 text-stone-600 hover:bg-stone-50 font-bold px-4 md:px-6 py-2.5 md:py-3 rounded-xl transition-all duration-300 text-sm md:text-base whitespace-nowrap"
          >
            <Download size={20} />
            <span className="hidden md:inline">Exporter</span>
          </button>
          <button
            onClick={() => {
              resetForm();
              setIsCreateModalOpen(true);
            }}
            className="flex items-center gap-2 bg-[#C5A065] hover:bg-[#2D2A26] text-white font-bold px-4 md:px-6 py-2.5 md:py-3 rounded-xl transition-all duration-300 hover:shadow-lg text-sm md:text-base whitespace-nowrap"
          >
            <Plus size={20} />
            <span>Nouveau Client</span>
          </button>
          </div>
        </div>
      </header>

      <div className="p-4 md:p-8">
        <DataTable
          data={clients}
          columns={columns}
          filters={filters}
          searchPlaceholder="Rechercher un client..."
          searchKeys={["firstName", "lastName", "email", "phone"]}
          itemsPerPage={10}
          selectable={false}
        />
      </div>

      {/* Create Modal */}
      <Modal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        type="form"
        title="Nouveau Client"
        description="Créer un nouveau client ou placeholder pour les commandes téléphoniques"
        icon={<UserCircle className="h-6 w-6 text-(--bakery-gold)" />}
        actions={{
          primary: {
            label: "Créer",
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
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Prénom <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => handleInputChange("firstName", e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
                placeholder="Ex: Marie"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Nom de famille <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => handleInputChange("lastName", e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
                placeholder="Ex: Dubois"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Email{" "}
              {formData.status !== "placeholder" && (
                <span className="text-red-500">*</span>
              )}
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange("email", e.target.value)}
              disabled={formData.status === "placeholder"}
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
              placeholder={
                formData.status === "placeholder"
                  ? "Non requis pour placeholder"
                  : "Ex: client@example.com"
              }
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Téléphone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => handleInputChange("phone", e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
              placeholder="Ex: 514-555-0123"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Type de paiement
            </label>
            <select
              value={formData.billingKind}
              onChange={(e) => handleInputChange("billingKind", e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
            >
              <option value="standard">Standard (paiement requis)</option>
              <option value="representant">Représentant (paye le jour même)</option>
              <option value="gouvernement">Gouvernemental (net 30)</option>
            </select>
            {formData.billingKind === "gouvernement" && (
              <div className="mt-3 space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Organisation <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.billingOrganization}
                  onChange={(e) =>
                    handleInputChange("billingOrganization", e.target.value)
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
                  placeholder="Ex: Ville de la Vallée, Commission scolaire de Laval"
                />
                <label className="text-sm font-medium text-gray-700">
                  Courriel de facturation (ville)
                </label>
                <input
                  type="email"
                  value={formData.billingInvoiceEmail}
                  onChange={(e) =>
                    handleInputChange("billingInvoiceEmail", e.target.value)
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
                  placeholder="comptes@ville.ca — reçoit la facture"
                />
              </div>
            )}
            <p className="text-xs text-gray-500">
              Représentant et Gouvernemental peuvent commander sans paiement immédiat.
            </p>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={isEditModalOpen}
        onOpenChange={setIsEditModalOpen}
        type="form"
        title="Modifier Client"
        description="Modifier les informations du client"
        icon={<Edit2 className="h-6 w-6 text-(--bakery-gold)" />}
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
              setEditingClient(null);
              resetForm();
            },
            disabled: isSubmitting,
          },
          tertiary: editingClient
            ? {
                label:
                  editingClient.status === "active" ? "Désactiver" : "Activer",
                onClick: () => {
                  if (editingClient) {
                    handleToggleStatus(editingClient);
                    setIsEditModalOpen(false);
                    setEditingClient(null);
                    resetForm();
                  }
                },
                variant: "outline" as const,
                disabled: isSubmitting,
              }
            : undefined,
        }}
      >
        <div className="space-y-4">
          {editingClient?.status === "placeholder" && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-800">
                Ce client est un placeholder. Utilisez le bouton dans le menu
                d'actions pour le convertir en client actif.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Prénom <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => handleInputChange("firstName", e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
                placeholder="Ex: Marie"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                Nom de famille <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => handleInputChange("lastName", e.target.value)}
                className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
                placeholder="Ex: Dubois"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Email{" "}
              {formData.status !== "placeholder" && (
                <span className="text-red-500">*</span>
              )}
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => handleInputChange("email", e.target.value)}
              disabled={formData.status === "placeholder"}
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm disabled:bg-gray-100 disabled:cursor-not-allowed"
              placeholder={
                formData.status === "placeholder"
                  ? "Non requis pour placeholder"
                  : "Ex: client@example.com"
              }
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Téléphone <span className="text-red-500">*</span>
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => handleInputChange("phone", e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
              placeholder="Ex: 514-555-0123"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700">
              Type de paiement
            </label>
            <select
              value={formData.billingKind}
              onChange={(e) => handleInputChange("billingKind", e.target.value)}
              className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
            >
              <option value="standard">Standard (paiement requis)</option>
              <option value="representant">Représentant (paye le jour même)</option>
              <option value="gouvernement">Gouvernemental (net 30)</option>
            </select>
            {formData.billingKind === "gouvernement" && (
              <div className="mt-3 space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Organisation <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.billingOrganization}
                  onChange={(e) =>
                    handleInputChange("billingOrganization", e.target.value)
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
                  placeholder="Ex: Ville de la Vallée, Commission scolaire de Laval"
                />
                <label className="text-sm font-medium text-gray-700">
                  Courriel de facturation (ville)
                </label>
                <input
                  type="email"
                  value={formData.billingInvoiceEmail}
                  onChange={(e) =>
                    handleInputChange("billingInvoiceEmail", e.target.value)
                  }
                  className="w-full p-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-[#C5A065]/50 outline-none text-sm"
                  placeholder="comptes@ville.ca — reçoit la facture"
                />
              </div>
            )}
          </div>

          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">
                  Statut actuel
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  Utilisez le bouton ci-dessous pour changer le statut
                </p>
              </div>
              <span
                className={`px-3 py-1 rounded-full text-sm font-medium ${
                  formData.status === "active"
                    ? "bg-green-100 text-green-800"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {formData.status === "active" ? "Actif" : "Inactif"}
              </span>
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={isDeleteModalOpen}
        onOpenChange={setIsDeleteModalOpen}
        type="warning"
        title="Confirmer la suppression"
        description="Cette action est irréversible"
        icon={<Trash2 className="h-6 w-6 text-red-600" />}
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
              setDeletingClient(null);
            },
            disabled: isSubmitting,
          },
        }}
      >
        {deletingClient && (
          <div className="space-y-4">
            <p className="text-gray-700">
              Êtes-vous sûr de vouloir supprimer ce client ?
            </p>
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <div className="space-y-2">
                <p className="font-medium text-gray-900">
                  {getFullName(deletingClient)}
                </p>
                <p className="text-sm text-gray-600">
                  Email: {deletingClient.email || "Non renseigné"}
                </p>
                <p className="text-sm text-gray-600">
                  Téléphone: {deletingClient.phone}
                </p>
                <p className="text-sm text-gray-600">
                  Commandes: {deletingClient.orders?.length || 0}
                </p>
              </div>
            </div>
            <p className="text-sm text-red-600">
              Cette action est irréversible. Toutes les données associées à ce
              client seront perdues.
            </p>
          </div>
        )}
      </Modal>

      {/* Details Modal */}
      <Modal
        open={isDetailsModalOpen}
        onOpenChange={setIsDetailsModalOpen}
        type="details"
        title="Détails du Client"
        description="Profil complet, commandes et adresses"
        icon={<Eye className="h-6 w-6 text-(--bakery-gold)" />}
        size="xl"
        actions={{
          secondary: {
            label: "Fermer",
            onClick: () => {
              setIsDetailsModalOpen(false);
              setViewingClient(null);
            },
          },
        }}
      >
        {viewingClient && (
          <div className="space-y-6">
            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Commandes</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {activeOrders.length}
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      Total: {clientOrders.length} • Terminées: {archivedOrders.length}
                    </p>
                  </div>
                  <Package className="w-8 h-8 text-[#C5A065]" />
                </div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Total dépensé</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {(viewingClient.orders || [])
                        .reduce((sum, order) => sum + (order.total || 0), 0)
                        .toFixed(2)}{" "}
                      $
                    </p>
                  </div>
                  <DollarSign className="w-8 h-8 text-[#C5A065]" />
                </div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Adresses</p>
                    <p className="text-2xl font-bold text-gray-900 mt-1">
                      {viewingClient.addresses?.length || 0}
                    </p>
                  </div>
                  <MapPin className="w-8 h-8 text-[#C5A065]" />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="profile" className="w-full">
              <TabsList className="w-full grid grid-cols-4">
                <TabsTrigger value="profile">Profil</TabsTrigger>
                <TabsTrigger value="orders">
                  Commandes ({activeOrders.length})
                </TabsTrigger>
                <TabsTrigger value="archived">
                  Terminées ({archivedOrders.length})
                </TabsTrigger>
                <TabsTrigger value="addresses">
                  Adresses ({viewingClient.addresses?.length || 0})
                </TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="space-y-4">
                <div className="p-6 bg-linear-to-br from-(--bakery-cream) to-white rounded-xl border border-(--bakery-border)">
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 rounded-full bg-(--bakery-gold) bg-opacity-20 flex items-center justify-center">
                        <UserCircle className="w-10 h-10 text-(--bakery-gold)" />
                      </div>
                      <div>
                        <h3 className="text-2xl font-bold text-(--bakery-text)">
                          {getFullName(viewingClient)}
                        </h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium ${
                              viewingClient.status === "active"
                                ? "bg-green-100 text-green-800"
                                : viewingClient.status === "placeholder"
                                  ? "bg-amber-100 text-amber-800"
                                  : "bg-gray-100 text-gray-800"
                            }`}
                          >
                            {viewingClient.status === "active"
                              ? "Actif"
                              : viewingClient.status === "placeholder"
                                ? "Placeholder"
                                : "Inactif"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-sm text-(--bakery-text-secondary)">
                      <p>Client depuis</p>
                      <p className="font-medium text-(--bakery-text)">
                        {formatDate(viewingClient.createdAt)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                      <Mail className="w-5 h-5 text-(--bakery-gold)" />
                      <div>
                        <p className="text-xs text-(--bakery-text-secondary)">
                          Email
                        </p>
                        <p className="text-sm font-medium text-(--bakery-text)">
                          {viewingClient.email}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 p-3 bg-white rounded-lg">
                      <Phone className="w-5 h-5 text-(--bakery-gold)" />
                      <div>
                        <p className="text-xs text-(--bakery-text-secondary)">
                          Téléphone
                        </p>
                        <p className="text-sm font-medium text-(--bakery-text)">
                          {viewingClient.phone}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="orders" className="space-y-3">
                {activeOrders.length > 0 ? (
                  activeOrders.map((order: any) => (
                    <div
                      key={order.id}
                      className="p-4 bg-white rounded-lg border border-(--bakery-border) hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-medium text-(--bakery-text)">
                            {(() => {
                              const m = (order.orderNumber || "").trim().match(/^MF-\d{8}-(\d{1,4})$/i);
                              return m ? `#${m[1].padStart(4, "0")}` : order.orderNumber;
                            })()}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-sm text-(--bakery-text-secondary)">
                            <Calendar className="w-4 h-4" />
                            {formatDate(order.orderDate)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-2 text-lg font-bold text-(--bakery-text)">
                            <DollarSign className="w-5 h-5 text-(--bakery-gold)" />
                            {order.total.toFixed(2)} $
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${getOrderStatusColor(
                            order.status,
                          )}`}
                        >
                          {getOrderStatusLabel(order.status)}
                        </span>
                        {order.pickupLocation && (
                          <div className="flex items-center gap-2 text-sm text-(--bakery-text-secondary)">
                            <MapPin className="w-4 h-4" />
                            {order.deliveryType === "delivery"
                              ? "Livraison"
                              : order.pickupLocation}
                            {order.pickupDate && (
                              <span>• {formatDate(order.pickupDate)}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {Array.isArray(order.items) && order.items.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-(--bakery-border)">
                          <p className="text-xs text-(--bakery-text-secondary) mb-2">
                            Produits
                          </p>
                          <div className="space-y-1">
                            {order.items.map((item: any, idx: number) => (
                              <div
                                key={item.id ?? `${order.id}-item-${idx}`}
                                className="flex items-start justify-between gap-3 text-sm"
                              >
                                <span className="text-(--bakery-text) truncate">
                                  {item.quantity ?? 1}x{" "}
                                  {item.productName ||
                                    item.product?.name ||
                                    (item.productId != null ? `Produit #${item.productId}` : "Produit")}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-8 bg-gray-50 rounded-lg text-center">
                    <Package className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                    <p className="text-(--bakery-text-secondary)">
                      Aucune commande
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="archived" className="space-y-3">
                {archivedOrders.length > 0 ? (
                  archivedOrders.map((order: any) => (
                    <div
                      key={order.id}
                      className="p-4 bg-white rounded-lg border border-(--bakery-border) hover:shadow-md transition-shadow"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="font-medium text-(--bakery-text)">
                            {(() => {
                              const m = (order.orderNumber || "").trim().match(/^MF-\d{8}-(\d{1,4})$/i);
                              return m ? `#${m[1].padStart(4, "0")}` : order.orderNumber;
                            })()}
                          </p>
                          <div className="flex items-center gap-2 mt-1 text-sm text-(--bakery-text-secondary)">
                            <Calendar className="w-4 h-4" />
                            {formatDate(order.orderDate)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="flex items-center gap-2 text-lg font-bold text-(--bakery-text)">
                            <DollarSign className="w-5 h-5 text-(--bakery-gold)" />
                            {order.total.toFixed(2)} $
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-medium ${getOrderStatusColor(
                            order.status,
                          )}`}
                        >
                          {getOrderStatusLabel(order.status)}
                        </span>
                        {order.pickupLocation && (
                          <div className="flex items-center gap-2 text-sm text-(--bakery-text-secondary)">
                            <MapPin className="w-4 h-4" />
                            {order.deliveryType === "delivery"
                              ? "Livraison"
                              : order.pickupLocation}
                            {order.pickupDate && (
                              <span>• {formatDate(order.pickupDate)}</span>
                            )}
                          </div>
                        )}
                      </div>

                      {Array.isArray(order.items) && order.items.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-(--bakery-border)">
                          <p className="text-xs text-(--bakery-text-secondary) mb-2">
                            Produits
                          </p>
                          <div className="space-y-1">
                            {order.items.map((item: any, idx: number) => (
                              <div
                                key={item.id ?? `${order.id}-item-${idx}`}
                                className="flex items-start justify-between gap-3 text-sm"
                              >
                                <span className="text-(--bakery-text) truncate">
                                  {item.quantity ?? 1}x{" "}
                                  {item.productName ||
                                    item.product?.name ||
                                    (item.productId != null ? `Produit #${item.productId}` : "Produit")}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="p-8 bg-gray-50 rounded-lg text-center">
                    <Package className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                    <p className="text-(--bakery-text-secondary)">
                      Aucune commande terminée
                    </p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="addresses" className="space-y-3">
                {viewingClient.addresses?.length > 0 ? (
                  viewingClient.addresses?.map((address) => (
                    <div
                      key={address.id}
                      className="p-4 bg-white rounded-lg border border-(--bakery-border)"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <span className="px-2 py-1 bg-(--bakery-gold) bg-opacity-20 text-(--bakery-gold) rounded text-xs font-medium">
                          {address.type === "billing"
                            ? "Facturation"
                            : "Livraison"}
                        </span>
                        {address.isDefault && (
                          <span className="text-xs text-(--bakery-text-secondary)">
                            Par défaut
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-(--bakery-text)">
                        {address.street}
                      </p>
                      <p className="text-sm text-(--bakery-text-secondary)">
                        {address.city}, {address.province} {address.postalCode}
                      </p>
                    </div>
                  ))
                ) : (
                  <div className="p-8 bg-gray-50 rounded-lg text-center">
                    <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                    <p className="text-(--bakery-text-secondary)">
                      Aucune adresse enregistrée
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        )}
      </Modal>

      {/* Error Modal */}
      <Modal
        open={isErrorModalOpen}
        onOpenChange={setIsErrorModalOpen}
        type="warning"
        title="Erreur de validation"
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

export default ClientManagement;
