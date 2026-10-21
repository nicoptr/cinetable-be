import { DateTime } from "luxon";
import { emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function seasonLaunchedTemplate(seasonName: string, categoryName: string, closeAt: Date): string {
    const when = DateTime.fromJSDate(closeAt).setZone("Europe/Rome").toFormat("dd-MM-yyyy 'alle' HH:mm");
    return emailLayout("Sei in gara", `<p>L'edizione <strong>${escapeHtml(seasonName)}</strong> è partita!</p>
<p>La tua categoria è <strong>${escapeHtml(categoryName)}</strong>: proponi un film che le appartenga.</p>
<p>Le candidature chiudono il ${when} (ora di Roma).</p>
<p>Tieni la categoria segreta: nessun altro sa quale sia la tua.</p>`);
}
