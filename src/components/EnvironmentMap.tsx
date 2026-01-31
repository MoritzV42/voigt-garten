import { useEffect, useRef, useState } from 'react';

interface POI {
  name: string;
  category: 'restaurant' | 'shopping' | 'nature' | 'culture';
  lat: number;
  lng: number;
  description: string;
  website?: string;
  distance?: string;
}

// POIs in der Umgebung von Etzdorf/Heideland
// Koordinaten basieren auf der Region um den Plus Code XXJ2+4JX Heideland
const POIS: POI[] = [
  // Restaurants
  {
    name: 'Gasthof Zum Rosental',
    category: 'restaurant',
    lat: 51.2180,
    lng: 12.1350,
    description: 'Traditionelle sächsische Küche in rustikalem Ambiente',
    distance: '~3 km'
  },
  {
    name: 'Landgasthof Heideland',
    category: 'restaurant',
    lat: 51.2250,
    lng: 12.1200,
    description: 'Regionale Spezialitäten und Biergarten',
    distance: '~4 km'
  },
  {
    name: 'Zum Goldenen Stern',
    category: 'restaurant',
    lat: 51.2100,
    lng: 12.1500,
    description: 'Gutbürgerliche Küche, bekannt für Wildgerichte',
    distance: '~5 km'
  },

  // Einkauf
  {
    name: 'REWE Borna',
    category: 'shopping',
    lat: 51.1241,
    lng: 12.4956,
    description: 'Vollsortiment Supermarkt',
    distance: '~15 km'
  },
  {
    name: 'Edeka Pegau',
    category: 'shopping',
    lat: 51.1689,
    lng: 12.2522,
    description: 'Lebensmittel und regionale Produkte',
    distance: '~10 km'
  },
  {
    name: 'Bauernhofladen Rosental',
    category: 'shopping',
    lat: 51.2150,
    lng: 12.1400,
    description: 'Frische regionale Produkte direkt vom Hof',
    distance: '~4 km'
  },

  // Natur & Wandern
  {
    name: 'Elsteraue Naturpark',
    category: 'nature',
    lat: 51.2000,
    lng: 12.1300,
    description: 'Wunderschöne Flusslandschaft mit Wanderwegen',
    distance: '~2 km'
  },
  {
    name: 'Weinberg-Wanderweg',
    category: 'nature',
    lat: 51.2200,
    lng: 12.1280,
    description: 'Panorama-Route durch die Weinberge',
    distance: 'Direkt ab Garten'
  },
  {
    name: 'Bergbau-Technik-Park',
    category: 'nature',
    lat: 51.1800,
    lng: 12.2000,
    description: 'Industriegeschichte und Landschaftswandel',
    distance: '~8 km'
  },

  // Kultur
  {
    name: 'Schloss Altenburg',
    category: 'culture',
    lat: 50.9853,
    lng: 12.4355,
    description: 'Historisches Residenzschloss mit Museum',
    distance: '~25 km'
  },
  {
    name: 'Leipzig Zentrum',
    category: 'culture',
    lat: 51.3397,
    lng: 12.3731,
    description: 'Kulturstadt mit vielfältigem Angebot',
    distance: '~30 km'
  },
];

// Garden location (Etzdorf im Rosental)
const GARDEN_LOCATION = {
  lat: 51.2200,
  lng: 12.1300,
};

const CATEGORY_STYLES: Record<string, { icon: string; color: string; label: string }> = {
  restaurant: { icon: '🍽️', color: '#ef4444', label: 'Restaurants' },
  shopping: { icon: '🛒', color: '#3b82f6', label: 'Einkauf' },
  nature: { icon: '🌲', color: '#22c55e', label: 'Natur' },
  culture: { icon: '🏛️', color: '#a855f7', label: 'Kultur' },
};

