import { emailButton, emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";
import { formatItaliaDate } from "@utils/date";

export function cineforumInvitationTemplate(cineforumName: string, inviterUsername: string, url: string, expiresAt: Date): string {
    return emailLayout("Sei stato invitato", `<p>${escapeHtml(inviterUsername)} ti ha invitato al cineforum <strong>${escapeHtml(cineforumName)}</strong> su Cinofili.</p>
<p>L'invito scade il ${formatItaliaDate(expiresAt)}.</p>
${emailButton(url, "Vedi l'invito")}`);
}
