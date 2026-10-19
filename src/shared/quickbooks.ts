/**
 * QuickBooks through the owner's Claude account (owner, 2026-09-29): the app
 * does not connect to Intuit itself. Agents inherit the account's QuickBooks
 * connector (mcp__claude_ai_Intuit_QuickBooks__*), and each agent's
 * Capabilities say whether it may use it, and whether it may make changes,
 * once the owner turns QuickBooks on in Settings (off by default).
 * The PreToolUse hook applies this rule on every call, so a change takes
 * effect on the agent's next call without a restart.
 */

export interface QuickBooksCapability {
  /** "Can use QuickBooks". */
  enabled: boolean;
  /** true = Can make changes; false = Read only, or Changes need my OK. */
  changes: boolean;
  /** true = Changes need my OK (issue 320): a change is refused until the owner
   *  approves that exact call on Ask me, then runs once. Never true together
   *  with `changes`. Absent on records saved before this level existed. */
  approval?: boolean;
}

/** The three levels an enabled agent can hold. */
export type QuickBooksLevel = 'read' | 'approval' | 'changes';

export function quickbooksLevel(cap: QuickBooksCapability): QuickBooksLevel {
  return cap.changes ? 'changes' : cap.approval ? 'approval' : 'read';
}

/** One level as the capability the app saves. Off stays off, with no level. */
export function quickbooksCapabilityOf(level: QuickBooksLevel): QuickBooksCapability {
  return { enabled: true, changes: level === 'changes', ...(level === 'approval' ? { approval: true } : {}) };
}

/** How long an approved call may be retried before the grant lapses. */
export const QUICKBOOKS_GRANT_TTL_MS = 30 * 60 * 1000;
/** How long a request waits for the owner before it is dropped. */
export const QUICKBOOKS_WAIT_TTL_MS = 24 * 60 * 60 * 1000;

/** A server name that is QuickBooks: "claude_ai_Intuit_QuickBooks",
 *  "claude.ai Intuit QuickBooks", "QuickBooksOnline", "qbo-test". Not bare
 *  "intuit", which Intuit TurboTax shares. One rule for tools and resources. */
function namesQuickBooks(server: string): boolean {
  return /quickbooks/i.test(server) || /(^|[^a-z0-9])qbo([^a-z0-9]|$)/i.test(server);
}

/** An MCP tool from a QuickBooks connector: its server names QuickBooks, or,
 *  for a server with an opaque name, the tool is one of the connector's qbo_ /
 *  quickbooks_ tools. */
export function isQuickBooksConnectorTool(toolName: string): boolean {
  const m = /^mcp__(.+?)__(.+)$/.exec(toolName ?? '');
  if (!m) return false;
  const [, server, tool] = m;
  if (namesQuickBooks(server)) return true;
  return /^(qbo|quickbooks)_/i.test(tool);
}

/** Claude Code's own tools for a connector's MCP resources. They name the
 *  server in their input (e.g. "claude.ai Intuit QuickBooks") and only read. */
const MCP_RESOURCE_TOOLS = new Set(['ListMcpResourcesTool', 'ReadMcpResourceTool']);

/** A resource list or read aimed at a QuickBooks connector, so the Settings
 *  switch and Capabilities cover it too. A list with no server names no
 *  resource contents and is left alone. */
export function isQuickBooksResourceCall(toolName: string, input: unknown): boolean {
  if (!MCP_RESOURCE_TOOLS.has(toolName)) return false;
  const server = input && typeof input === 'object' ? (input as { server?: unknown }).server : undefined;
  return typeof server === 'string' && namesQuickBooks(server);
}

/** The connector's tools that only look (its catalog as agents saw it,
 *  2026-09-29). Read only allows these and nothing else, so a tool Intuit adds
 *  later is refused until it is added here. Shopping for loans and pulling
 *  peer loan offers are left out: they may share the books with lenders. */
