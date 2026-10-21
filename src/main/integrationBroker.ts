/**
 * Loopback secret broker (Phase 2 foundation, main process).
 *
 * A 127.0.0.1-only HTTP proxy. An ephemeral worker calls
 *   <METHOD> http://127.0.0.1:<port>/i/<integrationId>/<path...>
 * authenticating with a PER-WORKER CAPABILITY TOKEN (a handle, NOT any secret) in the
 * `Authorization: Bearer` / `X-MD-Broker-Token` header. The broker validates the token,
 * authorizes the integration, decrypts the integration's real secret, injects it as the
 * upstream auth header, forwards to the integration's baseUrl, and streams the response
 * back. The worker uses the integration WITHOUT EVER SEEING the credential.
 *
 * Generalizes the existing src/main/slack.ts `SlackReplyServer` (a loopback broker that
 * posts Slack replies without the agent seeing the bot token) to an N-integration proxy.
 *
 * DEPENDENCY-FREE of electron by design: `getRecord` + `getSecret` are injected, so this
 * module is unit-testable under plain node. The secret is materialized ONLY here, at
 * forward-time, and is NEVER logged, NEVER returned to the worker, NEVER echoed in an
 * error.
 *
 * NOT an open proxy: a worker can only reach baseUrls the user registered (it selects an
 * integration by id, never a host), and the path is confined under the integration
 * origin (see resolveUpstreamUrl).
 *
 * Contract: hive/docs/integrations-spec.md.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConnectionThrottle, HOLD_MAX_MS } from './brokerThrottle';
import {
  type IntegrationRecord,
  buildAuthHeaders,
  resolveUpstreamUrl,
  authTypeNeedsSecret
} from '../shared/integrations';
import {
  BrokerWriteOnce,
  JOURNAL_UNSAVED,
  WRITE_BODY_KEEP,
  WRITE_NOT_SENT,
  WRITE_TOO_LARGE,
  WRITE_UNCERTAIN,
  classifyUpstreamFailure,
  isWriteMethod,
  withQuickBooksRequestId,
  writeOnceIdentity
} from './brokerWriteOnce';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB request-body cap
const UPSTREAM_TIMEOUT_MS = 30_000;
const DEFAULT_USER_AGENT = 'munder-difflin-broker/1';

/** Hop-by-hop headers never forwarded in either direction. */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade'
]);
/** Request headers the worker is NEVER allowed to pass upstream. */
const STRIP_REQUEST = new Set([
  'authorization', 'x-md-broker-token', 'host', 'cookie', 'content-length', ...HOP_BY_HOP
]);
/** Response headers never forwarded back (fetch already decodes the body, so the
 *  upstream content-encoding/length would be wrong). */
const STRIP_RESPONSE = new Set([
  'content-encoding', 'content-length', 'set-cookie', ...HOP_BY_HOP
]);

interface Capability {
  workerId: string;
  /** The agent this token speaks for (team agents); falls back to workerId. */
  agentId?: string;
  allowedIds: Set<string>;
  grantedAt: number;
}

/** Mail route handler (injected; src/main/mail.ts). The broker has already
 *  authenticated the token, so `agentId` is trusted. */
export type MailRouteHandler = (agentId: string, op: string, body: Record<string, unknown>) => Promise<{ status: number; body: Record<string, unknown> }>;

const MAIL_BODY_MAX = 1_000_000;

export interface IntegrationBrokerDeps {
  /** Resolve an integration record by id (injected — the registry). */
  getRecord: (id: string) => IntegrationRecord | undefined;
  /** Decrypt a secret by ref (injected — the secret store). Main-internal. */
  getSecret: (secretRef: string | undefined) => string | undefined;
  /** md-mail tool calls, `POST /mail/<tool>` (docs/designs/multi-mailbox.md). */
  mail?: MailRouteHandler;
  /** App-private send once journal. The desktop app always sets this. Tests
   *  that are not about writes omit it, and those writes keep the old path. */
  journalPath?: string;
  now?: () => number;
  fetchImpl?: typeof fetch;
  upstreamTimeoutMs?: number;
  /** Test seam. Production keeps WRITE_BODY_KEEP. */
  replayBodyMax?: number;
}

