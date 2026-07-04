import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { Stage, Layer, Text, Image as KonvaImage, Line, Rect, Ellipse, Group, Transformer } from 'react-konva';
import type Konva from 'konva';
import { apiGet, apiPut, apiPost } from '../../api/client';
import type { Worksheet, CanvasData, CanvasElement, MeetingNoteItem, MeetingNoteDetail } from '../../api/types';
import AppShell from '../../components/AppShell';
import styles from './WorksheetPage.module.css';

type Tool = 'select' | 'text' | 'draw' | 'rect' | 'circle' | 'line' | 'image' | 'eraser' | 'table';

const COLORS = [
  '#1a2033', '#2563EB', '#7C3AED', '#16a34a',
  '#d97706', '#dc2626', '#f97316', '#ec4899',
  '#06b6d4', '#64748b',
];
const DEFAULT_COLOR = '#1a2033';

const TOOLS: [Tool, string, string][] = [
  ['select', '↖', 'เลือก'],
  ['text', 'T', 'ข้อความ'],
  ['draw', '✏', 'วาดอิสระ'],
  ['rect', '▭', 'สี่เหลี่ยม'],
  ['circle', '○', 'วงกลม'],
  ['line', '╱', 'เส้นตรง'],
  ['table', '▦', 'ตาราง'],
  ['eraser', '⌫', 'ยางลบ'],
];

const CURSOR_MAP: Record<Tool, string> = {
  select: 'default', text: 'text', draw: 'crosshair',
  rect: 'crosshair', circle: 'crosshair', line: 'crosshair',
  image: 'default', eraser: 'cell', table: 'crosshair',
};

const DEFAULT_TABLE_ROWS = 3;
const DEFAULT_TABLE_COLS = 3;
const DEFAULT_COL_WIDTH = 100;
const DEFAULT_ROW_HEIGHT = 32;

function useDebounce<T>(value: T, ms: number): T {
  const [dv, setDv] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDv(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return dv;
}

// Approximate on-canvas bounding box of an element (used by the minimap)
function elementBounds(el: CanvasElement): { x: number; y: number; w: number; h: number } {
  switch (el.type) {
    case 'image':
    case 'rect':
      return { x: el.x ?? 0, y: el.y ?? 0, w: el.width ?? 100, h: el.height ?? 60 };
    case 'circle':
      return {
        x: (el.x ?? 0) - (el.radiusX ?? 40), y: (el.y ?? 0) - (el.radiusY ?? 40),
        w: (el.radiusX ?? 40) * 2, h: (el.radiusY ?? 40) * 2,
      };
    case 'text': {
      const fs = el.fontSize ?? 16;
      const lines = (el.text ?? '').split('\n');
      return { x: el.x ?? 0, y: el.y ?? 0, w: Math.max(...lines.map(l => l.length), 1) * fs * 0.6, h: lines.length * fs * 1.3 };
    }
    case 'table': {
      const cw = el.colWidths ?? [];
      const rh = el.rowHeights ?? (el.rows ?? []).map(() => el.rowHeight ?? DEFAULT_ROW_HEIGHT);
      return { x: el.x ?? 0, y: el.y ?? 0, w: cw.reduce((a, b) => a + b, 0) || 100, h: rh.reduce((a, b) => a + b, 0) || 40 };
    }
    case 'line':
    case 'freedraw': {
      const pts = el.points ?? [];
      const ox = el.x ?? 0, oy = el.y ?? 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        minX = Math.min(minX, pts[i]!); maxX = Math.max(maxX, pts[i]!);
        minY = Math.min(minY, pts[i + 1]!); maxY = Math.max(maxY, pts[i + 1]!);
      }
      if (!isFinite(minX)) return { x: ox, y: oy, w: 1, h: 1 };
      return { x: ox + minX, y: oy + minY, w: (maxX - minX) || 1, h: (maxY - minY) || 1 };
    }
    default:
      return { x: el.x ?? 0, y: el.y ?? 0, w: 1, h: 1 };
  }
}

function Minimap({ elements, scale, position, stageSize, onNavigate }: {
  elements: CanvasElement[];
  scale: number;
  position: { x: number; y: number };
  stageSize: { width: number; height: number };
  onNavigate: (worldX: number, worldY: number) => void;
}) {
  const MM_W = 180, MM_H = 120, PAD = 60;
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const boundsList = elements.map(elementBounds);
  const vx = -position.x / scale, vy = -position.y / scale;
  const vw = stageSize.width / scale, vh = stageSize.height / scale;
  let minX = vx, minY = vy, maxX = vx + vw, maxY = vy + vh;
  for (const b of boundsList) {
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
  }
  minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
  const worldW = Math.max(1, maxX - minX), worldH = Math.max(1, maxY - minY);
  const mmScale = Math.min(MM_W / worldW, MM_H / worldH);
  const offX = (MM_W - worldW * mmScale) / 2, offY = (MM_H - worldH * mmScale) / 2;
  const toMM = (x: number, y: number) => ({ x: offX + (x - minX) * mmScale, y: offY + (y - minY) * mmScale });

  function handle(clientX: number, clientY: number) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const mx = clientX - r.left - offX, my = clientY - r.top - offY;
    onNavigate(minX + mx / mmScale, minY + my / mmScale);
  }

  const vp = toMM(vx, vy);
  return (
    <div
      ref={ref}
      className={styles.minimap}
      onPointerDown={e => { setDragging(true); handle(e.clientX, e.clientY); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (dragging) handle(e.clientX, e.clientY); }}
      onPointerUp={e => { setDragging(false); try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ } }}
    >
      {boundsList.map((b, i) => {
        const p = toMM(b.x, b.y);
        return <div key={i} className={styles.minimapItem}
          style={{ left: p.x, top: p.y, width: Math.max(2, b.w * mmScale), height: Math.max(2, b.h * mmScale) }} />;
      })}
      <div className={styles.minimapViewport}
        style={{ left: vp.x, top: vp.y, width: vw * mmScale, height: vh * mmScale }} />
    </div>
  );
}

