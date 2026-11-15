-- planista10: bez zgloszen zmian prowadzacych i bez powiadomien w aplikacji.
-- Terminy odwoluje, przenosi i odrabia tylko planista (administrator albo dziekanat) wprost
-- w Ukladaniu planu -> Terminy. Powiazanie odwolanie <-> odrobienie (Occurrence.makeupOfId) zostaje.

-- Powiadomienie wskazuje zgloszenie, wiec idzie pierwsze.
DROP TABLE "Notification";
DROP TABLE "ChangeRequest";

DROP TYPE "NotificationKind";
DROP TYPE "ChangeRequestStatus";
DROP TYPE "ChangeRequestKind";
