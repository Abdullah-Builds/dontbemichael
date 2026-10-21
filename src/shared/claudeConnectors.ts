/**
 * Connectors on the owner's Claude account (docs/designs/claude-connectors.md,
 * owner 2026-10-02). The app reads them from `claude mcp list`; each one is off
 * until the owner turns it on in Settings > Connections, and an agent uses it
 * only once its Capabilities grant it. Everything else an agent's Claude could
 * load (the owner's own servers and plugins) is never offered.
 *
 * Two layers hold it. At start, an agent with no connector is started without
 * any; one with grants starts with a deny rule for every connector and server it
 * was not given. On every call, the PreToolUse hook refuses an MCP tool or MCP
 * resource call that is not a granted connector or the app's own md-mail.
 *
 * QuickBooks keeps its own switch (`quickbooksClaude`), Read only or Can make
 * changes, and the role default for roles that read the books (shared/quickbooks.ts).
 *
 * Pure: no fs, no electron.
 */
import type { AgentCapabilities } from './mailboxes';
import { quickbooksCapability } from './quickbooks';
import { emailCalendarAllowed } from './mcpCatalog';

/** `unreachable`: the check failed to connect (a network or server failure),
 *  which signing in again would not fix. */
export type ConnectorStatus = 'connected' | 'needs-sign-in' | 'unreachable';

export interface ClaudeConnector {
  /** The name after "claude.ai ", e.g. "Intuit QuickBooks". The key everywhere. */
  key: string;
  /** The connector's address, kept to spot a rename. */
  url: string;
  status: ConnectorStatus;
}

/** The last read of the Claude account, kept in config. */
export interface ClaudeConnectorsState {
  /** null until a read has succeeded once. */
  list: ClaudeConnector[] | null;
  /** The owner's own Claude Code servers and plugin servers ("serena",
   *  "plugin:enterprise-search:slack"): never offered, always denied. */
  servers?: string[];
  /** When the list was last read successfully. */
  readAt?: number;
  /** Set when the latest read failed; cleared by a good one. */
  failedAt?: number;
}

/** The parts of the config the connector rules read. */
export interface ConnectorConfig {
  claudeConnectors?: ClaudeConnectorsState;
  connectorsOn?: { [key: string]: boolean };
  quickbooksClaude?: boolean;
  agentCapabilities?: { [agentId: string]: AgentCapabilities };
}

/** Claude Code's own tools for MCP resources. They name the server in their input. */
export const MCP_RESOURCE_TOOLS: ReadonlySet<string> = new Set(['ListMcpResourcesTool', 'ReadMcpResourceTool']);

/** The app's own mail server, passed to agents with `--mcp-config`. Its tools
 *  follow the agent's Email capability, never the connector rules. */
export const APP_MCP_SERVER = 'md-mail';

const KEY_MAX = 80;
const URL_MAX = 300;

/** One server line of `claude mcp list`:
 *  "claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected",
 *  "plugin:enterprise-search:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication",
 *  "serena: uvx ... - ✘ Failed to connect — CONNECTION_CLOSED". The name ends at
 *  the first ": "; the status is after the last " - <mark> ". */
const LINE = /^(.+?): (.*) - (?:([✔✓!✘✗-]) )?(.*)$/u;

export interface McpList {
  connectors: ClaudeConnector[];
  servers: string[];
}

/** Reads `claude mcp list`. Returns null when no server line was found, which
 *  the caller treats as a failed read (signed out, a timeout, a new format). */
export function parseMcpList(stdout: string): McpList | null {
  const connectors: ClaudeConnector[] = [];
  const servers: string[] = [];
  let seen = 0;
  for (const raw of String(stdout ?? '').split(/\r?\n/)) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    seen++;
    const [, name, target, mark, words] = m;
    const c = /^claude\.ai (.+)$/.exec(name);
    if (!c) { if (!servers.includes(name)) servers.push(name); continue; }
    const key = c[1].trim().slice(0, KEY_MAX);
    if (!key || connectors.some((x) => x.key === key)) continue;
    const ok = (!mark || mark === '✔' || mark === '✓') && /\bconnected\b/i.test(words) && !/\bnot\b|needs|fail|error/i.test(words);
    const unreachable = !ok && (mark === '✘' || mark === '✗' || /fail|error/i.test(words)) && !/needs|auth/i.test(words);
    connectors.push({ key, url: target.trim().split(/\s+/)[0].slice(0, URL_MAX), status: ok ? 'connected' : unreachable ? 'unreachable' : 'needs-sign-in' });
  }
  return seen > 0 ? { connectors, servers } : null;
}

