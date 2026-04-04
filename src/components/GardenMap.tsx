import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { CATEGORY_COLORS, CATEGORY_LABELS, CATEGORY_ICONS, getAreaCategory, type MapCategory } from './mapAreas';

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
  description?: string;
  photo_count?: number;
}

export type MapMode = 'gebaeude' | 'natur' | 'technik' | 'wasser' | 'alle';

interface GardenMapProps {
  mode?: MapMode;
  onAreaClick?: (areaId: string) => void;
  highlightedAreas?: string[];
  activeArea?: string;
  selectable?: boolean;
  compact?: boolean;
  showModeSwitch?: boolean;
}

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

function getPathAbsolutePoints(d: string): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  // Tokenize: split into commands and numbers
  const tokens = d.match(/[a-zA-Z]|-?[\d.]+/g);
  if (!tokens) return points;

  let cx = 0, cy = 0; // current point
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (!/[a-zA-Z]/.test(cmd)) { i++; continue; }
    i++;

    const readNum = () => parseFloat(tokens[i++] || '0');

    switch (cmd) {
      case 'M': cx = readNum(); cy = readNum(); points.push({ x: cx, y: cy }); break;
      case 'm': {
        // First pair after 'm' is absolute move, subsequent are relative lineTo
        if (points.length === 0) { cx = readNum(); cy = readNum(); } else { cx += readNum(); cy += readNum(); }
        points.push({ x: cx, y: cy });
        // Consume implicit relative lineTo pairs
        while (i < tokens.length && /^-?[\d.]/.test(tokens[i])) {
          cx += readNum(); cy += readNum();
          points.push({ x: cx, y: cy });
        }
        break;
      }
      case 'L': cx = readNum(); cy = readNum(); points.push({ x: cx, y: cy }); break;
      case 'l': cx += readNum(); cy += readNum(); points.push({ x: cx, y: cy });
        while (i < tokens.length && /^-?[\d.]/.test(tokens[i])) {
          cx += readNum(); cy += readNum(); points.push({ x: cx, y: cy });
        }
        break;
      case 'H': cx = readNum(); points.push({ x: cx, y: cy }); break;
      case 'h': cx += readNum(); points.push({ x: cx, y: cy }); break;
      case 'V': cy = readNum(); points.push({ x: cx, y: cy }); break;
      case 'v': cy += readNum(); points.push({ x: cx, y: cy }); break;
      case 'C': { // absolute cubic bezier: 3 pairs
        for (let j = 0; j < 3; j++) { const px = readNum(); const py = readNum(); if (j === 2) { cx = px; cy = py; points.push({ x: cx, y: cy }); } }
        break;
      }
      case 'c': { // relative cubic bezier: 3 pairs
        const sx = cx, sy = cy;
        for (let j = 0; j < 3; j++) { const dx = readNum(); const dy = readNum(); if (j === 2) { cx = sx + dx; cy = sy + dy; points.push({ x: cx, y: cy }); } }
        break;
      }
      case 'Z': case 'z': break;
      default: break;
    }
  }
  return points;
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
      const pts = getPathAbsolutePoints(a.d || '');
      if (pts.length === 0) return null;
      // Use bounding box center for more stable results
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      }
      return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    }
    default:
      return null;
  }
}

function computeLabelPositions(shapes: SvgShape[]): { id: string; label: string; cx: number; cy: number; lx: number; ly: number }[] {
  const VB_W = 1602, VB_H = 787;
  const LABEL_H = 18;
  const PAD = 8; // padding from viewBox edges

  type Placed = { id: string; label: string; cx: number; cy: number; lx: number; ly: number; hw: number };
  const placed: Placed[] = [];

  function labelHalfWidth(label: string): number {
    return (label.length * 8 + 12) / 2;
  }

  function overlapsAny(lx: number, ly: number, hw: number): boolean {
    for (const p of placed) {
      const dx = Math.abs(lx - p.lx);
      const dy = Math.abs(ly - p.ly);
      if (dx < (hw + p.hw + 4) && dy < (LABEL_H + 2)) {
        return true;
      }
    }
    return false;
  }

  function inBounds(lx: number, ly: number, hw: number): boolean {
    return (lx - hw >= PAD) && (lx + hw <= VB_W - PAD) && (ly - 9 >= PAD) && (ly + 9 <= VB_H - PAD);
  }

  // Direction offsets: [dx, dy] — top, right, bottom, left
  const directions: [number, number][] = [
    [0, -1],  // top
    [1, 0],   // right
    [0, 1],   // bottom
    [-1, 0],  // left
  ];

  for (const shape of shapes) {
    const center = getShapeCenter(shape);
    if (!center) continue;

    const hw = labelHalfWidth(shape.label);
    let bestLx = center.x;
    let bestLy = center.y - 35;
    let found = false;

    // Try each direction at increasing distances
    for (let dist = 35; dist <= 80 && !found; dist += 15) {
      for (const [ddx, ddy] of directions) {
        const lx = center.x + ddx * dist;
        const ly = center.y + ddy * dist;
        if (inBounds(lx, ly, hw) && !overlapsAny(lx, ly, hw)) {
          bestLx = lx;
          bestLy = ly;
          found = true;
          break;
        }
      }
    }

    // Fallback: if nothing found, try diagonal directions
    if (!found) {
      const diagonals: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (let dist = 40; dist <= 100 && !found; dist += 15) {
        for (const [ddx, ddy] of diagonals) {
          const lx = center.x + ddx * dist * 0.7;
          const ly = center.y + ddy * dist * 0.7;
          if (inBounds(lx, ly, hw) && !overlapsAny(lx, ly, hw)) {
            bestLx = lx;
            bestLy = ly;
            found = true;
            break;
          }
        }
      }
    }

    // Final fallback: clamp to bounds
    if (!found) {
      bestLx = Math.max(PAD + hw, Math.min(VB_W - PAD - hw, bestLx));
      bestLy = Math.max(PAD + 9, Math.min(VB_H - PAD - 9, bestLy));
    }

    placed.push({ id: shape.id, label: shape.label, cx: center.x, cy: center.y, lx: bestLx, ly: bestLy, hw });
  }

  return placed.map(({ id, label, cx, cy, lx, ly }) => ({ id, label, cx, cy, lx, ly }));
}

