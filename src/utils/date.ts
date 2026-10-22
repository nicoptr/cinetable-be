import { DateTime } from "luxon";

const rome = (date: Date) => DateTime.fromJSDate(date).setZone("Europe/Rome").setLocale("it");

/** "28 ottobre 2026" */
export const formatDay = (date: Date): string => rome(date).toFormat("d LLLL yyyy");

/** "venerdì 15 marzo 2030 alle 20:30" */
export const formatDayTime = (date: Date): string => rome(date).toFormat("cccc d LLLL yyyy 'alle' HH:mm");
