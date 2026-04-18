-- Worker G — Task-Reprioritization (2026-04-18)
-- Transaktion: Merge/Archive/Reprio in einem Zug
-- Vorbedingung: Backup existiert (garten.db.bak.20260418_081756_worker_g)

BEGIN TRANSACTION;

-- ======================================
-- Phase 1: Duplikate auf status='duplicate'
-- ======================================

-- #83 Pachtvertrag unterschreiben -> duplicate von #39
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Duplikat von #39 Pachtvertrag mit Opa]',
  updated_at=datetime('now','localtime')
WHERE id=83;

-- #84 Schornsteinfeger-Check -> duplicate von #50
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Duplikat von #50 Schornsteinfeger Feuerstättenbescheid]',
  updated_at=datetime('now','localtime')
WHERE id=84;

-- #91 Elektro-Endabnahme -> duplicate von #51 (E-Check Solar)
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Duplikat von #51 E-Check Solar/Akku + #30 E-Check Recurring]',
  updated_at=datetime('now','localtime')
WHERE id=91;

-- #59 Eigene Domain (rechtliches) -> duplicate von #77 (marketing)
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Duplikat von #77 Eigene Domain]',
  updated_at=datetime('now','localtime')
WHERE id=59;

-- #58 Google Business (rechtliches) -> duplicate von #78 (marketing)
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Duplikat von #78 Google Business Profile]',
  updated_at=datetime('now','localtime')
WHERE id=58;

-- #86 WC-Upgrade -> duplicate von #47
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Duplikat von #47 Trockentrenntoilette einbauen]',
  updated_at=datetime('now','localtime')
WHERE id=86;

-- #85 Versicherungsschutz (Umbrella) -> duplicate von #55 + #56
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Umbrella-Duplikat, abgedeckt durch #55 Betriebshaftpflicht + #56 Gebäudeversicherung]',
  updated_at=datetime('now','localtime')
WHERE id=85;

-- #45 Einzelunternehmen Natur Refugium Etzdorf -> löschen (läuft über InfinitySpace)
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Moritz-Entscheid - Gewerbeanmeldung läuft über InfinitySpace, nicht Refugium-DB]',
  updated_at=datetime('now','localtime')
WHERE id=45;

-- #80 Gewerbeanmeldung Refugium -> löschen (läuft über InfinitySpace)
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Moritz-Entscheid - Gewerbeanmeldung läuft über InfinitySpace, nicht Refugium-DB]',
  updated_at=datetime('now','localtime')
WHERE id=80;

-- #44 Rechtliches Backend (Umbrella) -> duplicate
UPDATE projects SET status='duplicate',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Umbrella-Duplikat, abgedeckt durch #55/#56/#46]',
  updated_at=datetime('now','localtime')
WHERE id=44;

-- ======================================
-- Phase 2: Obsolete Ostern-Tasks -> status='archived'
-- ======================================

UPDATE projects SET status='archived',
  description=COALESCE(description,'') || '
[Worker G 2026-04-18: Archiviert, Oster-Fenster 05.04.2026 vorbei]',
  updated_at=datetime('now','localtime')
WHERE id IN (40, 41, 90);

-- ======================================
-- Phase 3: Mai-Bucket (Vermietungs-kritisch)
-- ======================================

