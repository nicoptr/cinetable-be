import { emailButton, emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function resetPasswordTemplate(username: string, url: string): string {
    return emailLayout("Reimposta la password", `<p>Ciao ${escapeHtml(username)}, abbiamo ricevuto una richiesta di reimpostazione della password.</p>
<p>Il link vale 1 ora. Se non l'hai richiesta, ignora questa email.</p>
${emailButton(url, "Scegli una nuova password")}`);
}
