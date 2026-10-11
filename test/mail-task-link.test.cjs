'use strict';

/**
 * Issue #105: the link from a webhook or task to its mail approval and the sent
 * Message-ID. A proposal stores the task id (only when a task exists) and the
 * webhook's correlation id; the task's trigger row stores the proposal id; once
 * a send is confirmed the linked view carries that proposal's Message-ID.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const loadTs = require('./load-ts.cjs');

const { linkedProposals, proposalForRows } = loadTs('src/shared/mailProposals.ts');
const { handleMailRequest } = loadTs('src/main/mail.ts');
const { MailApprovals } = loadTs('src/main/mailApprovals.ts');
const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

const server = { host: 'h', port: 993, secure: true };
const cfg = {
  mailboxes: [{ id: 'ceo', address: 'ceo@x.com', provider: 'gmail', imap: server, smtp: server, status: 'connected', createdAt: 1, updatedAt: 1 }],
  agentCapabilities: { pam: { email: { enabled: true, mailboxes: ['ceo'], send: false, sending: 'approval' } } }
};

/** The linker main builds, over in-memory task cards and trigger rows. */
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'md-tasklink-'));
  const out = { sends: [], attached: [] };
  const tasks = new Set(['webhook-abc']);
  const rows = [{ id: 'row1', direction: 'inbound', taskId: 'webhook-abc', correlationId: 'corr-1' }];
  const linker = {
    resolve: (taskId) => (tasks.has(taskId) ? { taskId, ...(rows.find((r) => r.taskId === taskId)?.correlationId ? { correlationId: rows.find((r) => r.taskId === taskId).correlationId } : {}) } : undefined),
    attach: (taskId, proposalId) => { out.attached.push([taskId, proposalId]); const r = rows.find((x) => x.taskId === taskId); if (r) r.proposalId = proposalId; }
  };
  const approvals = new MailApprovals({
    path: path.join(dir, 'mail-proposals.json'),
    send: () => true, remember: () => {}, toast: () => {}, agentName: (id) => id, godId: () => 'god', changed: () => {}, now: () => 1_000_000
  });
  const svc = { send: async (agentId, id, input) => { out.sends.push(input); return { sent: true, messageId: '<sent-1@x.com>' }; } };
  const call = (op, body) => handleMailRequest(svc, { getConfig: () => cfg, proposals: approvals, tasks: linker }, 'pam', op, body);
  return { approvals, call, out, rows, tasks, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const email = { mailbox: 'ceo', to: 'a@client.com', subject: 'Order 1', body: 'Shipped.' };

test('a webhook task and its approval carry the same correlation id, both ways', async (t) => {
  // Value: protects=the owner can join request, approval and send by stored ids; fails_when=the proposal lacks the task or correlation id, or the trigger row lacks the proposal id; why_new=issue #105; seam=fake linker
  const { approvals, call, out, rows, cleanup } = setup();
  t.after(cleanup);
  const res = await call('propose', { ...email, task: 'webhook-abc' });
  assert.equal(res.status, 200);
  assert.equal(res.body.task, 'webhook-abc');
  const p = approvals.get(res.body.proposal);
  assert.equal(p.taskId, 'webhook-abc');
  assert.equal(p.correlationId, 'corr-1', 'the correlation id comes from the webhook row');
  assert.deepEqual(out.attached, [['webhook-abc', p.id]]);
  assert.equal(rows[0].proposalId, p.id, 'the trigger row stores the proposal id');
  assert.equal(proposalForRows(rows, linkedProposals(approvals.all()))?.id, p.id);
  assert.equal(linkedProposals(approvals.all())[0].correlationId, rows[0].correlationId);
});

test('after a confirmed send the linked view shows the one Message-ID, never before', async (t) => {
  // Value: protects=the Message-ID shown is the sent email's and only appears after send; fails_when=it shows while waiting or approved, or differs from the send result; why_new=issue #105; seam=fake svc
  const { approvals, call, cleanup } = setup();
  t.after(cleanup);
  const id = (await call('propose', { ...email, task: 'webhook-abc' })).body.proposal;
  assert.equal(linkedProposals(approvals.all())[0].messageId, undefined, 'waiting: none');
  approvals.decide(id, 'approve', {}, '');
  assert.equal(linkedProposals(approvals.all())[0].messageId, undefined, 'approved: none');
  const sent = await call('send', { mailbox: 'ceo', proposal: id });
  assert.equal(sent.body.messageId, '<sent-1@x.com>');
  const [view] = linkedProposals(approvals.all());
  assert.equal(view.state, 'sent');
  assert.equal(view.messageId, '<sent-1@x.com>');
  assert.deepEqual(Object.keys(view).sort(), ['correlationId', 'id', 'messageId', 'state', 'taskId'], 'ids and state only: no recipient, subject or body');
});

test('a proposal with no task, or a task that does not exist, shows no task id', async (t) => {
  // Value: protects=no made-up or empty link; fails_when=a missing or unknown task id is stored or attached; why_new=issue #105; seam=fake linker
  const { approvals, call, out, cleanup } = setup();
  t.after(cleanup);
  const none = (await call('propose', { ...email, subject: 'No task' })).body;
  assert.equal(approvals.get(none.proposal).taskId, undefined);
  assert.equal(none.task, undefined);
  const bogus = (await call('propose', { ...email, subject: 'Bogus task', task: 'webhook-nope' })).body;
  assert.equal(approvals.get(bogus.proposal).taskId, undefined);
  assert.match(bogus.task_note, /No task with that id exists/);
  assert.deepEqual(out.attached, []);
  assert.deepEqual(linkedProposals(approvals.all()), []);
});

test('a task that is not from a webhook links the task id without a correlation id', async (t) => {
  // Value: protects=taskId is stored whenever a task exists; fails_when=a card with no trigger row gets a made-up correlation id or no link; why_new=issue #105; seam=fake linker
  const { approvals, call, tasks, cleanup } = setup();
  t.after(cleanup);
  tasks.add('card-7');
  const id = (await call('propose', { ...email, task: 'card-7' })).body.proposal;
  const p = approvals.get(id);
  assert.equal(p.taskId, 'card-7');
  assert.equal(p.correlationId, undefined);
});

test('rows match their approval by stored ids only', () => {
  // Value: protects=no join by subject, body or time; fails_when=a row with no ids matches a proposal; why_new=issue #105; seam=none
  const linked = [{ id: 'mp_1', taskId: 't1', state: 'waiting' }, { id: 'mp_2', taskId: 't2', state: 'sent', messageId: '<m>' }];
  assert.equal(proposalForRows([{ proposalId: 'mp_2' }], linked)?.id, 'mp_2');
  assert.equal(proposalForRows([{ taskId: 't1' }], linked)?.id, 'mp_1');
  assert.equal(proposalForRows([{ proposalId: 'mp_gone', taskId: 't1' }], linked), null, 'a stored proposal id is not second-guessed');
  assert.equal(proposalForRows([{}], linked), null);
});

test('the agent can name the task, and every locale has the new lines', () => {
  // Value: protects=the propose tool offers task and the UI strings exist in each language; fails_when=the schema or a locale key is missing; why_new=issue #105; seam=source read
  assert.match(read('resources/md-mail-mcp.cjs'), /task: \{ type: 'string'/);
  for (const lang of ['en', 'ar', 'zh-CN']) {
    const j = JSON.parse(read(`src/renderer/src/i18n/locales/${lang}.json`));
    assert.ok(j.askMe.mailTask && j.askMe.mailRequest, `${lang} askMe`);
    const th = j.triggerHistory;
    assert.ok(th.approvalLine && th.messageId, `${lang} lines`);
    for (const s of ['waiting', 'approved', 'changes', 'declined', 'sending', 'sent', 'cancelled']) assert.ok(th.proposalState[s], `${lang} state ${s}`);
  }
});
