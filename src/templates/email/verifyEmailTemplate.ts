import { emailButton, emailLayout, emailNote, emailText } from "./layout";
import { escapeHtml } from "@utils/html";

export function verifyEmailTemplate(username: string, url: string): string {
    return emailLayout("Ci siamo quasi", "Conferma la tua email",
        emailText(`Ciao ${escapeHtml(username)}, ti diamo il benvenuto su Cinetable!`) +
        emailText("Conferma il tuo indirizzo per attivare l'account: il link resta valido per 24 ore.") +
        emailButton(url, "Conferma email") +
        emailNote("Se non hai creato tu l'account, ignora questa email."));
}