/** True for IPv4 loopback (127.0.0.0/8) and IPv6 ::1 (incl. v4-mapped). Mirrors slack.ts. */
function isLoopback(addr: string): boolean {
  const a = addr.replace(/^::ffff:/, '');
  return a === '::1' || a.startsWith('127.');
}

type WriteOutcome =
  | { type: 'error'; status: number; code: string; message: string }
  | { type: 'truncated'; status: number }
  | { type: 'http'; status: number; contentType: string; body: Buffer };

export class IntegrationBroker {
  private server: Server | null = null;
  private port = 0;
  /** When each connected app may be called again (brokerThrottle.ts). */
  private readonly throttle = new ConnectionThrottle();
  private readonly deps: IntegrationBrokerDeps;
  /** token -> capability. In-memory only; NEVER persisted. */
  private readonly byToken = new Map<string, Capability>();
  /** workerId -> token, for revoke. */
  private readonly byWorker = new Map<string, string>();
  /** Send once for connected app writes. Null when no journal path was given. */
  private readonly journal: BrokerWriteOnce | null;
  private readonly fetchImpl: typeof fetch;
  private readonly upstreamTimeoutMs: number;
  private readonly replayBodyMax: number;
  /** Identical writes already in flight, so a second caller waits for the first. */
  private readonly writes = new Map<string, Promise<WriteOutcome>>();

  constructor(deps: IntegrationBrokerDeps) {
    this.deps = deps;
    this.journal = deps.journalPath ? new BrokerWriteOnce(deps.journalPath, deps.now ?? Date.now) : null;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.upstreamTimeoutMs = deps.upstreamTimeoutMs ?? UPSTREAM_TIMEOUT_MS;
    this.replayBodyMax = deps.replayBodyMax ?? WRITE_BODY_KEEP;
  }

  /** Bind a loopback port (0 ⇒ OS-assigned). Resolves the bound port. */
  start(preferredPort = 0): Promise<{ ok: boolean; port?: number; error?: string }> {
    return new Promise((resolve) => {
      if (this.server) { resolve({ ok: true, port: this.port }); return; }
      const server = createServer((req, res) => this.handle(req, res));
      const onError = (e: Error): void => { server.off('listening', onListening); resolve({ ok: false, error: e.message }); };
      const onListening = (): void => {
        server.off('error', onError);
        this.server = server;
        const addr = server.address();
        this.port = addr && typeof addr === 'object' ? addr.port : preferredPort;
        resolve({ ok: true, port: this.port });
      };
      server.once('error', onError);
      server.once('listening', onListening);
      // 127.0.0.1 ONLY — never bound to a routable interface, never tunneled.
      server.listen(preferredPort, '127.0.0.1');
    });
  }

  /** Close the broker. Idempotent and best-effort. Clears all capabilities. */
  stop(): void {
    try { this.server?.close(); } catch { /* noop */ }
    this.server = null;
    this.port = 0;
    this.byToken.clear();
    this.byWorker.clear();
  }

  /** Whether the broker is bound and serving. */
  running(): boolean {
    return !!this.server && this.port > 0;
  }

  /** The base URL workers use (only valid while running). */
  url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Mint a per-worker capability token granting access to `allowedIds`. Any prior
   *  token for this worker is revoked first. The token is a random handle — never a
   *  secret, never persisted. */
  grant(workerId: string, allowedIds: string[], agentId?: string): string {
    this.revoke(workerId);
    const token = randomBytes(32).toString('base64url');
    this.byToken.set(token, { workerId, agentId, allowedIds: new Set(allowedIds), grantedAt: Date.now() });
    this.byWorker.set(workerId, token);
    return token;
  }

  /** Revoke a worker's capability (called on teardown). Idempotent. */
  revoke(workerId: string): void {
    const token = this.byWorker.get(workerId);
    if (token) { this.byToken.delete(token); this.byWorker.delete(workerId); }
  }

