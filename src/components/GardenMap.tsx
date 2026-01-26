import { useState, useEffect } from 'react';

interface Zone {
  id: string;
  name: string;
  // SVG path or polygon points (percentage-based for responsiveness)
  path: string;
  category: string;
  tasks: string[];
}

interface TaskStatus {
  [taskId: string]: 'ok' | 'due-soon' | 'overdue';
}

// Predefined zones on the garden map
// These coordinates are placeholders - adjust after uploading actual drone image
const GARDEN_ZONES: Zone[] = [
  {
    id: 'haus',
    name: 'Gartenhaus',
    path: 'M 65,20 L 85,20 L 85,40 L 65,40 Z',
    category: 'putzen',
    tasks: ['gartenhaus-putzen', 'fenster-putzen']
  },
  {
    id: 'terrasse',
    name: 'Terrasse',
    path: 'M 55,40 L 85,40 L 85,55 L 55,55 Z',
    category: 'putzen',
    tasks: ['terrasse-reinigen']
  },
  {
    id: 'rasen-vorne',
    name: 'Rasen (vorne)',
    path: 'M 10,50 L 50,50 L 50,80 L 10,80 Z',
    category: 'rasen',
    tasks: ['rasenmaehen', 'rasenkanten-schneiden']
  },
  {
    id: 'rasen-hinten',
    name: 'Rasen (hinten)',
    path: 'M 10,10 L 50,10 L 50,45 L 10,45 Z',
    category: 'rasen',
    tasks: ['rasenmaehen', 'vertikutieren']
  },
  {
    id: 'beete-links',
    name: 'Beete (links)',
    path: 'M 5,10 L 10,10 L 10,80 L 5,80 Z',
    category: 'beete',
    tasks: ['unkraut-jaeten', 'beete-mulchen', 'blumen-giessen']
  },
  {
    id: 'beete-rechts',
    name: 'Beete (rechts)',
    path: 'M 50,55 L 55,55 L 55,90 L 50,90 Z',
    category: 'beete',
    tasks: ['unkraut-jaeten', 'blumen-giessen']
  },
  {
    id: 'baeume',
    name: 'Baumbereich',
    path: 'M 55,60 L 90,60 L 90,95 L 55,95 Z',
    category: 'baeume',
    tasks: ['hecke-schneiden', 'obstbaumschnitt', 'laub-harken']
  },
  {
    id: 'holzlager',
    name: 'Holzlager',
    path: 'M 90,20 L 98,20 L 98,50 L 90,50 Z',
    category: 'brennholz',
    tasks: ['holz-hacken', 'holz-stapeln', 'holzvorrat-pruefen']
  },
  {
    id: 'eingang',
    name: 'Eingangsbereich',
    path: 'M 10,85 L 50,85 L 50,98 L 10,98 Z',
    category: 'sonstiges',
    tasks: ['zaun-kontrollieren']
  }
];

interface Props {
  droneImageUrl?: string;
}