const READ_TOOLS = new Set([
  'benchmarking_against_industry', 'benchmarking_against_industry_text', 'benchmarking_quickbooks_account',
  'benchmarking_quickbooks_account_text', 'business_health_check_widget', 'cash_flow_generator',
  'cash_flow_quickbooks_account', 'cash_flow_quickbooks_account_text', 'company_info',
  'industry_benchmark_widget', 'industry_recommendation', 'money_onboarding_application_metadata',
  'profit_loss_generator', 'profit_loss_quickbooks_account', 'profit_loss_quickbooks_account_text',
  'qbo_accounting_get_ap_aging_detail', 'qbo_accounting_get_ap_aging_summary',
  'qbo_accounting_get_ar_aging_detail', 'qbo_accounting_get_ar_aging_summary',
  'qbo_accounting_get_ar_aging_summary_text', 'qbo_accounting_get_balance_sheet',
  'qbo_accounting_get_balance_sheet_text', 'qbo_accounting_get_product_service_list',
  'qbo_accounting_get_sales_by_customer_summary', 'qbo_accounting_get_sales_by_customer_summary_text',
  'qbo_accounting_get_sales_by_product_summary', 'qbo_accounting_get_sales_by_product_summary_text',
  'qbo_catalog_search_products', 'qbo_contact_search_customer', 'qbo_lending_estimate_loan_payments',
  'qbo_lending_get_loans', 'qbo_lending_help', 'qbo_payroll_get_company_deductions_contributions',
  'qbo_payroll_get_company_info', 'qbo_payroll_get_company_last_payroll_run',
  'qbo_payroll_get_company_pay_types', 'qbo_payroll_get_company_payroll_readiness',
  'qbo_payroll_get_company_timeoff_details', 'qbo_payroll_get_employee_compensations',
  'qbo_payroll_get_employee_contract_details', 'qbo_payroll_get_employee_deductions',
  'qbo_payroll_get_employee_details', 'qbo_payroll_get_employee_manager_details',
  'qbo_payroll_get_employee_payroll_readiness', 'qbo_payroll_get_employee_timeoff_assignments',
  'qbo_payroll_get_employees', 'qbo_payroll_get_employees_by_work_location',
  'qbo_payroll_get_employer_tax_setup', 'qbo_payroll_get_pay_schedules', 'qbo_payroll_get_payslip_details',
  'qbo_payroll_get_payslips', 'qbo_payroll_get_tax_filings_summary', 'qbo_payroll_search_employee',
  'qbo_sales_get_estimates', 'qbo_sales_get_invoices', 'qbo_sales_get_payment_links',
  'qbo_sales_get_recurring_invoices', 'qbo_sales_get_settings', 'qbo_sales_get_transaction_document'
]);

/** True when a QuickBooks tool only reads: a known read tool, or a resource
 *  list or read. */
export function isQuickBooksReadTool(toolName: string): boolean {
  if (MCP_RESOURCE_TOOLS.has(toolName)) return true;
  const tool = /^mcp__.+?__(.+)$/.exec(toolName ?? '')?.[1] ?? '';
  return READ_TOOLS.has(tool);
}

/** An agent's QuickBooks capability: its saved choice, or, before the owner
 *  chose, on and Read only for roles that read the books (Oscar), off for the
 *  rest (owner, 2026-09-29). */
export function quickbooksCapability(saved: QuickBooksCapability | undefined, roleReadsBooks: boolean): QuickBooksCapability {
  if (saved) {
    const enabled = saved.enabled === true;
    // Changes need my OK is the stricter of the two, so it wins if a record holds both.
    const approval = enabled && saved.approval === true;
    return { enabled, changes: enabled && !approval && saved.changes === true, ...(approval ? { approval: true } : {}) };
  }
  return { enabled: roleReadsBooks, changes: false };
}

/** What `quickbooks:setAccess` saves for `agentId`, or null to refuse it
 *  (issue 132). An id must be on the team: one that is not (a typo, a member
 *  who was removed) would quietly apply to a later member who gets that id. A
 *  hire saves for its new id before the spawn, so the agent starts holding the
 *  connector, and says so with `hiring`. */
export function quickbooksAccessToSave(agentId: unknown, cap: unknown, onTeam: (id: string) => boolean, hiring = false): QuickBooksCapability | null {
  if (typeof agentId !== 'string' || !agentId || !cap || typeof cap !== 'object') return null;
  if (!hiring && !onTeam(agentId)) return null;
  const c = cap as { enabled?: unknown; changes?: unknown; approval?: unknown };
  return quickbooksCapability({ enabled: c.enabled === true, changes: c.changes === true, approval: c.approval === true }, false);
}

/** Refuses a QuickBooks connector call the Settings switch (`officeOn`) or
 *  the agent's Capabilities don't allow. The reason is read by the agent and
 *  shown on the floor. */
export function quickbooksAccess(officeOn: boolean, cap: QuickBooksCapability, toolName: string): { ok: true } | { ok: false; reason: string; approval?: true } {
  if (!officeOn) {
    return { ok: false, reason: 'The owner has QuickBooks turned off for the team in Settings. Do not try another way; tell Michael what you need.' };
  }
  if (!cap.enabled) {
    return { ok: false, reason: 'The owner has not given you QuickBooks in your Capabilities. Do not try another way; tell Michael what you need.' };
  }
  if (!cap.changes && cap.approval && !isQuickBooksReadTool(toolName)) {
    // The caller files the request and words the refusal with its id (quickbooksNeedsOk).
    return { ok: false, approval: true, reason: 'This change needs the owner\'s OK.' };
  }
  if (!cap.changes && !isQuickBooksReadTool(toolName)) {
    return { ok: false, reason: 'You are Read only in QuickBooks: do not create, change, send or delete anything there. Tell Michael what you would change, and the owner will do it.' };
  }
  return { ok: true };
}

