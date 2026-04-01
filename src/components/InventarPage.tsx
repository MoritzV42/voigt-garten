import { useState, useEffect, useCallback, useRef } from 'react';
import { AuthProvider, useAuth } from './AuthContext';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5055' : '';

interface Room {
  id: string;
  name: string;
  icon: string;
  building_id: string;
  floor_id?: string;
  sort_order: number;
  item_count: number;
}

interface Floor {
  id: string;
  name: string;
  icon: string;
  building_id: string;
  sort_order: number;
  rooms: Room[];
}

interface Building {
  id: string;
  name: string;
  icon: string;
  has_floors: boolean;
  sort_order: number;
  floors: Floor[];
  rooms: Room[];
}

interface InventoryItem {
  id: string;
  name: string;
  room_id: string;
  category: string | null;
  notes: string | null;
  quantity: number;
  photo_path: string | null;
  ablageort: string | null;
  position: string | null;
  kauflink: string | null;
  vorhanden: boolean | number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  room_name?: string;
  building_id?: string;
  building_name?: string;
}

interface FurnitureMeta {
  room_id: string;
  ablageort: string;
  icon: string;
}

const CATEGORIES = [
  { value: 'werkzeug', label: 'Werkzeug', color: 'bg-orange-100 text-orange-800' },
  { value: 'moebel', label: 'Möbel', color: 'bg-amber-100 text-amber-800' },
  { value: 'lebensmittel', label: 'Lebensmittel', color: 'bg-green-100 text-green-800' },
  { value: 'gartenbedarf', label: 'Gartenbedarf', color: 'bg-emerald-100 text-emerald-800' },
  { value: 'haushalt', label: 'Haushalt', color: 'bg-blue-100 text-blue-800' },
  { value: 'elektrik', label: 'Elektrik', color: 'bg-yellow-100 text-yellow-800' },
  { value: 'sonstiges', label: 'Sonstiges', color: 'bg-gray-100 text-gray-800' },
];