UPDATE projects SET due_date='2026-05-03', priority='kritisch',    updated_at=datetime('now','localtime') WHERE id=39;
-- #80 und #45 werden nicht mehr priorisiert (sind duplicate/InfinitySpace)
UPDATE projects SET due_date='2026-05-07', priority='kritisch',    updated_at=datetime('now','localtime') WHERE id=46;
UPDATE projects SET due_date='2026-05-07', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=53;
UPDATE projects SET due_date='2026-05-07', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=54;
UPDATE projects SET due_date='2026-05-09', priority='kritisch',    updated_at=datetime('now','localtime') WHERE id=4;
UPDATE projects SET due_date='2026-05-10', priority='kritisch',    updated_at=datetime('now','localtime') WHERE id=8;
UPDATE projects SET due_date='2026-05-12', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=5;
UPDATE projects SET due_date='2026-05-14', priority='kritisch',    updated_at=datetime('now','localtime') WHERE id=50;
UPDATE projects SET due_date='2026-05-14', priority='kritisch',    updated_at=datetime('now','localtime') WHERE id=51;
UPDATE projects SET due_date='2026-05-18', priority='kritisch',    updated_at=datetime('now','localtime') WHERE id=55;
UPDATE projects SET due_date='2026-05-18', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=56;
UPDATE projects SET due_date='2026-05-20', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=49;
UPDATE projects SET due_date='2026-05-21', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=48;
UPDATE projects SET due_date='2026-05-25', priority='kritisch',    updated_at=datetime('now','localtime') WHERE id=47;
UPDATE projects SET due_date='2026-05-28', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=52;
UPDATE projects SET due_date='2026-05-29', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=6;
UPDATE projects SET due_date='2026-05-30', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=11;
UPDATE projects SET due_date='2026-05-30', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=1;

-- ======================================
-- Phase 4: Juni-Bucket (Launch-Vorbereitung)
-- ======================================

UPDATE projects SET due_date='2026-06-05', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=14;
UPDATE projects SET due_date='2026-06-07', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=42;
UPDATE projects SET due_date='2026-06-07', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=7;
UPDATE projects SET due_date='2026-06-10', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=77;
UPDATE projects SET due_date='2026-06-12', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=81;
UPDATE projects SET due_date='2026-06-12', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=60;
UPDATE projects SET due_date='2026-06-14', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=78;
UPDATE projects SET due_date='2026-06-17', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=87;
UPDATE projects SET due_date='2026-06-19', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=89;
UPDATE projects SET due_date='2026-06-21', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=93;
UPDATE projects SET due_date='2026-06-24', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=82;
UPDATE projects SET due_date='2026-06-26', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=57;
UPDATE projects SET due_date='2026-06-28', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=2;
UPDATE projects SET due_date='2026-06-30', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=100;
-- #88 Hardware-Einkauf (Moritz: behalten als echter Einkaufs-Task, auf Juni legen vor Setup)
UPDATE projects SET due_date='2026-06-02', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=88;
-- #92 AUS-Schalter-Beschilderung: zu Juni-Hardware-Block
UPDATE projects SET due_date='2026-06-07', priority='hoch',        updated_at=datetime('now','localtime') WHERE id=92;

-- ======================================
-- Phase 5: Juli-Bucket (Nice-to-haves + Wohnkomfort)
-- ======================================

UPDATE projects SET due_date='2026-07-03', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=9;
UPDATE projects SET due_date='2026-07-05', priority='mittel',      updated_at=datetime('now','localtime') WHERE id=10;
UPDATE projects SET due_date='2026-07-07', priority='niedrig',     updated_at=datetime('now','localtime') WHERE id=94;
UPDATE projects SET due_date='2026-07-12', priority='niedrig',     updated_at=datetime('now','localtime') WHERE id=12;
UPDATE projects SET due_date='2026-07-14', priority='niedrig',     updated_at=datetime('now','localtime') WHERE id=3;
UPDATE projects SET due_date='2026-07-14', priority='niedrig',     updated_at=datetime('now','localtime') WHERE id=15;
UPDATE projects SET due_date='2026-07-17', priority='niedrig',     updated_at=datetime('now','localtime') WHERE id=79;
UPDATE projects SET due_date='2026-07-19', priority='niedrig',     updated_at=datetime('now','localtime') WHERE id=13;
UPDATE projects SET due_date='2026-07-21', priority='niedrig',     updated_at=datetime('now','localtime') WHERE id=101;

-- ======================================
-- Phase 6: Wartungs-Tasks in projects (IDs 16-38, is_recurring=1)
-- Diese sind Instanzen der recurring_tasks. Due-Dates auf saisonalen Start verschieben.
-- Oktober/März-Spezialfälle aus Plan §6.4: #37 Winterfest + #38 Frühjahrs-Check
-- ======================================

