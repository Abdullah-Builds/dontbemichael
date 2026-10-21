/**
 * Where everyone sits in the studio (branding/DESIGN.md 8.9): departments, not
 * seats. Each department gets one pod on the ring around Michael's glass pod; a
 * pod holds up to four desks. Past nine pods (one for every kind of department),
 * or 28 people, the Office view switches to a compact grid instead of crowding
 * the ring.
 */
import type { DepartmentName } from '@/design/tokens';
import { OFFICE_ROLES, departmentOf as sharedDepartmentOf } from '@shared/officeRoles';
import { G, P, type Pt } from './iso';

/** The fields layout needs from an agent. */
export interface Seatable { id: string; character?: string; description?: string; sourceCard?: string; isGod?: boolean }

const ROLES = OFFICE_ROLES as Record<string, { role: string }>;

/** The department a team member sits in (src/shared/officeRoles.ts); the
 *  shared names are the studio's department names. */
export const departmentOf = sharedDepartmentOf as (a: Seatable) => DepartmentName;

/** A short job title for a card or a panel header: the hired job card's role,
 *  else the character's usual job, else the first phrase of the role line (a
 *  "Title: what they do" line gives its title). */
export function roleOf(a: Seatable): string {
  const card = a.sourceCard?.split('/').pop();
  const fromCard = card ? ROLES[card]?.role : undefined;
  const usual = !a.sourceCard ? (ROLES[a.id]?.role ?? (a.character ? ROLES[a.character]?.role : undefined)) : undefined;
  const line = (a.description ?? '').split(/[.:\n]/)[0].trim();
  return fromCard ?? usual ?? (line.length <= 28 ? line : `${line.slice(0, 26)}...`);
}

/** One pod slot on the ring: its stage position, and where its label card goes. */
export interface Slot {
  x: number; y: number;               // stage px of the pod center (floor level)
  mode: 'above' | 'below';            // label card above or below the pod
  dx: number; gap: number;            // card horizontal offset, and gap to the pod
}

/** Nine slots around Michael: the seven tuned against the approved reference
 *  screen, then Operations front left and the team pod front (owner,
 *  2026-10-03: an eighth department flipped a small office to the grid). The
 *  two front slots were placed in the studio lab with every card open. */
const SLOTS: Slot[] = [
  { x: 400, y: 335, mode: 'above', dx: -34, gap: 100 },   // 0 left, near
  { x: 490, y: 245, mode: 'above', dx: -30, gap: 88 },    // 1 back left
  { x: 660, y: 270, mode: 'above', dx: 84, gap: 92 },     // 2 back
  { x: 765, y: 335, mode: 'above', dx: 66, gap: 74 },     // 3 back right
  { x: 900, y: 460, mode: 'below', dx: -10, gap: 42 },    // 4 right
  { x: 730, y: 540, mode: 'below', dx: 24, gap: 42 },     // 5 front right
  { x: 270, y: 385, mode: 'above', dx: -30, gap: 80 },    // 6 far left
  { x: 470, y: 590, mode: 'below', dx: -70, gap: 42 },    // 7 front left (operations)
  { x: 615, y: 615, mode: 'above', dx: -40, gap: 60 }     // 8 front, card toward Michael (team)
];
export const MAX_RING_DEPARTMENTS = SLOTS.length;
export const MAX_RING_PEOPLE = 28;

/** Each department's preferred slot, so the office looks the same every day. */
const PREFERRED: Partial<Record<DepartmentName, number>> = {
  'front-desk': 0, marketing: 1, support: 2, sales: 3, finance: 4, it: 5, people: 6, operations: 7, team: 8
};
const ORDER: DepartmentName[] = ['front-desk', 'support', 'sales', 'finance', 'marketing', 'people', 'it', 'operations', 'team'];

export interface PodPlan<A extends Seatable> {
  dept: DepartmentName;
  members: A[];                      // up to 4
  slot: Slot;
  grid: Pt;                          // grid position of the pod center
}