function getCategoryBadge(category: string | null) {
  const cat = CATEGORIES.find(c => c.value === category);
  if (!cat) return null;
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cat.color}`}>
      {cat.label}
    </span>
  );
}

function InventarContent() {
  const { user, token, isAdmin } = useAuth();

  const [buildings, setBuildings] = useState<Building[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [furnitureMeta, setFurnitureMeta] = useState<FurnitureMeta[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'inventar' | 'einkaufsliste'>('inventar');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(true);

  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(new Set());
  const [expandedFloors, setExpandedFloors] = useState<Set<string>>(new Set());
  const [expandedRooms, setExpandedRooms] = useState<Set<string>>(new Set());
  const [expandedFurniture, setExpandedFurniture] = useState<Set<string>>(new Set());

  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  const fetchBuildings = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/inventory/buildings`);
      const data = await res.json();
      setBuildings(data.buildings || []);
    } catch (e) {
      console.error('Failed to fetch buildings:', e);
    }
  }, []);

  const fetchItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (activeTab === 'einkaufsliste') params.set('vorhanden', 'false');
      const res = await fetch(`${API_BASE}/api/inventory/items?${params}`);
      const data = await res.json();
      setItems(data.items || []);
    } catch (e) {
      console.error('Failed to fetch items:', e);
    }
  }, [debouncedSearch, activeTab]);

  const fetchFurnitureMeta = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/inventory/furniture-meta`);
      const data = await res.json();
      setFurnitureMeta(data.meta || []);
    } catch (e) {
      console.error('Failed to fetch furniture meta:', e);
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchBuildings(), fetchItems(), fetchFurnitureMeta()]).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchItems();
  }, [debouncedSearch, activeTab]);

  // Auto-expand when searching
  useEffect(() => {
    if (!debouncedSearch) return;
    const newBuildings = new Set<string>();
    const newFloors = new Set<string>();
    const newRooms = new Set<string>();
    const newFurniture = new Set<string>();

    for (const item of items) {
      if (item.room_id) {
        newRooms.add(item.room_id);
        // Find building/floor for this room
        for (const b of buildings) {
          if (b.has_floors) {
            for (const f of b.floors) {
              for (const r of f.rooms) {
                if (r.id === item.room_id) {
                  newBuildings.add(b.id);
                  newFloors.add(f.id);
                }
              }
            }
          } else {
            for (const r of b.rooms) {
              if (r.id === item.room_id) {
                newBuildings.add(b.id);
              }
            }
          }
        }
      }
      if (item.ablageort) {
        newFurniture.add(`${item.room_id}__${item.ablageort}`);
      }
    }

    setExpandedBuildings(newBuildings);
    setExpandedFloors(newFloors);
    setExpandedRooms(newRooms);
    setExpandedFurniture(newFurniture);
  }, [items, debouncedSearch, buildings]);

  const toggle = (set: Set<string>, setFn: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setFn(next);
  };

  const getItemsForRoom = (roomId: string) => items.filter(i => i.room_id === roomId);

  const getFurnitureIcon = (roomId: string, ablageort: string) => {
    const meta = furnitureMeta.find(m => m.room_id === roomId && m.ablageort === ablageort);
    return meta?.icon || '🪑';
  };

  const groupByAblageort = (roomItems: InventoryItem[]) => {
    const groups: Record<string, InventoryItem[]> = {};
    const ungrouped: InventoryItem[] = [];
    for (const item of roomItems) {
      if (item.ablageort) {
        if (!groups[item.ablageort]) groups[item.ablageort] = [];
        groups[item.ablageort].push(item);
      } else {
        ungrouped.push(item);
      }
    }
    return { groups, ungrouped };
  };

  const groupByPosition = (furnitureItems: InventoryItem[]) => {
    const groups: Record<string, InventoryItem[]> = {};
    const ungrouped: InventoryItem[] = [];
    for (const item of furnitureItems) {
      if (item.position) {
        if (!groups[item.position]) groups[item.position] = [];
        groups[item.position].push(item);
      } else {
        ungrouped.push(item);
      }
    }
    return { groups, ungrouped };
  };

  const handleDelete = async (itemId: string) => {
    if (!confirm('Gegenstand wirklich löschen?')) return;
    try {
      await fetch(`${API_BASE}/api/inventory/items/${itemId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      await fetchItems();
      await fetchBuildings();
    } catch (e) {
      console.error('Delete failed:', e);
    }
  };

  const handleToggleVorhanden = async (item: InventoryItem) => {
    try {
      await fetch(`${API_BASE}/api/inventory/items/${item.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ vorhanden: !item.vorhanden }),
      });
      await fetchItems();
    } catch (e) {
      console.error('Toggle failed:', e);
    }
  };

  const renderItem = (item: InventoryItem) => {
    const isVorhanden = item.vorhanden === true || item.vorhanden === 1;
    return (
      <div
        key={item.id}
        className={`flex items-center justify-between py-2 px-3 rounded-lg group hover:bg-garden-50 transition ${!isVorhanden ? 'opacity-60' : ''}`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {user && (
            <button
              onClick={() => handleToggleVorhanden(item)}
              className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition ${
                isVorhanden
                  ? 'bg-garden-600 border-garden-600 text-white'
                  : 'border-gray-300 hover:border-garden-400'
              }`}
              title={isVorhanden ? 'Als fehlend markieren' : 'Als vorhanden markieren'}
            >
              {isVorhanden && (
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-medium text-sm ${!isVorhanden ? 'line-through text-gray-500' : 'text-gray-900'}`}>
                {item.name}
              </span>
              {item.quantity > 1 && (
                <span className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                  x{item.quantity}
                </span>
              )}
              {getCategoryBadge(item.category)}
            </div>
            {item.notes && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">{item.notes}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
          {item.kauflink && (
            <a
              href={item.kauflink}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 text-garden-600 hover:text-garden-800"
              title="Kauflink"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          )}
          {user && (
            <button
              onClick={() => setEditingItem(item)}
              className="p-1 text-gray-400 hover:text-garden-600"
              title="Bearbeiten"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => handleDelete(item.id)}
              className="p-1 text-gray-400 hover:text-red-600"
              title="Löschen"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderItemsInRoom = (roomId: string) => {
    const roomItems = getItemsForRoom(roomId);
    if (roomItems.length === 0) {
      return <p className="text-sm text-gray-400 italic py-2 pl-4">Keine Gegenstände</p>;
    }

    const { groups, ungrouped } = groupByAblageort(roomItems);

    return (
      <div className="pl-2">
        {/* Furniture groups */}
        {Object.entries(groups).sort().map(([ablageort, furnitureItems]) => {
          const fKey = `${roomId}__${ablageort}`;
          const isExpanded = expandedFurniture.has(fKey);
          const icon = getFurnitureIcon(roomId, ablageort);

          return (
            <div key={fKey} className="mb-1">
              <button
                onClick={() => toggle(expandedFurniture, setExpandedFurniture, fKey)}
                className="flex items-center gap-2 w-full text-left py-1.5 px-2 rounded hover:bg-earth-50 transition"
              >
                <span className="text-xs text-gray-400">{isExpanded ? '▾' : '▸'}</span>
                <span>{icon}</span>
                <span className="text-sm font-medium text-earth-700">{ablageort}</span>
                <span className="text-xs text-gray-400">({furnitureItems.length})</span>
              </button>
              {isExpanded && (
                <div className="pl-6">
                  {renderFurnitureItems(furnitureItems)}
                </div>
              )}
            </div>
          );
        })}
        {/* Ungrouped items */}
        {ungrouped.map(item => renderItem(item))}
      </div>
    );
  };

  const renderFurnitureItems = (furnitureItems: InventoryItem[]) => {
    const { groups, ungrouped } = groupByPosition(furnitureItems);

    return (
      <>
        {Object.entries(groups).sort().map(([position, posItems]) => (
          <div key={position} className="mb-1">
            <div className="flex items-center gap-1 py-1 px-2">
              <span className="text-xs text-gray-400">📂</span>
              <span className="text-xs font-medium text-gray-500">{position}</span>
            </div>
            <div className="pl-4">
              {posItems.map(item => renderItem(item))}
            </div>
          </div>
        ))}
        {ungrouped.map(item => renderItem(item))}
      </>
    );
  };

  const renderRoom = (room: Room, indent: number) => {
    const isExpanded = expandedRooms.has(room.id);
    const roomItemCount = items.filter(i => i.room_id === room.id).length;
    const displayCount = roomItemCount || room.item_count;

    return (
      <div key={room.id} style={{ paddingLeft: `${indent}px` }}>
        <button
          onClick={() => toggle(expandedRooms, setExpandedRooms, room.id)}
          className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-garden-50 transition"
        >
          <span className="text-sm text-gray-400">{isExpanded ? '▾' : '▸'}</span>
          <span className="text-lg">{room.icon}</span>
          <span className="font-medium text-gray-800">{room.name}</span>
          {displayCount > 0 && (
            <span className="ml-auto text-xs font-medium text-garden-600 bg-garden-100 px-2 py-0.5 rounded-full">
              {displayCount}
            </span>
          )}
        </button>
        {isExpanded && renderItemsInRoom(room.id)}
      </div>
    );
  };

  const renderFloor = (floor: Floor, buildingId: string) => {
    const isExpanded = expandedFloors.has(floor.id);
    const floorItemCount = floor.rooms.reduce((sum, r) => {
      const rc = items.filter(i => i.room_id === r.id).length;
      return sum + (rc || r.item_count);
    }, 0);

    return (
      <div key={floor.id} className="pl-4">
        <button
          onClick={() => toggle(expandedFloors, setExpandedFloors, floor.id)}
          className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-garden-50/50 transition"
        >
          <span className="text-sm text-gray-400">{isExpanded ? '▾' : '▸'}</span>
          <span className="text-lg">{floor.icon}</span>
          <span className="font-semibold text-gray-700">{floor.name}</span>
          {floorItemCount > 0 && (
            <span className="ml-auto text-xs font-medium text-earth-600 bg-earth-100 px-2 py-0.5 rounded-full">
              {floorItemCount}
            </span>
          )}
        </button>
        {isExpanded && (
          <div>
            {floor.rooms.map(room => renderRoom(room, 16))}
          </div>
        )}
      </div>
    );
  };

  const renderBuilding = (building: Building) => {
    const isExpanded = expandedBuildings.has(building.id);
    const totalItems = building.has_floors
      ? building.floors.reduce((sum, f) => sum + f.rooms.reduce((s, r) => {
          const rc = items.filter(i => i.room_id === r.id).length;
          return s + (rc || r.item_count);
        }, 0), 0)
      : building.rooms.reduce((sum, r) => {
          const rc = items.filter(i => i.room_id === r.id).length;
          return sum + (rc || r.item_count);
        }, 0);

    return (
      <div key={building.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-3">
        <button
          onClick={() => toggle(expandedBuildings, setExpandedBuildings, building.id)}
          className="flex items-center gap-3 w-full text-left py-3 px-4 hover:bg-garden-50/30 transition"
        >
          <span className="text-gray-400">{isExpanded ? '▾' : '▸'}</span>
          <span className="text-2xl">{building.icon}</span>
          <span className="text-lg font-bold text-garden-900">{building.name}</span>
          {totalItems > 0 && (
            <span className="ml-auto text-sm font-semibold text-garden-700 bg-garden-100 px-3 py-1 rounded-full">
              {totalItems}
            </span>
          )}
        </button>
        {isExpanded && (
          <div className="border-t border-gray-100 py-2 px-2">
            {building.has_floors
              ? building.floors.map(floor => renderFloor(floor, building.id))
              : building.rooms.map(room => renderRoom(room, 8))
            }
          </div>
        )}
      </div>
    );
  };

  // Shopping list view
  const renderShoppingList = () => {
    if (items.length === 0) {
      return (
        <div className="text-center py-12">
          <p className="text-6xl mb-4">🎉</p>
          <p className="text-lg text-gray-500">Alles vorhanden! Keine Einkäufe nötig.</p>
        </div>
      );
    }

    // Group by room
    const byRoom: Record<string, InventoryItem[]> = {};
    for (const item of items) {
      const key = item.room_name || 'Unbekannt';
      if (!byRoom[key]) byRoom[key] = [];
      byRoom[key].push(item);
    }

    return (
      <div className="space-y-4">
        {Object.entries(byRoom).map(([roomName, roomItems]) => (
          <div key={roomName} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-700 mb-2">{roomName}</h3>
            <div className="space-y-1">
              {roomItems.map(item => (
                <div key={item.id} className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-gray-50">
                  {user && (
                    <button
                      onClick={() => handleToggleVorhanden(item)}
                      className="w-5 h-5 rounded border-2 border-gray-300 hover:border-garden-400 flex-shrink-0"
                      title="Als vorhanden markieren"
                    />
                  )}
                  <span className="text-sm text-gray-700">{item.name}</span>
                  {item.quantity > 1 && (
                    <span className="text-xs text-gray-500">x{item.quantity}</span>
                  )}
                  {getCategoryBadge(item.category)}
                  {item.kauflink && (
                    <a
                      href={item.kauflink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto text-garden-600 hover:text-garden-800 text-xs underline"
                    >
                      Kaufen
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-garden-600" />
      </div>
    );
  }

  return (
    <div>
      {/* Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Tabs */}
        <div className="flex bg-gray-100 rounded-lg p-1 flex-shrink-0">
          <button
            onClick={() => setActiveTab('inventar')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === 'inventar'
                ? 'bg-white text-garden-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Inventar
          </button>
          <button
            onClick={() => setActiveTab('einkaufsliste')}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              activeTab === 'einkaufsliste'
                ? 'bg-white text-garden-700 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Einkaufsliste
          </button>
        </div>

        {/* Search */}
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Suchen... (z.B. Hammer, Schrauben)"
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Add Button */}
        {user && (
          <button
            onClick={() => { setEditingItem(null); setShowAddModal(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition font-medium text-sm flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Hinzufügen
          </button>
        )}
      </div>

      {/* Search result count */}
      {debouncedSearch && (
        <p className="text-sm text-gray-500 mb-4">
          {items.length} Ergebnis{items.length !== 1 ? 'se' : ''} für "{debouncedSearch}"
        </p>
      )}

      {/* Content */}
      {activeTab === 'inventar' ? (
        <div>
          {buildings.map(building => renderBuilding(building))}
          {buildings.length === 0 && (
            <p className="text-center text-gray-500 py-12">Keine Gebäude gefunden.</p>
          )}
        </div>
      ) : (
        renderShoppingList()
      )}

      {/* Add/Edit Modal */}
      {(showAddModal || editingItem) && (
        <ItemModal
          item={editingItem}
          buildings={buildings}
          token={token}
          onClose={() => { setShowAddModal(false); setEditingItem(null); }}
          onSaved={() => {
            setShowAddModal(false);
            setEditingItem(null);
            fetchItems();
            fetchBuildings();
          }}
        />
      )}
    </div>
  );
}

interface ItemModalProps {
  item: InventoryItem | null;
  buildings: Building[];
  token: string | null;
  onClose: () => void;
  onSaved: () => void;
}

function ItemModal({ item, buildings, token, onClose, onSaved }: ItemModalProps) {
  const [name, setName] = useState(item?.name || '');
  const [roomId, setRoomId] = useState(item?.room_id || '');
  const [category, setCategory] = useState(item?.category || '');
  const [ablageort, setAblageort] = useState(item?.ablageort || '');
  const [position, setPosition] = useState(item?.position || '');
  const [quantity, setQuantity] = useState(item?.quantity || 1);
  const [notes, setNotes] = useState(item?.notes || '');
  const [kauflink, setKauflink] = useState(item?.kauflink || '');
  const [vorhanden, setVorhanden] = useState(item ? (item.vorhanden === true || item.vorhanden === 1) : true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Collect all rooms for the select
  const allRooms: { id: string; name: string; buildingName: string; floorName?: string }[] = [];
  for (const b of buildings) {
    if (b.has_floors) {
      for (const f of b.floors) {
        for (const r of f.rooms) {
          allRooms.push({ id: r.id, name: r.name, buildingName: b.name, floorName: f.name });
        }
      }
    } else {
      for (const r of b.rooms) {
        allRooms.push({ id: r.id, name: r.name, buildingName: b.name });
      }
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Name ist erforderlich');
      return;
    }

    setSaving(true);
    setError('');

    const body = {
      name: name.trim(),
      room_id: roomId || null,
      category: category || null,
      ablageort: ablageort.trim() || null,
      position: position.trim() || null,
      quantity,
      notes: notes.trim() || null,
      kauflink: kauflink.trim() || null,
      vorhanden,
    };

    try {
      const url = item
        ? `${API_BASE}/api/inventory/items/${item.id}`
        : `${API_BASE}/api/inventory/items`;
      const res = await fetch(url, {
        method: item ? 'PATCH' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        onSaved();
      } else {
        const data = await res.json();
        setError(data.error || 'Fehler beim Speichern');
      }
    } catch (e) {
      setError('Verbindungsfehler');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-garden-900">
              {item ? 'Gegenstand bearbeiten' : 'Neuer Gegenstand'}
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
                placeholder="z.B. Akkuschrauber"
                autoFocus
              />
            </div>

            {/* Room */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Raum</label>
              <select
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
              >
                <option value="">-- Kein Raum --</option>
                {(() => {
                  const grouped: Record<string, typeof allRooms> = {};
                  for (const r of allRooms) {
                    const key = r.floorName ? `${r.buildingName} - ${r.floorName}` : r.buildingName;
                    if (!grouped[key]) grouped[key] = [];
                    grouped[key].push(r);
                  }
                  return Object.entries(grouped).map(([group, rooms]) => (
                    <optgroup key={group} label={group}>
                      {rooms.map(r => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </optgroup>
                  ));
                })()}
              </select>
            </div>

            {/* Ablageort & Position */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Möbel / Ablageort</label>
                <input
                  type="text"
                  value={ablageort}
                  onChange={e => setAblageort(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
                  placeholder="z.B. Werkzeugschrank"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fach / Position</label>
                <input
                  type="text"
                  value={position}
                  onChange={e => setPosition(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
                  placeholder="z.B. Oberes Fach"
                />
              </div>
            </div>

            {/* Category & Quantity */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kategorie</label>
                <select
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
                >
                  <option value="">-- Keine --</option>
                  {CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Menge</label>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={e => setQuantity(parseInt(e.target.value) || 1)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notizen</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none resize-none"
                placeholder="Optionale Notizen..."
              />
            </div>

            {/* Kauflink */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kauflink</label>
              <input
                type="url"
                value={kauflink}
                onChange={e => setKauflink(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-garden-500 focus:border-garden-500 outline-none"
                placeholder="https://..."
              />
            </div>

            {/* Vorhanden */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={!vorhanden}
                onChange={e => setVorhanden(!e.target.checked)}
                className="w-4 h-4 text-garden-600 border-gray-300 rounded focus:ring-garden-500"
              />
              <span className="text-sm text-gray-700">Nicht vorhanden (Einkaufsliste)</span>
            </label>

            {/* Buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
              >
                Abbrechen
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 px-4 py-2 bg-garden-600 text-white rounded-lg hover:bg-garden-700 transition disabled:opacity-50"
              >
                {saving ? 'Speichern...' : (item ? 'Speichern' : 'Hinzufügen')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default function InventarPage() {
  return (
    <AuthProvider>
      <InventarContent />
    </AuthProvider>
  );
}
