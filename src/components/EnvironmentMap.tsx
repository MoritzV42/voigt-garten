import { useEffect, useRef, useState, useCallback } from 'react';

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
const POIS: POI[] = [
  // Restaurants
  {
    name: 'Gasthof Zum Rosental',
    category: 'restaurant',
    lat: 51.2180,
    lng: 12.1350,
    description: 'Traditionelle sächsische Küche in rustikalem Ambiente',
    website: 'https://www.gasthof-rosental.de',
    distance: '~3 km'
  },
  {
    name: 'Landgasthof Heideland',
    category: 'restaurant',
    lat: 51.2250,
    lng: 12.1200,
    description: 'Regionale Spezialitäten und Biergarten',
    website: 'https://www.landgasthof-heideland.de',
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
    website: 'https://www.rewe.de',
    distance: '~15 km'
  },
  {
    name: 'Edeka Pegau',
    category: 'shopping',
    lat: 51.1689,
    lng: 12.2522,
    description: 'Lebensmittel und regionale Produkte',
    website: 'https://www.edeka.de',
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
    website: 'https://www.bergbau-technik-park.de',
    distance: '~8 km'
  },

  // Kultur
  {
    name: 'Schloss Altenburg',
    category: 'culture',
    lat: 50.9853,
    lng: 12.4355,
    description: 'Historisches Residenzschloss mit Museum',
    website: 'https://www.residenzschloss-altenburg.de',
    distance: '~25 km'
  },
  {
    name: 'Leipzig Zentrum',
    category: 'culture',
    lat: 51.3397,
    lng: 12.3731,
    description: 'Kulturstadt mit vielfältigem Angebot',
    website: 'https://www.leipzig.travel',
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
  const markersRef = useRef<Map<number, any>>(new Map());
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const [filterCategory, setFilterCategory] = useState<string | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [selectedPOI, setSelectedPOI] = useState<number | null>(null);
  const [expandedPOI, setExpandedPOI] = useState<number | null>(null);

  // Load Leaflet once on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadLeaflet = async () => {
      if (!document.querySelector('link[href*="leaflet"]')) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
      }

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

    const map = L.map(mapContainerRef.current, {
      center: [GARDEN_LOCATION.lat, GARDEN_LOCATION.lng],
      zoom: 11,
      scrollWheelZoom: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    // Garden marker - GROSSER (56x56px)
    const gardenIcon = L.divIcon({
      className: 'garden-marker',
      html: `<div style="background: #16a34a; color: white; width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; border: 4px solid white; box-shadow: 0 4px 15px rgba(0,0,0,0.5); cursor: pointer;">🏡</div>`,
      iconSize: [56, 56],
      iconAnchor: [28, 56],
      popupAnchor: [0, -56],
    });

    L.marker([GARDEN_LOCATION.lat, GARDEN_LOCATION.lng], { icon: gardenIcon })
      .addTo(map)
      .bindPopup(`
        <div style="text-align: center; padding: 10px; min-width: 180px;">
          <strong style="font-size: 16px;">Voigt-Garten Etzdorf</strong><br>
          <span style="color: #666; font-size: 13px;">Dein Ziel!</span><br><br>
          <a href="https://www.google.com/maps/dir/?api=1&destination=51.2200,12.1300"
             target="_blank"
             style="display: inline-block; background: #16a34a; color: white; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">
            🗺️ Route planen
          </a>
        </div>
      `);

    mapInstanceRef.current = map;
    setIsMapReady(true);

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
    markersRef.current.clear();

    // Filter POIs
    const filteredPOIs = filterCategory
      ? POIS.filter(p => p.category === filterCategory)
      : POIS;

    // Add new markers with click handlers
    filteredPOIs.forEach((poi, filteredIndex) => {
      const originalIndex = POIS.findIndex(p => p.name === poi.name);
      const style = CATEGORY_STYLES[poi.category];

      const poiIcon = L.divIcon({
        className: 'poi-marker',
        html: `<div style="background: ${style.color}; color: white; width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white; box-shadow: 0 2px 8px rgba(0,0,0,0.3); cursor: pointer; transition: transform 0.2s;">${style.icon}</div>`,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -34],
      });

      const marker = L.marker([poi.lat, poi.lng], { icon: poiIcon })
        .addTo(map);

      // Click handler for marker -> scroll to card
      marker.on('click', () => {
        handleMarkerClick(originalIndex);
      });

      markersRef.current.set(originalIndex, marker);
    });
  }, [filterCategory, isMapReady]);

  // Handle marker click -> scroll to card and expand
  const handleMarkerClick = useCallback((index: number) => {
    setSelectedPOI(index);
    setExpandedPOI(index);

    // Scroll to card
    const cardElement = cardRefs.current.get(index);
    if (cardElement) {
      cardElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    // Clear highlight after 3 seconds
    setTimeout(() => {
      setSelectedPOI(null);
    }, 3000);
  }, []);

  // Handle card click -> center map and expand
  const handleCardClick = useCallback((index: number, poi: POI) => {
    setSelectedPOI(index);

    // Toggle expand
    if (expandedPOI === index) {
      setExpandedPOI(null);
    } else {
      setExpandedPOI(index);
    }

    // Center map on POI
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setView([poi.lat, poi.lng], 13, { animate: true });

      // Open marker popup
      const marker = markersRef.current.get(index);
      if (marker) {
        marker.openPopup();
      }
    }

    // Clear highlight after 3 seconds
    setTimeout(() => {
      setSelectedPOI(null);
    }, 3000);
  }, [expandedPOI]);

  // Get Google Maps route URL for a POI
  const getRouteUrl = (poi: POI) => {
    return `https://www.google.com/maps/dir/?api=1&origin=${GARDEN_LOCATION.lat},${GARDEN_LOCATION.lng}&destination=${poi.lat},${poi.lng}`;
  };

  const filteredPOIs = filterCategory
    ? POIS.filter(p => p.category === filterCategory)
    : POIS;

  return (
    <div className="space-y-6">
      {/* Route Button - Prominent at top */}
      <div className="text-center">
        <a
          href="https://www.google.com/maps/dir/?api=1&destination=51.2200,12.1300"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-3 bg-garden-600 hover:bg-garden-700 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all shadow-lg hover:shadow-xl"
        >
          🗺️ Route zum Garten berechnen
        </a>
      </div>

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
        {filteredPOIs.map((poi) => {
          const originalIndex = POIS.findIndex(p => p.name === poi.name);
          const style = CATEGORY_STYLES[poi.category];
          const isSelected = selectedPOI === originalIndex;
          const isExpanded = expandedPOI === originalIndex;

          return (
            <div
              key={originalIndex}
              ref={(el) => {
                if (el) cardRefs.current.set(originalIndex, el);
              }}
              className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden transition-all duration-300 cursor-pointer ${
                isSelected
                  ? 'border-garden-500 shadow-lg ring-2 ring-garden-200 animate-pulse'
                  : 'border-gray-100 hover:shadow-md hover:border-gray-200'
              }`}
              onClick={() => handleCardClick(originalIndex, poi)}
            >
              {/* Card Header - Always visible */}
              <div className="p-4">
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
                  <div className={`text-gray-400 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                    ▼
                  </div>
                </div>
              </div>

              {/* Expanded Content */}
              <div
                className={`overflow-hidden transition-all duration-300 ${
                  isExpanded ? 'max-h-[400px] opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="border-t border-gray-100">
                  {/* Website iframe */}
                  {poi.website && (
                    <div className="bg-gray-50 p-2">
                      <iframe
                        src={poi.website}
                        title={poi.name}
                        className="w-full h-48 rounded-lg border border-gray-200"
                        sandbox="allow-scripts allow-same-origin"
                        loading="lazy"
                      />
                      <a
                        href={poi.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline mt-1 block text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        🔗 Website in neuem Tab öffnen
                      </a>
                    </div>
                  )}

                  {/* Route Button */}
                  <div className="p-4 bg-gray-50">
                    <a
                      href={getRouteUrl(poi)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 w-full bg-garden-600 hover:bg-garden-700 text-white py-3 px-4 rounded-lg font-medium transition-colors"
                      onClick={(e) => e.stopPropagation()}
                    >
                      🗺️ Route planen
                    </a>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
