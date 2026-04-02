import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:5055' : '';

interface SvgShape {
  id: string;
  label: string;
  tagName: string;
  attrs: Record<string, string>;
  originalFill: string;
}

interface AreaStatus {
  status: 'ok' | 'due-soon' | 'overdue' | 'no-data';
}

interface GardenMapProps {
  mode?: 'kategorie' | 'wartung' | 'neutral';
  onAreaClick?: (areaId: string) => void;
  highlightedAreas?: string[];
  activeArea?: string;
  selectable?: boolean;
  compact?: boolean;
  showModeSwitch?: boolean;
}

const WARTUNG_COLORS: Record<string, string> = {
  'ok': '34, 197, 94',
  'due-soon': '245, 158, 11',
  'overdue': '239, 68, 68',
  'no-data': '156, 163, 175',
};

function parseFillFromStyle(style: string | undefined): string {
  if (!style) return '#cccccc';
  const match = style.match(/fill\s*:\s*([^;]+)/);
  return match ? match[1].trim() : '#cccccc';
}

function parseSvgShapes(svgText: string): SvgShape[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  const shapes: SvgShape[] = [];
  const tagNames = ['path', 'rect', 'circle', 'ellipse'];

  const allElements = doc.querySelectorAll(tagNames.join(','));
  allElements.forEach((el) => {
    const label = el.getAttribute('inkscape:label');
    if (!label) return;

    const id = el.getAttribute('id') || '';
    const tagName = el.tagName.toLowerCase();
    const style = el.getAttribute('style') || undefined;
    const originalFill = parseFillFromStyle(style);

    const attrNames = ['d', 'x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'style'];
    const attrs: Record<string, string> = {};
    for (const name of attrNames) {
      const val = el.getAttribute(name);
      if (val !== null) {
        attrs[name] = val;
      }
    }

    shapes.push({ id, label, tagName, attrs, originalFill });
  });

  return shapes;
}

function getShapeCenter(shape: SvgShape): { x: number; y: number } | null {
  const a = shape.attrs;
  switch (shape.tagName) {
    case 'rect':
      return { x: parseFloat(a.x || '0') + parseFloat(a.width || '0') / 2, y: parseFloat(a.y || '0') + parseFloat(a.height || '0') / 2 };
    case 'circle':
      return { x: parseFloat(a.cx || '0'), y: parseFloat(a.cy || '0') };
    case 'ellipse':
      return { x: parseFloat(a.cx || '0'), y: parseFloat(a.cy || '0') };
    case 'path': {
      const nums = (a.d || '').match(/-?[\d.]+/g);
      if (!nums || nums.length < 2) return null;
      let sumX = 0, sumY = 0, count = 0;
      for (let i = 0; i < nums.length - 1; i += 2) {
        sumX += parseFloat(nums[i]);
        sumY += parseFloat(nums[i + 1]);
        count++;
      }
      return count > 0 ? { x: sumX / count, y: sumY / count } : null;
    }
    default:
      return null;
  }
}

function computeLabelPositions(shapes: SvgShape[]): { id: string; label: string; cx: number; cy: number; lx: number; ly: number }[] {
  const labels: { id: string; label: string; cx: number; cy: number; lx: number; ly: number }[] = [];

  for (const shape of shapes) {
    const center = getShapeCenter(shape);
    if (!center) continue;

    let lx = center.x;
    let ly = center.y - 30;

    for (const existing of labels) {
      const dx = Math.abs(lx - existing.lx);
      const dy = Math.abs(ly - existing.ly);
      if (dx < 80 && dy < 18) {
        ly = existing.ly - 20;
      }
    }

    ly = Math.max(15, ly);
    lx = Math.max(50, Math.min(1552, lx));

    labels.push({ id: shape.id, label: shape.label, cx: center.x, cy: center.y, lx, ly });
  }

  return labels;
}

export default function GardenMap({
  mode: initialMode = 'kategorie',
  onAreaClick,
  highlightedAreas = [],
  activeArea,
  selectable = false,
  compact = false,
  showModeSwitch = false,
}: GardenMapProps) {
  const [shapes, setShapes] = useState<SvgShape[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(initialMode);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [areaStatuses, setAreaStatuses] = useState<Record<string, AreaStatus>>({});

  const labelPositions = useMemo(() => computeLabelPositions(shapes), [shapes]);

  // Zoom & pan state
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const translateStart = useRef({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Touch zoom state
  const lastTouchDist = useRef<number | null>(null);
  const lastTouchCenter = useRef<{ x: number; y: number } | null>(null);

  // Fetch and parse SVG
  useEffect(() => {
    setLoading(true);
    fetch('/images/gartenplan.svg')
      .then((res) => res.text())
      .then((text) => {
        setShapes(parseSvgShapes(text));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Fetch area statuses in wartung mode
  useEffect(() => {
    if (mode !== 'wartung') return;
    fetch(`${API_BASE}/api/map/areas`)
      .then((res) => res.json())
      .then((data) => {
        const statuses: Record<string, AreaStatus> = {};
        if (data.areas) {
          for (const area of data.areas) {
            statuses[area.id] = { status: area.status || 'no-data' };
          }
        }
        setAreaStatuses(statuses);
      })
      .catch(() => setAreaStatuses({}));
  }, [mode]);

  const isHighlighted = useCallback(
    (id: string) => highlightedAreas.includes(id),
    [highlightedAreas]
  );

  const isActive = useCallback(
    (id: string) => activeArea === id,
    [activeArea]
  );

  const getFill = useCallback(
    (shape: SvgShape, hovered: boolean) => {
      const active = isActive(shape.id);
      const highlighted = isHighlighted(shape.id);

      if (mode === 'kategorie') {
        let opacity = 0.3;
        if (active || (selectable && selectedId === shape.id)) opacity = 0.8;
        else if (hovered || highlighted) opacity = 0.6;
        // Use original fill with adjusted opacity
        return { fill: shape.originalFill, opacity };
      }

      if (mode === 'wartung') {
        const status = areaStatuses[shape.id]?.status || 'no-data';
        const rgb = WARTUNG_COLORS[status];
        let opacity = 0.4;
        if (active || (selectable && selectedId === shape.id)) opacity = 0.8;
        else if (hovered || highlighted) opacity = 0.6;
        return { fill: `rgb(${rgb})`, opacity };
      }

      // neutral
      if (active || (selectable && selectedId === shape.id)) {
        return { fill: 'rgba(255,255,255,0.5)', opacity: 1 };
      }
      if (hovered) {
        return { fill: 'rgba(255,255,255,0.3)', opacity: 1 };
      }
      return { fill: 'transparent', opacity: 1 };
    },
    [mode, areaStatuses, isActive, isHighlighted, selectable, selectedId]
  );

  const getStroke = useCallback(
    (shape: SvgShape, hovered: boolean) => {
      const active = isActive(shape.id);
      if (mode === 'neutral') {
        if (active || (selectable && selectedId === shape.id)) return { stroke: 'white', strokeWidth: 1 };
        if (hovered) return { stroke: 'white', strokeWidth: 1 };
        return { stroke: 'none', strokeWidth: 0 };
      }
      if (hovered || active) return { stroke: 'white', strokeWidth: 2 };
      return { stroke: 'none', strokeWidth: 0 };
    },
    [mode, isActive, selectable, selectedId]
  );

  const handleShapeClick = useCallback(
    (id: string) => {
      if (selectable) {
        setSelectedId((prev) => (prev === id ? null : id));
      }
      onAreaClick?.(id);
    },
    [selectable, onAreaClick]
  );

  // Zoom handlers (only when not compact)
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (compact) return;
      e.preventDefault();
      setScale((prev) => {
        const next = prev - e.deltaY * 0.001;
        return Math.min(4, Math.max(1, next));
      });
    },
    [compact]
  );

  // Reset pan when scale goes back to 1
  useEffect(() => {
    if (scale <= 1) {
      setTranslate({ x: 0, y: 0 });
    }
  }, [scale]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (compact || scale <= 1) return;
      setIsPanning(true);
      panStart.current = { x: e.clientX, y: e.clientY };
      translateStart.current = { ...translate };
    },
    [compact, scale, translate]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanning) return;
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setTranslate({
        x: translateStart.current.x + dx,
        y: translateStart.current.y + dy,
      });
    },
    [isPanning]
  );

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  // Touch handlers for pinch-to-zoom and drag-to-pan
  const getTouchDist = (touches: React.TouchList) => {
    if (touches.length < 2) return null;
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const getTouchCenter = (touches: React.TouchList) => {
    if (touches.length < 2) return null;
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    };
  };

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (compact) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        lastTouchDist.current = getTouchDist(e.touches);
        lastTouchCenter.current = getTouchCenter(e.touches);
      } else if (e.touches.length === 1 && scale > 1) {
        e.preventDefault();
        setIsPanning(true);
        panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        translateStart.current = { ...translate };
      }
    },
    [compact, scale, translate]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (compact) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        const dist = getTouchDist(e.touches);
        if (dist !== null && lastTouchDist.current !== null) {
          const delta = dist / lastTouchDist.current;
          setScale((prev) => Math.min(4, Math.max(1, prev * delta)));
          lastTouchDist.current = dist;
        }
      } else if (e.touches.length === 1 && isPanning) {
        const dx = e.touches[0].clientX - panStart.current.x;
        const dy = e.touches[0].clientY - panStart.current.y;
        setTranslate({
          x: translateStart.current.x + dx,
          y: translateStart.current.y + dy,
        });
      }
    },
    [compact, isPanning]
  );

  const handleTouchEnd = useCallback(() => {
    setIsPanning(false);
    lastTouchDist.current = null;
    lastTouchCenter.current = null;
  }, []);

  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const renderShape = (shape: SvgShape) => {
    const hovered = hoveredId === shape.id;
    const active = isActive(shape.id);
    const { fill, opacity } = getFill(shape, hovered);
    const { stroke, strokeWidth } = getStroke(shape, hovered);

    const commonProps = {
      key: shape.id,
      fill,
      opacity,
      stroke,
      strokeWidth,
      style: {
        cursor: 'pointer',
        transition: 'fill 0.2s, opacity 0.2s, stroke 0.2s',
        ...(active ? { animation: 'gardenmap-pulse 2s ease-in-out infinite' } : {}),
      } as React.CSSProperties,
      onMouseEnter: () => setHoveredId(shape.id),
      onMouseLeave: () => setHoveredId(null),
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        handleShapeClick(shape.id);
      },
    };

    switch (shape.tagName) {
      case 'path':
        return <path {...commonProps} d={shape.attrs.d} />;
      case 'rect':
        return (
          <rect
            {...commonProps}
            x={shape.attrs.x}
            y={shape.attrs.y}
            width={shape.attrs.width}
            height={shape.attrs.height}
            rx={shape.attrs.rx}
            ry={shape.attrs.ry}
          />
        );
      case 'circle':
        return (
          <circle
            {...commonProps}
            cx={shape.attrs.cx}
            cy={shape.attrs.cy}
            r={shape.attrs.r}
          />
        );
      case 'ellipse':
        return (
          <ellipse
            {...commonProps}
            cx={shape.attrs.cx}
            cy={shape.attrs.cy}
            rx={shape.attrs.rx}
            ry={shape.attrs.ry}
          />
        );
      default:
        return null;
    }
  };

  const hoveredShape = shapes.find((s) => s.id === hoveredId);

  const tooltipContent = (hoveredShape && mode === 'wartung') ? (
    <div className="absolute top-3 left-3 bg-white/95 backdrop-blur rounded-lg shadow-lg px-3 py-2 pointer-events-none z-10">
      <div className="font-semibold text-gray-800 text-sm">{hoveredShape.label}</div>
      {mode === 'wartung' && (
        <div className="text-xs mt-0.5" style={{ color: `rgb(${WARTUNG_COLORS[areaStatuses[hoveredShape.id]?.status || 'no-data']})` }}>
          {(() => {
            const s = areaStatuses[hoveredShape.id]?.status || 'no-data';
            if (s === 'ok') return 'OK';
            if (s === 'due-soon') return 'Bald faellig';
            if (s === 'overdue') return 'Ueberfaellig';
            return 'Keine Daten';
          })()}
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <style>{`
        @keyframes gardenmap-pulse {
          0%, 100% { opacity: 0.8; }
          50% { opacity: 0.5; }
        }
      `}</style>
      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-xl ${compact ? 'max-h-64' : ''}`}
        style={{ userSelect: 'none', touchAction: 'none' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Mode Switch */}
        {showModeSwitch && !compact && (
          <div className="absolute top-3 left-3 z-20 flex bg-white/90 backdrop-blur rounded-full shadow-lg overflow-hidden text-xs">
            {(['kategorie', 'wartung', 'neutral'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 font-medium transition ${
                  mode === m
                    ? 'bg-garden-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {m === 'kategorie' ? 'Kategorie' : m === 'wartung' ? 'Wartung' : 'Neutral'}
              </button>
            ))}
          </div>
        )}

        {/* Zoom Controls */}
        {!compact && (
          <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
            <button
              onClick={() => setScale((s) => Math.min(4, s + 0.5))}
              className="bg-white/90 backdrop-blur shadow rounded w-8 h-8 flex items-center justify-center text-gray-700 hover:bg-white transition text-lg font-bold"
            >
              +
            </button>
            <button
              onClick={() => setScale((s) => Math.max(1, s - 0.5))}
              className="bg-white/90 backdrop-blur shadow rounded w-8 h-8 flex items-center justify-center text-gray-700 hover:bg-white transition text-lg font-bold"
            >
              -
            </button>
            <button
              onClick={resetZoom}
              className="bg-white/90 backdrop-blur shadow rounded w-8 h-8 flex items-center justify-center text-gray-700 hover:bg-white transition text-xs font-medium"
            >
              1:1
            </button>
          </div>
        )}

        {/* Map Content */}
        {loading ? (
          <div className="flex items-center justify-center h-64 bg-gray-100 text-gray-500">
            Karte wird geladen...
          </div>
        ) : (
          <div
            className="relative"
            style={{
              transform: `scale(${scale}) translate(${translate.x / scale}px, ${translate.y / scale}px)`,
              transformOrigin: 'center center',
              transition: isPanning ? 'none' : 'transform 0.2s ease-out',
            }}
          >
            {/* Background image */}
            <img
              src="/images/gartenplan-bg.jpg?v=2"
              alt="Gartenplan"
              className="w-full h-auto block"
              draggable={false}
            />

            {/* SVG Overlay */}
            <svg
              viewBox="0 0 1602 787"
              className="absolute inset-0 w-full h-full"
              preserveAspectRatio="xMidYMid meet"
            >
              {shapes.map(renderShape)}
              {/* Labels with leader lines */}
              {labelPositions.map(({ id, label, cx, cy, lx, ly }) => (
                <g key={`label-${id}`} className="pointer-events-none">
                  <line
                    x1={cx} y1={cy} x2={lx} y2={ly + 7}
                    stroke="white" strokeWidth="1.5" opacity="0.8"
                  />
                  <rect
                    x={lx - label.length * 4 - 6}
                    y={ly - 9}
                    width={label.length * 8 + 12}
                    height={18}
                    rx={3}
                    fill="white"
                    opacity="0.9"
                    stroke="#374151"
                    strokeWidth="0.5"
                  />
                  <text
                    x={lx}
                    y={ly + 4}
                    textAnchor="middle"
                    fill="#1f2937"
                    fontSize="11"
                    fontWeight="600"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {label}
                  </text>
                </g>
              ))}
            </svg>

            {/* Tooltip */}
            {tooltipContent}
          </div>
        )}
      </div>

      {/* Legend (Wartung mode only) */}
      {mode === 'wartung' && !compact && (
        <div className="flex gap-4 mt-2 text-sm text-gray-600">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: `rgb(${WARTUNG_COLORS['ok']})` }}></span>
            OK
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: `rgb(${WARTUNG_COLORS['due-soon']})` }}></span>
            Bald faellig
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: `rgb(${WARTUNG_COLORS['overdue']})` }}></span>
            Ueberfaellig
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm" style={{ background: `rgb(${WARTUNG_COLORS['no-data']})` }}></span>
            Keine Daten
          </div>
        </div>
      )}
    </>
  );
}
