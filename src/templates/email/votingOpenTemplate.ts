import { emailButton, emailLayout, emailNote, emailText } from "./layout";
import { escapeHtml } from "@utils/html";

export function votingOpenTemplate(movieTitle: string, url: string): string {
    return emailLayout("Votazioni", "Si vota!",
        emailText(`Il voto per <strong>${escapeHtml(movieTitle)}</strong> è aperto.`) +
        emailText("Dai un voto da 0 a 100 a ogni award.") +
        emailButton(url, "Vota ora") +
        emailNote("Un voto inviato non si può più cambiare."));
}
