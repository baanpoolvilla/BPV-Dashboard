import { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react';
import { useParams } from 'react-router-dom';
import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import { BlockNoteView } from '@blocknote/mantine';
import { useCreateBlockNote } from '@blocknote/react';
import type { Block, PartialBlock } from '@blocknote/core';
import { apiGet, apiPut, apiPost } from '../../api/client';
import type { Worksheet, MeetingNoteItem, MeetingNoteDetail } from '../../api/types';
import AppShell from '../../components/AppShell';
import styles from './WorksheetPage.module.css';

type SaveStatus = 'saved' | 'saving' | 'dirty';

// Downscale + compress an image to a compact data URL embedded in the document
// (no object storage / backend upload required).
function compressToDataUrl(file: File, maxSide = 1200, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('bad image'));
      img.onload = () => {
        const ratio = Math.min(maxSide / img.naturalWidth, maxSide / img.naturalHeight, 1);
        const w = Math.max(1, Math.round(img.naturalWidth * ratio));
        const h = Math.max(1, Math.round(img.naturalHeight * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('no ctx'));
        ctx.drawImage(img, 0, 0, w, h);
        const isPng = file.type === 'image/png';
        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

// ─── The editable meeting document ──────────────────────────────────────────
interface EditorHandle { flush: () => Promise<void> }

const MeetingEditor = forwardRef<EditorHandle, {
  worksheetId: string;
  initialBlocks: PartialBlock[] | undefined;
  onStatus: (s: SaveStatus) => void;
}>(function MeetingEditor({ worksheetId, initialBlocks, onStatus }, ref) {
  const editor = useCreateBlockNote({
    initialContent: initialBlocks && initialBlocks.length ? initialBlocks : undefined,
    uploadFile: async (file: File) => {
      if (!file.type.startsWith('image/')) throw new Error('ไฟล์ไม่ใช่รูปภาพ');
      return compressToDataUrl(file);
    },
  });

  const blocksRef = useRef<Block[]>(editor.document);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = useCallback(async () => {
    onStatus('saving');
    try {
      await apiPut(`/worksheets/${worksheetId}`, { canvasData: { version: 2, blocks: blocksRef.current } });
      onStatus('saved');
    } catch {
      onStatus('dirty');
    }
  }, [worksheetId, onStatus]);

  useImperativeHandle(ref, () => ({
    flush: async () => { if (timer.current) clearTimeout(timer.current); await save(); },
  }), [save]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <BlockNoteView
      editor={editor}
      theme="light"
      onChange={() => {
        blocksRef.current = editor.document;
        onStatus('dirty');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(save, 1500);
      }}
    />
  );
});

// ─── Read-only snapshot (meeting-note history) ──────────────────────────────
function ReadonlyNote({ blocks }: { blocks: PartialBlock[] }) {
  const editor = useCreateBlockNote({
    initialContent: blocks && blocks.length ? blocks : undefined,
  });
  return <BlockNoteView editor={editor} editable={false} theme="light" />;
}

export default function WorksheetPage() {
  const { userId, projectId } = useParams<{ userId: string; projectId: string }>();
  const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
  const [initialBlocks, setInitialBlocks] = useState<PartialBlock[] | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved');
  const [showHistory, setShowHistory] = useState(false);
  const [notes, setNotes] = useState<MeetingNoteItem[]>([]);
  const [viewNote, setViewNote] = useState<MeetingNoteDetail | null>(null);

  const editorRef = useRef<EditorHandle>(null);

  useEffect(() => {
    if (!userId || !projectId) return;
    apiGet<{ id: string; worksheetId?: string }[]>(`/users/${userId}/projects`)
      .then(projects => {
        const proj = projects.find(p => p.id === projectId);
        if (!proj?.worksheetId) { setLoaded(true); return; }
        return apiGet<Worksheet>(`/worksheets/${proj.worksheetId}`).then(ws => {
          setWorksheet(ws);
          const blocks = ws.canvasData?.blocks as PartialBlock[] | undefined;
          setInitialBlocks(Array.isArray(blocks) ? blocks : undefined);
          setSaveStatus('saved');
          setLoaded(true);
        });
      })
      .catch(() => setLoaded(true));
  }, [userId, projectId]);

  const onStatus = useCallback((s: SaveStatus) => setSaveStatus(s), []);

  const fetchNotes = useCallback(async () => {
    if (!worksheet) return;
    setNotes(await apiGet<MeetingNoteItem[]>(`/worksheets/${worksheet.id}/meeting-notes`));
  }, [worksheet]);

  useEffect(() => { if (showHistory) fetchNotes(); }, [showHistory, fetchNotes]);

  async function saveMeetingNote() {
    if (!worksheet) return;
    // make sure the latest edits are persisted before the backend snapshots them
    await editorRef.current?.flush();
    await apiPost(`/worksheets/${worksheet.id}/meeting-notes`, { meetingDate: new Date().toISOString() });
    fetchNotes();
  }

  async function openNote(noteId: string) {
    setViewNote(await apiGet<MeetingNoteDetail>(`/worksheets/notes/${noteId}`));
  }

  const snapshotBlocks = (viewNote?.canvasSnapshot?.blocks as PartialBlock[] | undefined) ?? [];

  return (
    <AppShell
      backTo={`/employees/${userId}`}
      backLabel="โปรไฟล์พนักงาน"
      title="บันทึกการประชุม"
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!viewNote && (
            <span className={styles.saveStatus}>
              {saveStatus === 'saved' ? '✓ บันทึกแล้ว' : saveStatus === 'saving' ? '⏳ กำลังบันทึก...' : '● ยังไม่บันทึก'}
            </span>
          )}
          <button className="btn btn-ghost" onClick={() => setShowHistory(!showHistory)}>ประวัติการประชุม</button>
          {!viewNote && <button className="btn btn-primary" onClick={saveMeetingNote}>บันทึกประชุม</button>}
        </div>
      }
    >
      <div className={styles.worksheetLayout}>
        <div className={styles.docArea}>
          {viewNote ? (
            <div className={styles.docPaper}>
              <div className={styles.snapshotBar}>
                <span>
                  📅 บันทึกเมื่อ {new Date(viewNote.meetingDate).toLocaleDateString('th-TH', { dateStyle: 'long' })}
                  {' · '}โดย {viewNote.user.name}
                </span>
                <button className="btn btn-primary" onClick={() => setViewNote(null)}>← กลับไปแก้ไข</button>
              </div>
              <ReadonlyNote key={viewNote.id} blocks={snapshotBlocks} />
            </div>
          ) : !loaded ? (
            <div className={styles.docPaper}><p className={styles.loading}>กำลังโหลด…</p></div>
          ) : worksheet ? (
            <div className={styles.docPaper}>
              <MeetingEditor
                key={worksheet.id}
                ref={editorRef}
                worksheetId={worksheet.id}
                initialBlocks={initialBlocks}
                onStatus={onStatus}
              />
            </div>
          ) : (
            <div className={styles.docPaper}><p className={styles.loading}>ไม่พบ worksheet ของโปรเจกต์นี้</p></div>
          )}
        </div>

        {/* History panel */}
        {showHistory && (
          <div className={styles.historyPanel}>
            <div className={styles.historyHeader}>
              <p className={styles.historyTitle}>ประวัติการประชุม</p>
              <button className={styles.closeBtn} onClick={() => setShowHistory(false)}>✕</button>
            </div>
            {!viewNote && (
              <button className="btn btn-primary" style={{ margin: '0 16px 12px', width: 'calc(100% - 32px)' }} onClick={saveMeetingNote}>
                + บันทึกประชุมใหม่
              </button>
            )}
            <div className={styles.notesList}>
              {notes.length === 0 ? (
                <p className={styles.noNotes}>ยังไม่มีประวัติการประชุม</p>
              ) : notes.map(n => (
                <div
                  key={n.id}
                  className={`${styles.noteItem} ${viewNote?.id === n.id ? styles.noteItemActive : ''}`}
                  onClick={() => openNote(n.id)}
                >
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
