import { emailButton, emailLayout, emailNote, emailText } from "./layout";
import { escapeHtml } from "@utils/html";

export function resetPasswordTemplate(username: string, url: string): string {
    return emailLayout("Il tuo account", "Reimposta la password",
        emailText(`Ciao ${escapeHtml(username)}, abbiamo ricevuto una richiesta per reimpostare la tua password.`) +
        emailText("Il link resta valido per un'ora.") +
        emailButton(url, "Scegli una nuova password") +
        emailNote("Se non l'hai chiesto tu, ignora questa email: la password resta quella di prima."));
}
