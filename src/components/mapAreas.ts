export type MapCategory = 'gebaeude' | 'natur' | 'technik' | 'wasser';

export interface MapArea {
  id: string;
  label: string;
  category: MapCategory;
}

export const MAP_AREAS: readonly MapArea[] = [
  // Gebäude
  { id: 'haus', label: 'Haus', category: 'gebaeude' },
  { id: 'wintergarten', label: 'Wintergarten', category: 'gebaeude' },
  { id: 'terrasse', label: 'Terrasse', category: 'gebaeude' },
  { id: 'geraeteschuppen', label: 'Geräteschuppen', category: 'gebaeude' },
  { id: 'offener-schuppen', label: 'Offener Schuppen', category: 'gebaeude' },
  { id: 'holzschuppen', label: 'Holzschuppen', category: 'gebaeude' },
  { id: 'baumhaus', label: 'Baumhaus', category: 'gebaeude' },
  { id: 'klo', label: 'Klo', category: 'gebaeude' },
  { id: 'werkstatt', label: 'Werkstatt', category: 'gebaeude' },
  { id: 'zufahrt', label: 'Zufahrt', category: 'gebaeude' },
  { id: 'unterer-eingang', label: 'Unterer Eingang', category: 'gebaeude' },
  // Wasser
  { id: 'teich', label: 'Teich', category: 'wasser' },
  { id: 'pool', label: 'Pool', category: 'wasser' },
  { id: 'brunnen', label: 'Brunnen', category: 'wasser' },
  { id: 'wasserbehaelter-mauer', label: 'Wasserbehälter', category: 'wasser' },
  { id: 'baum-wassertank', label: 'Baum-Wassertank', category: 'wasser' },
  // Technik
  { id: 'solaranlage', label: 'Solaranlage', category: 'technik' },
  // Natur
  { id: 'weinberg', label: 'Weinberg', category: 'natur' },
  { id: 'eiche-1', label: 'Eiche 1', category: 'natur' },
  { id: 'eiche-2', label: 'Eiche 2', category: 'natur' },
  { id: 'terrassen-beet', label: 'Terrassenbeet', category: 'natur' },
  { id: 'kompost', label: 'Kompost', category: 'natur' },
  { id: 'oberer-kompost', label: 'Oberer Kompost', category: 'natur' },
  { id: 'hecke-mittig', label: 'Hecke', category: 'natur' },
  { id: 'rechter-teil', label: 'Rechter Grundstücksteil', category: 'natur' },
  { id: 'agrar-zukauf', label: 'Agrarfläche (Zukauf)', category: 'natur' },
] as const;

export type MapAreaId = typeof MAP_AREAS[number]['id'];

export const CATEGORY_COLORS: Record<MapCategory, string> = {
  gebaeude: '139, 90, 43',    // Brown
  natur: '34, 197, 94',        // Green
  technik: '245, 158, 11',     // Orange
  wasser: '59, 130, 246',      // Blue
};

export const CATEGORY_LABELS: Record<MapCategory, string> = {
  gebaeude: 'Gebäude',
  natur: 'Natur',
  technik: 'Technik',
  wasser: 'Wasser',
};

export const CATEGORY_ICONS: Record<MapCategory, string> = {
  gebaeude: '🏠',
  natur: '🌿',
  technik: '⚡',
  wasser: '💧',
};

export function getAreaLabel(id: string): string {
  const area = MAP_AREAS.find(a => a.id === id);
  return area ? area.label : id;
}

export function getAreaCategory(id: string): MapCategory | undefined {
  const area = MAP_AREAS.find(a => a.id === id);
  return area?.category;
}

export function getAreasByCategory(category: MapCategory): MapArea[] {
  return MAP_AREAS.filter(a => a.category === category);
}
