import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { authClient, forgotPassword } from "../lib/AuthClient"; 
import GoldenBackground from "./GoldenBackground";
import { Mail, ArrowLeft, Check, Lock, User, Eye, EyeOff } from "lucide-react";
import { getRedirectPath } from "../utils/loginMultipleusers"; 
import { UserWithRole } from "../types";

const styles = {
  gold: "#337957",
  text: "#2D2A26",
  fontScript: '"Great Vibes", cursive',
  fontSans: '"Inter", sans-serif',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const AuthPage: React.FC = () => {
  const [view, setView] = useState<"login" | "signup" | "forgot-password">("login");
  const [isVerificationSent, setIsVerificationSent] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [pendingSignIn, setPendingSignIn] = useState<{email: string, password: string} | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [rememberMe, setRememberMe] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const navigate = useNavigate();

  // --- LOGIQUE DE REDIRECTION CENTRALISÉE ---
  const handleRoleBasedRedirect = async (signInData?: any) => {
    try {
      const checkoutIntent = localStorage.getItem("checkout_intent");
      if (checkoutIntent) {
        const intent = JSON.parse(checkoutIntent);
        localStorage.removeItem("checkout_intent");
        console.log("🛒 [AUTH] Restoring checkout intent");
        navigate("/checkout", { state: intent });
        return;
      }

      let user: UserWithRole | null = null;

      // Use session data from signIn response if available (avoids cookie dependency)
      if (signInData?.user) {
        user = signInData.user as UserWithRole;
      } else {
        // Fallback: try to get session from cookie
        const session = await authClient.getSession({
          query: { disableCookieCache: true },
        });
        user = session?.data?.user as UserWithRole;
      }

      if (!user) {
        console.warn("⚠️ [AUTH] No user found after login, redirecting to home");
        navigate("/");
        return;
      }

      const role = user?.user_metadata?.role || user?.role || "client";
      console.log("👤 [AUTH] Role detected:", role);

      const destination = getRedirectPath(role);

      navigate(destination, { replace: true });

    } catch (e) {
      console.error("Redirect error:", e);
      navigate("/"); // Fallback de sécurité
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const session = await authClient.getSession({
          query: { disableCookieCache: true },
        });
        if (session.data?.user) {
          handleRoleBasedRedirect();
        }
      } catch (error) {
        console.error("Session check error:", error);
      }
    };
    checkAuth();
    
  }, []);

  const switchView = (newView: "login" | "signup" | "forgot-password") => {
    setView(newView);
    setError(null);
    setSuccessMessage(null);
    setIsVerificationSent(false);
    setVerificationCode("");
    setPendingSignIn(null);
  };

  const validateForm = () => {
    if (!EMAIL_REGEX.test(email)) {
      setError("Format d'email invalide.");
      return false;
    }
    if (view !== "forgot-password" && password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères.");
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!validateForm()) return;

    setLoading(true);

    try {
      if (view === "login") {
        const { data: signInData, error: signInError } = await authClient.signIn.email({
          email,
          password,
        });

        if (signInError) {
          if (
            signInError.message?.includes("Email not verified") ||
            signInError.message?.includes("verification") ||
            signInError.status === 403
          ) {
            console.log("📧 [AUTH] Email verification required...");
            setPendingSignIn({ email, password });
            setIsVerificationSent(true);
            setError(null);
            return;
          }
          throw new Error(signInError.message || "Connexion échouée");
        }

        // Store session token for cross-domain compatibility
        console.log("🔑 [AUTH] SignIn response:", JSON.stringify(signInData));
        const token = signInData?.token;
        if (token) {
          localStorage.setItem("bearer_token", token);
          console.log("✅ [AUTH] Bearer token stored in localStorage");
        } else {
          console.warn("⚠️ [AUTH] No token in signIn response");
        }

        await handleRoleBasedRedirect(signInData);

      } else if (view === "signup") {
        // Note: do NOT send role here. better-auth's MongoDB adapter persists
        // whatever string we pass, and "client" isn't in the Mongoose User
        // enum (user/pro/staff/admin/cuisinier/patissier/four/vendeur/
        // customerService/deliveryDriver). Mongoose blows up on the next
        // password-reset / hook that touches the user. The backend `before`
        // hook coerces missing role to "user" automatically.
        const { error: signUpError } = await authClient.signUp.email({
          email,
          password,
          name,
        } as any);

        if (signUpError)
          throw new Error(signUpError.message || "Inscription échouée");

        setIsVerificationSent(true);
      } else if (view === "forgot-password") {
        await handleForgotPassword();
      }
    } catch (err: any) {
      console.error("Auth Error:", err);
      if (err.message === "Failed to fetch") {
        setError("Erreur réseau. Vérifiez votre connexion.");
      } else {
        setError(err.message || "Une erreur est survenue.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    await forgotPassword(email);
    setSuccessMessage("Un lien de réinitialisation a été envoyé à votre adresse email.");
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();

    if (verificationCode.length !== 6) {
      setError("Le code doit contenir 6 chiffres.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log("🔐 [VERIFY] Verifying email with OTP...");
      const result = await authClient.emailOtp.verifyEmail({
        email: pendingSignIn ? pendingSignIn.email : email,
        otp: verificationCode,
      });

      if (result.data) {
        console.log("✅ [VERIFY] Email verification successful");

        if (pendingSignIn) {
          // Complete the pending sign-in
          console.log("🔐 [AUTH] Completing pending sign-in...");
          const { data: signInData, error: signInError } = await authClient.signIn.email({
            email: pendingSignIn.email,
            password: pendingSignIn.password,
          });

          if (signInError) {
            throw new Error(signInError.message || "Erreur lors de la connexion");
          }

          // Store session token for cross-domain compatibility
          if (signInData?.token) {
            localStorage.setItem("bearer_token", signInData.token);
          }

          setPendingSignIn(null);

          await handleRoleBasedRedirect(signInData);

        } else {
          setSuccessMessage("Votre email a été vérifié avec succès ! Vous pouvez maintenant vous connecter.");
          setTimeout(() => {
            setIsVerificationSent(false);
            switchView("login");
          }, 2000);
        }
      } else {
        throw new Error("Code de vérification invalide");
      }
    } catch (err: any) {
      console.error("❌ [VERIFY] Email verification failed:", err);
      if (err.message === "Failed to fetch") {
        setError("Erreur réseau. Vérifiez votre connexion.");
      } else {
        setError(err.message || "Code de vérification invalide.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendCode = async () => {
    setLoading(true);
    setError(null);
    setVerificationCode("");
    setSuccessMessage(null);

    try {
      console.log("📧 [RESEND] Resending verification OTP...");
      await authClient.emailOtp.sendVerificationOtp({
        email: pendingSignIn ? pendingSignIn.email : email,
        type: "email-verification",
      });

      setSuccessMessage("Un nouveau code a été envoyé à votre email.");
    } catch (err: any) {
      setError("Erreur lors de l'envoi du code. Veuillez réessayer.");
    } finally {
      setLoading(false);
    }
  };


  if (isVerificationSent) {
    return (
      <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#F9F7F2]">
        <div className="absolute inset-0 z-0">
          <GoldenBackground />
        </div>
        <button
          onClick={() => navigate("/")}
          className="absolute top-6 left-6 z-20 flex items-center gap-2 px-3 py-2 rounded-full bg-white/95 border border-[#337957]/40 shadow-md text-xs font-bold uppercase tracking-widest text-[#2D2A26] hover:text-[#337957] transition-colors"
        >
          <ArrowLeft size={18} className="text-[#337957]" /> Retour au site
        </button>
        <div className="relative z-10 w-full max-w-md px-4 sm:px-6 text-center">
          <div className="bg-white/80 backdrop-blur-xl p-6 sm:p-10 rounded-3xl shadow-2xl border border-white/40">
            <div className="w-20 h-20 bg-[#337957]/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <Mail className="text-[#337957]" size={40} />
            </div>
            <h2 className="text-4xl mb-4" style={{ fontFamily: styles.fontScript, color: styles.gold }}>
              Vérifiez votre email
            </h2>
            <p className="text-[11px] font-bold uppercase tracking-widest text-stone-500 leading-relaxed mb-8">
              {pendingSignIn
                ? `Un code de vérification a été envoyé à ${pendingSignIn.email} pour compléter votre connexion.`
                : `Un code de vérification a été envoyé à ${email} pour activer votre compte.`}{" "}
              <br /><br />
              Veuillez entrer le code à 6 chiffres ci-dessous.
            </p>

            <form onSubmit={handleVerifyCode} className="space-y-4">
              <div>
                <input
                  type="text"
                  value={verificationCode}
                  onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="Entrez le code"
                  className="w-full px-4 py-3 text-center text-2xl font-mono tracking-widest bg-stone-50 border border-stone-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#337957] focus:border-transparent"
                  maxLength={6}
                  required
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                  <p className="text-red-700 text-sm text-center">{error}</p>
                </div>
              )}

              {successMessage && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
                  <p className="text-green-700 text-sm text-center">{successMessage}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || verificationCode.length !== 6}
                className="w-full px-6 py-3 text-sm font-bold text-white bg-[#337957] rounded-xl hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? "Vérification..." : "Vérifier le code"}
              </button>

              <button
                type="button"
                onClick={handleResendCode}
                disabled={loading}
                className="w-full px-6 py-3 text-sm font-bold text-[#337957] bg-white border border-[#337957] rounded-xl hover:bg-[#337957]/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Renvoyer le code
              </button>
            </form>

            <button
              onClick={() => {
                setIsVerificationSent(false);
                setPendingSignIn(null);
                switchView("login");
              }}
              className="flex items-center justify-center gap-2 mx-auto text-[10px] font-black uppercase tracking-widest text-[#2D2A26] hover:text-[#337957] transition-all mt-6"
            >
              <ArrowLeft size={14} /> Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#F9F7F2]">
      <div className="absolute inset-0 z-0">
        <GoldenBackground />
      </div>
      <button
        onClick={() => navigate("/")}
        className="absolute top-6 left-6 z-20 flex items-center gap-2 px-3 py-2 rounded-full bg-white/95 border border-[#337957]/40 shadow-md text-xs font-bold uppercase tracking-widest text-[#2D2A26] hover:text-[#337957] transition-colors"
      >
        <ArrowLeft size={18} className="text-[#337957]" /> Retour au site
      </button>
      <div className="relative z-10 w-full max-w-md px-4 sm:px-6">
        <div className="bg-white/80 backdrop-blur-xl p-6 sm:p-10 rounded-3xl shadow-2xl border border-white/40">
          <div className="text-center mb-8">
            <h2 className="text-5xl mb-2" style={{ fontFamily: styles.fontScript, color: styles.gold }}>
              Marius & Fanny
            </h2>
            <h1 className="text-[10px] font-black uppercase tracking-[0.4em] mt-4" style={{ color: styles.text }}>
              {view === "login" && "Connexion"}
              {view === "signup" && "Inscription"}
              {view === "forgot-password" && "Récupération"}
            </h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div
                className="text-[10px] font-bold uppercase tracking-widest py-3 px-4 rounded-lg border text-center animate-pulse"
                style={{ borderColor: "#ef4444", backgroundColor: "#fef2f2", color: "#b91c1c" }}
                role="alert"
              >
                {error}
              </div>
            )}

            {successMessage && (
              <div
                className="text-[10px] font-bold uppercase tracking-widest py-3 px-4 rounded-lg border text-center"
                style={{ borderColor: "#22c55e", backgroundColor: "#f0fdf4", color: "#15803d" }}
              >
                {successMessage}
              </div>
            )}

            {view === "signup" && (
              <div className="space-y-1 group">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest opacity-50 group-focus-within:opacity-100 group-focus-within:text-[#337957] transition-all">
                  <User size={12} /> Nom Complet
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-0 py-3 bg-transparent border-b border-black/10 focus:border-[#337957] outline-none transition-all placeholder:text-black/10 text-sm"
                  placeholder="JEAN DUPONT"
                  required
                />
              </div>
            )}

            <div className="space-y-1 group">
              <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest opacity-50 group-focus-within:opacity-100 group-focus-within:text-[#337957] transition-all">
                <Mail size={12} /> Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-0 py-3 bg-transparent border-b border-black/10 focus:border-[#337957] outline-none transition-all placeholder:text-black/10 text-sm"
                placeholder="VOTRE@EMAIL.COM"
                required
              />
            </div>

            {view !== "forgot-password" && (
              <div className="space-y-1 group">
                <label className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest opacity-50 group-focus-within:opacity-100 group-focus-within:text-[#337957] transition-all">
                  <Lock size={12} /> Mot de passe
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-0 py-3 pr-9 bg-transparent border-b border-black/10 focus:border-[#337957] outline-none transition-all placeholder:text-black/10 text-sm"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-stone-500 hover:text-[#337957] transition-colors"
                    aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
            )}

            {view === "login" && (
              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 cursor-pointer group">
                  <div className={`w-4 h-4 border rounded flex items-center justify-center transition-colors ${rememberMe ? "border-[#337957] bg-[#337957]" : "border-black/20 group-hover:border-[#337957]"}`}>
                    {rememberMe && <Check size={10} className="text-white" />}
                  </div>
                  <input type="checkbox" className="hidden" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#2D2A26]/60 group-hover:text-[#2D2A26] transition-colors">
                    Se souvenir
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => switchView("forgot-password")}
                  className="text-[10px] font-bold uppercase tracking-wider text-[#2D2A26]/60 hover:text-[#337957] transition-colors"
                >
                  Mot de passe oublié ?
                </button>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-8 py-4 text-[11px] font-black uppercase tracking-[0.2em] text-white transition-all duration-300 hover:opacity-90 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
              style={{ backgroundColor: styles.text }}
            >
              {loading
                ? "CHARGEMENT..."
                : view === "login"
                ? "SE CONNECTER"
                : view === "signup"
                ? "CRÉER MON COMPTE"
                : "ENVOYER LE LIEN"}
            </button>
          </form>

          <div className="mt-8 text-center border-t border-black/5 pt-6 flex flex-col gap-3">
            {view !== "login" && (
              <button
                type="button"
                onClick={() => switchView("login")}
                className="text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-100 hover:text-[#337957] transition-all"
                style={{ color: styles.text }}
              >
                Déjà un compte ? Se connecter
              </button>
            )}

            {view !== "signup" && (
              <button
                type="button"
                onClick={() => switchView("signup")}
                className="text-[10px] font-bold uppercase tracking-widest opacity-40 hover:opacity-100 hover:text-[#337957] transition-all"
                style={{ color: styles.text }}
              >
                Nouveau ici ? S'inscrire
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;
