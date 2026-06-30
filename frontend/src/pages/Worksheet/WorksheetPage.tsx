import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Stage, Layer, Text, Image as KonvaImage, Line, Rect, Transformer } from 'react-konva';
import type Konva from 'konva';
import { apiGet, apiPut, apiPost, apiFetch } from '../../api/client';
import type { Worksheet, CanvasData, CanvasElement, MeetingNoteItem, MeetingNoteDetail } from '../../api/types';
import AppShell from '../../components/AppShell';
import styles from './WorksheetPage.module.css';

type Tool = 'select' | 'text' | 'draw' | 'rect' | 'image';

const COLORS = ['#e2e8f0', '#378ADD', '#7F77DD', '#22c55e', '#f59e0b', '#ef4444', '#f97316', '#ec4899'];

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
  const [color, setColor] = useState('#e2e8f0');
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState<number[]>([]);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty'>('saved');
  const [showHistory, setShowHistory] = useState(false);
  const [notes, setNotes] = useState<MeetingNoteItem[]>([]);
  const [viewNote, setViewNote] = useState<MeetingNoteDetail | null>(null);
  const [stageSize, setStageSize] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const stageRef = useRef<Konva.Stage>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const loadedImages = useRef<Map<string, HTMLImageElement>>(new Map());
  const [, forceUpdate] = useState(0);

  // Load worksheet
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

  // Container resize
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Preload images
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

  // Autosave
  const debouncedElements = useDebounce(elements, 2500);
  useEffect(() => {
    if (!worksheet || saveStatus === 'saved') return;
    setSaveStatus('saving');
    const data: CanvasData = { version: 1, elements: debouncedElements };
    apiPut(`/worksheets/${worksheet.id}`, { canvasData: data })
      .then(() => setSaveStatus('saved'))
      .catch(() => setSaveStatus('dirty'));
  }, [debouncedElements, worksheet]);

  // Transformer
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    if (selectedId) {
      const node = stage.findOne(`#${CSS.escape(selectedId)}`);
      if (node) tr.nodes([node]);
    } else {
      tr.nodes([]);
    }
    tr.getLayer()?.batchDraw();
  }, [selectedId]);

  function markDirty() { setSaveStatus('dirty'); }

  function addId(): string {
    return `el_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
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

    if (tool === 'draw') {
      setIsDrawing(true);
      setCurrentLine([pos.x, pos.y]);
    } else if (tool === 'text') {
      const id = addId();
      const newEl: CanvasElement = { id, type: 'text', x: pos.x, y: pos.y, text: 'พิมพ์ข้อความ', fontSize: 16, color };
      setElements(prev => [...prev, newEl]);
      setSelectedId(id);
      setTool('select');
      markDirty();
    } else if (tool === 'rect') {
      const id = addId();
      const newEl: CanvasElement = { id, type: 'rect', x: pos.x, y: pos.y, width: 120, height: 80, fill: 'transparent', stroke: color, strokeWidth };
      setElements(prev => [...prev, newEl]);
      setSelectedId(id);
      setTool('select');
      markDirty();
    }
  }

  function handleStageMouseMove(_e: Konva.KonvaEventObject<MouseEvent>) {
    if (!isDrawing || tool !== 'draw') return;
    const stage = stageRef.current;
    if (!stage) return;
    const pos = stage.getRelativePointerPosition();
    if (!pos) return;
    setCurrentLine(prev => [...prev, pos.x, pos.y]);
  }

  function handleStageMouseUp() {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentLine.length > 2) {
      const id = addId();
      const newEl: CanvasElement = { id, type: 'freedraw', points: currentLine, stroke: color, strokeWidth };
      setElements(prev => [...prev, newEl]);
      markDirty();
    }
    setCurrentLine([]);
  }

  function handleElementChange(id: string, attrs: Partial<CanvasElement>) {
    setElements(prev => prev.map(el => el.id === id ? { ...el, ...attrs } : el));
    markDirty();
  }

  function deleteSelected() {
    if (!selectedId) return;
    setElements(prev => prev.filter(el => el.id !== selectedId));
    setSelectedId(null);
    markDirty();
  }

  async function handleImageUpload(file: File) {
    if (!worksheet) return;
    const fd = new FormData();
    fd.append('file', file);
    const res = await apiFetch(`/worksheets/${worksheet.id}/upload-image`, { method: 'POST', body: fd, headers: {} });
    const { url } = await res.json();
    const id = addId();
    const newEl: CanvasElement = { id, type: 'image', x: 100, y: 100, width: 300, height: 200, url };
    setElements(prev => [...prev, newEl]);
    setSelectedId(id);
    markDirty();
  }

  async function saveMeetingNote() {
    if (!worksheet) return;
    const meetingDate = new Date().toISOString();
    await apiPost(`/worksheets/${worksheet.id}/meeting-notes`, { meetingDate });
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
    const oldScale = scale;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const scaleBy = 1.08;
    const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
    const clamped = Math.min(Math.max(newScale, 0.2), 4);
    const mousePointTo = {
      x: (pointer.x - position.x) / oldScale,
      y: (pointer.y - position.y) / oldScale,
    };
    setScale(clamped);
    setPosition({
      x: pointer.x - mousePointTo.x * clamped,
      y: pointer.y - mousePointTo.y * clamped,
    });
  }

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
          <button className="btn btn-ghost" onClick={() => setShowHistory(!showHistory)}>
            ประวัติการประชุม
          </button>
          <button className="btn btn-primary" onClick={saveMeetingNote}>
            บันทึกประชุม
          </button>
        </div>
      }
    >
      <div className={styles.worksheetLayout}>
        {/* Toolbar */}
        <div className={styles.toolbar}>
          <div className={styles.toolGroup}>
            {([
              ['select', '↖', 'เลือก'],
              ['text', 'T', 'ข้อความ'],
              ['draw', '✏', 'วาด'],
              ['rect', '▭', 'สี่เหลี่ยม'],
            ] as [Tool, string, string][]).map(([t, icon, label]) => (
              <button
                key={t}
                className={`${styles.toolBtn} ${tool === t ? styles.toolActive : ''}`}
                onClick={() => { setTool(t); setSelectedId(null); }}
                title={label}
              >
                <span>{icon}</span>
                <span className={styles.toolLabel}>{label}</span>
              </button>
            ))}
            <label className={`${styles.toolBtn}`} title="อัปโหลดรูป">
              <span>🖼</span>
              <span className={styles.toolLabel}>รูปภาพ</span>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = ''; }} />
            </label>
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
                />
              ))}
            </div>
          </div>

          <div className={styles.toolGroup}>
            <p className={styles.toolGroupLabel}>ขนาดเส้น</p>
            <input type="range" min={1} max={12} value={strokeWidth} onChange={e => setStrokeWidth(+e.target.value)} className={styles.slider} />
            <span className={styles.sliderVal}>{strokeWidth}px</span>
          </div>

          {selectedId && (
            <div className={styles.toolGroup}>
              <button className="btn btn-danger" style={{ fontSize: 12, padding: '5px 10px' }} onClick={deleteSelected}>
                ลบ
              </button>
            </div>
          )}

          {viewNote && (
            <div className={styles.toolGroup}>
              <button className="btn btn-primary" onClick={() => setViewNote(null)}>
                ← กลับแก้ไข
              </button>
            </div>
          )}
        </div>

        {/* Canvas container */}
        <div
          ref={containerRef}
          className={styles.canvasArea}
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
            style={{ cursor: tool === 'draw' ? 'crosshair' : tool === 'text' ? 'text' : 'default' }}
          >
            <Layer>
              {displayElements.map(el => {
                if (el.type === 'text') return (
                  <Text
                    key={el.id}
                    id={el.id}
                    x={el.x} y={el.y}
                    text={el.text ?? ''}
                    fontSize={el.fontSize ?? 16}
                    fill={el.color ?? '#e2e8f0'}
                    draggable={tool === 'select' && !viewNote}
                    onClick={() => !viewNote && setSelectedId(el.id)}
                    onDragEnd={e => handleElementChange(el.id, { x: e.target.x(), y: e.target.y() })}
                    onDblClick={() => {
                      if (viewNote) return;
                      const val = window.prompt('แก้ไขข้อความ:', el.text ?? '');
                      if (val !== null) handleElementChange(el.id, { text: val });
                    }}
                  />
                );
                if (el.type === 'image') {
                  const imgEl = loadedImages.current.get(el.url ?? '');
                  return imgEl ? (
                    <KonvaImage
                      key={el.id}
                      id={el.id}
                      x={el.x} y={el.y}
                      width={el.width ?? 200} height={el.height ?? 150}
                      image={imgEl}
                      draggable={tool === 'select' && !viewNote}
                      onClick={() => !viewNote && setSelectedId(el.id)}
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
                    key={el.id}
                    id={el.id}
                    points={el.points ?? []}
                    stroke={el.stroke ?? '#e2e8f0'}
                    strokeWidth={el.strokeWidth ?? 3}
                    tension={0.5}
                    lineCap="round"
                    lineJoin="round"
                    onClick={() => !viewNote && setSelectedId(el.id)}
                  />
                );
                if (el.type === 'rect') return (
                  <Rect
                    key={el.id}
                    id={el.id}
                    x={el.x} y={el.y}
                    width={el.width ?? 100} height={el.height ?? 60}
                    fill={el.fill ?? 'transparent'}
                    stroke={el.stroke ?? '#378ADD'}
                    strokeWidth={el.strokeWidth ?? 1}
                    draggable={tool === 'select' && !viewNote}
                    onClick={() => !viewNote && setSelectedId(el.id)}
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
                return null;
              })}

              {/* Live draw */}
              {isDrawing && currentLine.length > 2 && (
                <Line points={currentLine} stroke={color} strokeWidth={strokeWidth} tension={0.5} lineCap="round" lineJoin="round" />
              )}

              <Transformer ref={transformerRef} borderStroke="#378ADD" anchorFill="#378ADD" anchorStroke="#378ADD" />
            </Layer>
          </Stage>

          {/* Zoom indicator */}
          <div className={styles.zoomBadge}>{Math.round(scale * 100)}%</div>
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
