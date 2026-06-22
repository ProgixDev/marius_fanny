import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import GoldenBackground from "../components/GoldenBackground";
import { ArrowRight, CheckCircle2, Lock } from "lucide-react";

const ResetPassword = () => {
  const { token } = useParams(); 
  const navigate = useNavigate();
  
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'error' | 'success', msg: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      return setStatus({ type: 'error', msg: 'Les mots de passe diffèrent' });
    }

    setLoading(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
      const res = await fetch(`${apiUrl}/api/auth-password/reset_password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword: password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.message);

      setStatus({ type: 'success', msg: 'Mot de passe mis à jour !' });
      setTimeout(() => navigate("/se-connecter"), 3000);
    } catch (err: any) {
      setStatus({ type: 'error', msg: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    /* On enveloppe tout dans une div relative avec un z-index élevé 
       pour être sûr que le contenu passe devant les effets du GoldenBackground
    */
    <div className="relative min-h-screen">
      <GoldenBackground />
      
      <div className="relative z-999 flex items-center justify-center min-h-screen px-4">
        <div className="bg-white/95 p-8 rounded-2xl shadow-2xl w-full max-w-md backdrop-blur-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-serif text-[#337957]">Nouveau départ</h1>
            <p className="text-gray-500 mt-2">Choisissez votre nouveau mot de passe sécurisé</p>
          </div>

          {status?.type === 'success' ? (
            <div className="flex flex-col items-center animate-bounce py-10">
              <CheckCircle2 size={60} color="#337957" />
              <p className="mt-4 font-medium text-lg text-green-600 text-center">{status.msg}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                <input
                  type="password"
                  placeholder="Nouveau mot de passe"
                  className="w-full pl-10 pr-4 py-3 border-b-2 border-gray-200 focus:border-[#337957] outline-none transition-colors bg-transparent"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-3 top-3 text-gray-400" size={18} />
                <input
                  type="password"
                  placeholder="Confirmez le mot de passe"
                  className="w-full pl-10 pr-4 py-3 border-b-2 border-gray-200 focus:border-[#337957] outline-none transition-colors bg-transparent"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                />
              </div>

              {status?.type === 'error' && (
                <p className="text-red-500 text-sm text-center font-medium bg-red-50 p-2 rounded">
                  {status.msg}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#337957] text-white py-4 rounded-full font-bold shadow-lg hover:bg-[#b38f54] transform transition active:scale-95 flex items-center justify-center gap-2"
              >
                {loading ? "Chargement..." : "VALIDER"}
                <ArrowRight size={20} />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;