import { DateTime } from "luxon";
import { emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function candidatureDuplicateTemplate(movieTitle: string, closeAt: Date): string {
    const when = DateTime.fromJSDate(closeAt).setZone("Europe/Rome").toFormat("dd-MM-yyyy 'alle' HH:mm");
    return emailLayout("Scegli un altro film", `<p>Il film <strong>${escapeHtml(movieTitle)}</strong> è stato candidato anche da un altro partecipante, quindi è escluso dalla rassegna.</p>
<p>Scegline un altro entro il ${when} (ora di Roma).</p>`);
}
