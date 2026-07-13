import nodemailer from "nodemailer";

/**
 * Surveillance automatique de l'envoi de courriels.
 *
 * But : détecter IMMÉDIATEMENT toute panne d'envoi (adresse d'expédition
 * corrompue, identifiants SMTP invalides, compte Brevo bloqué, non-livraison…)
 * et prévenir par courriel — pour ne plus jamais rester des jours sans le savoir.
 *
 * L'ALERTE part via l'API Brevo (indépendante du transporter SMTP et de
 * EMAIL_FROM_ADDRESS), avec un expéditeur codé en dur : elle fonctionne donc
 * même quand l'envoi « normal » est cassé.
 */

const BREVO_API = "https://api.brevo.com/v3";

const alertTo = (): string =>
  (process.env.EMAIL_HEALTH_ALERT_TO || "dibwissem7@gmail.com").trim();

// L'adresse d'envoi DOIT être une adresse propre du domaine authentifié.
const FROM_RE = /^[^\s@"<>]+@mariusetfanny\.com$/i;

async function sendAlert(subject: string, message: string): Promise<void> {
  const key = (process.env.BREVO_API_KEY || "").trim();
  const to = alertTo();
  console.error(`🚨 [SANTÉ COURRIEL] ${subject} — ${message}`);
  if (!key) {
    console.error("🚨 [SANTÉ COURRIEL] pas de BREVO_API_KEY → alerte impossible.");
    return;
  }
  try {
    const r = await fetch(`${BREVO_API}/smtp/email`, {
      method: "POST",
      headers: {
        "api-key": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        // Expéditeur codé en dur (indépendant de l'env potentiellement cassé).
        sender: { name: "Alerte système — Marius & Fanny", email: "commandes@mariusetfanny.com" },
        to: [{ email: to }],
        subject,
        htmlContent: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto">
            <div style="background:#FDECEA;border-left:4px solid #D9534F;padding:16px 20px;border-radius:8px">
              <p style="margin:0;font-weight:bold;color:#2D2A26">🚨 ${subject}</p>
              <p style="margin:10px 0 0;color:#555;font-size:14px;line-height:1.6">${message}</p>
            </div>
            <p style="color:#999;font-size:12px;margin-top:16px">Surveillance automatique de l'envoi de courriels — Marius &amp; Fanny.</p>
          </div>`,
      }),
    });
    if (!r.ok) console.error("🚨 [SANTÉ COURRIEL] échec API alerte:", r.status, await r.text());
    else console.log(`✅ [SANTÉ COURRIEL] alerte envoyée à ${to}.`);
  } catch (e: any) {
    console.error("🚨 [SANTÉ COURRIEL] exception envoi alerte:", e?.message);
  }
}

/** Vérifie l'état de l'envoi de courriels et alerte en cas de panne. */
export async function runEmailHealthCheck(): Promise<void> {
  const from = (process.env.EMAIL_FROM_ADDRESS || "").trim();

  // 1) Format de l'adresse d'expédition (la panne du 10 juillet 2026).
  if (!FROM_RE.test(from)) {
    await sendAlert(
      "PANNE COURRIEL — adresse d'expédition invalide",
      `L'adresse d'envoi configurée est invalide : « ${from} ». Les confirmations ne seront pas livrées. Vérifier EMAIL_FROM_ADDRESS dans le .env du serveur.`,
    );
    return;
  }

  // 2) Envoi de test via le VRAI transporter (même config que l'app).
  const to = alertTo();
  const marker = `mfhealth-${Date.now()}`;
  try {
    const t = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT || "587"),
      secure: process.env.EMAIL_PORT === "465",
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
    });
    await t.sendMail({
      from: `"Marius & Fanny (santé)" <${from}>`,
      to,
      subject: `✅ [MF] Test santé courriel (${marker})`,
      html: `<p>Test automatique d'envoi. Marqueur : ${marker}. Si vous recevez ceci, l'envoi fonctionne. (Vous pouvez créer un filtre pour archiver ces messages.)</p>`,
    });
  } catch (e: any) {
    await sendAlert(
      "PANNE COURRIEL — l'envoi échoue",
      `Le test d'envoi a échoué : ${e?.message}. Vérifier les identifiants SMTP Brevo / l'état du compte.`,
    );
    return;
  }

  // 3) Vérifier la LIVRAISON réelle via l'API Brevo (~2 min plus tard).
  //    Un envoi « accepté » (250) mais non livré = le bug du From corrompu.
  setTimeout(
    async () => {
      try {
        const key = (process.env.BREVO_API_KEY || "").trim();
        if (!key) return;
        const sinceMs = Date.now() - 5 * 60 * 1000;
        const r = await fetch(
          `${BREVO_API}/smtp/statistics/events?email=${encodeURIComponent(to)}&days=1&limit=25&sort=desc`,
          { headers: { "api-key": key, accept: "application/json" } },
        );
        const j: any = await r.json();
        const events: any[] = j.events || [];
        const recent = events.filter((e) => new Date(e.date).getTime() >= sinceMs);
        const delivered = recent.some((e) => e.event === "delivered");
        const failed = recent.some((e) =>
          ["hard_bounce", "blocked", "invalid_email", "error"].includes(e.event),
        );
        if (failed || !delivered) {
          await sendAlert(
            "PANNE COURRIEL — courriel non livré",
            `Le test d'envoi (${marker}) a été accepté mais Brevo n'indique pas de livraison${failed ? " (échec/rebond détecté)" : ""}. Les courriels risquent de ne pas arriver aux clients. Vérifier l'adresse d'expédition et l'état du compte Brevo.`,
          );
        } else {
          console.log(`✅ [SANTÉ COURRIEL] OK — test livré (${marker}).`);
        }
      } catch (e: any) {
        console.error("[SANTÉ COURRIEL] vérif livraison échouée:", e?.message);
      }
    },
    2 * 60 * 1000,
  );
}
