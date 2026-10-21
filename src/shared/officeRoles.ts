/**
 * Each Office character's job — the same in every business type, the way it was
 * in the show (owner's rule, 2026-09-23).
 *
 * A business type chooses WHICH characters are on its team and how each job
 * reads for that trade (a restaurant's Oscar watches food cost; a CPA's watches
 * retainers). It never changes WHAT the job is: Oscar is always finance, Dwight
 * always sales. `office-pack-fixtures.test.cjs` holds every shipped pack to this
 * map, so a pack can't quietly give a character a different job again.
 *
 * Michael is not here: he is the office manager on every team, not a pack role.
 */

export const OFFICE_ROLES = {
  oscar: { role: 'Finance', folder: 'Finance' },
  dwight: { role: 'Sales Director', folder: 'Sales' },
  kelly: { role: 'Customer Support', folder: 'Support' },
  pam: { role: 'Executive Admin', folder: 'Admin' },
  ryan: { role: 'Marketing', folder: 'Marketing' },
  sadiq: { role: 'IT Security', folder: 'Security' },
  toby: { role: 'HR Manager', folder: 'HR' },
  nick: { role: 'IT Engineer', folder: 'IT' },
  creed: { role: 'Quality Control', folder: 'Quality' },
  meredith: { role: 'Supply Chain', folder: 'Supply Chain' },
  darryl: { role: 'Inventory & Shipping', folder: 'Inventory' }
} as const;

export type OfficeRoleCharacter = keyof typeof OFFICE_ROLES;

/** The departments the studio seats people in; `team` is the general pod. */
export type OfficeDepartment = 'front-desk' | 'support' | 'sales' | 'finance' | 'marketing' | 'people' | 'it' | 'operations' | 'team';

/** The fields a department is read from. */
export interface DepartmentSource { id: string; character?: string; description?: string; sourceCard?: string }

const KEYWORDS: [RegExp, OfficeDepartment][] = [
  [/\b(sales|business development|account exec)/i, 'sales'],
  [/\b(admin|assistant|front desk|reception|executive|office coordinator)/i, 'front-desk'],
  [/\b(support|customer|service|success|help ?desk)/i, 'support'],
  [/\b(financ|accountan|accounting|bookkeep|billing|payroll|cfo|controller)/i, 'finance'],
  [/\b(market|social|content|brand|seo|community)/i, 'marketing'],
  [/\b(hr\b|human resources|people|recruit|talent)/i, 'people'],
  // "IT" only in capitals: the word "it" in a role line is not a department.
  [/\bIT\b/, 'it'],
  [/\b(engineer|security|developer|devops|systems)/i, 'it'],
  [/\b(supply|inventory|shipping|logistic|quality|warehouse|procure|purchas)/i, 'operations']
];

const ROLES = OFFICE_ROLES as Record<string, { role: string }>;

function fromText(text?: string): OfficeDepartment | null {
  if (!text) return null;
  for (const [re, dept] of KEYWORDS) if (re.test(text)) return dept;
  return null;
}

/** The department a team member sits in, the same in the studio and in main
 *  (Company foundations reads a member's job from it). The job card they were
 *  hired with decides first (a hire can bring a job that is not the
 *  character's usual one); a pack member's id is its card's. Then the
 *  character's usual job, then the start of their role line, else the general
 *  team pod. */
export function departmentOf(a: DepartmentSource): OfficeDepartment {
  const card = a.sourceCard?.split('/').pop();
  return fromText(card ? ROLES[card]?.role : undefined)
    ?? (a.sourceCard ? null : fromText(ROLES[a.id]?.role))
    ?? (a.sourceCard ? null : fromText(a.character ? ROLES[a.character]?.role : undefined))
    ?? fromText(a.description?.slice(0, 60))
    ?? 'team';
}
