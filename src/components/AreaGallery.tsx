import { useState, useEffect } from 'react';

interface GalleryItem {
  id: string;
  url: string;
  thumbnailUrl?: string;
  name?: string;
  description?: string;
  category: string;
  type: 'image' | 'video' | 'panorama';
  map_area?: string;
}

interface AreaGalleryProps {
  activeArea?: string;
  previousArea?: string;
  areaOrder: string[];
}

const API_BASE = import.meta.env.DEV ? 'http://localhost:5055' : '';

export default function AreaGallery({ activeArea, previousArea, areaOrder }: AreaGalleryProps) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/gallery`);
        if (res.ok) {
          const data = await res.json();
          setItems((data.items || []).filter((i: GalleryItem) => i.map_area));
        }
      } catch (err) {
        console.error('Failed to fetch gallery:', err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchItems();
  }, []);

  // Group by area
  const grouped = items.reduce((acc, item) => {
    const area = item.map_area || '';
    if (!acc[area]) acc[area] = [];
    acc[area].push(item);
    return acc;
  }, {} as Record<string, GalleryItem[]>);

  // Sort areas: active first, previous second, rest by areaOrder
  const sortedAreas = Object.keys(grouped).sort((a, b) => {
    if (a === activeArea) return -1;
    if (b === activeArea) return 1;
    if (a === previousArea) return -1;
    if (b === previousArea) return 1;
    const ai = areaOrder.indexOf(a);
    const bi = areaOrder.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  if (isLoading) {
    return (
      <div className="text-center py-8 text-gray-500">
        Lade Fotos...
      </div>
    );
  }

  if (sortedAreas.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400">
        Noch keine Fotos Kartenbereichen zugeordnet.
      </div>
    );
  }

  // Find area label from the SVG shapes (we'll use a simple lookup)
  const getAreaLabel = (id: string) => {
    // Import from mapAreas would cause circular dep in some setups, so inline
    const labels: Record<string, string> = {
      'haus': 'Haus', 'wintergarten': 'Wintergarten', 'terrasse': 'Terrasse',
      'carport': 'Carport', 'schuppen-1': 'Schuppen 1', 'schuppen-2': 'Schuppen 2',
      'schuppen-3': 'Schuppen 3', 'schuppen-4': 'Schuppen 4', 'brunnen': 'Brunnen',
      'beete-ost': 'Beete Ost', 'beete-west': 'Beete West', 'wiese-oben': 'Wiese oben',
      'wiese-unten': 'Wiese unten', 'obstbaeume': 'Obstbäume', 'hecke-nord': 'Hecke Nord',
      'einfahrt': 'Einfahrt', 'kompost': 'Kompost',
    };
    return labels[id] || id;
  };

  return (
    <div className="space-y-6">
      {sortedAreas.map(areaId => (
        <div
          key={areaId}
          className={`bg-white rounded-xl shadow overflow-hidden ${areaId === activeArea ? 'ring-2 ring-garden-500' : ''}`}
        >
          <div className="bg-garden-50 p-4 border-b border-garden-100">
            <h3 className="font-semibold text-garden-800">
              {getAreaLabel(areaId)}
              <span className="ml-2 text-sm font-normal text-garden-600">
                ({grouped[areaId].length} Foto{grouped[areaId].length > 1 ? 's' : ''})
              </span>
            </h3>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              {grouped[areaId].map(item => (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className="relative aspect-square rounded-lg overflow-hidden cursor-pointer group bg-gray-100"
                >
                  {item.type === 'video' ? (
                    <>
                      <video src={item.url} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <span className="text-white text-4xl">▶️</span>
                      </div>
                    </>
                  ) : (
                    <img
                      src={item.thumbnailUrl || item.url}
                      alt={item.name || 'Galeriebild'}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                      loading="lazy"
                    />
                  )}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
                    <div className="text-white text-sm truncate">
                      {item.name || 'Ohne Titel'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {/* Simple Lightbox */}
      {selectedItem && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center"
          onClick={() => setSelectedItem(null)}
        >
          <button
            onClick={() => setSelectedItem(null)}
            className="absolute top-4 right-4 text-white/80 hover:text-white text-4xl z-10"
          >
            ×
          </button>
          <div className="max-w-6xl max-h-[90vh] px-4" onClick={e => e.stopPropagation()}>
            {selectedItem.type === 'video' ? (
              <video src={selectedItem.url} controls autoPlay className="max-w-full max-h-[80vh] rounded-lg" />
            ) : (
              <img
                src={selectedItem.url}
                alt={selectedItem.name || 'Galeriebild'}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            )}
            {(selectedItem.name || selectedItem.description) && (
              <div className="mt-4 text-center text-white">
                {selectedItem.name && <h3 className="text-xl font-semibold">{selectedItem.name}</h3>}
                {selectedItem.description && <p className="text-white/70 mt-1">{selectedItem.description}</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
