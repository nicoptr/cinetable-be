-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('DRAFT', 'OPEN', 'SCREENING', 'FINAL', 'DONE');

-- CreateEnum
CREATE TYPE "CandidatureStatus" AS ENUM ('VALID', 'DUPLICATE', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "cineforumId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Award" (
    "id" SERIAL NOT NULL,
    "cineforumId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Award_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" SERIAL NOT NULL,
    "cineforumId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "SeasonStatus" NOT NULL DEFAULT 'DRAFT',
    "candidaturesCloseAt" TIMESTAMP(3) NOT NULL,
    "finalNightAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonAward" (
    "seasonId" INTEGER NOT NULL,
    "awardId" INTEGER NOT NULL,
    "revealedAt" TIMESTAMP(3),

    CONSTRAINT "SeasonAward_pkey" PRIMARY KEY ("seasonId","awardId")
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "categoryId" INTEGER,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Movie" (
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "originalTitle" TEXT NOT NULL,
    "year" INTEGER,
    "posterPath" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("tmdbId")
);

-- CreateTable
CREATE TABLE "Candidature" (
    "id" SERIAL NOT NULL,
    "seasonId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "status" "CandidatureStatus" NOT NULL DEFAULT 'VALID',
    "projectionOrder" INTEGER,
    "revealedAt" TIMESTAMP(3),
    "screeningAt" TIMESTAMP(3),
    "location" TEXT,
    "votingOpenedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Candidature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BannedMovie" (
    "seasonId" INTEGER NOT NULL,
    "tmdbId" INTEGER NOT NULL,

    CONSTRAINT "BannedMovie_pkey" PRIMARY KEY ("seasonId","tmdbId")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" SERIAL NOT NULL,
    "candidatureId" INTEGER NOT NULL,
    "awardId" INTEGER NOT NULL,
    "participantId" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CategoryToSeason" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_seasonId_userId_key" ON "Participant"("seasonId", "userId");

-- CreateIndex
CREATE INDEX "Candidature_seasonId_tmdbId_idx" ON "Candidature"("seasonId", "tmdbId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_candidatureId_awardId_participantId_key" ON "Vote"("candidatureId", "awardId", "participantId");

-- CreateIndex
CREATE UNIQUE INDEX "_CategoryToSeason_AB_unique" ON "_CategoryToSeason"("A", "B");

-- CreateIndex
CREATE INDEX "_CategoryToSeason_B_index" ON "_CategoryToSeason"("B");

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_cineforumId_fkey" FOREIGN KEY ("cineforumId") REFERENCES "Cineforum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Award" ADD CONSTRAINT "Award_cineforumId_fkey" FOREIGN KEY ("cineforumId") REFERENCES "Cineforum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_cineforumId_fkey" FOREIGN KEY ("cineforumId") REFERENCES "Cineforum"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonAward" ADD CONSTRAINT "SeasonAward_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonAward" ADD CONSTRAINT "SeasonAward_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "Award"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidature" ADD CONSTRAINT "Candidature_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidature" ADD CONSTRAINT "Candidature_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidature" ADD CONSTRAINT "Candidature_tmdbId_fkey" FOREIGN KEY ("tmdbId") REFERENCES "Movie"("tmdbId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BannedMovie" ADD CONSTRAINT "BannedMovie_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_candidatureId_fkey" FOREIGN KEY ("candidatureId") REFERENCES "Candidature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_awardId_fkey" FOREIGN KEY ("awardId") REFERENCES "Award"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryToSeason" ADD CONSTRAINT "_CategoryToSeason_A_fkey" FOREIGN KEY ("A") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryToSeason" ADD CONSTRAINT "_CategoryToSeason_B_fkey" FOREIGN KEY ("B") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "Candidature_one_valid_per_participant" ON "Candidature"("participantId") WHERE "status" = 'VALID';
