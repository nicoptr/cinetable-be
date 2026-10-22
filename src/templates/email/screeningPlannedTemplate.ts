import { emailButton, emailFact, emailLayout, emailText } from "./layout";
import { escapeHtml } from "@utils/html";
import { formatDayTime } from "@utils/date";

export function screeningPlannedTemplate(movieTitle: string, screeningAt: Date, location: string, url: string): string {
    return emailLayout("Proiezione", "Prossima proiezione",
        emailText(`In programma c'è <strong>${escapeHtml(movieTitle)}</strong>.`) +
        emailFact("Quando", formatDayTime(screeningAt)) +
        emailFact("Dove", escapeHtml(location)) +
        emailButton(url, "Vedi il programma"));
}
