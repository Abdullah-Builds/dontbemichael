import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoTip } from './InfoTip';
import { Icon } from './Icon';
import { PixelButton } from './PixelButton';
import { Spinner } from './GetMichaelReady';
import { RadioRows } from './CapabilitiesTab';
import type { HarnessConfig } from '@/store/config';
import { allowedCount, DATA_CLASSES, dataClassSettings, type DataClassId, type DataClassSetting } from '../../../shared/dataClasses';
import { researchOnFloor, startResearch, stopResearch } from '@/shell/research';
import { useStore } from '@/store/store';
import { isClaudeProvider } from '@shared/agentProvider';
import { RESEARCH_ID } from '../../../shared/research';
import { useResearchName } from '@/shell/research';

/**
 * Settings, Research & privacy (issue #230, docs/designs/research-agent-privacy.md,
 * design review D3 to D14): the Research row first, then what the team may
 * send it. Turn on and Turn off act at once, with live states (D6); the classes
 * are a preference, staged for the footer Save like every other setting.
 */

type Phase = 'off' | 'starting' | 'on' | 'failed' | 'stopping';

const head: CSSProperties = {
  fontFamily: 'var(--cth-font-display)', fontSize: 10, fontWeight: 600, lineHeight: '12px',
  color: 'var(--cth-ink-500)', textTransform: 'uppercase', marginBottom: 10,
  display: 'flex', alignItems: 'center', gap: 6
};
/** A sentence, so it is set in sentence case, not as a caps label (DESIGN.md 4.1). */
const sentenceHead: CSSProperties = { fontSize: 13, lineHeight: '18px', fontWeight: 600, color: 'var(--cth-ink-2)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' };
const hint: CSSProperties = { fontSize: 12, lineHeight: '17px', color: 'var(--cth-ink-3)' };
const dot = (color: string): CSSProperties => ({ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 });

