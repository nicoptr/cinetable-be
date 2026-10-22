export const seasonLink = (cineforumId: number, seasonId: number): string =>
    `${process.env.CLIENT_URL}/cineforums/${cineforumId}/seasons/${seasonId}`;

export const filmLink = (cineforumId: number, seasonId: number, order: number): string => `${seasonLink(cineforumId, seasonId)}/films/${order}`;