  /** Constant-time-ish lookup of a presented token against live capabilities. */
  private resolveCapability(provided: string | undefined): Capability | undefined {
    if (!provided) return undefined;
    const a = Buffer.from(provided);
    for (const [token, cap] of this.byToken) {
      const b = Buffer.from(token);
      if (a.length === b.length && timingSafeEqual(a, b)) return cap;
    }
    return undefined;
  }

  /** A call to an app that is still rate limiting: answered now with when to
   *  try again, so the agent waits instead of retrying blind. */
  private static sendThrottled(res: ServerResponse, label: string, waitMs: number): void {
    const seconds = Math.ceil(waitMs / 1000);
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': String(seconds) });
    res.end(JSON.stringify({ error: `${label} asked the app to slow down. Try again in ${seconds} seconds.`, code: 'rate_limited' }));
  }

  private static sendError(res: ServerResponse, status: number, code: string, message: string): void {
    if (res.headersSent) { try { res.end(); } catch { /* noop */ } return; }
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: message, code }));
  }

  /** Extract the bearer/x-md-broker-token from the request. */
  private static tokenFrom(req: IncomingMessage): string | undefined {
    const x = req.headers['x-md-broker-token'];
    if (typeof x === 'string' && x) return x;
    const auth = req.headers['authorization'];
    if (typeof auth === 'string') {
      const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
      if (m) return m[1].trim();
    }
    return undefined;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    // 1) Loopback — defense in depth even though the bind already excludes others.
    if (!isLoopback(req.socket.remoteAddress ?? '')) {
      return IntegrationBroker.sendError(res, 403, 'forbidden', 'loopback callers only');
    }
    // 2) Capability token.
    const cap = this.resolveCapability(IntegrationBroker.tokenFrom(req));
    if (!cap) return IntegrationBroker.sendError(res, 401, 'unauthorized', 'missing or invalid capability token');

    const rawUrl = req.url ?? '';
    // 3a) Mail tools: POST /mail/<tool> with a JSON body. Access is checked per
    //     call against the agent's Capabilities (mailAccess), not the token's
    //     integration list.
    const mailMatch = /^\/mail\/([a-z_]{1,32})$/.exec(rawUrl);
    if (mailMatch) {
      if (!this.deps.mail) return IntegrationBroker.sendError(res, 404, 'not_found', 'mail is not available');
      if (req.method !== 'POST') return IntegrationBroker.sendError(res, 405, 'method', 'use POST');
      void this.mail(req, res, cap.agentId ?? cap.workerId, mailMatch[1]);
      return;
    }
    // 3) Parse /i/<integrationId>/<path...>.
    const m = /^\/i\/([^/?#]+)(?:\/([^?#]*))?(\?[^#]*)?$/.exec(rawUrl);
    if (!m) return IntegrationBroker.sendError(res, 404, 'not_found', 'expected /i/<integrationId>/<path>');
    let integrationId: string;
    try {
      integrationId = decodeURIComponent(m[1]);
    } catch {
      return IntegrationBroker.sendError(res, 400, 'bad_request', 'invalid integration id encoding');
    }
    const path = m[2] ?? '';
    const query = m[3] ?? '';

    // 4) Authorize against this worker's capability.
    if (!cap.allowedIds.has(integrationId)) {
      return IntegrationBroker.sendError(res, 403, 'forbidden', 'integration not in this worker capability');
    }
    // 5) Resolve the record (still enabled?).
    const rec = this.deps.getRecord(integrationId);
    if (!rec) return IntegrationBroker.sendError(res, 404, 'not_found', 'unknown integration');
    if (!rec.enabled) return IntegrationBroker.sendError(res, 403, 'forbidden', 'integration is disabled');
    // 5b) An app that asked to slow down is not called until its time is up: a
    //     short wait is held here (the call runs again then), a long one is
    //     answered now.
    const wait = this.throttle.waitFor(integrationId);
    if (wait > HOLD_MAX_MS) return IntegrationBroker.sendThrottled(res, rec.label || integrationId, wait);
    if (wait > 0) {
      setTimeout(() => { if (!req.destroyed && !res.writableEnded) this.handle(req, res); }, wait);
      return;
    }

    // 6) Confine the upstream URL under the integration origin (NOT an open proxy).
    const upstream = resolveUpstreamUrl(rec.baseUrl, path + query);
    if (!upstream) return IntegrationBroker.sendError(res, 400, 'bad_request', 'invalid or out-of-bounds path');

    // 7) Secret (decrypted ONLY here, used ONLY to inject the upstream header).
    let secret: string | undefined;
    if (authTypeNeedsSecret(rec.authType)) {
      secret = this.deps.getSecret(rec.secretRef);
      if (!secret) return IntegrationBroker.sendError(res, 503, 'no_secret', 'no secret configured for this integration');
    }

    void this.forward(req, res, rec, upstream, secret, cap.agentId ?? cap.workerId, integrationId, path + query);
  }

  private async mail(req: IncomingMessage, res: ServerResponse, agentId: string, op: string): Promise<void> {
    let raw = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (d: string) => { raw += d; if (raw.length > MAIL_BODY_MAX) { tooBig = true; req.destroy(); } });
    await new Promise<void>((resolve) => { req.on('end', resolve); req.on('close', resolve); req.on('error', resolve); });
    if (tooBig) return IntegrationBroker.sendError(res, 413, 'too_large', 'request too large');
    let body: Record<string, unknown> = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return IntegrationBroker.sendError(res, 400, 'bad_request', 'body must be JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return IntegrationBroker.sendError(res, 400, 'bad_request', 'body must be a JSON object');
    try {
      const out = await this.deps.mail!(agentId, op, body);
      if (res.headersSent) return;
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.body));
    } catch (e) {
      IntegrationBroker.sendError(res, 500, 'mail_error', e instanceof Error ? e.message : String(e));
    }
  }

  private async forward(
    req: IncomingMessage,
    res: ServerResponse,
    rec: IntegrationRecord,
    upstream: URL,
    secret: string | undefined,
    agentId: string,
    integrationId: string,
    pathAndQuery: string
  ): Promise<void> {
    // Buffer the request body with a hard cap (write methods).
    const method = (req.method ?? 'GET').toUpperCase();
    const hasBody = method !== 'GET' && method !== 'HEAD';
    let body: Buffer | undefined;
    if (hasBody) {
      try {
        body = await readBodyCapped(req);
      } catch (e) {
        if ((e as Error).message === 'too_large') {
          return IntegrationBroker.sendError(res, 413, 'payload_too_large', 'request body too large');
        }
        return IntegrationBroker.sendError(res, 400, 'bad_request', 'could not read request body');
      }
    }

    // Sanitize worker headers, then inject the auth header(s). Injected auth ALWAYS
    // wins: the strip list removes any worker-supplied authorization/auth header.
    const outHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const key = k.toLowerCase();
      if (STRIP_REQUEST.has(key)) continue;
      if (Array.isArray(v)) outHeaders[key] = v.join(', ');
      else if (typeof v === 'string') outHeaders[key] = v;
    }
    if (!outHeaders['user-agent']) outHeaders['user-agent'] = DEFAULT_USER_AGENT;
    const injected = buildAuthHeaders(rec.authType, rec.authHeader, secret);
    for (const [k, v] of Object.entries(injected)) {
      delete outHeaders[k]; // ensure the worker can't shadow an injected header
      outHeaders[k] = v;
    }

    if (this.journal && isWriteMethod(method)) {
      await this.forwardWrite(res, upstream, outHeaders, method, body ?? Buffer.alloc(0), agentId, integrationId, pathAndQuery);
      return;
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.upstreamTimeoutMs);
    let upstreamRes: Response;
    try {
      upstreamRes = await this.fetchImpl(upstream, {
        method,
        headers: outHeaders,
        body: body as BodyInit | undefined,
        redirect: 'manual',
        signal: ac.signal
      });
    } catch (e) {
      clearTimeout(timer);
      // The message could in theory contain the URL but never the secret.
      return IntegrationBroker.sendError(res, 502, 'bad_gateway', `upstream request failed: ${(e as Error).message}`);
    }
    this.throttle.note(rec.id, upstreamRes.status, upstreamRes.headers);

    // Stream the response back (status + sanitized headers + body).
    const respHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((value, key) => {
      if (!STRIP_RESPONSE.has(key.toLowerCase())) respHeaders[key] = value;
    });
    res.writeHead(upstreamRes.status, respHeaders);
    try {
      if (upstreamRes.body) {
        await pipeWebStream(upstreamRes.body, res);
      } else {
        res.end();
      }
    } catch {
      // The status is already sent and the body has no length, so a clean end
      // would read to the agent as a whole answer. Drop the connection instead.
      res.destroy();
    } finally {
      clearTimeout(timer);
    }
  }

  /** One identical write is sent once. The first caller is answered from the
   *  upstream stream. A later caller, including one after a restart, is
   *  answered from the journal. */
  private async forwardWrite(
    res: ServerResponse,
    upstream: URL,
    headers: Record<string, string>,
    method: string,
    body: Buffer,
    agentId: string,
    integrationId: string,
    pathAndQuery: string
  ): Promise<void> {
    const journal = this.journal;
    if (!journal) return;
    const identity = writeOnceIdentity({ agentId, integrationId, method, pathAndQuery, body });
    const running = this.writes.get(identity.storageKey);
    if (running) {
      this.deliver(res, await running);
      return;
    }
    const looked = journal.lookup(identity.storageKey);
    if (looked.kind === 'uncertain') {
      this.deliver(res, { type: 'error', status: 409, code: 'may_have_applied', message: WRITE_UNCERTAIN });
      return;
    }
    if (looked.kind === 'replay') {
      this.deliver(res, { type: 'http', status: looked.status, contentType: looked.contentType, body: looked.body });
      return;
    }
    if (looked.kind === 'truncated') {
      this.deliver(res, { type: 'truncated', status: looked.status });
      return;
    }
    if (!journal.begin(identity.storageKey, identity.idempotencyKey)) {
      this.deliver(res, { type: 'error', status: 503, code: 'write_record', message: JOURNAL_UNSAVED });
      return;
    }

    // Our key wins. A worker supplied one would change on every retry, and the
    // provider would treat those as different writes.
    delete headers['idempotency-key'];
    headers['idempotency-key'] = identity.idempotencyKey;
    const target = withQuickBooksRequestId(upstream, identity.idempotencyKey);
    const attempt = this.executeWrite(res, target, headers, method, body, identity.storageKey, integrationId);
    this.writes.set(identity.storageKey, attempt);
    try {
      await attempt;
    } finally {
      this.writes.delete(identity.storageKey);
    }
  }

  private async executeWrite(
    res: ServerResponse,
    upstream: URL,
    headers: Record<string, string>,
    method: string,
    body: Buffer,
    storageKey: string,
    integrationId: string
  ): Promise<WriteOutcome> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.upstreamTimeoutMs);
    try {
      let upstreamRes: Response;
      try {
        upstreamRes = await this.fetchImpl(upstream, {
          method,
          headers,
          body: body as BodyInit,
          redirect: 'manual',
          signal: ac.signal
        });
      } catch (e) {
        return this.failWrite(res, storageKey, e);
      }
      // A rate limit on a write pushes the app's next call back, as for a read.
      this.throttle.note(integrationId, upstreamRes.status, upstreamRes.headers);
      return await this.relayWrite(res, upstreamRes, storageKey);
    } finally {
      clearTimeout(timer);
    }
  }

  /** The first caller gets the real stream, including an answer too large to
   *  keep. The journal keeps a small answer so a retry can be given it whole. */
  private async relayWrite(res: ServerResponse, upstreamRes: Response, storageKey: string): Promise<WriteOutcome> {
    const status = upstreamRes.status;
    const contentType = upstreamRes.headers.get('content-type') ?? 'application/octet-stream';
    const respHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((value, key) => {
      if (!STRIP_RESPONSE.has(key.toLowerCase())) respHeaders[key] = value;
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    try {
      if (!res.headersSent) res.writeHead(status, respHeaders);
      if (upstreamRes.body) {
        const node = Readable.fromWeb(upstreamRes.body as Parameters<typeof Readable.fromWeb>[0]);
        for await (const chunk of node) {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (!truncated) {
            size += buf.length;
            if (size > this.replayBodyMax) {
              truncated = true;
              chunks.length = 0;
            } else {
              chunks.push(buf);
            }
          }
          if (!res.writableEnded) {
            try {
              if (!res.write(buf)) await waitForDrain(res);
            } catch {
              truncated = true;
              chunks.length = 0;
              node.destroy();
              break;
            }
          }
        }
      }
      if (!res.writableEnded) res.end();
    } catch {
      truncated = true;
      chunks.length = 0;
      // The status is already sent and the body has no length, so a clean end
      // would read to the agent as a whole answer. Drop the connection instead.
      res.destroy();
    }
    const kept = truncated ? undefined : Buffer.concat(chunks);
    // Only a write that worked is kept. A refusal, a rate limit or a server
    // error may go again; the same key goes up, so the service can still dedupe.
    if (status >= 200 && status < 300) this.journal?.settle(storageKey, status, contentType, kept, truncated);
    else this.journal?.forget(storageKey);
    if (truncated) return { type: 'truncated', status };
    return { type: 'http', status, contentType, body: kept ?? Buffer.alloc(0) };
  }

  private failWrite(res: ServerResponse, storageKey: string, e: unknown): WriteOutcome {
    const kind = classifyUpstreamFailure(e);
    console.error('[broker] write failed:', kind, e instanceof Error ? e.message : String(e));
    let outcome: WriteOutcome;
    if (kind === 'never' && this.journal?.forget(storageKey)) {
      outcome = { type: 'error', status: 502, code: 'bad_gateway', message: WRITE_NOT_SENT };
    } else {
      outcome = { type: 'error', status: 409, code: 'may_have_applied', message: WRITE_UNCERTAIN };
    }
    this.deliver(res, outcome);
    return outcome;
  }

  private deliver(res: ServerResponse, outcome: WriteOutcome): void {
    if (res.headersSent || res.writableEnded) return;
    if (outcome.type === 'error') {
      IntegrationBroker.sendError(res, outcome.status, outcome.code, outcome.message);
      return;
    }
    if (outcome.type === 'truncated') {
      // The real answer was too large to keep. A success status with a stand-in
      // body would look like the created invoice, so this is a refusal instead.
      res.writeHead(409, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ code: 'already_applied', error: WRITE_TOO_LARGE }));
      return;
    }
    res.writeHead(outcome.status, { 'content-type': outcome.contentType });
    res.end(outcome.body);
  }
}

/** Wait until the caller can take more bytes, or until they go away. */
function waitForDrain(res: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = (err?: Error): void => {
      res.off('drain', onDrain);
      res.off('close', onClose);
      res.off('error', onError);
      if (err) reject(err);
      else resolve();
    };
    const onDrain = (): void => finish();
    const onClose = (): void => finish();
    const onError = (err: Error): void => finish(err);
    res.once('drain', onDrain);
    res.once('close', onClose);
    res.once('error', onError);
  });
}

/** Read a request body into a Buffer, aborting past MAX_BODY_BYTES (throws 'too_large'). */
function readBodyCapped(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (e) => reject(e));
  });
}

/** Pipe a web ReadableStream (fetch response body) to a node ServerResponse. */
function pipeWebStream(web: ReadableStream<Uint8Array>, res: ServerResponse): Promise<void> {
  return new Promise((resolve, reject) => {
    const node = Readable.fromWeb(web as Parameters<typeof Readable.fromWeb>[0]);
    node.on('error', reject);
    res.on('error', reject);
    res.on('finish', resolve);
    node.pipe(res);
  });
}