/** The MCP server name Claude Code gives tools: every character outside
 *  [A-Za-z0-9_-] becomes "_" ("claude.ai Google Drive" -> "claude_ai_Google_Drive"). */
export function serverToolName(server: string): string {
  return server.replace(/[^A-Za-z0-9_-]/g, '_');
}

/** The deny rule and tool prefix for a connector: "mcp__claude_ai_Intuit_QuickBooks". */
export function connectorRule(key: string): string {
  return `mcp__${serverToolName(`claude.ai ${key}`)}`;
}

/** The deny rule for one of the owner's own servers: "mcp__serena". */
export function serverRule(server: string): string {
  return `mcp__${serverToolName(server)}`;
}

/** The Claude account's QuickBooks connector, by its exact name. Only this one
 *  keeps QuickBooks' own switch and Read only rules: another connector whose
 *  name mentions QuickBooks (a future "QuickBooks Payroll") gets its own switch
 *  and grants like any connector (Codex adversarial review, 2026-10-02). */
export const QUICKBOOKS_KEY = 'Intuit QuickBooks';

export function isQuickBooksKey(key: string): boolean {
  return key.trim().toLowerCase() === QUICKBOOKS_KEY.toLowerCase();
}

/** The Claude account's Gmail and Google Calendar, for the one-time carry-over
 *  of the old "Your Claude account" switch. */
export function isEmailCalendarKey(key: string): boolean {
  return /^(gmail|google calendar)$/i.test(key.trim());
}

/** Whether the owner has a connector on. QuickBooks keeps its own switch. */
export function connectorOn(cfg: ConnectorConfig, key: string): boolean {
  return isQuickBooksKey(key) ? cfg.quickbooksClaude === true : cfg.connectorsOn?.[key] === true;
}

/** Whether an agent holds a connector: its grant, or for QuickBooks its
 *  capability (with the role default for roles that read the books). The owner
 *  switch is checked separately. */
export function connectorGranted(cfg: ConnectorConfig, agentId: string, key: string, roleReadsBooks: boolean): boolean {
  const caps = cfg.agentCapabilities?.[agentId];
  if (isQuickBooksKey(key)) return quickbooksCapability(caps?.quickbooks, roleReadsBooks).enabled;
  return (caps?.connectors ?? []).includes(key);
}

/** Whether an agent reads mail through the Claude account's Gmail: switched
 *  on in Settings and granted to it (schedules: "cannot check email"). */
export function gmailConnectorOn(cfg: ConnectorConfig, agentId: string): boolean {
  const keys = new Set([...Object.keys(cfg.connectorsOn ?? {}), ...(cfg.agentCapabilities?.[agentId]?.connectors ?? [])]);
  return [...keys].some((key) => /^gmail$/i.test(key.trim()) && connectorOn(cfg, key) && connectorGranted(cfg, agentId, key, false));
}

/** The connectors an agent may use now: on the account, on in Settings,
 *  granted. Before any good read, none. */
export function usableConnectors(cfg: ConnectorConfig, agentId: string, roleReadsBooks: boolean): ClaudeConnector[] {
  return (cfg.claudeConnectors?.list ?? []).filter((c) => connectorOn(cfg, c.key) && connectorGranted(cfg, agentId, c.key, roleReadsBooks));
}

export interface SpawnConnectorPlan {
  /** Start with no connector and no personal server at all
   *  (ENABLE_CLAUDEAI_MCP_SERVERS=false and --strict-mcp-config). */
  strip: boolean;
  /** Otherwise: the deny rules for every connector and server not given. */
  deny: string[];
}

/** How an agent starts: stripped when it holds no connector (or nothing has
 *  been read yet), else with a deny rule for everything it was not given. */
export function spawnConnectorPlan(cfg: ConnectorConfig, agentId: string, roleReadsBooks: boolean): SpawnConnectorPlan {
  const usable = new Set(usableConnectors(cfg, agentId, roleReadsBooks).map((c) => c.key));
  if (usable.size === 0) return { strip: true, deny: [] };
  const deny = new Set<string>();
  for (const c of cfg.claudeConnectors?.list ?? []) if (!usable.has(c.key)) deny.add(connectorRule(c.key));
  for (const s of cfg.claudeConnectors?.servers ?? []) deny.add(serverRule(s));
  return { strip: false, deny: [...deny] };
}

/** What a tool call reaches: a connector, the app's own server, another
 *  server, or nothing MCP at all. */
export type McpTarget =
  | { kind: 'none' }
  | { kind: 'app' }
  | { kind: 'connector'; key: string }
  | { kind: 'unknown-connector'; server: string }
  | { kind: 'other'; server: string }
  | { kind: 'all-servers' };