/** What the agent reads when its change is waiting on the owner. */
export function quickbooksNeedsOk(id: string): string {
  return `This change needs the owner's OK and is waiting on Ask me (request ${id}). Do not try another way. Once the owner approves, make exactly this same call again, with the same input, and it will run once. If the owner declines you will be told here.`;
}

/** What the agent reads when the owner declined that exact call. */
export function quickbooksDeclined(id: string): string {
  return `The owner declined this change (request ${id}). Do not try it again or another way; tell Michael what you were trying to do.`;
}

/** The tool as plain words for the owner: "Create invoice". Falls back to the raw name. */
export function quickbooksToolWords(toolName: string): string {
  const tool = /^mcp__.+?__(.+)$/.exec(toolName ?? '')?.[1] ?? toolName ?? '';
  const words = tool.replace(/^(qbo|quickbooks)_/i, '').replace(/^(accounting|sales|payroll|contact|catalog|lending)_/i, '').replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : tool;
}

/** The most a call's input may hold (canonical text) and still be put up for the
 *  owner. A larger one cannot be shown in full, so it is not filed. */
export const QUICKBOOKS_INPUT_MAX = 20_000;

/** The call's input in plain lines for the owner to read, every field the
 *  approval covers and each in full: "customer name: Acme". A nested value is
 *  shown as indented JSON over several lines. */
export function quickbooksInputLines(input: unknown): string[] {
  if (input === undefined || input === null) return [];
  const show = (v: unknown): string => (v === '' ? '(empty)' : typeof v === 'object' && v !== null ? JSON.stringify(v, null, 2) : String(v));
  if (typeof input !== 'object' || Array.isArray(input)) return [`input: ${show(input)}`];
  return Object.entries(input as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${show(v)}`);
}

/** A call's input in one stable text, whatever order its keys came in, so
 *  the same call hashes the same. */
export function quickbooksCanonicalInput(input: unknown): string {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, walk((v as Record<string, unknown>)[k])]));
    }
    return v;
  };
  return JSON.stringify(walk(input ?? null));
}

/** What the agent reads when its change is too large to show the owner in full. */
export const QUICKBOOKS_TOO_LARGE = 'This change is too large to show the owner in full, so it cannot be put up for approval. Split it into smaller changes and make each one on its own.';

/** What the agent is told when the owner approves: which request, and that the same call runs once. */
export function quickbooksApprovedMessage(a: { id: string; title: string }): { act: 'inform'; subject: string; body: string } {
  const minutes = Math.round(QUICKBOOKS_GRANT_TTL_MS / 60000);
  return {
    act: 'inform',
    subject: 'QuickBooks change approved',
    body: `The owner approved your QuickBooks change "${a.title}" (request ${a.id}). Make exactly the same call again, with the same input, and it will run once. The approval lapses after ${minutes} minutes if you do not use it.`
  };
}

/** What the agent is told when the owner declines. */
export function quickbooksDeclinedMessage(a: { id: string }): { act: 'inform'; subject: string; body: string } {
  return { act: 'inform', subject: 'QuickBooks change declined', body: quickbooksDeclined(a.id) };
}

/** What the agent reads when it already has too many changes waiting on the owner. */
export const QUICKBOOKS_TOO_MANY_WAITING = 'You already have several QuickBooks changes waiting on the owner\'s OK. Do not ask for more; tell Michael what is waiting and carry on with other work.';

export type QuickBooksApprovalState = 'waiting' | 'approved' | 'declined' | 'used';

export interface QuickBooksApproval {
  id: string;
  agentId: string;
  /** The full tool name, e.g. mcp__claude_ai_Intuit_QuickBooks__qbo_sales_create_invoice. */
  tool: string;
  /** sha256 of the tool name and its canonical input. */
  inputHash: string;
  /** The tool in plain words, for the owner. */
  title: string;
  /** The input in plain lines, for the owner. */
  lines: string[];
  state: QuickBooksApprovalState;
  createdAt: number;
  decidedAt?: number;
  /** When it lapses: a waiting request, an approved grant, or a remembered no or a used grant. */
  expiresAt: number;
}
