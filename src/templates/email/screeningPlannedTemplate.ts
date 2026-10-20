import { DateTime } from "luxon";
import { emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function screeningPlannedTemplate(movieTitle: string, screeningAt: Date, location: string): string {
    const when = DateTime.fromJSDate(screeningAt).setZone("Europe/Rome").toFormat("dd-MM-yyyy 'alle' HH:mm");
    return emailLayout("Prossima proiezione", `<p>Il prossimo film in programma è <strong>${escapeHtml(movieTitle)}</strong>.</p>
<p>Ci vediamo il ${when} (ora di Roma) a <strong>${escapeHtml(location)}</strong>.</p>`);
}