/** Names the server a tool call reaches. Connector keys come from the last
 *  read, the switches and the grants, so a removed one is still named. */
export function mcpTarget(cfg: ConnectorConfig, toolName: string, input: unknown): McpTarget {
  let server: string;
  if (MCP_RESOURCE_TOOLS.has(toolName)) {
    const s = input && typeof input === 'object' ? (input as { server?: unknown }).server : undefined;
    // A list with no server would show every server the session connected:
    // deny rules hide a server's tools, not its resources (owner, 2026-10-02).
    if (typeof s !== 'string' || !s) return { kind: 'all-servers' };
    if (s === APP_MCP_SERVER) return { kind: 'app' };
    const c = /^claude\.ai (.+)$/.exec(s);
    if (c) {
      const key = knownKeys(cfg).find((k) => k === c[1].trim());
      return key ? { kind: 'connector', key } : { kind: 'unknown-connector', server: s };
    }
    return { kind: 'other', server: s };
  }
  const m = /^mcp__(.+)$/.exec(toolName ?? '');
  if (!m) return { kind: 'none' };
  server = m[1];
  if (server.startsWith(`${APP_MCP_SERVER}__`)) return { kind: 'app' };
  // The longest matching prefix wins ("Google" vs "Google Drive"). Two names
  // that become the same tool prefix ("Foo Bar", "Foo_Bar") cannot be told
  // apart, so neither is (Codex adversarial review, 2026-10-02).
  let best: string | undefined;
  let tie = false;
  for (const k of knownKeys(cfg)) {
    const rule = connectorRule(k);
    if (!toolName.startsWith(`${rule}__`)) continue;
    if (!best || rule.length > connectorRule(best).length) { best = k; tie = false; }
    else if (rule === connectorRule(best) && k !== best) tie = true;
  }
  if (best && !tie) return { kind: 'connector', key: best };
  const name = server.split('__')[0];
  return name.startsWith('claude_ai_') ? { kind: 'unknown-connector', server: name } : { kind: 'other', server: name };
}

function knownKeys(cfg: ConnectorConfig): string[] {
  const keys = new Set<string>();
  for (const c of cfg.claudeConnectors?.list ?? []) keys.add(c.key);
  for (const k of Object.keys(cfg.connectorsOn ?? {})) keys.add(k);
  for (const caps of Object.values(cfg.agentCapabilities ?? {})) for (const k of caps?.connectors ?? []) keys.add(k);
  return [...keys];
}

/** Why an MCP call was refused when the app could not decide it: the hook
 *  shim could not reach the app, or the check failed (D8). */
export const CONNECTOR_UNDECIDED = 'Connector blocked: the app could not confirm access. Try again in a moment; if it keeps happening, tell Michael.';

const TELL_MICHAEL = 'Do not try another way; tell Michael what you need.';

/** The connector rule for one MCP call. An allowed md-mail or QuickBooks call
 *  still goes through its own gate in the hook (Capabilities > Email, or
 *  QuickBooks' switch and Read only). The reason is read by the agent and shown
 *  on the floor. */
export function connectorAccess(
  cfg: ConnectorConfig,
  agentId: string | undefined,
  toolName: string,
  input: unknown,
  roleReadsBooks: boolean
): { ok: true } | { ok: false; reason: string } {
  const target = mcpTarget(cfg, toolName, input);
  if (target.kind === 'none') return { ok: true };
  if (!agentId) return { ok: false, reason: `Connector tools are only for the team. ${TELL_MICHAEL}` };
  if (target.kind === 'all-servers') {
    return { ok: false, reason: 'Name the connector\'s server to list its resources (for example "claude.ai HubSpot"). Only connectors you were given can be listed.' };
  }
  // The app's own md-mail: Capabilities > Email decides its tools, in the hook.
  // It has no resources, and the mail gate checks tool names only, so a
  // resource call naming md-mail is refused (Codex adversarial review, 2026-10-02).
  if (target.kind === 'app') {
    return MCP_RESOURCE_TOOLS.has(toolName) ? { ok: false, reason: `The office mail server has no resources to read. ${TELL_MICHAEL}` } : { ok: true };
  }
  if (target.kind === 'other') {
    return { ok: false, reason: `"${target.server}" is not one of the office's connections, so you cannot use it. ${TELL_MICHAEL}` };
  }
  const list = cfg.claudeConnectors?.list;
  if (target.kind === 'unknown-connector') {
    // Before the first good read agents start with no connector at all, so
    // only QuickBooks' own gate applies. After it, a connector the read did not
    // list is refused whatever its name: a server named like QuickBooks (say a
    // project .mcp.json "claude.ai QuickBooks Backdoor") is not QuickBooks
    // (Codex adversarial review, 2026-10-02).
    const qbServer = [serverToolName(`claude.ai ${QUICKBOOKS_KEY}`), `claude.ai ${QUICKBOOKS_KEY}`];
    if (list == null && qbServer.includes(target.server)) return { ok: true };
    return { ok: false, reason: `That connector on the owner's Claude account is not turned on for the team. ${TELL_MICHAEL}` };
  }
  const { key } = target;
  const listed = (list ?? []).some((c) => c.key === key);
  // QuickBooks keeps its own switch and rules: the hook's QuickBooks gate
  // decides, as long as the account still has it.
  if (isQuickBooksKey(key) && (listed || list == null)) return { ok: true };
  if (!listed) {
    return { ok: false, reason: `${key} is no longer on the owner's Claude account. ${TELL_MICHAEL}` };
  }
  if (!connectorOn(cfg, key)) {
    return { ok: false, reason: `The owner has ${key} turned off for the team in Settings. ${TELL_MICHAEL}` };
  }
  if (!connectorGranted(cfg, agentId, key, roleReadsBooks)) {
    return { ok: false, reason: `The owner has not given you ${key} in your Capabilities. ${TELL_MICHAEL}` };
  }
  return { ok: true };
}

