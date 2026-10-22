import { emailButton, emailLayout, emailNote, emailText } from "./layout";
import { escapeHtml } from "@utils/html";
import { formatDay } from "@utils/date";

export function cineforumInvitationTemplate(cineforumName: string, inviterUsername: string, url: string, expiresAt: Date): string {
    return emailLayout("Invito", "Hai un posto a tavola",
        emailText(`${escapeHtml(inviterUsername)} ti invita nel cineforum <strong>${escapeHtml(cineforumName)}</strong> su Cinetable.`) +
        emailText("Ognuno porta un film in segreto, lo guardate insieme e alla serata finale si aprono le buste.") +
        emailButton(url, "Vedi l'invito") +
        emailNote(`L'invito scade il ${formatDay(expiresAt)}.`));
}
