import { emailButton, emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function verifyEmailTemplate(username: string, url: string): string {
    return emailLayout("Conferma la tua email", `<p>Ciao ${escapeHtml(username)}, benvenuto su Cinofili!</p>
<p>Conferma il tuo indirizzo per attivare l'account. Il link vale 24 ore.</p>
${emailButton(url, "Conferma email")}`);
}