export interface StudioPlan<A extends Seatable> {
  pods: PodPlan<A>[];
  /** True when the ring cannot hold the team: show the compact grid instead. */
  compact: boolean;
  /** Everyone who is not Michael, grouped by department, for the compact grid. */
  groups: { dept: DepartmentName; members: A[] }[];
}

export function planStudio<A extends Seatable>(agents: A[]): StudioPlan<A> {
  const team = agents.filter((a) => !a.isGod);
  const byDept = new Map<DepartmentName, A[]>();
  for (const a of team) {
    const d = departmentOf(a);
    byDept.set(d, [...(byDept.get(d) ?? []), a]);
  }
  const depts = ORDER.filter((d) => byDept.has(d));
  const groups = depts.map((dept) => ({ dept, members: byDept.get(dept)! }));

  // A department with more than four people takes a second pod.
  const units: { dept: DepartmentName; members: A[] }[] = [];
  for (const g of groups) {
    for (let i = 0; i < g.members.length; i += 4) units.push({ dept: g.dept, members: g.members.slice(i, i + 4) });
  }
  const compact = units.length > MAX_RING_DEPARTMENTS || team.length > MAX_RING_PEOPLE;
  if (compact) return { pods: [], compact, groups };

  const taken = new Set<number>();
  const pods: PodPlan<A>[] = [];
  const place = (u: { dept: DepartmentName; members: A[] }, i: number) => {
    taken.add(i);
    const slot = SLOTS[i];
    pods.push({ ...u, slot, grid: G(slot.x, slot.y) });
  };
  const rest: typeof units = [];
  for (const u of units) {
    const pref = PREFERRED[u.dept];
    if (pref !== undefined && !taken.has(pref)) place(u, pref);
    else rest.push(u);
  }
  for (const u of rest) {
    const free = SLOTS.findIndex((_, i) => !taken.has(i));
    place(u, free);
  }
  return { pods, compact, groups };
}

/* ── Label cards ──────────────────────────────────────────────────────────── */

export const CARD_W = 186;
export const CARD_W_WIDE = 200;
export const CARD_H = 66;
/** Each extra person adds a row: name, role, what they are doing, a bar. */
export const CARD_ROW_H = 78;

export function cardSize(members: number): { w: number; h: number } {
  return { w: members > 1 ? CARD_W_WIDE : CARD_W, h: CARD_H + CARD_ROW_H * (members - 1) };
}

/** Stage px of a pod's label card (top-left) and its stem. */
export function cardRect(slot: Slot, members: number): { left: number; top: number; w: number; h: number; stem: { x: number; y1: number; y2: number } } {
  const { w, h } = cardSize(members);
  const left = slot.x + slot.dx - w / 2;
  const top = slot.mode === 'above' ? slot.y - slot.gap - h : slot.y + slot.gap;
  const sx = Math.min(Math.max(slot.x, left + 16), left + w - 16);
  const stem = slot.mode === 'above'
    ? { x: sx, y1: top + h, y2: slot.y - 76 }
    : { x: sx, y1: top, y2: slot.y + 36 };
  return { left, top, w, h, stem };
}

/* ── Mailbox posts ────────────────────────────────────────────────────────── */

export const POST_GY = 4.4;

/** Grid x of each mailbox post, along the platform's front left edge. */
export function postGx(i: number, n: number): number {
  const span = Math.min(3.4, 1.2 * Math.max(n - 1, 0));
  return -4 + (n > 1 ? (span * i) / (n - 1) : 0);
}

export const HUB: Pt = [0, 0];
/** Stage px of Michael's hub card, under his glass pod. 212 px wide so its
 *  five board counts' labels never touch ("Blocked" is 38.5 px at 10 px;
 *  design review 2026-10-18, 3A). */
export const HUB_CARD = { left: 447, top: 494, w: 212 };
/** Where an escalation leaves the stage, toward the Needs you board. */
export const EXIT: Pt = [1056, 196];
/** The top of Michael's pod, where his tokens start. */
/** Where things leave Michael's office from: above his desk. */
export const HUB_TOP: Pt = P(0, -0.2, 100);