/** A fresh read against the saved state: keeps switches and grants across a
 *  rename (same address, new name), and returns the keys that moved. */
export function renamedKeys(prev: ClaudeConnector[] | null | undefined, next: ClaudeConnector[]): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  if (!prev) return out;
  const nextKeys = new Set(next.map((c) => c.key));
  for (const old of prev) {
    if (nextKeys.has(old.key) || !old.url) continue;
    const moved = next.find((c) => c.url === old.url && !prev.some((p) => p.key === c.key));
    if (moved) out.push({ from: old.key, to: moved.key });
  }
  return out;
}

/** Connectors the owner turned on or granted that are gone from the account. */
export function removedKeys(cfg: ConnectorConfig): string[] {
  const list = cfg.claudeConnectors?.list;
  if (!list) return [];
  const present = new Set(list.map((c) => c.key));
  const out = new Set<string>();
  for (const [k, on] of Object.entries(cfg.connectorsOn ?? {})) if (on && !present.has(k)) out.add(k);
  for (const caps of Object.values(cfg.agentCapabilities ?? {})) for (const k of caps?.connectors ?? []) if (!present.has(k)) out.add(k);
  return [...out].sort((a, b) => a.localeCompare(b));
}

/** The one-time carry-over (owner, 2026-10-02, D9), run at the first good read.
 *  QuickBooks keeps its own switch and each agent's choice, untouched. The old
 *  "Your Claude account" switch, when on, turns Gmail and Google Calendar on and
 *  grants them to every agent (Michael included), who could all use them
 *  before. Every other connector starts off. `switchedOff` names the connected
 *  ones agents could reach before the update and no longer can (E2). */
export function connectorCarryOver(
  cfg: ConnectorConfig & { mcpDefaults?: { [id: string]: { enabled: boolean } } },
  list: ClaudeConnector[],
  agentIds: string[]
): { connectorsOn: { [key: string]: boolean }; agentCapabilities: { [agentId: string]: AgentCapabilities }; switchedOff: string[] } {
  const connectorsOn = { ...(cfg.connectorsOn ?? {}) };
  const agentCapabilities = { ...(cfg.agentCapabilities ?? {}) };
  const mail = list.filter((c) => isEmailCalendarKey(c.key)).map((c) => c.key);
  if (emailCalendarAllowed(cfg.mcpDefaults) && mail.length) {
    for (const k of mail) connectorsOn[k] = true;
    for (const id of agentIds) {
      const caps = agentCapabilities[id] ?? {};
      agentCapabilities[id] = { ...caps, connectors: [...new Set([...(caps.connectors ?? []), ...mail])] };
    }
  }
  const switchedOff = agentIds.length
    ? list.filter((c) => c.status === 'connected' && !isQuickBooksKey(c.key) && !isEmailCalendarKey(c.key)).map((c) => c.key)
    : [];
  return { connectorsOn, agentCapabilities, switchedOff };
}

/** Keys found now that the owner has not seen in Settings yet. */
export function unseenKeys(list: ClaudeConnector[] | null | undefined, seen: string[] | undefined): string[] {
  if (!list) return [];
  return list.map((c) => c.key).filter((k) => !(seen ?? []).includes(k));
}
