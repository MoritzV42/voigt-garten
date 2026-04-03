export const MAP_AREAS = [
  { id: 'haus', label: 'Haus' },
  { id: 'wintergarten', label: 'Wintergarten' },
  { id: 'terrasse', label: 'Terrasse' },
  { id: 'carport', label: 'Carport' },
  { id: 'schuppen-1', label: 'Schuppen 1' },
  { id: 'schuppen-2', label: 'Schuppen 2' },
  { id: 'schuppen-3', label: 'Schuppen 3' },
  { id: 'schuppen-4', label: 'Schuppen 4' },
  { id: 'brunnen', label: 'Brunnen' },
  { id: 'beete-ost', label: 'Beete Ost' },
  { id: 'beete-west', label: 'Beete West' },
  { id: 'wiese-oben', label: 'Wiese oben' },
  { id: 'wiese-unten', label: 'Wiese unten' },
  { id: 'obstbaeume', label: 'Obstbäume' },
  { id: 'hecke-nord', label: 'Hecke Nord' },
  { id: 'einfahrt', label: 'Einfahrt' },
  { id: 'kompost', label: 'Kompost' },
] as const;

export type MapAreaId = typeof MAP_AREAS[number]['id'];

export function getAreaLabel(id: string): string {
  const area = MAP_AREAS.find(a => a.id === id);
  return area ? area.label : id;
}
