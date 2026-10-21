import { emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function voteReminderTemplate(movieTitle: string): string {
    return emailLayout("Manca il tuo voto", `<p>Non hai ancora votato <strong>${escapeHtml(movieTitle)}</strong>.</p>
<p>Accedi a Cinetable e assegna un voto da 0 a 100 a ogni premio.</p>`);
}
