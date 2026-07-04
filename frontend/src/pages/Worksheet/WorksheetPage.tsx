import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import { useParams } from 'react-router-dom';
import { Stage, Layer, Text, Image as KonvaImage, Line, Rect, Ellipse, Group, Transformer } from 'react-konva';
import type Konva from 'konva';
import { apiGet, apiPut, apiPost, apiFetch } from '../../api/client';
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
  const [editing, setEditing] = useState<{ id: string; ri?: number; ci?: number } | null>(null);
  const [editValue, setEditValue] = useState('');

  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const loadedImages = useRef<Map<string, HTMLImageElement>>(new Map());
  const [, forceUpdate] = useState(0);

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
    if (selectedId && tool === 'select') {
      const node = stage.findOne(`#${CSS.escape(selectedId)}`);
      if (node) tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId, tool]);

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
      pushHistory(elements);
      const id = addId();
      setElements(prev => [...prev, { id, type: 'text', x: pos.x, y: pos.y, text: '', fontSize, color }]);
      setSelectedId(id);
      setTool('select');
      setEditValue('');
      setEditing({ id });
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

  function getEditorRect(target: { id: string; ri?: number; ci?: number }) {
    const el = elements.find(e => e.id === target.id);
    if (!el) return null;
    if (target.ri === undefined || target.ci === undefined) {
      return { x: el.x ?? 0, y: (el.y ?? 0) - 4, width: 220, height: (el.fontSize ?? fontSize) * 1.4 + 4, fontSize: el.fontSize ?? fontSize };
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

  function commitEdit() {
    if (!editing) return;
    const { id, ri, ci } = editing;
    if (ri === undefined || ci === undefined) {
      if (editValue.trim() === '') {
        setElements(prev => prev.filter(el => el.id !== id));
      } else {
        handleElementChange(id, { text: editValue });
      }
    } else {
      const el = elements.find(e => e.id === id);
      if (el) {
        const rows = (el.rows ?? [['']]).map(r => [...r]);
        rows[ri]![ci] = editValue;
        handleElementChange(id, { rows });
      }
    }
    setEditing(null);
  }

  function cancelEdit() {
    if (!editing) return;
    const { id, ri } = editing;
    if (ri === undefined) {
      // discard a freshly-created, never-typed-into text element
      const el = elements.find(e => e.id === id);
      if (el && (el.text ?? '') === '') setElements(prev => prev.filter(e => e.id !== id));
    }
    setEditing(null);
  }

  async function handleImageUpload(file: File) {
    if (!worksheet) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiFetch(`/worksheets/${worksheet.id}/upload-image`, { method: 'POST', body: fd, headers: {} });
    const { url } = await res.json();
    pushHistory(elements);
    const id = addId();
    setElements(prev => [...prev, { id, type: 'image', x: 80, y: 80, width: 300, height: 200, url }]);
    setSelectedId(id);
    markDirty();
  }

  function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    if (viewNote) return;
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
            onDragEnd={e => setPosition({ x: e.target.x(), y: e.target.y() })}
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
                  const rowHeight = el.rowHeight ?? DEFAULT_ROW_HEIGHT;
                  const totalWidth = colWidths.reduce((a, b) => a + b, 0);
                  const totalHeight = rows.length * rowHeight;
                  return (
                    <Group
                      key={el.id} id={el.id}
                      x={el.x ?? 0} y={el.y ?? 0}
                      draggable={draggable}
                      onClick={onClick}
                      onDragEnd={e => handleElementChange(el.id, { x: e.target.x(), y: e.target.y() })}
                      onTransformEnd={e => {
                        const node = e.target;
                        const sx = node.scaleX(), sy = node.scaleY();
                        handleElementChange(el.id, {
                          x: node.x(), y: node.y(),
                          colWidths: colWidths.map(w => Math.max(30, w * sx)),
                          rowHeight: Math.max(16, rowHeight * sy),
                        });
                        node.scaleX(1); node.scaleY(1);
                      }}
                    >
                      <Rect width={totalWidth} height={totalHeight} fill="#ffffff" stroke={el.stroke ?? DEFAULT_COLOR} strokeWidth={1.5} />
                      {rows.map((row, ri) => {
                        let cx = 0;
                        return row.map((cell, ci) => {
                          const cw = colWidths[ci] ?? DEFAULT_COL_WIDTH;
                          const rectX = cx;
                          cx += cw;
                          return (
                            <Fragment key={`${el.id}-${ri}-${ci}`}>
                              <Rect
                                x={rectX} y={ri * rowHeight}
                                width={cw} height={rowHeight}
                                stroke={el.stroke ?? DEFAULT_COLOR} strokeWidth={0.5}
                              />
                              <Text
                                x={rectX + 6} y={ri * rowHeight + 4}
                                width={cw - 12} height={rowHeight - 8}
                                text={cell} fontSize={13} fill={DEFAULT_COLOR}
                                onDblClick={() => openCellEditor(el.id, ri, ci, cell)}
                              />
                            </Fragment>
                          );
                        });
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
            return (
              <input
                autoFocus
                className={styles.inlineEditor}
                style={{
                  left: rect.x * scale + position.x,
                  top: rect.y * scale + position.y,
                  width: rect.width * scale,
                  height: rect.height * scale,
                  fontSize: rect.fontSize * scale,
                }}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onFocus={e => e.target.select()}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                  e.stopPropagation();
                }}
                onBlur={commitEdit}
              />
            );
          })()}

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
