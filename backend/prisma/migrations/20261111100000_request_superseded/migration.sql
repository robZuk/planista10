-- Zgloszenie nieaktualne: planista zmienil termin wprost (Ukladanie planu → Terminy), inaczej
-- niz prosil prowadzacy. Czekajace zgloszenie zamyka sie wtedy samo, a prowadzacy dostaje
-- powiadomienie.
ALTER TYPE "ChangeRequestStatus" ADD VALUE 'SUPERSEDED';
ALTER TYPE "NotificationKind" ADD VALUE 'REQUEST_SUPERSEDED';