-- Mai-Start aktive Recurring (Saison beginnt): diese Tasks laufen ab Mai wieder
UPDATE projects SET due_date='2026-05-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=16; -- Rasenmähen
UPDATE projects SET due_date='2026-05-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=17; -- Rasenkanten
UPDATE projects SET due_date='2026-05-16', priority='niedrig',updated_at=datetime('now','localtime') WHERE id=18; -- Vertikutieren (Plan: jährlich April, verschoben Mai)
UPDATE projects SET due_date='2026-05-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=19; -- Unkraut jäten
UPDATE projects SET due_date='2026-05-05', priority='mittel', updated_at=datetime('now','localtime') WHERE id=20; -- Beete mulchen
UPDATE projects SET due_date='2026-05-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=21; -- Blumen gießen
UPDATE projects SET due_date='2026-05-15', priority='mittel', updated_at=datetime('now','localtime') WHERE id=22; -- Hecke schneiden
UPDATE projects SET due_date='2026-07-24', priority='niedrig',updated_at=datetime('now','localtime') WHERE id=23; -- Obstbaumschnitt (Plan-Juli)
UPDATE projects SET due_date='2026-10-01', priority='niedrig',updated_at=datetime('now','localtime') WHERE id=24; -- Laub harken (Oktober)
UPDATE projects SET due_date='2026-08-15', priority='mittel', updated_at=datetime('now','localtime') WHERE id=25; -- Holz hacken (Plan: Aug-Okt)
UPDATE projects SET due_date='2026-08-20', priority='mittel', updated_at=datetime('now','localtime') WHERE id=26; -- Holz stapeln
UPDATE projects SET due_date='2026-09-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=27; -- Holzvorrat prüfen (Heizsaison-Start)
UPDATE projects SET due_date='2026-05-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=28; -- Außenbeleuchtung (Pre-Sommer-Check)
UPDATE projects SET due_date='2026-05-16', priority='mittel', updated_at=datetime('now','localtime') WHERE id=29; -- Steckdosen prüfen
-- #30 E-Check (Elektriker) 2026-09-30 behalten (ok, noch in Zukunft)
UPDATE projects SET due_date='2026-05-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=31; -- Gartenhaus putzen
UPDATE projects SET due_date='2026-05-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=32; -- Terrasse reinigen
UPDATE projects SET due_date='2026-10-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=33; -- Regenrinnen (Frühjahr+Herbst)
UPDATE projects SET due_date='2026-06-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=34; -- Fenster putzen
UPDATE projects SET due_date='2026-10-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=35; -- Werkzeug pflegen (Post-Saison)
UPDATE projects SET due_date='2026-09-01', priority='mittel', updated_at=datetime('now','localtime') WHERE id=36; -- Zaun kontrollieren
UPDATE projects SET due_date='2026-10-15', priority='niedrig',updated_at=datetime('now','localtime') WHERE id=37; -- Winterfest
UPDATE projects SET due_date='2027-03-15', priority='niedrig',updated_at=datetime('now','localtime') WHERE id=38; -- Frühjahrs-Check

-- ======================================
-- Phase 7: Recurring-Tasks seasonal_months + ggf. cycle_days Update
-- ======================================

