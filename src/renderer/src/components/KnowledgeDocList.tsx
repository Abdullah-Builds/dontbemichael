import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PixelButton } from './PixelButton';
import { InfoTip } from './InfoTip';
import type { KnowledgeDoc } from '../../../preload';
import { isFoundationsDoc } from '@shared/foundations';

/**
 * The documents in company knowledge (owner, 2026-10-19: "super limited
 * without ability to see what documents are used"): each with its file and
 * date, and Open, which opens the store's copy in the owner's own app. A save
 * there is read in again, so agents search the new version. Company
 * foundations opens as a read only copy, because the app keeps it.
 */
export function KnowledgeDocList({ refreshKey }: { refreshKey: number }) {
  const { t, i18n } = useTranslation();
  const [docs, setDocs] = useState<KnowledgeDoc[] | null>(null);
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);

  const load = useCallback(() => {
    void window.cth.kgList().then((list) => setDocs(Array.isArray(list) ? list : [])).catch(() => setDocs([]));
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);
  // An older preload has no change events; the list still loads.
  useEffect(() => window.cth.onKgChanged?.((e) => {
    const title = docs?.find((d) => d.id === e.id)?.title ?? '';
    setNote(e.error ? { text: t('settings.memory.docs.saveFailed', { title, reason: e.error }), bad: true } : { text: t('settings.memory.docs.savedIn', { title }), bad: false });
    load();
  }), [docs, load, t]);

  if (!docs || docs.length === 0) return null;
  const day = (iso?: string): string => {
    const d = iso ? new Date(iso) : null;
    return d && Number.isFinite(d.getTime()) ? d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  };
  const open = async (d: KnowledgeDoc): Promise<void> => {
    setNote(null);
    const r = await window.cth.kgOpen?.(d.id).catch(() => null);
    if (!r || !r.ok) setNote({ text: t('settings.memory.docs.openFailed', { title: d.title }), bad: true });
  };
  const readOnly = (d: KnowledgeDoc): boolean => isFoundationsDoc(d);

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--cth-ink-700)', marginBottom: 6 }}>
        {t('settings.memory.docs.label')}<InfoTip text={t('settings.memory.docs.tip')} />
      </div>
      <ul role="list" style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 300, overflowY: 'auto', borderRadius: 'var(--cth-r-lg)', boxShadow: 'inset 0 0 0 1px var(--cth-line)' }}>
        {docs.map((d, i) => (
          <li key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderTop: i ? '1px solid var(--cth-line)' : 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 13, lineHeight: '18px', color: 'var(--cth-ink-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.title}</span>
                {readOnly(d) && (
                  <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '1px 7px', borderRadius: 'var(--cth-r-pill)', background: 'var(--cth-neutral-soft)', color: 'var(--cth-ink-500)' }}>
                    {t('settings.memory.docs.readOnly')}<InfoTip text={t('settings.memory.docs.readOnlyTip')} />
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, lineHeight: '16px', color: 'var(--cth-ink-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {[d.source !== d.title ? d.source : '', d.updatedAt ? t('settings.memory.docs.updated', { date: day(d.updatedAt) }) : t('settings.memory.docs.added', { date: day(d.addedAt) })].filter(Boolean).join(', ')}
              </div>
            </div>
            <PixelButton variant="secondary" size="sm" ariaLabel={t('settings.memory.docs.openAria', { title: d.title })} onClick={() => { void open(d); }}>
              {t('settings.memory.docs.open')}
            </PixelButton>
          </li>
        ))}
      </ul>
      {note && <div role={note.bad ? 'alert' : 'status'} style={{ marginTop: 6, fontSize: 12, color: note.bad ? 'var(--cth-coral-text)' : 'var(--cth-ink-500)' }}>{note.text}</div>}
    </div>
  );
}
