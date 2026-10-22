import { emailButton, emailLayout, emailNote, emailText } from "./layout";
import { escapeHtml } from "@utils/html";

export function voteReminderTemplate(movieTitle: string, url: string): string {
    return emailLayout("Promemoria", "Manca il tuo voto",
        emailText(`Non hai ancora votato <strong>${escapeHtml(movieTitle)}</strong>.`) +
        emailText("Dai un voto da 0 a 100 a ogni award: bastano un paio di minuti.") +
        emailButton(url, "Vota ora") +
        emailNote("Un voto inviato non si può più cambiare."));
}
