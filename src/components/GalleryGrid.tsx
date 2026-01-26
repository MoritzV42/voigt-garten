import { useState, useEffect } from 'react';

interface GalleryItem {
  id: string;
  url: string;
  thumbnailUrl?: string;
  name?: string;
  description?: string;
  category: string;
  type: 'image' | 'video';
  uploadedAt: string;
  uploadedBy?: string;
}

const CATEGORIES = [
  { id: 'all', name: 'Alle', emoji: '📸' },
  { id: 'haus', name: 'Gartenhaus', emoji: '🏡' },
  { id: 'terrasse', name: 'Terrasse', emoji: '🪴' },
  { id: 'luftaufnahmen', name: 'Luftaufnahmen', emoji: '🚁' },
  { id: 'beete', name: 'Beete', emoji: '🌻' },
  { id: 'wiese', name: 'Wiese/Rasen', emoji: '🌿' },
  { id: 'baeume', name: 'Bäume/Hecken', emoji: '🌳' },
  { id: 'sonstiges', name: 'Sonstiges', emoji: '📷' },
];

interface Props {
  refreshTrigger?: number;
}

export default function GalleryGrid({ refreshTrigger }: Props) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch gallery items
  useEffect(() => {
    const fetchItems = async () => {
      setIsLoading(true);
      try {
        const response = await fetch('/api/gallery');
        if (response.ok) {
          const data = await response.json();
          setItems(data.items || []);
        }
      } catch (error) {
        console.error('Error fetching gallery:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchItems();
  }, [refreshTrigger]);

  const filteredItems = selectedCategory === 'all'
    ? items
    : items.filter(item => item.category === selectedCategory);

  const getCategoryInfo = (categoryId: string) => {
    return CATEGORIES.find(c => c.id === categoryId) || CATEGORIES[CATEGORIES.length - 1];
  };

  // Group items by category for display
  const groupedByCategory = filteredItems.reduce((acc, item) => {
    if (!acc[item.category]) {
      acc[item.category] = [];
    }
    acc[item.category].push(item);
    return acc;
  }, {} as Record<string, GalleryItem[]>);

  return (
    <div className="space-y-6">
      {/* Category Filter */}
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`
                px-4 py-2 rounded-lg text-sm font-medium transition
                ${selectedCategory === cat.id
                  ? 'bg-garden-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }
              `}
            >
              {cat.emoji} {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Gallery Grid */}
      {isLoading ? (
        <div className="bg-white rounded-xl shadow p-12 text-center">
          <div className="text-4xl animate-pulse mb-2">📸</div>
          <p className="text-gray-500">Lade Galerie...</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="bg-white rounded-xl shadow p-12 text-center">
          <div className="text-6xl mb-4">🖼️</div>
          <p className="text-gray-600 mb-2">Noch keine Fotos vorhanden</p>
          <p className="text-gray-400 text-sm">
            Lade Bilder über das Upload-Formular hoch
          </p>
        </div>
      ) : (
        <>
          {/* Grid View (when "all" is selected, group by category) */}
          {selectedCategory === 'all' ? (
            Object.entries(groupedByCategory).map(([categoryId, categoryItems]) => {
              const cat = getCategoryInfo(categoryId);
              return (
                <div key={categoryId} className="bg-white rounded-xl shadow overflow-hidden">
                  <div className="bg-garden-50 p-4 border-b border-garden-100">
                    <h3 className="font-semibold text-garden-800">
                      {cat.emoji} {cat.name}
                    </h3>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                      {categoryItems.map(item => (
                        <GalleryThumbnail
                          key={item.id}
                          item={item}
                          onClick={() => setSelectedItem(item)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="bg-white rounded-xl shadow p-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {filteredItems.map(item => (
                  <GalleryThumbnail
                    key={item.id}
                    item={item}
                    onClick={() => setSelectedItem(item)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Lightbox Modal */}
      {selectedItem && (
        <Lightbox
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onPrev={() => {
            const idx = filteredItems.findIndex(i => i.id === selectedItem.id);
            if (idx > 0) setSelectedItem(filteredItems[idx - 1]);
          }}
          onNext={() => {
            const idx = filteredItems.findIndex(i => i.id === selectedItem.id);
            if (idx < filteredItems.length - 1) setSelectedItem(filteredItems[idx + 1]);
          }}
          hasPrev={filteredItems.findIndex(i => i.id === selectedItem.id) > 0}
          hasNext={filteredItems.findIndex(i => i.id === selectedItem.id) < filteredItems.length - 1}
        />
      )}
    </div>
  );
}

function GalleryThumbnail({ item, onClick }: { item: GalleryItem; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      className="relative aspect-square rounded-lg overflow-hidden cursor-pointer group bg-gray-100"
    >
      {item.type === 'image' ? (
        <img
          src={item.thumbnailUrl || item.url}
          alt={item.name || 'Galeriebild'}
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
          loading="lazy"
        />
      ) : (
        <>
          <video
            src={item.url}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <span className="text-white text-4xl">▶️</span>
          </div>
        </>
      )}

      {/* Hover Overlay */}
      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
        <div className="text-white text-sm truncate">
          {item.name || 'Ohne Titel'}
        </div>
      </div>

      {/* Video Badge */}
      {item.type === 'video' && (
        <div className="absolute top-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
          🎬 Video
        </div>
      )}
    </div>
  );
}

function Lightbox({
  item,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext
}: {
  item: GalleryItem;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}) {
  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      if (e.key === 'ArrowRight' && hasNext) onNext();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  return (
    <div
      className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Close Button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/80 hover:text-white text-4xl z-10"
      >
        ×
      </button>

      {/* Prev Button */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-5xl z-10"
        >
          ‹
        </button>
      )}

      {/* Next Button */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-4 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-5xl z-10"
        >
          ›
        </button>
      )}

      {/* Content */}
      <div
        className="max-w-6xl max-h-[90vh] px-4"
        onClick={(e) => e.stopPropagation()}
      >
        {item.type === 'image' ? (
          <img
            src={item.url}
            alt={item.name || 'Galeriebild'}
            className="max-w-full max-h-[80vh] object-contain rounded-lg"
          />
        ) : (
          <video
            src={item.url}
            controls
            autoPlay
            className="max-w-full max-h-[80vh] rounded-lg"
          />
        )}

        {/* Info Bar */}
        {(item.name || item.description) && (
          <div className="mt-4 text-center text-white">
            {item.name && (
              <h3 className="text-xl font-semibold">{item.name}</h3>
            )}
            {item.description && (
              <p className="text-white/70 mt-1">{item.description}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
