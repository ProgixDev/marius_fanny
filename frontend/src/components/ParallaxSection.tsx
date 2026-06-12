import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import GoldenBackground from './GoldenBackground';
import { useSettings } from '../lib/SettingsContext';

import {
  Mail,
  Phone,
  CheckCircle,
  ChefHat,
  Truck,
  Clock,
  Star,
  Send
} from 'lucide-react';

interface FormData {
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  businessType: string;
  message: string;
}

const WholesaleSection = () => {
  const settings = useSettings();
  const [formData, setFormData] = useState<FormData>({
    companyName: '',
    contactName: '',
    email: '',
    phone: '',
    businessType: '',
    message: ''
  });

  const [isSubmitted, setIsSubmitted] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const businessTypes = [
    'Restaurant / Brasserie',
    'Hôtel / Hébergement',
    'Traiteur / Événementiel',
    'Épicerie Fine',
    'Boutique / Revendeur',
    'Café / Salon de thé',
    'Autre'
  ];

  const valueProps = [
    {
      icon: <ChefHat size={32} />,
      title: "Savoir-faire Artisanal",
      desc: "Des créations authentiques, faites maison chaque jour avec des ingrédients de première qualité."
    },
    {
      icon: <Clock size={32} />,
      title: "Fraîcheur Quotidienne",
      desc: "Production à la demande pour garantir une expérience gustative optimale à vos clients."
    },
    {
      icon: <Star size={32} />,
      title: "Offre Sur-mesure",
      desc: "Nous adaptons nos volumes et nos créations selon les besoins spécifiques de votre établissement."
    },
    {
      icon: <Truck size={32} />,
      title: "Fiabilité & Logistique",
      desc: "Une livraison ponctuelle et soignée pour assurer la continuité de votre service."
    }
  ];

  const handleInputChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    try {
      const apiBase = import.meta.env.VITE_API_URL || '';
      const res = await fetch(`${apiBase}/api/partner-request/inquiry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.message || 'Une erreur est survenue. Veuillez réessayer.');
        return;
      }
      setIsSubmitted(true);
    } catch {
      setError('Impossible de contacter le serveur. Vérifiez votre connexion.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <section id="devenir-partenaire" className="relative min-h-screen bg-[#F9F7F2] text-[#2D2A26] overflow-hidden selection:bg-[#337957] selection:text-white">
      
      {/* --- INTÉGRATION DU BACKGROUND --- */}
      {/* On place le composant ici. Il doit être en absolute inset-0 dans son propre code 
          ou contenu dans une div absolute ici si besoin. 
          Je suppose ici qu'il gère son propre positionnement ou qu'il remplit le conteneur relative. */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <GoldenBackground />
      </div>
      
      {/* J'ai supprimé les anciens divs de bruit (SVG) et les cercles flous 
          pour laisser la place à votre GoldenBackground */}

      <div className="relative z-10 max-w-7xl mx-auto px-6 py-24">

        <div className="text-center mb-24 animate-fadeInUp">
          <div className="inline-block mb-6">
            <span className="bg-[#337957] text-white font-black text-xs md:text-sm uppercase tracking-[0.3em] px-6 py-2 rounded-full shadow-lg">
              Espace Professionnel
            </span>
          </div>
          
          <h1 
            className="text-3xl md:text-4xl lg:text-5xl mb-6"
            style={{ fontFamily: '"Great Vibes", cursive', color: '#337957' }}
          >
            L'excellence pour vos clients
          </h1>
          
          <p className="text-lg md:text-xl text-[#2D2A26]/80 max-w-3xl mx-auto leading-relaxed font-light mb-10">
            Devenez partenaire de Marius et Fanny. Offrez à votre clientèle le goût authentique 
            de la pâtisserie artisanale, sans les contraintes de production.
          </p>

          <a 
            href="#inscription"
            className="inline-flex items-center gap-2 bg-[#2D2A26] text-white px-10 py-5 rounded-full font-bold uppercase text-sm tracking-widest hover:bg-[#337957] transition-all duration-300 shadow-xl hover:scale-105"
          >
            Demander l'accès
            <Send size={16} />
          </a>
        </div>

        <div className="mb-32">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-black uppercase tracking-tight mb-4">
              Pourquoi nous <span className="text-[#337957] underline decoration-4 decoration-[#337957]/30 underline-offset-4">rejoindre ?</span>
            </h2>
            <p className="text-[#2D2A26]/60">Un partenariat pensé pour votre réussite</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {valueProps.map((prop, idx) => (
              <div 
                key={idx} 
                className="bg-white/80 backdrop-blur-md p-8 rounded-3xl border border-[#337957]/20 hover:border-[#337957] transition-all duration-300 hover:shadow-xl hover:-translate-y-1 group"
              >
                <div className="w-16 h-16 bg-[#337957]/10 rounded-2xl flex items-center justify-center text-[#337957] mb-6 group-hover:bg-[#337957] group-hover:text-white transition-colors duration-300">
                  {prop.icon}
                </div>
                <h3 className="font-bold text-lg uppercase mb-3 text-[#2D2A26] tracking-wide">
                  {prop.title}
                </h3>
                <p className="text-sm text-[#2D2A26]/70 leading-relaxed">
                  {prop.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div id="inscription" className="max-w-5xl mx-auto">
          <div className="bg-white/95 backdrop-blur-sm rounded-[2.5rem] p-8 md:p-16 shadow-2xl border border-gray-100 relative overflow-hidden">
            
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#337957] opacity-5 rounded-bl-full pointer-events-none"></div>

            <div className="grid lg:grid-cols-5 gap-12">
              
              <div className="lg:col-span-2 space-y-8">
                <div>
                  <h2 className="text-3xl md:text-4xl font-black mb-4 uppercase tracking-tight text-[#2D2A26]">
                    Ouvrir un <br/>
                    <span className="text-[#337957]">Compte Pro</span>
                  </h2>
                  <p className="text-[#2D2A26]/70 leading-relaxed">
                    Remplissez ce formulaire pour initier notre partenariat.
                  </p>
                </div>

                <div className="space-y-6 pt-6 border-t border-gray-100">
                  <div className="flex items-start gap-4">
                   
                     
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="p-3 bg-[#F9F7F2] rounded-full">
                      <Phone className="text-[#337957]" size={20} />
                    </div>
                    <div>
                      <div className="text-xs text-[#2D2A26]/50 uppercase tracking-wider font-bold mb-1">Téléphone</div>
                      <div className="font-bold text-[#2D2A26]">Montréal : {settings.contactPhoneMontreal}</div>
                      <div className="font-bold text-[#2D2A26]">Laval : {settings.contactPhone}</div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="lg:col-span-3">
                {isSubmitted ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 bg-[#F9F7F2] rounded-3xl animate-fadeIn">
                    <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                      <CheckCircle size={40} className="text-green-600" />
                    </div>
                    <h3 className="text-2xl font-black mb-3 text-[#2D2A26]">Demande Transmise !</h3>
                    <p className="text-[#2D2A26]/70">
                      Merci de votre confiance. Nous étudions votre profil et vous revenons très vite.
                    </p>
                  </div>
                ) : (
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-[#2D2A26]/80 ml-1">
                          Entreprise *
                        </label>
                        <input
                          type="text"
                          name="companyName"
                          value={formData.companyName}
                          onChange={handleInputChange}
                          required
                          className="w-full bg-[#F9F7F2] border border-gray-200 rounded-xl px-5 py-4 text-[#2D2A26] placeholder-gray-400 focus:border-[#337957] focus:outline-none focus:ring-4 focus:ring-[#337957]/10 transition-all font-medium"
                          placeholder="Nom de votre société"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-[#2D2A26]/80 ml-1">
                          Interlocuteur *
                        </label>
                        <input
                          type="text"
                          name="contactName"
                          value={formData.contactName}
                          onChange={handleInputChange}
                          required
                          className="w-full bg-[#F9F7F2] border border-gray-200 rounded-xl px-5 py-4 text-[#2D2A26] placeholder-gray-400 focus:border-[#337957] focus:outline-none focus:ring-4 focus:ring-[#337957]/10 transition-all font-medium"
                          placeholder="Votre nom complet"
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-5">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-[#2D2A26]/80 ml-1">
                          Email Pro *
                        </label>
                        <input
                          type="email"
                          name="email"
                          value={formData.email}
                          onChange={handleInputChange}
                          required
                          className="w-full bg-[#F9F7F2] border border-gray-200 rounded-xl px-5 py-4 text-[#2D2A26] placeholder-gray-400 focus:border-[#337957] focus:outline-none focus:ring-4 focus:ring-[#337957]/10 transition-all font-medium"
                          placeholder="contact@societe.com"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase tracking-wider text-[#2D2A26]/80 ml-1">
                          Téléphone *
                        </label>
                        <input
                          type="tel"
                          name="phone"
                          value={formData.phone}
                          onChange={handleInputChange}
                          required
                          className="w-full bg-[#F9F7F2] border border-gray-200 rounded-xl px-5 py-4 text-[#2D2A26] placeholder-gray-400 focus:border-[#337957] focus:outline-none focus:ring-4 focus:ring-[#337957]/10 transition-all font-medium"
                          placeholder="+1 XXX XXX XXXX"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-[#2D2A26]/80 ml-1">
                        Type d'activité *
                      </label>
                      <div className="relative">
                        <select
                          name="businessType"
                          value={formData.businessType}
                          onChange={handleInputChange}
                          required
                          className="w-full bg-[#F9F7F2] border border-gray-200 rounded-xl px-5 py-4 text-[#2D2A26] appearance-none focus:border-[#337957] focus:outline-none focus:ring-4 focus:ring-[#337957]/10 transition-all font-medium cursor-pointer"
                        >
                          <option value="">Sélectionnez votre activité...</option>
                          {businessTypes.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                        <div className="absolute right-5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                          ▼
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-wider text-[#2D2A26]/80 ml-1">
                        Votre Projet
                      </label>
                      <textarea
                        name="message"
                        value={formData.message}
                        onChange={handleInputChange}
                        rows={4}
                        className="w-full bg-[#F9F7F2] border border-gray-200 rounded-xl px-5 py-4 text-[#2D2A26] placeholder-gray-400 focus:border-[#337957] focus:outline-none focus:ring-4 focus:ring-[#337957]/10 transition-all font-medium resize-none"
                        placeholder="Dites-nous en plus sur vos besoins (volumes estimés, fréquence de livraison...)"
                      />
                    </div>

                    {error && (
                      <p className="text-red-600 text-sm font-medium text-center bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                        {error}
                      </p>
                    )}

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full bg-[#337957] text-white py-5 rounded-xl font-black uppercase text-sm tracking-widest hover:bg-[#2D2A26] transition-all duration-300 shadow-lg hover:shadow-xl mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isLoading ? 'Envoi en cours...' : 'Demander l\'accès'}
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(30px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .animate-fadeInUp {
          animation: fadeInUp 0.8s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .animate-fadeIn {
          animation: fadeIn 0.5s ease-out;
        }
      `}</style>
    </section>
  );
};

export default WholesaleSection;
