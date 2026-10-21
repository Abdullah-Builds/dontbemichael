'use strict';

/**
 * Design v2 "Studio" (branding/DESIGN.md 8, docs/designs/studio-home.md): the
 * pixel floor is replaced by an isometric studio. Team members sit in
 * department pods around Michael's glass pod; mailboxes are posts on the front
 * edge; live hive messages travel as tokens. The studio shows only what the app
 * really does.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');
const L = loadTs('src/renderer/src/scene/studio/layout.ts');
const iso = loadTs('src/renderer/src/scene/studio/iso.ts');

test('the projection is 2:1 isometric around Michael, and G undoes P on the floor', () => {
  assert.deepEqual(iso.P(0, 0), [545, 425]);
  const [x, y] = iso.P(1, 0);
  assert.equal(x - 545, 50);
  assert.equal(y - 425, 25);
  for (const [gx, gy] of [[2, -3], [-4.2, 1.1], [0.5, 0.5]]) {
    const back = iso.G(...iso.P(gx, gy));
    assert.ok(Math.abs(back[0] - gx) < 1e-9 && Math.abs(back[1] - gy) < 1e-9);
  }
});

test('a department comes from the hired job card, then the character, then the role line', () => {
  assert.equal(L.departmentOf({ id: 'kelly', character: 'kelly' }), 'support');
  assert.equal(L.departmentOf({ id: 'oscar', character: 'oscar' }), 'finance');
  // Erin hired into Kelly's job sits in Support, whatever Erin usually does.
  assert.equal(L.departmentOf({ id: 'erin', character: 'erin', sourceCard: 'pro-services/kelly' }), 'support');
  // A character hired into another's job goes where the job is.
  assert.equal(L.departmentOf({ id: 'pam2', character: 'pam', sourceCard: 'retail-shop/dwight' }), 'sales');
  assert.equal(L.departmentOf({ id: 'x', character: 'nobody', description: 'Bookkeeper for the shop' }), 'finance');
  assert.equal(L.departmentOf({ id: 'y', character: 'nobody', description: 'Makes the tea' }), 'team');
  // IT Engineer and IT Security share the IT pod; supply, inventory and quality share Operations.
  assert.equal(L.departmentOf({ id: 'nick', character: 'nick' }), 'it');
  assert.equal(L.departmentOf({ id: 'sadiq', character: 'sadiq' }), 'it');
  for (const c of ['creed', 'meredith', 'darryl']) assert.equal(L.departmentOf({ id: c, character: c }), 'operations', c);
});

test('pods are departments on a nine slot ring; Michael is never a pod', () => {
  const team = ['pam', 'kelly', 'dwight', 'oscar', 'ryan', 'toby', 'nick'].map((c) => ({ id: c, character: c }));
  const plan = L.planStudio([{ id: 'god', character: 'michael', isGod: true }, ...team, { id: 'erin', character: 'erin', sourceCard: 'x/kelly' }]);
  assert.equal(plan.compact, false);
  assert.equal(plan.pods.length, 7);
  const support = plan.pods.find((p) => p.dept === 'support');
  assert.deepEqual(support.members.map((m) => m.id), ['kelly', 'erin'], 'two people share the Support pod');
  assert.ok(!plan.pods.some((p) => p.members.some((m) => m.id === 'god')));
  // Each department keeps its own slot, so the office looks the same every day.
  const slotOf = (d) => plan.pods.find((p) => p.dept === d).slot;
  assert.deepEqual([slotOf('front-desk').x, slotOf('support').x, slotOf('sales').x, slotOf('finance').x], [400, 660, 765, 900]);
  // No two pods share a slot.
  assert.equal(new Set(plan.pods.map((p) => `${p.slot.x},${p.slot.y}`)).size, plan.pods.length);
});

test('a fifth person opens a second pod; past the ring the view goes compact', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, character: 'x', description: 'Sales rep' }));
  const plan = L.planStudio(five);
  assert.equal(plan.pods.length, 2);
  assert.deepEqual(plan.pods.map((p) => p.members.length), [4, 1]);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, character: 'x', description: 'Makes the tea' }));
  assert.equal(L.planStudio(many).compact, true);
  // Nine department pods fit the ring (owner, 2026-10-03); a tenth pod does not.
  const nineDepts = ['Sales', 'Support', 'Finance', 'Marketing', 'HR', 'IT', 'Inventory', 'Admin', 'Tea'].map((d, i) => ({ id: `d${i}`, character: 'x', description: d }));
  assert.equal(L.planStudio(nineDepts).compact, false, 'every kind of department has a slot');
  const tenPods = [...nineDepts, ...Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, character: 'x', description: 'Sales rep' }))];
  assert.equal(L.planStudio(tenPods).compact, true, 'more pods than slots');
});

test('an office with one person in every department keeps the studio, Operations and the team pod included', () => {
  // Value: protects=adding Creed (Operations, the eighth department) never flips the floor to the card grid; fails_when=the ring has no slot for operations or team, or they take another department's slot; why_new=owner 2026-10-03: "after adding a new agent the whole office floor changed to this chart layout"; seam=none
  const team = ['pam', 'kelly', 'dwight', 'oscar', 'ryan', 'toby', 'nick', 'creed'].map((c) => ({ id: c, character: c }));
  const plan = L.planStudio([{ id: 'god', character: 'michael', isGod: true }, ...team, { id: 'sadiq', character: 'sadiq' }]);
  assert.equal(plan.compact, false);
  assert.equal(plan.pods.length, 8);
  const slotOf = (d) => plan.pods.find((p) => p.dept === d)?.slot;
  assert.deepEqual([slotOf('operations').x, slotOf('operations').y], [470, 590], 'Operations has its own slot, front left');
  const withTeam = L.planStudio([...team, { id: 'r', character: 'x', description: 'Researcher: studies competitors' }]);
  assert.equal(withTeam.compact, false);
  assert.deepEqual([withTeam.pods.find((p) => p.dept === 'team').slot.x, withTeam.pods.find((p) => p.dept === 'team').slot.y], [615, 615], 'the team pod has its own slot, front');
  assert.equal(new Set(withTeam.pods.map((p) => `${p.slot.x},${p.slot.y}`)).size, withTeam.pods.length, 'no shared slots');
  assert.equal(L.MAX_RING_DEPARTMENTS, 9);
});

test('a card above its pod is anchored by its bottom edge, so it grows away from the pod', () => {
  const src = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(src, /const cy = oy \+ \(above \? r\.top \+ r\.h : r\.top\) \* k;/);
  assert.match(src, /transform: open\.bottomAt !== undefined \? 'translateY\(-100%\)' : undefined/);
  const r = L.cardRect({ x: 660, y: 270, mode: 'above', dx: 84, gap: 92 }, 2);
  assert.equal(r.top + r.h, 270 - 92, 'the bottom edge sits a fixed gap above the pod');
});

test('the app shows the studio, not the pixel floor', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /<StudioStage config=\{config\} bleed=\{columnShown \? sidebarWidth \+ 10 : 0\} \/>/);
  assert.doesNotMatch(app, /<OfficeFloor \/>/);
});

test('only what is real: mail paths run to the person who watches the mailbox, and nothing is invented', () => {
  const src = read('src/renderer/src/scene/studio/StudioStage.tsx');
  // A mailbox's owner is whoever has it on their Capabilities (config.agentCapabilities).
  assert.match(src, /c\.email\?\.enabled && c\.email\.mailboxes\?\.\[0\] === mailboxId/);
  // A broken mailbox is the config's own needs-attention status, with a Fix into Settings.
  assert.match(src, /m\.status === 'needs-attention'/);
  assert.match(src, /section: 'Connections'/);
  // Counts come from the ledger and the hive log, never from sample numbers.
  assert.match(src, /e\.from !== 'god' \|\| e\.act !== 'request'/, 'delegated = Michael\'s requests today');
  assert.match(src, /const asks = shownQuestions\(t, foundations\)\.length; if \(asks\) forYouBy\[t\.assignee\]/, 'for you = the Ask me questions Needs you shows on that person\'s cards');
  assert.doesNotMatch(src, /closes 6:00|Harbor|Northwind/);
});

test('live tokens come from hive messages, only Michael escalates to the owner, and at most 16 fly', () => {
  const src = read('src/renderer/src/scene/studio/life.tsx');
  assert.match(src, /window\.cth\.onHiveMessage\(/);
  assert.match(src, /export const MAX_TOKENS = 16;/);
  assert.match(src, /\.slice\(-MAX_TOKENS\)/);
  // An escalation always leaves from Michael's pod toward the Needs you board.
  assert.match(src, /const src = from === 'you' \? 'hub' : from;/);
  assert.match(src, /const \[x0, y0\] = HUB_TOP;/);
});

test('the studio moves on real events only: scheduled runs, mail, tools, done tasks (owner, 2026-09-30)', () => {
  const life = read('src/renderer/src/scene/studio/life.tsx');
  // A scheduled run is a hive message from the scheduler: the clock rings, then it travels.
  assert.match(life, /const scheduled = e\.from === 'scheduler';/);
  assert.match(life, /setClockRinging\(true\);/);
  // Mail tool calls move an envelope on the watcher's mail wire; reads come in, the rest go out.
  assert.match(life, /\/\^mcp__md-mail__\(\[a-z_\]\+\)\$\/\.exec\(e\.tool\)/);
  assert.match(life, /const dir: 'in' \| 'out' = op === 'read' \? 'in' : 'out';/);
  assert.match(life, /window\.cth\.onHiveHookEvent\(onHook\)/);
  // Blocked tool calls must not animate mail envelopes or tool glyphs.
  assert.match(life, /if \(e\.blocked\) return;/);
  assert.ok(
  life.indexOf('if (e.blocked) return;') >= 0 &&
  life.indexOf('const mail =') > life.indexOf('if (e.blocked) return;'),
  'blocked events are ignored before mail-envelope animation',
  );
  // A done burst only for a task that newly reached Done, never on first load.
  assert.match(life, /if \(!before \|\| Date\.now\(\) - openedAt\.current < 6000 \|\| live\.current\.paused\) return;/);
  assert.match(life, /if \(\/\^Bash\$\|\^BashOutput\$\/\.test\(tool\)\) return 'terminal';/);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  // No standing wires: a mailbox wire only while mail moves, Michael's wire only as work starts.
  assert.match(stage, /if \(!seat \|\| !life\.postActive\[m\.id\]\) return null;/);
  assert.match(stage, /plan\.pods\.map\(\(pod\) => kickoff\[pod\.members\[0\]\.id\] \? \(/);
  assert.doesNotMatch(stage, /dash="5 5"/, 'no standing red line from a broken mailbox');
  assert.match(stage, /busy=\{godBusy\} name=\{god\?\.name\} plateLit=\{[^}]+\} ringing=\{life\.clockRinging\}/);
  // Reduced motion: the ambient loops stop.
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-st-scroll, \.cth-st-steam, \.cth-st-sway, \.cth-st-dot, \.cth-st-write, \.cth-st-flow, \.cth-st-doing \{ animation: none !important; \}/);
});

test('the stage pauses when nobody can see it, and honours reduced motion', () => {
  const src = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(src, /const paused = docHidden \|\| floorView !== 'office' \|\| !!fullscreenAgentId;/);
  assert.match(src, /svg\.pauseAnimations\(\); else svg\.unpauseAnimations\(\);/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-studio-paused \* \{ animation-play-state: paused !important; \}/);
});

test('every label card is a button, and arrow keys move between them', () => {
  const src = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(src, /data-studio-card=""/);
  assert.match(src, /\['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'\]\.includes\(e\.key\)/);
});

test('a quiet pod is a chip; its card shows while someone works, it is selected, or hovered (owner, 2026-09-30)', () => {
  const src = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(src, /const ACTIVE = new Set<string>\(\['thinking', 'working', 'blocked', 'compacting', 'looping'\]\);/);
  assert.match(src, /const working = \(pod: PodPlan<Agent>\) => !quietCards && pod\.members\.some\(\(a\) => ACTIVE\.has\(a\.status\)\);/);
  assert.match(src, /const rolled = \(pod: PodPlan<Agent>\) => !working\(pod\) && \(peek === podKey\(pod\) \|\| pod\.members\.some\(\(a\) => a\.id === selected\)\);/);
  // In the app quietCards is off, so a pod at work shows its card.
  assert.doesNotMatch(read('src/renderer/src/App.tsx'), /quietCards/);
  assert.match(src, /const open = openCard\(pod\);/);
  // The chip still carries anything waiting on the owner.
  const chip = src.slice(src.indexOf('function PodChip('));
  assert.match(chip.slice(0, 6000), /forYou > 0 &&/);
  // No stem to a card that is not showing.
  assert.match(src, /if \(!working\(pod\)\) return null;/);
});

/**
 * Owner, 2026-10-01: an opened card sat off at its slot, away from the chip.
 * A quiet pod's card rolls down from just under its chip, over the monitors;
 * every chip sits over its pod; no browser tooltip on the chip.
 */
