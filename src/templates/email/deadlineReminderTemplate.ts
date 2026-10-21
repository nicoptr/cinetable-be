import { DateTime } from "luxon";
import { emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function deadlineReminderTemplate(seasonName: string, categoryName: string | null, closeAt: Date): string {
    const when = DateTime.fromJSDate(closeAt).setZone("Europe/Rome").toFormat("dd-MM-yyyy 'alle' HH:mm");
    const category = categoryName ? `<p>La tua categoria è <strong>${escapeHtml(categoryName)}</strong>.</p>` : "";
    return emailLayout("Promemoria: candida il tuo film", `<p>Non hai ancora una candidatura valida per l'edizione <strong>${escapeHtml(seasonName)}</strong>.</p>
${category}<p>Le candidature chiudono il ${when} (ora di Roma): proponi il tuo film prima della scadenza.</p>`);
}