export default function EnvironmentMap() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [leafletLoaded, setLeafletLoaded] = useState(false);

  // Load Leaflet once on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadLeaflet = async () => {
      // Add Leaflet CSS if not present
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

      // Load Leaflet JS if not present
      if (!(window as any).L) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = () => resolve();
          document.head.appendChild(script);
        });
      }

      setLeafletLoaded(true);
    };

    loadLeaflet();
  }, []);

  // Initialize map once Leaflet is loaded
  useEffect(() => {
    if (!leafletLoaded || !mapContainerRef.current || mapInstanceRef.current) return;

    const L = (window as any).L;

    // Create map
    const map = L.map(mapContainerRef.current, {
      center: [GARDEN_LOCATION.lat, GARDEN_LOCATION.lng],
      zoom: 11,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    // Add garden marker (permanent)
    const gardenIcon = L.divIcon({
      className: 'garden-marker',
      html: `<div style="background: #16a34a; color: white; width: 44px; height: 44px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; border: 3px solid white; box-shadow: 0 3px 10px rgba(0,0,0,0.4); cursor: pointer;">🏡</div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -44],
    });

    L.marker([GARDEN_LOCATION.lat, GARDEN_LOCATION.lng], { icon: gardenIcon })
      .addTo(map)
      .bindPopup(`
        <div style="text-align: center; padding: 10px; min-width: 160px;">
          <strong style="font-size: 14px;">Garten Etzdorf</strong><br>
          <span style="color: #666; font-size: 12px;">Dein Ziel!</span><br><br>
          <a href="https://www.google.com/maps/dir/?api=1&destination=51.2200,12.1300"
             target="_blank"
             style="display: inline-block; background: #16a34a; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none; font-size: 12px;">
            🗺️ Route planen
          </a>
        </div>
      `);

    mapInstanceRef.current = map;
    setIsMapReady(true);

    // Cleanup on unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [leafletLoaded]);

  // Update markers when filter changes
  useEffect(() => {
    if (!isMapReady || !mapInstanceRef.current) return;

    const L = (window as any).L;
    const map = mapInstanceRef.current;

    // Remove existing POI markers
    markersRef.current.forEach(marker => map.removeLayer(marker));
    markersRef.current = [];

    // Filter POIs
    const filteredPOIs = filterCategory
      ? POIS.filter(p => p.category === filterCategory)
      : POIS;

    // Add new markers
    filteredPOIs.forEach(poi => {
      const style = CATEGORY_STYLES[poi.category];
      const poiIcon = L.divIcon({
        className: 'poi-marker',
        html: `<div style="background: ${style.color}; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); cursor: pointer;">${style.icon}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -34],
      });

      const marker = L.marker([poi.lat, poi.lng], { icon: poiIcon })
        .addTo(map)
        .bindPopup(`
          <div style="min-width: 180px; padding: 5px;">
            <strong style="font-size: 14px;">${poi.name}</strong><br>
            <span style="color: #666; font-size: 12px;">${poi.description}</span><br>
            ${poi.distance ? `<span style="color: #16a34a; font-size: 12px; display: block; margin-top: 4px;">📍 ${poi.distance}</span>` : ''}
            ${poi.website ? `<a href="${poi.website}" target="_blank" style="color: #3b82f6; font-size: 12px; display: block; margin-top: 4px;">🔗 Website besuchen</a>` : ''}
          </div>
        `);

      markersRef.current.push(marker);
    });
  }, [filterCategory, isMapReady]);

  const filteredPOIs = filterCategory
    ? POIS.filter(p => p.category === filterCategory)
    : POIS;

  return (
    <div className="space-y-6">
      {/* Filter Buttons */}
      <div className="flex flex-wrap gap-2 justify-center">
        <button
          onClick={() => setFilterCategory(null)}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
            !filterCategory
              ? 'bg-garden-600 text-white shadow-md'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Alle ({POIS.length})
        </button>
        {Object.entries(CATEGORY_STYLES).map(([category, style]) => {
          const count = POIS.filter(p => p.category === category).length;
          const isActive = filterCategory === category;
          return (
            <button
              key={category}
              onClick={() => setFilterCategory(isActive ? null : category)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                isActive
                  ? 'text-white shadow-md'
                  : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
              }`}
              style={isActive ? { backgroundColor: style.color } : {}}
            >
              <span>{style.icon}</span>
              {style.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Map Container */}
      <div className="bg-white rounded-xl shadow-lg overflow-hidden border border-gray-200">
        <div
          ref={mapContainerRef}
          className="h-[450px] md:h-[550px] w-full"
          style={{ background: '#e5e7eb' }}
        >
          {!isMapReady && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-garden-600 mx-auto mb-3"></div>
                <p className="text-gray-500">Karte wird geladen...</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* POI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredPOIs.map((poi, index) => {
          const style = CATEGORY_STYLES[poi.category];
          return (
            <div
              key={index}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:shadow-md hover:border-gray-200 transition-all"
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0"
                  style={{ backgroundColor: style.color + '15' }}
                >
                  {style.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-gray-900 truncate">{poi.name}</h3>
                  <p className="text-sm text-gray-600 mt-0.5 line-clamp-2">{poi.description}</p>
                  {poi.distance && (
                    <p className="text-xs text-garden-600 mt-2 font-medium">📍 {poi.distance}</p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Navigation Button */}
      <div className="text-center pt-4">
        <a
          href="https://www.google.com/maps/dir/?api=1&destination=51.2200,12.1300"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-garden-600 hover:bg-garden-700 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all shadow-lg hover:shadow-xl"
        >
          🗺️ Navigation zum Garten starten
        </a>
      </div>
    </div>
  );
}