export default function WorksheetPage() {
  const { userId, projectId } = useParams<{ userId: string; projectId: string }>();
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [elements, setElements] = useState<CanvasElement[]>([]);
  const [tool, setTool] = useState<Tool>('select');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [fontSize, setFontSize] = useState(16);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [currentLine, setCurrentLine] = useState<number[]>([]);
  const [drawStartPos, setDrawStartPos] = useState<{ x: number; y: number } | null>(null);
  const [previewEl, setPreviewEl] = useState<CanvasElement | null>(null);
  const [history, setHistory] = useState<CanvasElement[][]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [showHistory, setShowHistory] = useState(false);
  const [notes, setNotes] = useState<MeetingNoteItem[]>([]);
  const [viewNote, setViewNote] = useState<MeetingNoteDetail | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  // `newAt` = creating a fresh text element at this canvas point (no element/transformer yet)
  const [editing, setEditing] = useState<{ id?: string; ri?: number; ci?: number; newAt?: { x: number; y: number } } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const loadedImages = useRef<Map<string, HTMLImageElement>>(new Map());
  const editorRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const editorOpenedAt = useRef(0);
  const [, forceUpdate] = useState(0);

  // Reliably focus the inline editor when it opens (autoFocus can lose the race
  // against the canvas click that triggered it)
  useEffect(() => {
    if (!editing) return;
    editorOpenedAt.current = Date.now();
    const t = setTimeout(() => {
      const node = editorRef.current;
      if (node) { node.focus(); node.select(); }
    }, 0);
    return () => clearTimeout(t);
  }, [editing]);

  // The click that opens the editor can immediately blur it; ignore that first
  // spurious blur and grab focus back instead of committing.
  function handleEditorBlur() {
    if (Date.now() - editorOpenedAt.current < 250) {
      requestAnimationFrame(() => editorRef.current?.focus());
      return;
    }
    commitEdit();
  }

  useEffect(() => {
    if (!userId || !projectId) return;
    apiGet<{ id: string; name: string; status: string; taskCount: number; worksheetId?: string; thumbnailUrl?: string; lastUpdated: string }[]>(`/users/${userId}/projects`)
      .then(projects => {
        const proj = projects.find(p => p.id === projectId);
        if (!proj?.worksheetId) return;
        return apiGet<Worksheet>(`/worksheets/${proj.worksheetId}`);
      })
      .then(ws => {
        if (!ws) return;
        setWorksheet(ws);
        setElements(ws.canvasData.elements ?? []);
        setSaveStatus('saved');
      });
  }, [userId, projectId]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    elements.forEach(el => {
      if (el.type === 'image' && el.url && !loadedImages.current.has(el.url)) {
        const img = new window.Image();
        img.crossOrigin = 'anonymous';
        img.src = el.url;
        img.onload = () => { loadedImages.current.set(el.url!, img); forceUpdate(n => n + 1); };
      }
    });
  }, [elements]);

  const debouncedElements = useDebounce(elements, 2500);
  useEffect(() => {
    if (!worksheet || saveStatus === 'saved') return;
    setSaveStatus('saving');
    const data: CanvasData = { version: 1, elements: debouncedElements };
    apiPut(`/worksheets/${worksheet.id}`, { canvasData: data })
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('dirty'));
  }, [debouncedElements, worksheet]);

  useEffect(() => { if (viewNote) setEditing(null); }, [viewNote]);

  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const selectedEl = elements.find(e => e.id === selectedId);
    // Tables use their own per-column/per-row drag handles; don't show the box while editing text
    if (selectedId && tool === 'select' && !editing && selectedEl?.type !== 'table') {
      const node = stage.findOne(`#${CSS.escape(selectedId)}`);
      if (node) tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, tool, elements, editing]);

  // Re-measure the selection box whenever a selected element's own geometry
  // changes (e.g. table cell edits) — Konva doesn't auto-recompute a Group's
  // cached bounding box unless the node's transform itself changes.
  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr || tr.nodes().length === 0) return;
    tr.forceUpdate();
    tr.getLayer()?.batchDraw();
  }, [elements]);

  function markDirty() { setSaveStatus('dirty'); }
  function addId() { return `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`; }

  function pushHistory(snap: CanvasElement[]) {
    setHistory(prev => [...prev.slice(-29), [...snap]]);
  }

  function undo() {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setHistory(h => h.slice(0, -1));
    setElements(prev);
    setSelectedId(null);
    setSaveStatus('dirty');
  }

  function handleElementClick(id: string) {
    if (viewNote) return;
    if (tool === 'eraser') {
      const el = elements.find(e => e.id === id);
      if (el?.type === 'freedraw') return; // freehand strokes are only partially erased via drag
      pushHistory(elements);
      setElements(prev => prev.filter(el => el.id !== id));
      markDirty();
      return;
    }
    if (tool === 'select') setSelectedId(id);
  }

  function eraseAtPoint(pos: { x: number; y: number }) {
    const radius = Math.max(strokeWidth * 4, 14);
    setElements(prev => {
      const result: CanvasElement[] = [];
      for (const el of prev) {
        if (el.type !== 'freedraw' || !el.points || el.points.length < 4) { result.push(el); continue; }
        const pts = el.points;
        const segments: number[][] = [];
        let current: number[] = [];
        let removedAny = false;
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i] as number, y = pts[i + 1] as number;
          const dx = x - pos.x, dy = y - pos.y;
          if (dx * dx + dy * dy <= radius * radius) {
            removedAny = true;
            if (current.length >= 4) segments.push(current);
            current = [];
          } else {
            current.push(x, y);
          }
        }
        if (current.length >= 4) segments.push(current);
        if (!removedAny) { result.push(el); continue; }
        segments.forEach((seg, idx) => {
          result.push({ ...el, id: idx === 0 ? el.id : addId(), points: seg });
        });
      }
      return result;
    });
  }

  function handleStageMouseDown(e: Konva.KonvaEventObject<MouseEvent>) {
    if (tool === 'select') {
      if (e.target === e.target.getStage()) setSelectedId(null);
      return;
    }
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;

    if (tool === 'eraser') {
      pushHistory(elements);
      setIsErasing(true);
      eraseAtPoint(pos);
      return;
    }

    if (tool === 'draw') {
      setIsDrawing(true);
      setCurrentLine([pos.x, pos.y]);
    } else if (tool === 'text') {
      // Open a floating editor at the click point; the element is only created on commit
      setSelectedId(null);
      setTool('select');
      setEditValue('');
      setEditing({ newAt: { x: pos.x, y: pos.y } });
    } else if (tool === 'rect' || tool === 'circle' || tool === 'line') {
      setDrawStartPos({ x: pos.x, y: pos.y });
      setIsDrawing(true);
    } else if (tool === 'table') {
      pushHistory(elements);
      const id = addId();
      const rows = Array.from({ length: DEFAULT_TABLE_ROWS }, () => Array(DEFAULT_TABLE_COLS).fill(''));
      const colWidths = Array(DEFAULT_TABLE_COLS).fill(DEFAULT_COL_WIDTH);
      setElements(prev => [...prev, { id, type: 'table', x: pos.x, y: pos.y, rows, colWidths, rowHeight: DEFAULT_ROW_HEIGHT, stroke: color }]);
      setSelectedId(id);
      setTool('select');
      markDirty();
    }
  }

  function handleStageMouseMove(_e: Konva.KonvaEventObject<MouseEvent>) {
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;

    if (tool === 'eraser' && isErasing) {
      eraseAtPoint(pos);
      return;
    }
    if (tool === 'draw' && isDrawing) {
      setCurrentLine(prev => [...prev, pos.x, pos.y]);
      return;
    }
    if (!isDrawing || !drawStartPos) return;

    if (tool === 'rect') {
      setPreviewEl({
        id: '__preview', type: 'rect',
        x: Math.min(pos.x, drawStartPos.x), y: Math.min(pos.y, drawStartPos.y),
        width: Math.abs(pos.x - drawStartPos.x), height: Math.abs(pos.y - drawStartPos.y),
        fill: 'transparent', stroke: color, strokeWidth,
      });
    } else if (tool === 'circle') {
      setPreviewEl({
        id: '__preview', type: 'circle',
        x: (drawStartPos.x + pos.x) / 2, y: (drawStartPos.y + pos.y) / 2,
        radiusX: Math.max(4, Math.abs(pos.x - drawStartPos.x) / 2),
        radiusY: Math.max(4, Math.abs(pos.y - drawStartPos.y) / 2),
        fill: 'transparent', stroke: color, strokeWidth,
      });
    } else if (tool === 'line') {
      setPreviewEl({
        id: '__preview', type: 'line',
        x: drawStartPos.x, y: drawStartPos.y,
        points: [0, 0, pos.x - drawStartPos.x, pos.y - drawStartPos.y],
        stroke: color, strokeWidth,
      });
    }
  }

  function handleStageMouseUp() {
    if (tool === 'eraser' && isErasing) {
      setIsErasing(false);
      markDirty();
      return;
    }
    if (tool === 'draw' && isDrawing) {
      setIsDrawing(false);
      if (currentLine.length > 2) {
        pushHistory(elements);
        setElements(prev => [...prev, { id: addId(), type: 'freedraw', points: currentLine, stroke: color, strokeWidth }]);
        markDirty();
      }
      setCurrentLine([]);
      return;
    }

    if ((tool === 'rect' || tool === 'circle' || tool === 'line') && previewEl && drawStartPos) {
      const minSize = 6;
      let tooSmall = false;
      if (tool === 'rect') tooSmall = (previewEl.width ?? 0) < minSize || (previewEl.height ?? 0) < minSize;
      else if (tool === 'circle') tooSmall = (previewEl.radiusX ?? 0) < minSize;
      else if (tool === 'line') tooSmall = Math.abs(previewEl.points?.[2] ?? 0) < minSize && Math.abs(previewEl.points?.[3] ?? 0) < minSize;

      if (!tooSmall) {
        pushHistory(elements);
        setElements(prev => [...prev, { ...previewEl, id: addId() }]);
        markDirty();
      }
      setPreviewEl(null);
      setDrawStartPos(null);
      setIsDrawing(false);
      setTool('select');
    }
  }

  function handleElementChange(id: string, attrs: Partial<CanvasElement>) {
    setElements(prev => prev.map(el => el.id === id ? { ...el, ...attrs } : el));
    markDirty();
  }

  function deleteSelected() {
    if (!selectedId) return;
    pushHistory(elements);
    setElements(prev => prev.filter(el => el.id !== selectedId));
    setSelectedId(null);
    markDirty();
  }

  function openCellEditor(id: string, ri: number, ci: number, currentValue: string) {
    if (viewNote) return;
    setSelectedId(id);
    setEditValue(currentValue);
    setEditing({ id, ri, ci });
  }

  function getEditorRect(target: { id?: string; ri?: number; ci?: number; newAt?: { x: number; y: number } }) {
    // New (not-yet-created) text element
    if (target.newAt) {
      const fs = fontSize;
      const lines = (editValue || '').split('\n');
      const longest = Math.max(...lines.map(l => l.length), 6);
      return {
        x: target.newAt.x, y: target.newAt.y - 2,
        width: Math.min(600, Math.max(120, longest * fs * 0.62 + 12)),
        height: lines.length * fs * 1.3 + 8,
        fontSize: fs,
      };
    }
    const el = elements.find(e => e.id === target.id);
    if (!el) return null;
    if (target.ri === undefined || target.ci === undefined) {
      // Text element — grow the box with the content (multi-line aware)
      const fs = el.fontSize ?? fontSize;
      const lines = (editValue || el.text || '').split('\n');
      const longest = Math.max(...lines.map(l => l.length), 6);
      return {
        x: el.x ?? 0, y: (el.y ?? 0) - 2,
        width: Math.min(600, Math.max(120, longest * fs * 0.62 + 12)),
        height: lines.length * fs * 1.3 + 8,
        fontSize: fs,
      };
    }
    const rows = el.rows ?? [['']];
    const colWidths = el.colWidths ?? rows[0]!.map(() => DEFAULT_COL_WIDTH);
    const rowHeight = el.rowHeight ?? DEFAULT_ROW_HEIGHT;
    const cx = colWidths.slice(0, target.ci).reduce((a, b) => a + b, 0);
    return {
      x: (el.x ?? 0) + cx, y: (el.y ?? 0) + target.ri * rowHeight,
      width: colWidths[target.ci] ?? DEFAULT_COL_WIDTH, height: rowHeight,
      fontSize: 13,
    };
  }

  // Commit the current cell and jump to a neighbour (Tab = right w/ wrap, Enter = down)
  function moveCell(dr: number, dc: number) {
    if (!editing || editing.ri === undefined || editing.ci === undefined || !editing.id) return;
    const { id, ri, ci } = editing;
    const el = elements.find(e => e.id === id);
    if (!el) return;
    const rows = (el.rows ?? [['']]).map(r => [...r]);
    rows[ri]![ci] = editValue;
    handleElementChange(id, { rows });
    const numCols = rows[0]!.length;
    const numRows = rows.length;
    let nr = ri + dr, nc = ci + dc;
    if (nc >= numCols) { nc = 0; nr += 1; }
    else if (nc < 0) { nc = numCols - 1; nr -= 1; }
    if (nr < 0 || nr >= numRows) { setEditing(null); return; }
    setEditValue(rows[nr]![nc] ?? '');
    setEditing({ id, ri: nr, ci: nc });
  }

  // Smart table structure edits (operate on the currently-selected table)
  function selectedTable(): CanvasElement | undefined {
    const el = elements.find(e => e.id === selectedId);
    return el?.type === 'table' ? el : undefined;
  }

  function tableRowHeights(t: CanvasElement): number[] {
    return t.rowHeights ?? (t.rows ?? []).map(() => t.rowHeight ?? DEFAULT_ROW_HEIGHT);
  }

  function addTableRow() {
    const t = selectedTable();
    if (!t) return;
    const cols = t.rows?.[0]?.length ?? DEFAULT_TABLE_COLS;
    const heights = tableRowHeights(t);
    pushHistory(elements);
    handleElementChange(t.id, {
      rows: [...(t.rows ?? []), Array(cols).fill('')],
      rowHeights: [...heights, heights[heights.length - 1] ?? DEFAULT_ROW_HEIGHT],
      rowHeight: undefined,
    });
  }

  function addTableCol() {
    const t = selectedTable();
    if (!t) return;
    pushHistory(elements);
    handleElementChange(t.id, {
      rows: (t.rows ?? []).map(r => [...r, '']),
      colWidths: [...(t.colWidths ?? []), DEFAULT_COL_WIDTH],
    });
  }

  function removeTableRow() {
    const t = selectedTable();
    if (!t || (t.rows?.length ?? 0) <= 1) return;
    pushHistory(elements);
    handleElementChange(t.id, {
      rows: (t.rows ?? []).slice(0, -1),
      rowHeights: tableRowHeights(t).slice(0, -1),
      rowHeight: undefined,
    });
  }

  function removeTableCol() {
    const t = selectedTable();
    if (!t || (t.rows?.[0]?.length ?? 0) <= 1) return;
    pushHistory(elements);
    handleElementChange(t.id, {
      rows: (t.rows ?? []).map(r => r.slice(0, -1)),
      colWidths: (t.colWidths ?? []).slice(0, -1),
    });
  }

  function commitEdit() {
    if (!editing) return;
    const { id, ri, ci, newAt } = editing;
    if (newAt) {
      // Create the text element only if the user actually typed something
      if (editValue.trim() !== '') {
        pushHistory(elements);
        const nid = addId();
        setElements(prev => [...prev, { id: nid, type: 'text', x: newAt.x, y: newAt.y, text: editValue, fontSize, color }]);
        setSelectedId(nid);
        markDirty();
      }
    } else if (id && (ri === undefined || ci === undefined)) {
      if (editValue.trim() === '') {
        pushHistory(elements);
        setElements(prev => prev.filter(el => el.id !== id));
        markDirty();
      } else {
        handleElementChange(id, { text: editValue });
      }
    } else if (id) {
      const el = elements.find(e => e.id === id);
      if (el) {
        const rows = (el.rows ?? [['']]).map(r => [...r]);
        rows[ri!]![ci!] = editValue;
        handleElementChange(id, { rows });
      }
    }
    setEditing(null);
  }

  function cancelEdit() {
    setEditing(null);
  }

  // Downscale + compress an image file to a compact data URL that lives inside
  // the canvas JSON — no object storage / backend upload required.
  function compressImage(file: File, maxSide: number, quality: number): Promise<{ url: string; w: number; h: number }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
      reader.onload = () => {
        const img = new window.Image();
        img.onerror = () => reject(new Error('ไฟล์รูปเสียหายหรือไม่รองรับ'));
        img.onload = () => {
          const ratio = Math.min(maxSide / img.naturalWidth, maxSide / img.naturalHeight, 1);
          const w = Math.max(1, Math.round(img.naturalWidth * ratio));
          const h = Math.max(1, Math.round(img.naturalHeight * ratio));
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('เบราว์เซอร์ไม่รองรับการย่อรูป'));
          ctx.drawImage(img, 0, 0, w, h);
          // PNG (may have transparency) stays PNG; everything else → JPEG for size
          const isPng = file.type === 'image/png';
          const url = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality);
          resolve({ url, w, h });
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  }

  async function handleImageUpload(file: File) {
    if (!file.type.startsWith('image/')) { setUploadError('ไฟล์ที่เลือกไม่ใช่รูปภาพ'); return; }
    if (file.size > 25 * 1024 * 1024) { setUploadError('รูปภาพใหญ่เกิน 25MB'); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const { url, w, h } = await compressImage(file, 1200, 0.82);
      const maxSide = 360;
      const ratio = Math.min(maxSide / w, maxSide / h, 1);
      pushHistory(elements);
      const id = addId();
      setElements(prev => [...prev, {
        id, type: 'image', x: 80, y: 80,
        width: Math.round(w * ratio),
        height: Math.round(h * ratio),
        url,
      }]);
      setSelectedId(id);
      markDirty();
    } catch (err) {
      console.error('Image processing failed:', err);
      setUploadError(err instanceof Error ? err.message : 'เพิ่มรูปภาพไม่สำเร็จ');
    } finally {
      setUploading(false);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (viewNote) return;
    // Screenshot / image on the clipboard → upload it
    const imgItem = Array.from(e.clipboardData.items).find(it => it.type.startsWith('image/'));
    if (imgItem) {
      const file = imgItem.getAsFile();
      if (file) { e.preventDefault(); handleImageUpload(file); return; }
    }
    const text = e.clipboardData.getData('text/plain');
    if (!text || !text.includes('\t')) return; // only intercept tabular (Excel) paste; let other paste behave normally
    e.preventDefault();
    const rows = text.replace(/\r/g, '').split('\n').filter(r => r.length > 0).map(r => r.split('\t'));
    if (rows.length === 0) return;
    const maxCols = Math.max(...rows.map(r => r.length));
    const normalized = rows.map(r => {
      const copy = [...r];
      while (copy.length < maxCols) copy.push('');
      return copy;
    });
    const colWidths = Array.from({ length: maxCols }, (_, ci) => {
      const longest = Math.max(...normalized.map(r => (r[ci] ?? '').length), 4);
      return Math.min(220, Math.max(70, longest * 8));
    });
    pushHistory(elements);
    const id = addId();
    setElements(prev => [...prev, { id, type: 'table', x: 80, y: 80, rows: normalized, colWidths, rowHeight: DEFAULT_ROW_HEIGHT, stroke: color }]);
    setSelectedId(id);
    setTool('select');
    markDirty();
  }

  async function saveMeetingNote() {
    if (!worksheet) return;
    await apiPost(`/worksheets/${worksheet.id}/meeting-notes`, { meetingDate: new Date().toISOString() });
    fetchNotes();
  }

  const fetchNotes = useCallback(async () => {
    if (!worksheet) return;
    const data = await apiGet<MeetingNoteItem[]>(`/worksheets/${worksheet.id}/meeting-notes`);
    setNotes(data);
  }, [worksheet]);

  useEffect(() => { if (showHistory) fetchNotes(); }, [showHistory, fetchNotes]);

  async function openNote(noteId: string) {
    const note = await apiGet<MeetingNoteDetail>(`/worksheets/notes/${noteId}`);
    setViewNote(note);
  }

  function handleWheel(e: Konva.KonvaEventObject<WheelEvent>) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    // Horizontal trackpad swipe / shift+wheel: pan sideways instead of zooming
    if (Math.abs(e.evt.deltaX) > Math.abs(e.evt.deltaY)) {
      setPosition(prev => ({ x: prev.x - e.evt.deltaX, y: prev.y - e.evt.deltaY }));
      return;
    }

    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const scaleBy = 1.08;
    const newScale = Math.min(Math.max(e.evt.deltaY < 0 ? scale * scaleBy : scale / scaleBy, 0.2), 4);
    const pt = { x: (pointer.x - position.x) / scale, y: (pointer.y - position.y) / scale };
    setScale(newScale);
    setPosition({ x: pointer.x - pt.x * newScale, y: pointer.y - pt.y * newScale });
  }

  function zoomStep(factor: number) {
    const ns = Math.min(Math.max(scale * factor, 0.2), 4);
    const cx = stageSize.width / 2;
    const cy = stageSize.height / 2;
    const pt = { x: (cx - position.x) / scale, y: (cy - position.y) / scale };
    setScale(ns);
    setPosition({ x: cx - pt.x * ns, y: cy - pt.y * ns });
  }

  function resetView() { setScale(1); setPosition({ x: 0, y: 0 }); }

  const displayElements = viewNote ? viewNote.canvasSnapshot.elements : elements;

  return (
    <AppShell
      backTo={`/employees/${userId}`}
      backLabel="โปรไฟล์พนักงาน"
      title="Worksheet"
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={styles.saveStatus}>
            {saveStatus === 'saved' ? '✓ บันทึกแล้ว' : saveStatus === 'saving' ? '⏳ กำลังบันทึก...' : '● ยังไม่บันทึก'}
          </span>
          <button className="btn btn-ghost" onClick={() => setShowHistory(!showHistory)}>ประวัติการประชุม</button>
          <button className="btn btn-primary" onClick={saveMeetingNote}>บันทึกประชุม</button>
        </div>
      }
    >
      <div className={styles.worksheetLayout}>
        {/* Toolbar */}
        <div className={styles.toolbar}>

          <div className={styles.toolGroup}>
            <p className={styles.toolGroupLabel}>เครื่องมือ</p>
            {TOOLS.map(([t, icon, label]) => (
              <button
                key={t}
                className={`${styles.toolBtn} ${tool === t ? styles.toolActive : ''}`}
                onClick={() => { setTool(t); setSelectedId(null); }}
                title={label}
              >
                <span className={styles.toolIcon}>{icon}</span>
                <span className={styles.toolLabel}>{label}</span>
              </button>
            ))}
            <label className={styles.toolBtn} title="อัปโหลดรูปภาพ">
              <span className={styles.toolIcon}>🖼</span>
              <span className={styles.toolLabel}>รูปภาพ</span>
              <input type="file" accept="image/*" style={{ display: 'none' }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ''; }}
              />
            </label>
          </div>

          <div className={styles.toolGroup}>
            <p className={styles.toolGroupLabel}>การกระทำ</p>
            <button
              className={`${styles.toolBtn} ${history.length === 0 ? styles.toolDisabled : ''}`}
              onClick={undo}
              disabled={history.length === 0}
              title={`เลิกทำ (${history.length})`}
            >
              <span className={styles.toolIcon}>↩</span>
              <span className={styles.toolLabel}>เลิกทำ</span>
            </button>
            {selectedId && (
              <button className={`${styles.toolBtn} ${styles.toolDanger}`} onClick={deleteSelected} title="ลบที่เลือก">
                <span className={styles.toolIcon}>🗑</span>
                <span className={styles.toolLabel}>ลบที่เลือก</span>
              </button>
            )}
            {viewNote && (
              <button className={`${styles.toolBtn} ${styles.toolAccent}`} onClick={() => setViewNote(null)}>
                <span className={styles.toolIcon}>←</span>
                <span className={styles.toolLabel}>กลับแก้ไข</span>
              </button>
            )}
          </div>

          {selectedTable() && !viewNote && (
            <div className={styles.toolGroup}>
              <p className={styles.toolGroupLabel}>ตาราง</p>
              <button className={styles.toolBtn} onClick={addTableRow} title="เพิ่มแถว">
                <span className={styles.toolIcon}>⊕</span>
                <span className={styles.toolLabel}>เพิ่มแถว</span>
              </button>
              <button className={styles.toolBtn} onClick={addTableCol} title="เพิ่มคอลัมน์">
                <span className={styles.toolIcon}>⊞</span>
                <span className={styles.toolLabel}>เพิ่มคอลัมน์</span>
              </button>
              <button className={styles.toolBtn} onClick={removeTableRow} title="ลบแถวล่างสุด">
                <span className={styles.toolIcon}>⊖</span>
                <span className={styles.toolLabel}>ลบแถว</span>
              </button>
              <button className={styles.toolBtn} onClick={removeTableCol} title="ลบคอลัมน์ขวาสุด">
                <span className={styles.toolIcon}>⊟</span>
                <span className={styles.toolLabel}>ลบคอลัมน์</span>
              </button>
            </div>
          )}

          <div className={styles.toolGroup}>
            <p className={styles.toolGroupLabel}>สี</p>
            <div className={styles.palette}>
              {COLORS.map(c => (
                <button
                  key={c}
                  className={`${styles.colorSwatch} ${color === c ? styles.swatchActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
          </div>

          <div className={styles.toolGroup}>
            <p className={styles.toolGroupLabel}>{tool === 'eraser' ? 'ขนาดยางลบ' : 'ขนาดเส้น'}</p>
            <div className={styles.sliderRow}>
              <input type="range" min={1} max={12} value={strokeWidth}
                onChange={e => setStrokeWidth(+e.target.value)} className={styles.slider} />
              <span className={styles.sliderVal}>{strokeWidth}px</span>
            </div>
          </div>

          {tool === 'text' && (
            <div className={styles.toolGroup}>
              <p className={styles.toolGroupLabel}>ขนาดตัวอักษร</p>
              <div className={styles.sliderRow}>
                <input type="range" min={8} max={72} value={fontSize}
                  onChange={e => setFontSize(+e.target.value)} className={styles.slider} />
                <span className={styles.sliderVal}>{fontSize}px</span>
              </div>
            </div>
          )}

        </div>

        {/* Canvas */}
        <div
          ref={containerRef}
          className={styles.canvasArea}
          tabIndex={0}
          onPaste={handlePaste}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file?.type.startsWith('image/')) handleImageUpload(file);
          }}
        >
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            scaleX={scale}
            scaleY={scale}
            x={position.x}
            y={position.y}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onWheel={handleWheel}
            draggable={tool === 'select'}
            onDragEnd={e => {
              // dragend bubbles from child elements too — only pan when the
              // Stage itself was the drag target, not a shape/image/table
              if (e.target === e.target.getStage()) setPosition({ x: e.target.x(), y: e.target.y() });
            }}
            style={{ cursor: CURSOR_MAP[tool] }}
          >
            <Layer>
              {displayElements.map(el => {
                const draggable = tool === 'select' && !viewNote;
                const onClick = () => handleElementClick(el.id);

                if (el.type === 'text') return (
                  <Text
                    key={el.id} id={el.id}
                    x={el.x} y={el.y}
                    text={el.text ?? ''}
                    fontSize={el.fontSize ?? 16}
                    fill={el.color ?? DEFAULT_COLOR}
                    draggable={draggable}
                    onClick={onClick}
                    onDragEnd={e => handleElementChange(el.id, { x: e.target.x(), y: e.target.y() })}
                    onDblClick={() => {
                      if (viewNote) return;
                      setSelectedId(el.id);
                      setEditValue(el.text ?? '');
                      setEditing({ id: el.id });
                    }}
                  />
                );

                if (el.type === 'image') {
                  const imgEl = loadedImages.current.get(el.url ?? '');
                  return imgEl ? (
                    <KonvaImage
                      key={el.id} id={el.id}
                      x={el.x} y={el.y}
                      width={el.width ?? 200} height={el.height ?? 150}
                      image={imgEl}
                      draggable={draggable}
                      onClick={onClick}
                      onDragEnd={e => handleElementChange(el.id, { x: e.target.x(), y: e.target.y() })}
                      onTransformEnd={e => {
                        const node = e.target;
                        handleElementChange(el.id, {
                          x: node.x(), y: node.y(),
                          width: Math.max(20, node.width() * node.scaleX()),
                          height: Math.max(20, node.height() * node.scaleY()),
                          scaleX: 1, scaleY: 1,
                        });
                        node.scaleX(1); node.scaleY(1);
                      }}
                    />
                  ) : null;
                }

                if (el.type === 'freedraw') return (
                  <Line
                    key={el.id} id={el.id}
                    points={el.points ?? []}
                    stroke={el.stroke ?? DEFAULT_COLOR}
                    strokeWidth={el.strokeWidth ?? 2}
                    tension={0.5} lineCap="round" lineJoin="round"
                    hitStrokeWidth={Math.max(el.strokeWidth ?? 2, 10)}
                    onClick={onClick}
                  />
                );

                if (el.type === 'rect') return (
                  <Rect
                    key={el.id} id={el.id}
                    x={el.x} y={el.y}
                    width={el.width ?? 100} height={el.height ?? 60}
                    fill={el.fill ?? 'transparent'}
                    stroke={el.stroke ?? DEFAULT_COLOR}
                    strokeWidth={el.strokeWidth ?? 2}
                    draggable={draggable}
                    onClick={onClick}
                    onDragEnd={e => handleElementChange(el.id, { x: e.target.x(), y: e.target.y() })}
                    onTransformEnd={e => {
                      const node = e.target;
                      handleElementChange(el.id, {
                        x: node.x(), y: node.y(),
                        width: Math.max(10, node.width() * node.scaleX()),
                        height: Math.max(10, node.height() * node.scaleY()),
                      });
                      node.scaleX(1); node.scaleY(1);
                    }}
                  />
                );

                if (el.type === 'circle') return (
                  <Ellipse
                    key={el.id} id={el.id}
                    x={el.x ?? 0} y={el.y ?? 0}
                    radiusX={el.radiusX ?? 40} radiusY={el.radiusY ?? 40}
                    fill={el.fill ?? 'transparent'}
                    stroke={el.stroke ?? DEFAULT_COLOR}
                    strokeWidth={el.strokeWidth ?? 2}
                    draggable={draggable}
                    onClick={onClick}
                    onDragEnd={e => handleElementChange(el.id, { x: e.target.x(), y: e.target.y() })}
                    onTransformEnd={e => {
                      const node = e.target;
                      handleElementChange(el.id, {
                        x: node.x(), y: node.y(),
                        radiusX: (el.radiusX ?? 40) * node.scaleX(),
                        radiusY: (el.radiusY ?? 40) * node.scaleY(),
                      });
                      node.scaleX(1); node.scaleY(1);
                    }}
                  />
                );

                if (el.type === 'line') return (
                  <Line
                    key={el.id} id={el.id}
                    x={el.x ?? 0} y={el.y ?? 0}
                    points={el.points ?? [0, 0, 100, 0]}
                    stroke={el.stroke ?? DEFAULT_COLOR}
                    strokeWidth={el.strokeWidth ?? 2}
                    lineCap="round"
                    hitStrokeWidth={Math.max(el.strokeWidth ?? 2, 10)}
                    draggable={draggable}
                    onClick={onClick}
                    onDragEnd={e => handleElementChange(el.id, { x: e.target.x(), y: e.target.y() })}
                  />
                );

                if (el.type === 'table') {
                  const rows = el.rows ?? [['']];
                  const colWidths = el.colWidths ?? rows[0]!.map(() => DEFAULT_COL_WIDTH);
                  const rowHeights = el.rowHeights ?? rows.map(() => el.rowHeight ?? DEFAULT_ROW_HEIGHT);
                  // running offsets for column-left and row-top positions
                  const colX: number[] = []; colWidths.reduce((a, w, i) => { colX[i] = a; return a + w; }, 0);
                  const rowY: number[] = []; rowHeights.reduce((a, h, i) => { rowY[i] = a; return a + h; }, 0);
                  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
                  const totalHeight = rowHeights.reduce((a, b) => a + b, 0);
                  const tableSelected = tool === 'select' && selectedId === el.id && !viewNote;
                  const setCur = (e: Konva.KonvaEventObject<MouseEvent>, c: string) => {
                    const cont = e.target.getStage()?.container();
                    if (cont) cont.style.cursor = c;
                  };
                  return (
                    <Group
                      key={el.id} id={el.id}
                      x={el.x ?? 0} y={el.y ?? 0}
                      draggable={draggable}
                      onClick={onClick}
                      onDragEnd={e => handleElementChange(el.id, { x: e.target.x(), y: e.target.y() })}
                    >
                      <Rect width={totalWidth} height={totalHeight} fill="#ffffff" stroke={el.stroke ?? DEFAULT_COLOR} strokeWidth={1.5} />
                      {rows.map((row, ri) =>
                        row.map((cell, ci) => (
                          <Fragment key={`${el.id}-${ri}-${ci}`}>
                            <Rect
                              x={colX[ci]} y={rowY[ri]}
                              width={colWidths[ci]} height={rowHeights[ri]}
                              stroke={el.stroke ?? DEFAULT_COLOR} strokeWidth={0.5}
                            />
                            <Text
                              x={colX[ci]! + 6} y={rowY[ri]! + 4}
                              width={(colWidths[ci] ?? DEFAULT_COL_WIDTH) - 12}
                              height={(rowHeights[ri] ?? DEFAULT_ROW_HEIGHT) - 8}
                              text={cell} fontSize={13} fill={DEFAULT_COLOR}
                              onDblClick={() => openCellEditor(el.id, ri, ci, cell)}
                            />
                          </Fragment>
                        ))
                      )}

                      {/* Column-width drag handles (right border of each column) */}
                      {tableSelected && colWidths.map((cw, ci) => {
                        const borderX = colX[ci]! + cw;
                        const groupAbsY = position.y + (el.y ?? 0) * scale;
                        return (
                          <Rect
                            key={`colh-${ci}`}
                            x={borderX - 3} y={0} width={6} height={totalHeight}
                            fill="#2563EB" opacity={0.001}
                            draggable
                            onMouseEnter={e => setCur(e, 'col-resize')}
                            onMouseLeave={e => setCur(e, 'default')}
                            dragBoundFunc={pos => ({ x: pos.x, y: groupAbsY })}
                            onDragEnd={e => {
                              const newW = Math.max(30, e.target.x() + 3 - colX[ci]!);
                              const next = [...colWidths]; next[ci] = newW;
                              pushHistory(elements);
                              handleElementChange(el.id, { colWidths: next });
                            }}
                          />
                        );
                      })}

                      {/* Row-height drag handles (bottom border of each row) */}
                      {tableSelected && rowHeights.map((rh, ri) => {
                        const borderY = rowY[ri]! + rh;
                        const groupAbsX = position.x + (el.x ?? 0) * scale;
                        return (
                          <Rect
                            key={`rowh-${ri}`}
                            x={0} y={borderY - 3} width={totalWidth} height={6}
                            fill="#2563EB" opacity={0.001}
                            draggable
                            onMouseEnter={e => setCur(e, 'row-resize')}
                            onMouseLeave={e => setCur(e, 'default')}
                            dragBoundFunc={pos => ({ x: groupAbsX, y: pos.y })}
                            onDragEnd={e => {
                              const newH = Math.max(16, e.target.y() + 3 - rowY[ri]!);
                              const next = [...rowHeights]; next[ri] = newH;
                              pushHistory(elements);
                              handleElementChange(el.id, { rowHeights: next, rowHeight: undefined });
                            }}
                          />
                        );
                      })}
                    </Group>
                  );
                }

                return null;
              })}

              {/* Freedraw live preview */}
              {isDrawing && tool === 'draw' && currentLine.length > 2 && (
                <Line points={currentLine} stroke={color} strokeWidth={strokeWidth} tension={0.5} lineCap="round" lineJoin="round" />
              )}

              {/* Drag-to-create previews */}
              {previewEl?.type === 'rect' && (
                <Rect x={previewEl.x ?? 0} y={previewEl.y ?? 0} width={previewEl.width ?? 0} height={previewEl.height ?? 0}
                  fill="transparent" stroke={color} strokeWidth={strokeWidth} dash={[8, 4]} opacity={0.7} />
              )}
              {previewEl?.type === 'circle' && (
                <Ellipse x={previewEl.x ?? 0} y={previewEl.y ?? 0} radiusX={previewEl.radiusX ?? 0} radiusY={previewEl.radiusY ?? 0}
                  fill="transparent" stroke={color} strokeWidth={strokeWidth} dash={[8, 4]} opacity={0.7} />
              )}
              {previewEl?.type === 'line' && (
                <Line x={previewEl.x ?? 0} y={previewEl.y ?? 0} points={previewEl.points ?? []}
                  stroke={color} strokeWidth={strokeWidth} lineCap="round" dash={[8, 4]} opacity={0.7} />
              )}

              <Transformer ref={transformerRef}
                borderStroke="#2563EB" anchorFill="#2563EB" anchorStroke="#2563EB" anchorCornerRadius={3} />
            </Layer>
          </Stage>

          {/* Inline text editor overlay */}
          {editing && (() => {
            const rect = getEditorRect(editing);
            if (!rect) return null;
            const isCell = editing.ri !== undefined && editing.ci !== undefined;
            const commonStyle = {
              left: rect.x * scale + position.x,
              top: rect.y * scale + position.y,
              width: rect.width * scale,
              height: rect.height * scale,
              fontSize: rect.fontSize * scale,
            };
            if (isCell) {
              return (
                <input
                  ref={editorRef as React.RefObject<HTMLInputElement>}
                  autoFocus
                  className={styles.inlineEditor}
                  style={commonStyle}
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  onFocus={e => e.target.select()}
                  onKeyDown={e => {
                    if (e.key === 'Tab') { e.preventDefault(); moveCell(0, e.shiftKey ? -1 : 1); }
                    else if (e.key === 'Enter') { e.preventDefault(); moveCell(1, 0); }
                    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    e.stopPropagation();
                  }}
                  onBlur={handleEditorBlur}
                />
              );
            }
            // Text element — multi-line textarea (Enter = commit, Shift+Enter = new line)
            return (
              <textarea
                ref={editorRef as React.RefObject<HTMLTextAreaElement>}
                autoFocus
                className={styles.inlineEditor}
                style={{ ...commonStyle, resize: 'none', overflow: 'hidden', lineHeight: 1.3 }}
                value={editValue}
                placeholder="พิมพ์ข้อความ… (Shift+Enter ขึ้นบรรทัดใหม่)"
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                  e.stopPropagation();
                }}
                onBlur={handleEditorBlur}
              />
            );
          })()}

          {/* Upload status / error toast */}
          {uploading && <div className={styles.uploadToast}>⏳ กำลังอัปโหลดรูปภาพ…</div>}
          {uploadError && (
            <div className={`${styles.uploadToast} ${styles.uploadToastError}`} onClick={() => setUploadError(null)}>
              ⚠ {uploadError} <span style={{ opacity: 0.7, marginLeft: 6 }}>(คลิกเพื่อปิด)</span>
            </div>
          )}

          {/* Minimap */}
          <Minimap
            elements={displayElements}
            scale={scale}
            position={position}
            stageSize={stageSize}
            onNavigate={(wx, wy) => setPosition({ x: stageSize.width / 2 - wx * scale, y: stageSize.height / 2 - wy * scale })}
          />

          {/* Zoom controls */}
          <div className={styles.zoomControls}>
            <button className={styles.zoomBtn} onClick={() => zoomStep(1.2)} title="ซูมเข้า">+</button>
            <button className={styles.zoomBadge} onClick={resetView} title="รีเซ็ตมุมมอง">{Math.round(scale * 100)}%</button>
            <button className={styles.zoomBtn} onClick={() => zoomStep(1 / 1.2)} title="ซูมออก">−</button>
          </div>
        </div>

        {/* History panel */}
        {showHistory && (
          <div className={styles.historyPanel}>
            <div className={styles.historyHeader}>
              <p className={styles.historyTitle}>ประวัติการประชุม</p>
              <button className={styles.closeBtn} onClick={() => setShowHistory(false)}>✕</button>
            </div>
            <button className="btn btn-primary" style={{ margin: '0 16px 12px', width: 'calc(100% - 32px)' }} onClick={saveMeetingNote}>
              + บันทึกประชุมใหม่
            </button>
            <div className={styles.notesList}>
              {notes.length === 0 ? (
                <p className={styles.noNotes}>ยังไม่มีประวัติการประชุม</p>
              ) : notes.map(n => (
                <div key={n.id} className={styles.noteItem} onClick={() => openNote(n.id)}>
                  <div className={styles.noteDate}>
                    {new Date(n.meetingDate).toLocaleDateString('th-TH', { dateStyle: 'medium' })}
                  </div>
                  <div className={styles.noteMeta}>
                    บันทึกโดย {n.user.name} · {new Date(n.createdAt).toLocaleDateString('th-TH', { dateStyle: 'short' })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