test('a quiet pod\'s card rolls down in place of its chip; every chip sits over its pod', () => {
  const src = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(src, /const chipAt = \(pod: PodPlan<Agent>\) => \(\{ x: ox \+ pod\.slot\.x \* k, y: oy \+ \(pod\.slot\.y - CHIP_LIFT\) \* k \}\);/);
  // It takes the chip's place: the tab row where the chip was, the chip hidden.
  assert.match(src, /return \{ l, t: c\.y - ROLL_TOP, r: l \+ r\.w, b: c\.y - ROLL_TOP \+ r\.h, down: true \};/);
  assert.match(src, /if \(open\?\.down\) \{\n\s*return \(\n\s*<div key=\{`card-\$\{pod\.members\[0\]\.id\}`\} className="cth-st-roll"/);
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-st-roll \{ animation: cth-roll 240ms var\(--cth-ease\) backwards; \}/);
  const chip = src.slice(src.indexOf('function PodChip('), src.indexOf('function PodChip(') + 4000);
  assert.doesNotMatch(chip, /title=\{t\(`studio\.dept\./, 'no native tooltip over the pod');
});

test('more life: plane to Needs you, pointing, conversations, owner messages, hires, closing lights, daylight (owner, 2026-09-30)', () => {
  const life = read('src/renderer/src/scene/studio/life.tsx');
  assert.match(life, /window\.dispatchEvent\(new Event\('cth:needs-you-ping'\)\)/);
  assert.match(read('src/renderer/src/shell/TopBar.tsx'), /window\.addEventListener\('cth:needs-you-ping', on\)/);
  assert.match(life, /const pointing = !scheduled && from === 'hub' && e\.act === 'request';/);
  assert.match(life, /filter\(\(\[, c\]\) => c\.ab && c\.ba\)/, 'an arc only for a real back and forth');
  assert.match(life, /now - c\.last < 60_000/);
  assert.match(life, /const fromOwner = e\.from === 'human';/);
  // Banter is paper planes only; an envelope is always a real message (owner, 2026-10-04).
  assert.match(life, /kind: 'note-plane', color: acc\(fromId\)/);
  assert.doesNotMatch(life + read('src/renderer/src/scene/studio/StudioStage.tsx'), /note-mail|Math\.random\(\) < 0\.5 \? 'plane' : 'mail'/);
  // The owner only talks to Michael: an owner message to anyone else flies nothing (owner, 2026-10-04).
  assert.match(life, /if \(fromOwner\) \{\s*if \(dest !== 'hub'\) continue;/);
  // Hires and Needs you planes ignore what was already there when the office opened.
  assert.match(life, /Date\.now\(\) - openedAt\.current < 6000/);
  assert.match(life, /Date\.now\(\) - openedAt\.current < 4000/);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(stage, /window\.cth\.onClosingTime\(/);
  assert.match(stage, /if \(e\.phase === 'cancelled' \|\| e\.phase === 'error'\) \{ setState\(null\); return; \}/);
  assert.match(stage, /lightsOut=\{\(!!closing && pod\.members\.every\(\(a\) => closing\.out\.has\(a\.id\)\)\) \|\|/);
  assert.match(stage, /const night = hour >= 19 \|\| hour < 6;/);
  for (const loc of ['en', 'zh-CN', 'ar']) {
    assert.match(JSON.parse(read(`src/renderer/src/i18n/locales/${loc}.json`)).studio.welcome, /\{\{name\}\}/, loc);
  }
});

test('lights come up as people clock in, the way closing time turns them off (owner, 2026-09-30)', () => {
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  // The rule lives in shell/clockingIn.ts, shared with the opening card (2026-10-17).
  assert.match(stage, /import \{ useClockingIn \} from '@\/hooks\/useClockingIn';/);
  const rule = read('src/renderer/src/shell/clockingIn.ts');
  assert.match(rule, /if \(a\.action !== marker\) \{ since\.delete\(a\.id\); continue; \}/);
  assert.match(rule, /now - \(since\.get\(a\.id\) \?\? now\) < CLOCK_IN_CAP_MS/, 'never dark for more than a minute');
  assert.match(rule, /export const CLOCK_IN_CAP_MS = 60_000;/);
  assert.match(read('src/renderer/src/hooks/useClockingIn.ts'), /clockingIn\(agents, since\.current, Date\.now\(\), ACTION_CLOCKING_IN\)/);
  assert.match(stage, /\|\| pod\.members\.every\(\(a\) => away\.has\(a\.id\)\)\}/);
  assert.match(stage, /const hubAway = godStatus === 'booting' \|\| \(!!god && away\.has\(god\.id\)\);/);
  const art = read('src/renderer/src/scene/studio/StudioArt.tsx');
  assert.match(art, /if \(was\.current && !off\) \{/, 'a light flickers only as it comes on');
  assert.match(read('src/renderer/src/store/store.ts'), /status: 'idle',\n\s+action: ACTION_CLOCKING_IN,/, 'a saved team loads clocking in');
});

test('the idle quote belongs to the speaker\'s chip and never covers a card (owner, 2026-09-30)', () => {
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  // Rendered inside the pod chip, tail on the speaker's avatar, which gets a ring.
  const chip = stage.slice(stage.indexOf('function PodChip('));
  assert.match(chip.slice(0, 4000), /className=\{\['cth-st-quote'/);
  assert.match(chip.slice(0, 4000), /\['--q-tail' as string\]: `\$\{4 \+ speakerAt \* 14 \+ 4\}px`/);
  assert.match(chip.slice(0, 6000), /className=\{i === speakerAt \? 'cth-st-speak' : undefined\}/);
  assert.doesNotMatch(stage, /One in-character line over an idle pod/, 'no free floating bubble');
  // Only someone in a quiet pod (a chip) speaks; never someone clocking in.
  assert.match(stage, /const quietPeople = \(\) => chatCandidates\(live\.current\.pods, live\.current\.gone, ACTIVE, ACTION_CLOCKING_IN\);/);
  assert.match(fs.readFileSync(path.resolve(__dirname, '../src/renderer/src/shell/closingFloor.ts'), 'utf8'), /a\.status === 'idle' && a\.action !== clockingIn/);
  assert.match(stage, /const wait = first \? 8000 \+ Math\.random\(\) \* 7000 : 15_000 \+ Math\.random\(\) \* 15_000;/);
  // Up from the chip, up and leftward, or down under it: the first that covers no card.
  assert.match(stage, /const free = spots\.find\(/);
  assert.match(read('src/renderer/src/design/global.css'), /\.cth-st-quote-text \{ font-size: 12\.5px;/);
});

/**
 * Idle people talk to each other (owner, 2026-10-01: "kelly and ryan throwing
 * paper planes towards each other or mails which on landing shows a chat
 * bubble with the message"): a beat flies pod to pod, then shows on the
 * catcher's chip with the sender's name and color.
 */
test('idle banter: paper planes between two quiet pods, the line shown where it lands', () => {
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  const life = read('src/renderer/src/scene/studio/life.tsx');
  assert.match(stage, /const partners = idle\.filter\(\(b\) => podOfId\(b\.id\) !== podOfId\(a\.id\)\);/, 'two different pods');
  assert.match(stage, /live\.current\.throwNote\(from\.id, to\.id\)/);
  assert.match(stage, /later\(FLIGHT_MS, \(\) => \{\n\s*show\(\{ agentId: to\.id, text, from: \{ name: from\.name, acc: live\.current\.accentOf\(from\.id\) \}/, 'the line shows on landing, at the catcher');
  assert.match(stage, /if \(!still\.includes\(from\.id\) \|\| !still\.includes\(to\.id\)\) \{ busyUntil = 0; return; \}/, 'work ends the chat');
  assert.match(stage, /\{\(quote\.from \|\| members\.length > 1\) && <span className="cth-st-quote-who">\{quote\.from\?\.name \?\? speaker\.name\}<\/span>\}/);
  assert.match(life, /kind === 'you' \|\| kind === 'owner' \|\| kind === 'note-plane' \?/);
});

test('the owner\'s message to Michael flies as a paper plane in the owner\'s indigo (owner, 2026-10-10)', () => {
  const life = read('src/renderer/src/scene/studio/life.tsx');
  // Like the plane Michael throws to Ask me, but indigo going up and coral coming down.
  assert.match(life, /kind: 'owner', ping: true/);
  assert.match(life, /case 'owner': return T\.indigo;/);
  assert.match(life, /const plane = f\.kind === 'you' \|\| f\.kind === 'owner'/);
  assert.match(life, /kind === 'you' \|\| kind === 'owner' \|\| kind === 'note-plane' \?/, 'drawn as the plane, never the envelope');
});

test('a paper plane turns with its path instead of flying as a fixed picture (owner, 2026-10-01)', () => {
  const life = read('src/renderer/src/scene/studio/life.tsx');
  assert.match(life, /const plane = f\.kind === 'you' \|\| f\.kind === 'owner' \|\| f\.kind === 'note-plane';/);
  assert.match(life, /<animateMotion [^>]*\n?\s*rotate=\{plane \? 'auto' : undefined\} \/>/, 'only planes rotate; badges and envelopes stay upright');
  assert.match(life, /\{plane && f\.end\[0\] < f\.start\[0\] \? <g transform="scale\(1,-1\)">\{head\}<\/g> : head\}/, 'flying left it stays right side up');
  // rotate="auto" points the shape's +x axis down the path, so the glyph's
  // nose (11,-7) must sit on +x once its own rotation is applied.
  const turn = Number(/Nose along \+x[^]*?<g transform="rotate\((-?[\d.]+)\)">\s*<path d="M-11,1 L11,-7/.exec(life)[1]);
  const nose = (Math.atan2(-7, 11) * 180) / Math.PI + turn;
  assert.ok(Math.abs(nose) < 2, `nose points ${nose.toFixed(1)} degrees off the path`);
});

test('Michael\'s numbers live on his walls; a chip replaces the always-on card (owner, 2026-09-30)', () => {
  const art = read('src/renderer/src/scene/studio/StudioArt.tsx');
  assert.match(art, /function StatsSign\(/);
  assert.match(art, /\{stats && <StatsSign at=\{P\(-0\.6, -a \+ 0\.01, z1 - 3\)\}/);
  assert.match(art, /<text key=\{n\} className="cth-st-tick"/, 'numbers tick when they change');
  // Board columns read left to right on the wall, as the Tasks view does:
  // To do, Doing, Waiting, Blocked, Done (owner, 2026-10-18).
  assert.match(art, /\['#9C97CC', board\.todo\], \[T\.blue, board\.doing\], \[T\.amber, board\.waiting\], \[T\.coral, board\.blocked\], \[T\.green, board\.done\]/);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  // The name plate on his glass is the way in; no floating chip (owner, 2026-09-30).
  assert.doesNotMatch(stage, /HubChip/);
  assert.match(stage, /className="cth-st-plate"/);
  assert.match(stage, /onMouseEnter=\{\(\) => openPeek\('hub'\)\}\n\s+onMouseLeave=\{closePeek\}\n\s+onFocus=\{\(\) => openPeek\('hub'\)\}/);
  assert.match(stage, /\{\(sel \|\| peek === 'hub'\) && \(/);
});

test('a terminal that survived a reload is not shown clocking in', () => {
  const app = read('src/renderer/src/App.tsx');
  assert.match(app, /const running = new Set\(list\.filter\(\(p\) => p\.hasOutput\)\.map\(\(p\) => p\.id\)\);/);
  assert.match(app, /a\.ptyId && running\.has\(a\.ptyId\) && a\.action === ACTION_CLOCKING_IN\) useStore\.getState\(\)\.updateAgent\(a\.id, \{ action: '' \}\)/);
});

test('Michael\'s office has a name plate by the door, not an M badge (owner, 2026-09-30)', () => {
  const art = read('src/renderer/src/scene/studio/StudioArt.tsx');
  assert.match(art, /<NamePlate at=\{P\(\.\.\.plateAt\(name\)\)\} name=\{name\} busy=\{busy\}/);
  // The plate ends before the glass's corner (gx 1.05) for any name.
  assert.match(art, /return \[Math\.min\(0\.6, 0\.97 - plateWidth\(name\) \/ 100\), 1\.06, 44\];/);
  assert.doesNotMatch(art, /fontSize=\{12\} fill="#fff">M<\/text>/, 'the M badge is gone');
  assert.match(read('src/renderer/src/scene/studio/StudioStage.tsx'), /<g key="hub" style=\{dimStyle\(dimmed\(god \? \[god\.id\] : \[\]\)\)\}><Hub T=\{T\} dark=\{dark\} board=\{snap\.board\} busy=\{godBusy\} name=\{god\?\.name\} plateLit=/);
});

test('the right column has no ground of its own; its cards sit on the office (owner, 2026-09-30)', () => {
  const app = read('src/renderer/src/App.tsx');
  // Closed, the office takes the window (docs/designs/needs-you-empty-state.md D1).
  assert.match(app, /<StudioStage config=\{config\} bleed=\{columnShown \? sidebarWidth \+ 10 : 0\} \/>/);
  const col = app.slice(app.indexOf("The right column has no ground of its own"), app.indexOf("{columnMode === 'board' || !agent ? ("));
  assert.doesNotMatch(col, /background:|backdropFilter|boxShadow/);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(stage, /const fitW = Math\.max\(200, box\.w - bleed\);/);
  assert.match(stage, /right: -bleed, overflow: 'hidden'/);
});

test('a second pod never takes a slot another department prefers; job titles come from the hire', () => {
  // Generated by /ship coverage audit (pass 1).
  // Value: protects=departments keep their usual place when one grows a second pod, and panel headers show the hired job; fails_when=planStudio places overflow pods before preferred ones, or roleOf stops preferring the hired card or cutting a long role line; why_new=only one department per pod and departmentOf were checked; roleOf had no test; seam=none
  const sup = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}`, character: 'x', description: 'Customer support' }));
  const plan = L.planStudio([...sup, { id: 'm', character: 'x', description: 'Marketing lead' }, { id: 'fd', character: 'x', description: 'Front desk' }]);
  const at = plan.pods.map((p) => [p.dept, p.members.length, p.slot.x]);
  assert.deepEqual(at, [['front-desk', 1, 400], ['support', 4, 660], ['marketing', 1, 490], ['support', 1, 765]], 'marketing keeps its slot; the extra support pod takes a free one');
  // roleOf: the hired job card, then the character's usual job, then the start of the role line.
  assert.equal(L.roleOf({ id: 'erin', character: 'erin', sourceCard: 'pro-services/kelly' }), L.roleOf({ id: 'kelly', character: 'kelly' }));
  assert.notEqual(L.roleOf({ id: 'erin', character: 'erin', sourceCard: 'pro-services/kelly' }), L.roleOf({ id: 'erin', character: 'erin' }), 'the hire, not the character');
  assert.equal(L.roleOf({ id: 'x', character: 'nobody', sourceCard: 'pack/unknown', description: 'Handles the books. Also payroll.' }), 'Handles the books');
  assert.equal(L.roleOf({ id: 'y', description: 'Keeps every supplier relationship warm and the shelves full' }), 'Keeps every supplier relat...');
  assert.equal(L.roleOf({ id: 'r', description: 'Research: looks things up on the internet for the team' }), 'Research', 'a titled line gives its title');
  assert.equal(L.roleOf({ id: 'z' }), '');
  // Mailbox posts spread along the front edge, the first always at the corner.
  assert.deepEqual([L.postGx(0, 1), L.postGx(0, 3), L.postGx(2, 3)], [-4, -4, -1.6]);
  assert.ok(L.postGx(5, 6) <= -4 + 3.4 + 1e-9, 'never past the platform edge');
});

test('the selected Michael card keeps its outline down the filled stats row (owner, 2026-10-01)', () => {
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  const hub = /function HubCard[^]*?\n\}\) \{[^]*?\n\}\n/.exec(stage)[0];
  // An inset shadow on the card paints under its children, so the filled
  // stats row covered the outline at the sides.
  assert.doesNotMatch(/<div style=\{\{\n\s*position: 'relative', \.\.\.style[^]*?\}\}>/.exec(hub)[0], /inset/, 'the card itself draws no inset outline');
  assert.match(hub, /<span aria-hidden style=\{\{\n\s*position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none',\n\s*boxShadow: `inset 0 0 0 1px \$\{selected \? 'var\(--cth-ink\)' : 'var\(--cth-line\)'\}`\n\s*\}\} \/>\n\s*<\/div>\n\s*\);\n\}\n$/, 'the outline is the last layer, over the rows');
});

test('a flying token stays hidden until its motion has begun, so it never sits at the stage corner (issue #300)', () => {
  const life = read('src/renderer/src/scene/studio/life.tsx');
  assert.match(life, /const \[launched, setLaunched\] = useState\(false\);/);
  assert.match(life, /ref\.current\?\.beginElement\(\); setLaunched\(true\);/, 'shown only after beginElement ran');
  assert.match(life, /<g visibility=\{launched \? 'visible' : 'hidden'\}>\s*<animateMotion ref=\{ref\}/, 'the moving head is hidden before it launches');
});

test('Michael\'s wall and hub card count Waiting: five columns in the Tasks order, on a card wide enough for their labels (owner, 2026-10-18)', () => {
  // Value: protects=design review D2 A, 1A and 3A, the wall adds up to the Tasks view; fails_when=Waiting drops off either surface, the order differs from Tasks, the five columns overrun the board, or the card shrinks so English labels touch; why_new=owner report (wall missing the waiting count); seam=pure geometry from the tuple, source pins; no_claim=the drawn pixels (lab screenshot)
  const art = read('src/renderer/src/scene/studio/StudioArt.tsx');
  assert.match(art, /board: \{ todo: number; doing: number; waiting: number; blocked: number; done: number \};/);
  assert.match(art, /\.map\(\(\[c, n\], i\) => \[0\.47 - 0\.32 \* cw - i \* 0\.36 \* cw, c, n\]\);/);
  const cw = Number(/const cw = ([\d.]+);/.exec(art)[1]);
  const last = 0.47 - 0.32 * cw - 4 * 0.36 * cw;
  assert.ok(Math.abs(last - 0.04 * cw - -0.97) < 0.08, `the fifth column ends at the board's edge (${last.toFixed(3)})`);
  const stage = read('src/renderer/src/scene/studio/StudioStage.tsx');
  assert.match(stage, /gridTemplateColumns: 'repeat\(5, 1fr\)'/);
  assert.match(stage, /\{col\(board\.doing, t\('studio\.doingCol'\), 'var\(--cth-blue\)'\)\}\n\s+\{col\(board\.waiting, t\('kanban\.colWaiting'\), 'var\(--cth-amber\)'\)\}\n\s+\{col\(board\.blocked/);
  const L = loadTs('src/renderer/src/scene/studio/layout.ts');
  assert.equal(L.HUB_CARD.w, 212, 'five columns of at least 40 px ("Blocked" is 38.5 px)');
  assert.match(read('src/renderer/src/scene/studio/OnboardingStudio.tsx'), /board=\{\{ todo: 0, doing: 0, waiting: 0, blocked: 0, done: 0 \}\}/);
});
