import { DateTime } from "luxon";

export const formatItaliaDate = (date: Date | undefined | null): string => {
    return date ? DateTime.fromJSDate(date).setZone("Europe/Rome").toFormat("dd-MM-yyyy") : "data mancante";
}

export const formatItaliaTime = (date: Date | undefined | null): string => {
    return new Date(date ?? "").toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit"
    });

}