-- Zajecia online: umieszczenie i termin bez sali (roomId = null). Wyjatek terminu moze
-- przeniesc go na online (newOnline = true) — przezywa ponowne generowanie.
ALTER TABLE "Placement" ALTER COLUMN "roomId" DROP NOT NULL;
ALTER TABLE "Occurrence" ALTER COLUMN "roomId" DROP NOT NULL;
ALTER TABLE "PlacementException" ADD COLUMN "newOnline" BOOLEAN;
