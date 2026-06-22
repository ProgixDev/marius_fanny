import React, { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Phone, Instagram, Send, MapPin, Paperclip, X, Loader2 } from 'lucide-react';
import GoldenBackground from './GoldenBackground';
import { useSettings } from '../lib/SettingsContext';

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
const normalizedApiUrl = API_URL.startsWith("http") ? API_URL : `https://${API_URL}`;

const Contact: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const settings = useSettings();
  const [submitted, setSubmitted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("Renseignement général");
  const [message, setMessage] = useState("");
  const [cvFile, setCvFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("firstName", firstName);
      formData.append("lastName", lastName);
      formData.append("email", email);
      formData.append("subject", subject);
      formData.append("message", message);
      if (cvFile) {
        formData.append("cv", cvFile);
      }

      const res = await fetch(`${normalizedApiUrl}/api/contact`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.success) {
        setSubmitted(true);
        setFirstName("");
        setLastName("");
        setEmail("");
        setSubject("Renseignement général");
        setMessage("");
        setCvFile(null);
      } else {
        setError(data.message || "Erreur lors de l'envoi du message.");
      }
    } catch {
      setError("Impossible de contacter le serveur. Veuillez réessayer.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-[#F9F7F2] to-white relative overflow-hidden">
      <GoldenBackground />

      <nav className="sticky top-0 z-50 bg-white/90 backdrop-blur-sm border-b border-[#337957]/20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center h-16">
            <Link
              to="/"
              className="flex items-center gap-2 text-[#2D2A26] hover:text-[#337957] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="font-semibold uppercase tracking-widest text-xs">Retour à la boutique</span>
            </Link>
          </div>
        </div>
      </nav>

      <header className="relative py-16">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <h1
            className="text-5xl md:text-7xl font-bold mb-4"
            style={{ fontFamily: '"Great Vibes", cursive', color: '#337957' }}
          >
            Contactez-nous
          </h1>
          <p className="text-lg text-[#2D2A26]/70 max-w-2xl mx-auto font-light italic">
            Une question pour un événement spécial ou une commande personnalisée ? Nous sommes à votre écoute.
          </p>
          <div className="mt-8 h-1 w-24 bg-gradient-to-r from-transparent via-[#337957] to-transparent mx-auto"></div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 pb-24 relative z-10">
        <div className="grid lg:grid-cols-3 gap-8">

          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white/80 backdrop-blur-sm p-8 rounded-2xl border border-[#337957]/20 shadow-sm">
              <h3 className="text-xl font-bold mb-6 text-[#2D2A26] uppercase tracking-wider border-b border-[#337957]/20 pb-2">Coordonnées</h3>

              <div className="space-y-6">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#337957]/10 flex items-center justify-center shrink-0">
                    <Phone className="w-5 h-5 text-[#337957]" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#337957] uppercase">Téléphone</p>
                    <p className="text-[#2D2A26] font-medium">Laval: {settings.contactPhone}</p>
                    <p className="text-[#2D2A26] font-medium">Montréal: {settings.contactPhoneMontreal}</p>
                  </div>
                </div>


                <div className="flex items-start gap-4">
               
                  <div>
                    <p className="text-xs font-bold text-[#337957] uppercase">Boutiques</p>
                    <p className="text-[#2D2A26] font-medium">{settings.address}</p>
                    <p className="text-[#2D2A26] font-medium">{settings.addressMontreal}</p>
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-stone-100">
                <p className="text-sm italic text-stone-500 mb-4">Suivez nos créations :</p>
                {settings.instagramUrl && (
                  <a href={settings.instagramUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-3 px-4 py-2 bg-[#337957] text-white rounded-full hover:bg-[#B59055] transition-all">
                    <Instagram className="w-5 h-5" />
                    <span className="font-bold text-sm">Suivez-nous</span>
                  </a>
                )}
              </div>
            </div>
          </div>

          {/* Formulaire (Colonne Droite) */}
          <div className="lg:col-span-2">
            <div className="bg-white p-8 md:p-12 rounded-2xl shadow-xl border border-[#337957]/10">
              {submitted ? (
                <div className="text-center py-12 animate-fade-in">
                  <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <Send className="w-10 h-10" />
                  </div>
                  <h2 className="text-3xl font-serif text-[#2D2A26] mb-4">Message envoyé !</h2>
                  <p className="text-stone-500">Merci de nous avoir contacté. Notre équipe vous répondra dans les plus brefs délais.</p>
                  <button
                    onClick={() => setSubmitted(false)}
                    className="mt-6 text-[#337957] font-bold underline hover:text-[#2D2A26] transition-colors"
                  >
                    Envoyer un autre message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Prénom</label>
                      <input
                        type="text" required
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 px-4 py-3 rounded-lg focus:outline-none focus:border-[#337957] transition-colors"
                        placeholder="Jean"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Nom de famille</label>
                      <input
                        type="text" required
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full bg-stone-50 border border-stone-200 px-4 py-3 rounded-lg focus:outline-none focus:border-[#337957] transition-colors"
                        placeholder="Dupont"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Email</label>
                    <input
                      type="email" required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 px-4 py-3 rounded-lg focus:outline-none focus:border-[#337957] transition-colors"
                      placeholder="jean.dupont@exemple.com"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Sujet</label>
                    <select
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 px-4 py-3 rounded-lg focus:outline-none focus:border-[#337957] transition-colors"
                    >
                      <option>Renseignement général</option>
                      <option>Commande spéciale </option>
                      <option>Service traiteur</option>
                      <option>Réclamation / Qualité</option>
                      <option>Carrière</option>
                      <option>Autre</option>
                    </select>
                  </div>

                  {subject === "Carrière" && (
                    <div className="space-y-2">
                      <label className="text-xs font-bold uppercase tracking-widest text-stone-500">
                        CV (PDF, DOC, DOCX)
                      </label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".pdf,.doc,.docx"
                        className="hidden"
                        onChange={(e) => setCvFile(e.target.files?.[0] || null)}
                      />
                      {cvFile ? (
                        <div className="flex items-center justify-between w-full bg-[#337957]/10 border border-[#337957]/40 px-4 py-3 rounded-lg">
                          <div className="flex items-center gap-2 text-[#2D2A26]">
                            <Paperclip className="w-4 h-4 text-[#337957]" />
                            <span className="text-sm font-medium truncate max-w-xs">{cvFile.name}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => { setCvFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                            className="text-stone-400 hover:text-red-500 transition-colors ml-3"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full flex items-center justify-center gap-3 bg-stone-50 border-2 border-dashed border-[#337957]/40 hover:border-[#337957] hover:bg-[#337957]/5 px-4 py-5 rounded-lg transition-all text-[#337957] font-semibold text-sm"
                        >
                          <Paperclip className="w-5 h-5" />
                          Joindre mon CV
                          <span className="text-stone-400 font-normal">(PDF, DOC, DOCX)</span>
                        </button>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    <label className="text-xs font-bold uppercase tracking-widest text-stone-500">Votre Message</label>
                    <textarea
                      required rows={5}
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full bg-stone-50 border border-stone-200 px-4 py-3 rounded-lg focus:outline-none focus:border-[#337957] transition-colors resize-none"
                      placeholder={subject === "Carrière" ? "Parlez-nous de vous : poste souhaité, expériences, disponibilités…" : "Comment pouvons-nous vous aider ?"}
                    ></textarea>
                  </div>

                  {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
                      {error}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-[#2D2A26] text-white py-4 rounded-full font-black uppercase tracking-widest text-sm hover:bg-[#337957] hover:scale-[1.02] transition-all shadow-lg flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Envoi en cours...
                      </>
                    ) : (
                      <>
                        Envoyer le message
                        <Send className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative bg-[#F9F7F2] text-[#2D2A26] border-t border-[#337957]/20">
        <div className="max-w-7xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-6">
            <p className="text-sm text-[#2D2A26]/70">Copyright {currentYear} | {settings.storeName}</p>
            <div className="flex gap-6 text-xs font-bold uppercase tracking-widest">
              <Link to="/politique-retour" className="hover:text-[#337957]">Politique de retour</Link>
              <span className="text-[#337957]/30">|</span>
              <span className="text-[#2D2A26]/50">Confidentialité</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Contact;
