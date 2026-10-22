import { emailButton, emailFact, emailLayout, emailNote, emailText } from "./layout";
import { escapeHtml } from "@utils/html";
import { formatDayTime } from "@utils/date";

export function seasonLaunchedTemplate(seasonName: string, categoryName: string, closeAt: Date, url: string): string {
    return emailLayout("Nuova edizione", "Sei in gara",
        emailText(`L'edizione <strong>${escapeHtml(seasonName)}</strong> è partita!`) +
        emailFact("La tua categoria", escapeHtml(categoryName)) +
        emailText(`Proponi un film che le appartenga entro ${formatDayTime(closeAt)}.`) +
        emailButton(url, "Candida il tuo film") +
        emailNote("Tieni la categoria per te: nessun altro sa qual è la tua."));
}
