import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { HarnessConfig } from '@/store/config';
import { cityLine, cleanCompanyProfile, mergeEditedProfile, missingProfileFields, type CompanyProfile } from '@shared/companyProfile';
import { CompanyProfileFields } from './CompanyProfileFields';
import { PixelButton } from './PixelButton';

/**
 * Settings, Company profile: every field of the company profile, editable
 * after setup (src/shared/companyProfile.ts). A save reaches running agents on
 * their next message (the hook delivers the profile when it changes), and the
 * page points to Memory & Knowledge for anything that isn't a short fact.
 */
export function CompanyProfileSettings({ config, onOpenKnowledge }: {
  config: HarnessConfig;
  onOpenKnowledge: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(config.businessName ?? '');
  const [profile, setProfile] = useState<CompanyProfile>(() => cleanCompanyProfile(config.companyProfile));
  // The profile as the page opened: a save sends only what the owner changed since.
  const [opened, setOpened] = useState<CompanyProfile>(() => cleanCompanyProfile(config.companyProfile));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // No business type fit at setup ("Something else"): the industry is in the owner's words.
  const needsIndustry = !config.businessType;
  const gaps = missingProfileFields(cleanCompanyProfile(profile), needsIndustry);

  const edit = (next: CompanyProfile) => { setProfile(next); setStatus('idle'); };
  const save = async () => {
    setStatus('saving');
    try {
      const latest = cleanCompanyProfile((await window.cth.getConfig()).companyProfile);
      const clean = mergeEditedProfile(opened, cleanCompanyProfile(profile), latest);
      await window.cth.updateConfig({
        businessName: name.trim() || config.businessName,
        companyProfile: clean,
        businessCity: cityLine(clean.address) ?? config.businessCity
      });
      setOpened(clean);
      setProfile(clean);
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 14, lineHeight: '19px', color: 'var(--cth-ink-700)' }}>
        {t('companyProfile.intro')}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, color: 'var(--cth-ink-700)' }}>{t('onboarding.business.nameLabel')} *</span>
        <input value={name} onChange={(e) => { setName(e.target.value); setStatus('idle'); }} style={inputStyle} />
      </label>
      <CompanyProfileFields
        value={profile}
        onChange={edit}
        parts={['essentials', 'details', 'hint']}
        needsIndustry={needsIndustry}
        missing={gaps}
        onOpenKnowledge={onOpenKnowledge}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <PixelButton variant="primary" size="md" onClick={save} disabled={status === 'saving'}>
          {t('companyProfile.save')}
        </PixelButton>
        <span role="status" style={{ fontSize: 14, color: status === 'failed' ? 'var(--cth-coral)' : 'var(--cth-ink-500)' }}>
          {status === 'saved' ? t('companyProfile.saved')
            : status === 'failed' ? t('companyProfile.saveFailed')
            : gaps.length ? t('companyProfile.stillMissing') : ''}
        </span>
      </div>
    </div>
  );
}

const inputStyle: CSSProperties = {
  padding: '6px 8px 4px', border: 'none',
  background: 'var(--cth-cream-50)', boxShadow: 'inset 0 0 0 1px var(--cth-line-2)',
  fontFamily: 'var(--cth-font-ui)', fontSize: 14, color: 'var(--cth-ink-900)'
};
