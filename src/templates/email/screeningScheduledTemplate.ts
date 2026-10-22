import { emailButton, emailFact, emailLayout, emailNote, emailText } from "./layout";
import { escapeHtml } from "@utils/html";
import { formatDayTime } from "@utils/date";

/** Il film è ancora coperto: solo categoria, data e luogo, mai il titolo. */
export function screeningScheduledTemplate(categoryName: string | null, screeningAt: Date, location: string, url: string): string {
    return emailLayout("Proiezione", "Prossima proiezione",
        emailText("Il prossimo film è ancora segreto: lo scoprirete insieme.") +
        (categoryName ? emailFact("Categoria", escapeHtml(categoryName)) : "") +
        emailFact("Quando", formatDayTime(screeningAt)) +
        emailFact("Dove", escapeHtml(location)) +
        emailButton(url, "Vedi l'edizione") +
        emailNote("Il titolo arriverà con lo svelamento."));
}