UPDATE recurring_tasks SET seasonal_months='[4,5,6,7,8,9,10]', cycle_days=10, next_due='2026-05-01' WHERE id=1;   -- Rasenmähen
UPDATE recurring_tasks SET seasonal_months='[4,5,6,7,8,9]'   , cycle_days=30, next_due='2026-05-01' WHERE id=2;   -- Rasenkanten
UPDATE recurring_tasks SET seasonal_months='[4]'             , cycle_days=365, next_due='2027-04-01' WHERE id=3;  -- Vertikutieren
UPDATE recurring_tasks SET seasonal_months='[4,5,6,7,8,9]'   , cycle_days=14, next_due='2026-05-01' WHERE id=4;   -- Unkraut jäten
UPDATE recurring_tasks SET seasonal_months='[5]'             , cycle_days=365, next_due='2026-05-05' WHERE id=5;  -- Beete mulchen
UPDATE recurring_tasks SET seasonal_months='[5,6,7,8,9]'     , cycle_days=3, next_due='2026-05-01' WHERE id=6;    -- Blumen gießen
UPDATE recurring_tasks SET seasonal_months='[5,6,8,9]'       , cycle_days=120, next_due='2026-05-15' WHERE id=7;  -- Hecke schneiden
UPDATE recurring_tasks SET seasonal_months='[2,3]'           , cycle_days=365, next_due='2027-02-15' WHERE id=8;  -- Obstbaumschnitt
UPDATE recurring_tasks SET seasonal_months='[10,11]'         , cycle_days=10, next_due='2026-10-01' WHERE id=9;   -- Laub harken
UPDATE recurring_tasks SET seasonal_months='[8,9,10]'        , cycle_days=365, next_due='2026-08-15' WHERE id=10; -- Holz hacken
UPDATE recurring_tasks SET seasonal_months='[8,9,10]'        , cycle_days=365, next_due='2026-08-20' WHERE id=11; -- Holz stapeln
UPDATE recurring_tasks SET seasonal_months='[9,10,11,12,1,2,3]', cycle_days=60, next_due='2026-09-01' WHERE id=12;-- Holzvorrat
UPDATE recurring_tasks SET seasonal_months='[3,9]'           , cycle_days=90, next_due='2026-09-01' WHERE id=13;  -- Außenbeleuchtung
-- #14 Steckdosen prüfen: keine Saisonalität
UPDATE recurring_tasks SET seasonal_months='[]'              , next_due='2026-05-16' WHERE id=14;
-- #15 E-Check: keine Saisonalität
UPDATE recurring_tasks SET seasonal_months='[]'              , next_due='2026-09-30' WHERE id=15;
UPDATE recurring_tasks SET seasonal_months='[4,5,6,7,8,9,10]', cycle_days=30, next_due='2026-05-01' WHERE id=16;  -- Gartenhaus putzen
UPDATE recurring_tasks SET seasonal_months='[5,6,7,8,9]'     , cycle_days=30, next_due='2026-05-01' WHERE id=17;  -- Terrasse reinigen
UPDATE recurring_tasks SET seasonal_months='[4,10]'          , cycle_days=180, next_due='2026-10-01' WHERE id=18; -- Regenrinnen
UPDATE recurring_tasks SET seasonal_months='[4,6,8,10]'      , cycle_days=60, next_due='2026-06-01' WHERE id=19;  -- Fenster putzen
-- #20 Werkzeug pflegen: statisch (2x/Jahr Pre/Post-Saison)
UPDATE recurring_tasks SET seasonal_months='[3,10]'          , cycle_days=180, next_due='2026-10-01' WHERE id=20; -- Werkzeug
UPDATE recurring_tasks SET seasonal_months='[4,9]'           , cycle_days=180, next_due='2026-09-01' WHERE id=21; -- Zaun
UPDATE recurring_tasks SET seasonal_months='[10]'            , cycle_days=365, next_due='2026-10-15' WHERE id=22; -- Winterfest
UPDATE recurring_tasks SET seasonal_months='[3]'             , cycle_days=365, next_due='2027-03-15' WHERE id=23; -- Frühjahrs-Check

-- ======================================
-- Phase 8: Agent-Escalation-State Cleanup
-- ======================================

UPDATE agent_escalation_state
   SET cancelled=1,
       cancel_reason='reprioritized_2026_04_18',
       updated_at=datetime('now','localtime')
 WHERE COALESCE(cancelled,0)=0;

-- ======================================
-- Phase 9: Audit-Log
-- ======================================

INSERT INTO agent_actions_log (source, action_type, description, details, success, created_at)
VALUES ('worker_g',
        'bulk_reprio_2026_04_18',
        'Worker G Tasks-Reprioritization — Duplikate + Mai/Juni/Juli-Buckets + Recurring saisonalisiert',
        '{"duplicates_marked":10,"archived":3,"mai_tasks":18,"juni_tasks":16,"juli_tasks":9,"recurring_updated":23,"escalations_cancelled":true}',
        1,
        datetime('now','localtime'));

COMMIT;

-- WAL checkpoint
PRAGMA wal_checkpoint(TRUNCATE);
