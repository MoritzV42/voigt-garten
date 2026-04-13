/**
 * Tour-Step-Definitionen für das Garten-Onboarding.
 *
 * Jeder Step referenziert ein DOM-Element via `data-tutorial` Attribut.
 * Steps sind seitenspezifisch (page).
 */

export type TourStep = {
  /** Muss mit `data-tutorial="..."` auf dem DOM-Element übereinstimmen */
  target: string;
  /** Überschrift im Tooltip */
  title: string;
  /** Beschreibungstext */
  body: string;
  /** Auf welcher Seite befindet sich das Target? */
  page: string;
};

/**
 * Haupt-Tour: Wird beim ersten Besuch angeboten.
 * Führt durch alle wichtigen Bereiche des Gartens.
 */
export const GARDEN_TOUR: TourStep[] = [
  // Startseite
  {
    target: "hero-section",
    title: "Willkommen im Refugium",
    body: "Das ist die Startseite. Hier findest du alle wichtigen Infos zum Garten auf einen Blick.",
    page: "/",
  },
  {
    target: "nav-links",
    title: "Navigation",
    body: "Über die Sidebar erreichst du alle Bereiche: Galerie, Buchung, Aufgaben, Inventar und mehr. Auf dem Handy findest du die Navigation am unteren Bildschirmrand.",
    page: "/",
  },
  // Galerie
  {
    target: "gallery-grid",
    title: "Fotogalerie",
    body: "Hier siehst du Fotos und Videos vom Garten. Du kannst nach Kategorien filtern und auch eigene Bilder hochladen.",
    page: "/galerie",
  },
  {
    target: "gallery-upload",
    title: "Bilder hochladen",
    body: "Lade eigene Fotos hoch. Als Nicht-Admin werden sie erst nach Freigabe sichtbar.",
    page: "/galerie",
  },
  // Buchen
  {
    target: "booking-form",
    title: "Übernachtung buchen",
    body: "Wähle dein Wunschdatum, die Anzahl der Gäste und buche direkt online. Der Preis wird live berechnet.",
    page: "/buchen",
  },
  // Aufgaben
  {
    target: "kanban-board",
    title: "Aufgaben & Projekte",
    body: "Das Kanban-Board zeigt alle offenen Aufgaben. Du kannst Tasks erstellen, zuweisen und den Fortschritt verfolgen.",
    page: "/taskmanagement",
  },
  // Inventar
  {
    target: "inventory-section",
    title: "Inventar-Verwaltung",
    body: "Hier ist das gesamte Inventar nach Gebäuden und Räumen organisiert. Du kannst Gegenstände suchen und verwalten.",
    page: "/inventar",
  },
  // Karte
  {
    target: "garden-map",
    title: "Gartenkarte",
    body: "Die interaktive Karte zeigt alle Bereiche des Gartens. Klicke auf einen Bereich für Details und Fotos.",
    page: "/gartenkarte",
  },
];

/**
 * Seiten-spezifische Hilfe-Steps.
 */
export function getPageHelpSteps(pathname: string): TourStep[] {
  return GARDEN_TOUR.filter((step) => step.page === pathname);
}