export function ResearchPrivacySettings({ config, classes, onClassesChange }: {
  config: HarnessConfig;
  /** The classes as staged (unsaved changes included). */
  classes: Partial<Record<DataClassId, DataClassSetting>> | undefined;
  onClassesChange: (next: Partial<Record<DataClassId, DataClassSetting>>) => void;
}) {
  const { t } = useTranslation();
  const researchName = useResearchName();
  const [phase, setPhase] = useState<Phase>(config.research?.on && researchOnFloor() ? 'on' : config.research?.on ? 'failed' : 'off');
  const [waiting, setWaiting] = useState<number | null>(null);
  // PixelButton takes no ref: focus moves through the row that holds it.
  const confirmRow = useRef<HTMLDivElement | null>(null);
  const stateRow = useRef<HTMLDivElement | null>(null);
  const win = window.cth.platform === 'win32';

  useEffect(() => {
    let live = true;
    void window.cth.researchStatus().then((s) => {
      if (!live) return;
      setPhase((p) => (p === 'starting' || p === 'stopping' ? p : s.on ? (researchOnFloor() ? 'on' : 'failed') : 'off'));
    }).catch(() => undefined);
    return () => { live = false; };
  }, []);
  // The row follows the floor: a Research still coming back at launch reads
  // as on once its terminal is up, not stuck on "couldn't start" (design review).
  const onFloor = useStore((s) => s.agents.some((a) => a.id === RESEARCH_ID && !!a.ptyId));
  useEffect(() => { if (onFloor) setPhase((p) => (p === 'failed' ? 'on' : p)); }, [onFloor]);
  // The safe choice is under the keyboard (design review D14).
  useEffect(() => { if (waiting !== null) confirmRow.current?.querySelector<HTMLButtonElement>('button')?.focus(); }, [waiting]);

  const turnOn = async (): Promise<void> => {
    setPhase('starting');
    const r = await startResearch(config);
    setPhase(r.ok ? 'on' : 'failed');
  };
  const stop = async (): Promise<void> => {
    setWaiting(null);
    setPhase('stopping');
    await stopResearch();
    setPhase('off');
  };
  const askOff = async (): Promise<void> => {
    const s = await window.cth.researchStatus().catch(() => null);
    if (s && s.waiting > 0) setWaiting(s.waiting);
    else await stop();
  };
  const cancelOff = (): void => {
    setWaiting(null);
    requestAnimationFrame(() => stateRow.current?.querySelector<HTMLButtonElement>('button')?.focus());
  };

  // The app fences in Claude agents only: a member on another engine keeps
  // its own web tools and shell (ship review D4).
  const agents = useStore((s) => s.agents);
  const uncovered = agents.filter((a) => a.id !== RESEARCH_ID && !isClaudeProvider(a.provider ?? 'claude')).map((a) => a.name);
  const settings = dataClassSettings(classes);
  const counts = allowedCount(settings);
  const setClass = (id: DataClassId, v: DataClassSetting): void => onClassesChange({ ...(classes ?? {}), [id]: v });

  const line = phase === 'on' ? { color: 'var(--cth-green)', text: t('research.on', { name: researchName }) }
    : phase === 'failed' ? { color: 'var(--cth-coral)', text: t('research.failed', { name: researchName }) }
    : phase === 'off' ? { color: 'var(--cth-ink-4)', text: t('research.off', { name: researchName }) }
    : null;

  return (
    <>
      <div>
        <div style={head}>{t('research.title')}<InfoTip label={t('research.title')} text={t('research.tip', { name: researchName })} /></div>
        <div ref={stateRow} style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 28 }}>
          <span role="status" style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, lineHeight: '20px', color: 'var(--cth-ink-900)' }}>
            {line
              ? <><span aria-hidden="true" style={dot(line.color)} />{line.text}</>
              : <><Spinner />
                {phase === 'starting' ? t('research.starting', { name: researchName }) : t('research.stopping', { name: researchName })}</>}
          </span>
          {phase === 'off' && <PixelButton variant="secondary" size="sm" onClick={() => void turnOn()}>{t('research.turnOn')}</PixelButton>}
          {phase === 'failed' && <PixelButton variant="secondary" size="sm" onClick={() => void turnOn()}>{t('research.tryAgain')}</PixelButton>}
          {phase === 'on' && waiting === null && (
            <PixelButton variant="secondary" size="sm" onClick={() => void askOff()}>{t('research.turnOff')}</PixelButton>
          )}
        </div>
        {phase === 'on' && waiting !== null && (
          <div
            ref={confirmRow}
            style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, paddingInlineStart: 16, flexWrap: 'wrap' }}
            onKeyDown={(e) => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.stopPropagation(); cancelOff(); } }}
          >
            <span role="status" style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: '18px', color: 'var(--cth-ink-900)' }}>
              {waiting === 1 ? t('research.waitingOne') : t('research.waitingMany', { count: waiting })}
            </span>
            <PixelButton variant="secondary" size="sm" onClick={cancelOff}>{t('research.cancel')}</PixelButton>
            <PixelButton variant="primary" size="sm" onClick={() => void stop()}>{t('research.turnOff')}</PixelButton>
          </div>
        )}
        {win && (
          <div style={{ ...hint, marginTop: 8, paddingInlineStart: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            {t('research.windows', { name: researchName })}<InfoTip label={t('research.windows', { name: researchName })} text={t('research.windowsTip', { name: researchName })} />
          </div>
        )}
        {/* Windows has no sandbox: only the team's web tools are refused there. */}
        {win && (
          <div style={{ ...hint, marginTop: 8, paddingInlineStart: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
            {t('research.windowsTeam')}<InfoTip label={t('research.windowsTeam')} text={t('research.windowsTeamTip', { name: researchName })} />
          </div>
        )}
      </div>

      <div style={{ height: 1, background: 'var(--cth-line)' }} />

      <div>
        <div style={sentenceHead}>
          {t('research.sendTitle', { name: researchName })}
          <InfoTip label={t('research.sendTitle', { name: researchName })} text={t('research.sendTip', { name: researchName })} />
          <span style={{ fontSize: 11.5, fontWeight: 500, textTransform: 'none', color: 'var(--cth-ink-3)', fontFamily: 'var(--cth-font-ui)' }}>
            {t('research.count', { allowed: counts.allowed, private: counts.private })}
          </span>
        </div>
        {phase !== 'on' && <div style={{ ...hint, margin: '-4px 0 6px' }}>{t('research.usedWhenOn', { name: researchName })}</div>}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {DATA_CLASSES.map((c, i) => {
            const name = t(`research.class.${c.id}.name`);
            return (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 40, borderTop: i === 0 ? 'none' : '1px solid var(--cth-line)' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--cth-ink-900)', overflowWrap: 'anywhere' }}>
                  {name}<InfoTip label={name} text={t(`research.class.${c.id}.tip`)} />
                </span>
                {c.locked
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--cth-ink-3)', paddingInlineEnd: 4, flexShrink: 0 }}>
                      <Icon name="lock" size={0.75} /><span>{t('research.alwaysPrivate')}</span>
                    </span>
                  : <span style={{ flexShrink: 0 }}>
                      <RadioRows
                        inline
                        label={name}
                        value={settings[c.id]}
                        options={[{ value: 'allowed', label: t('research.allowed') }, { value: 'private', label: t('research.private') }]}
                        onChange={(v) => setClass(c.id, v as DataClassSetting)}
                      />
                    </span>}
              </div>
            );
          })}
        </div>
        {uncovered.length > 0 && (
          <div style={{ ...hint, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {t('research.otherEngines', { names: uncovered.join(', ') })}
            <InfoTip label={t('research.otherEnginesLabel')} text={t('research.otherEnginesTip')} />
          </div>
        )}
      </div>
    </>
  );
}
