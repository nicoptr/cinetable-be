import { DateTime } from "luxon";
import { emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

export function filmRevealedTemplate(movieTitle: string, screeningAt: Date | null, location: string | null): string {
    const when = screeningAt && DateTime.fromJSDate(screeningAt).setZone("Europe/Rome").toFormat("dd-MM-yyyy 'alle' HH:mm");
    const screening = when && location ? `\n<p>Ci vediamo il ${when} (ora di Roma) a <strong>${escapeHtml(location)}</strong>.</p>` : "";
    return emailLayout("Svelato il prossimo film", `<p>Il prossimo film in programma è <strong>${escapeHtml(movieTitle)}</strong>.</p>${screening}`);
}
