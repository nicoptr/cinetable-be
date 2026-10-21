import { DateTime } from "luxon";
import { emailLayout } from "./layout";
import { escapeHtml } from "@utils/html";

/** Il film è ancora coperto: solo categoria, data e luogo, mai il titolo. */
export function screeningScheduledTemplate(categoryName: string | null, screeningAt: Date, location: string): string {
    const when = DateTime.fromJSDate(screeningAt).setZone("Europe/Rome").toFormat("dd-MM-yyyy 'alle' HH:mm");
    const category = categoryName ? `, della categoria <strong>${escapeHtml(categoryName)}</strong>` : "";
    return emailLayout("Prossima proiezione", `<p>Il prossimo film${category}, è ancora segreto: lo scoprirete presto.</p>
<p>Ci vediamo il ${when} (ora di Roma) a <strong>${escapeHtml(location)}</strong>.</p>`);
}