export default function GardenMap({
  mode: initialMode = 'alle',
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
  const [mousePos, setMousePos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
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
    fetch(`${API_BASE}/api/map/areas`)
      .then((res) => res.json())
      .then((data) => {
        const statuses: Record<string, AreaStatus> = {};
        if (data.areas) {
          for (const [areaId, areaData] of Object.entries(data.areas)) {
            const d = areaData as any;
            statuses[areaId] = {
              status: d.status || 'no-data',
              description: d.description || '',
              photo_count: d.photo_count || 0,
            };
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
      const shapeCategory = getAreaCategory(shape.id);

      if (mode === 'alle') {
        // Show all areas with original colors
        let opacity = 0.55;
        if (active || (selectable && selectedId === shape.id)) opacity = 0.85;
        else if (hovered || highlighted) opacity = 0.75;
        return { fill: shape.originalFill, opacity };
      }

      // Category filter mode
      const isInCategory = shapeCategory === mode;

      if (isInCategory) {
        const rgb = CATEGORY_COLORS[mode as MapCategory];
        let opacity = 0.65;
        if (active || (selectable && selectedId === shape.id)) opacity = 0.9;
        else if (hovered || highlighted) opacity = 0.8;
        return { fill: `rgb(${rgb})`, opacity };
      } else {
        // Dimmed areas not in this category
        let opacity = 0.15;
        if (hovered) opacity = 0.3;
        return { fill: shape.originalFill, opacity };
      }
    },
    [mode, isActive, isHighlighted, selectable, selectedId]
  );

  const getStroke = useCallback(
    (shape: SvgShape, hovered: boolean) => {
      const active = isActive(shape.id);
      const shapeCategory = getAreaCategory(shape.id);
      const isInCategory = mode === 'alle' || shapeCategory === mode;

      if (!isInCategory) {
        return { stroke: 'none', strokeWidth: 0 };
      }
      if (hovered || active) return { stroke: 'white', strokeWidth: 2 };
      return { stroke: 'rgba(255,255,255,0.3)', strokeWidth: 0.5 };
    },
    [mode, isActive]
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
      onMouseMove: (e: React.MouseEvent) => {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          setMousePos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
      },
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

  const tooltipContent = hoveredShape ? (() => {
    const shapeCategory = getAreaCategory(hoveredShape.id);
    return (
      <div
        className="absolute bg-white/95 backdrop-blur rounded-lg shadow-lg px-3 py-2 pointer-events-none z-30 max-w-xs"
        style={{
          left: mousePos.x + 16,
          top: mousePos.y - 10,
        }}
      >
        <div className="font-semibold text-gray-800 text-sm">{hoveredShape.label}</div>
        {shapeCategory && (
          <div className="text-xs mt-0.5 flex items-center gap-1" style={{ color: `rgb(${CATEGORY_COLORS[shapeCategory]})` }}>
            {CATEGORY_ICONS[shapeCategory]} {CATEGORY_LABELS[shapeCategory]}
          </div>
        )}
        {areaStatuses[hoveredShape.id]?.description && (
          <div className="text-xs text-gray-600 mt-0.5">{areaStatuses[hoveredShape.id].description}</div>
        )}
        {(areaStatuses[hoveredShape.id]?.photo_count || 0) > 0 && (
          <div className="text-xs text-gray-500 mt-0.5">
            {areaStatuses[hoveredShape.id]?.photo_count} Foto{(areaStatuses[hoveredShape.id]?.photo_count || 0) > 1 ? 's' : ''}
          </div>
        )}
      </div>
    );
  })() : null;

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
            <button
              key="alle"
              onClick={() => setMode('alle')}
              className={`px-3 py-1.5 font-medium transition ${
                mode === 'alle'
                  ? 'bg-gray-700 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              Alle
            </button>
            {(['gebaeude', 'natur', 'technik', 'wasser'] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setMode(cat)}
                className={`px-3 py-1.5 font-medium transition ${
                  mode === cat
                    ? 'text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                style={mode === cat ? { backgroundColor: `rgb(${CATEGORY_COLORS[cat]})` } : {}}
              >
                {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
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

          </div>
        )}

        {/* Tooltip - outside transformed container */}
        {tooltipContent}
      </div>

      {/* Category Legend */}
      {mode !== 'alle' && !compact && (
        <div className="flex gap-4 mt-2 text-sm text-gray-600">
          {(['gebaeude', 'natur', 'technik', 'wasser'] as const).map((cat) => (
            <div key={cat} className="flex items-center gap-1.5">
              <span
                className="w-3 h-3 rounded-sm"
                style={{
                  background: `rgb(${CATEGORY_COLORS[cat]})`,
                  opacity: mode === cat ? 1 : 0.3,
                }}
              />
              {CATEGORY_LABELS[cat]}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