export default function GardenMap({ droneImageUrl }: Props) {
  const [taskStates, setTaskStates] = useState<TaskStatus>({});
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const [selectedZone, setSelectedZone] = useState<Zone | null>(null);

  // Load task states from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('voigt-garten-tasks');
    if (saved) {
      const tasks = JSON.parse(saved);
      const states: TaskStatus = {};

      // Calculate status for each task based on last done date
      Object.entries(tasks).forEach(([taskId, data]: [string, any]) => {
        if (data.lastDone) {
          const daysSince = Math.floor((Date.now() - new Date(data.lastDone).getTime()) / (1000 * 60 * 60 * 24));
          const cycleDays = data.cycleDays || 14;

          if (daysSince > cycleDays) {
            states[taskId] = 'overdue';
          } else if (daysSince > cycleDays * 0.7) {
            states[taskId] = 'due-soon';
          } else {
            states[taskId] = 'ok';
          }
        } else {
          states[taskId] = 'overdue'; // Never done = overdue
        }
      });

      setTaskStates(states);
    }
  }, []);

  const getZoneStatus = (zone: Zone): 'ok' | 'due-soon' | 'overdue' => {
    const taskStatuses = zone.tasks.map(t => taskStates[t] || 'overdue');

    if (taskStatuses.includes('overdue')) return 'overdue';
    if (taskStatuses.includes('due-soon')) return 'due-soon';
    return 'ok';
  };

  const getZoneColor = (zone: Zone, isHovered: boolean): string => {
    const status = getZoneStatus(zone);
    const opacity = isHovered ? '0.7' : '0.4';

    switch (status) {
      case 'overdue':
        return `rgba(239, 68, 68, ${opacity})`; // Red
      case 'due-soon':
        return `rgba(245, 158, 11, ${opacity})`; // Amber
      case 'ok':
        return `rgba(34, 197, 94, ${opacity})`; // Green
    }
  };

  const getStatusLabel = (status: 'ok' | 'due-soon' | 'overdue') => {
    switch (status) {
      case 'ok': return { text: 'Alles OK', color: 'text-green-600', bg: 'bg-green-100' };
      case 'due-soon': return { text: 'Bald fällig', color: 'text-amber-600', bg: 'bg-amber-100' };
      case 'overdue': return { text: 'Überfällig', color: 'text-red-600', bg: 'bg-red-100' };
    }
  };

  // Placeholder image if no drone image provided
  const placeholderImage = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='600' viewBox='0 0 800 600'%3E%3Crect fill='%23e5e7eb' width='800' height='600'/%3E%3Ctext x='400' y='300' text-anchor='middle' fill='%239ca3af' font-size='24' font-family='sans-serif'%3EDrohnenbild hier einf%C3%BCgen%3C/text%3E%3Ctext x='400' y='340' text-anchor='middle' fill='%239ca3af' font-size='16' font-family='sans-serif'%3E(public/images/drone-view.jpg)%3C/text%3E%3C/svg%3E";

  return (
    <div className="bg-white rounded-xl shadow-lg overflow-hidden">
      {/* Header */}
      <div className="bg-garden-600 text-white p-4">
        <h3 className="font-display text-xl font-bold flex items-center gap-2">
          <span>🗺️</span> Garten-Übersicht
        </h3>
        <p className="text-garden-100 text-sm mt-1">
          Klicke auf einen Bereich für Details. Farben zeigen den Wartungsstatus.
        </p>
      </div>

      {/* Legend */}
      <div className="flex gap-4 p-3 bg-gray-50 border-b border-gray-200 text-sm">
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-green-500"></div>
          <span>OK</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-amber-500"></div>
          <span>Bald fällig</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-red-500"></div>
          <span>Überfällig</span>
        </div>
      </div>

      {/* Map Container */}
      <div className="relative">
        {/* Background Image */}
        <img
          src={droneImageUrl || placeholderImage}
          alt="Luftaufnahme des Gartens"
          className="w-full h-auto"
        />

        {/* SVG Overlay for Zones */}
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {GARDEN_ZONES.map(zone => (
            <path
              key={zone.id}
              d={zone.path}
              fill={getZoneColor(zone, hoveredZone === zone.id)}
              stroke={hoveredZone === zone.id ? '#fff' : 'rgba(255,255,255,0.5)'}
              strokeWidth={hoveredZone === zone.id ? '0.5' : '0.2'}
              className="cursor-pointer transition-all duration-200"
              onMouseEnter={() => setHoveredZone(zone.id)}
              onMouseLeave={() => setHoveredZone(null)}
              onClick={() => setSelectedZone(zone)}
            />
          ))}
        </svg>

        {/* Hover Tooltip */}
        {hoveredZone && (
          <div className="absolute top-4 left-4 bg-white/95 backdrop-blur rounded-lg shadow-lg p-3 pointer-events-none">
            {(() => {
              const zone = GARDEN_ZONES.find(z => z.id === hoveredZone);
              if (!zone) return null;
              const status = getStatusLabel(getZoneStatus(zone));
              return (
                <>
                  <div className="font-semibold text-gray-800">{zone.name}</div>
                  <div className={`text-sm ${status.color} ${status.bg} px-2 py-0.5 rounded mt-1 inline-block`}>
                    {status.text}
                  </div>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Selected Zone Details */}
      {selectedZone && (
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-start justify-between">
            <div>
              <h4 className="font-semibold text-lg text-gray-800">{selectedZone.name}</h4>
              {(() => {
                const status = getStatusLabel(getZoneStatus(selectedZone));
                return (
                  <span className={`text-sm ${status.color} ${status.bg} px-2 py-0.5 rounded inline-block mt-1`}>
                    {status.text}
                  </span>
                );
              })()}
            </div>
            <button
              onClick={() => setSelectedZone(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ✕
            </button>
          </div>

          <div className="mt-3">
            <div className="text-sm text-gray-600 mb-2">Zugehörige Aufgaben:</div>
            <ul className="space-y-1">
              {selectedZone.tasks.map(taskId => {
                const status = taskStates[taskId] || 'overdue';
                const statusStyle = getStatusLabel(status);
                return (
                  <li key={taskId} className="flex items-center gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full ${
                      status === 'ok' ? 'bg-green-500' :
                      status === 'due-soon' ? 'bg-amber-500' : 'bg-red-500'
                    }`}></span>
                    <span className="text-gray-700 capitalize">
                      {taskId.replace(/-/g, ' ')}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <a
            href={`/wartung#${selectedZone.category}`}
            className="mt-4 inline-block bg-garden-600 hover:bg-garden-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
          >
            Zur Wartung →
          </a>
        </div>
      )}

      {/* Upload Prompt */}
      {!droneImageUrl && (
        <div className="p-4 bg-amber-50 border-t border-amber-200">
          <p className="text-amber-800 text-sm">
            <strong>📸 Drohnenbild benötigt:</strong> Lade ein Luftbild vom Garten hoch
            (ideal: von oben, bei gutem Wetter). Speichere es als <code className="bg-amber-100 px-1 rounded">public/images/drone-view.jpg</code>
          </p>
        </div>
      )}
    </div>
  );
}
