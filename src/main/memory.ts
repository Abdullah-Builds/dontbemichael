/**
 * MemoryManager — search by meaning over COMPANY KNOWLEDGE, backed by the
 * MemPalace CLI.
 *
 * Each team member's memory is private to it (owner, 2026-10-16): no member,
 * Michael included, searches or reads another's notes; they ask the member.
 * So the palace under harnessHome holds one section, `company`, mined from the
 * company knowledge store's mirror; members' notes are never mined into it.
 * The palace must stay writable for members' searches to open it, so each pass
 * checks that nothing else was filed there and, if something was (or members'
 * notes from before this rule are still there), clears it and indexes company
 * knowledge again. Degrades silently to no-op when `mempalace` isn't installed.
 *
 *   store   : mempalace mine <company mirror> --wing company --agent company
 *   check   : mempalace status (the sections filed)
 *   recall  : mempalace search "<q>" --wing company
 *
 * Runs in the Electron main process.
 */
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { privateRoot } from '../shared/agentPrivatePaths';
import { spawn, spawnSync } from 'node:child_process';
import { ensureKilled } from './procKill';
import { quarantineDirsToReap, quarantineStampMs, nextMineDelayMs } from './palaceReap';

export type EmbeddingModel = 'minilm' | 'embeddinggemma';

export interface MemorySettings {
  enabled: boolean;
  model: EmbeddingModel;
}

export interface MemoryStatus {
  available: boolean;        // mempalace CLI found on PATH
  enabled: boolean;          // user setting
  active: boolean;           // available && enabled && have a home
  initialized: boolean;      // palace directory exists
  palacePath: string | null;
  model: EmbeddingModel;
  bin: string | null;
}

// Check and re-index every 10 min, up from 3.
//
// Every `mempalace mine` opens the palace, and every open runs MemPalace's
// quarantine gate — which on a palace stuck in the rename loop means another
// full-size copy of the segment left on disk. The gate is not ours to fix, but
// how often we invoke it is. Mining is already skipped for agents whose
// memory.md has not changed, so this only affects an agent editing its notes
// repeatedly: its changes are batched into one mine instead of three. A memory
// written now is searchable within ten minutes rather than three, which no one
// is waiting on. `reapPalace` handles the copies that still get made.
const MINE_INTERVAL_MS = 600_000;
// Ceiling for the quarantine backoff below. Low on purpose: a memory is not
// searchable until it has been mined, and the reaper already handles the disk,
// so there is nothing here worth making recall half an hour stale for.
const MINE_BACKOFF_MAX_MS = 1_800_000;
const MINE_TIMEOUT_MS = 10 * 60_000; // hard cap per mine (first run downloads the embedding model)
/** mempalace's device "auto" picks the CoreML execution provider on Apple
 *  Silicon, and CoreML runs the quantized embeddinggemma ONNX graph partially
 *  (330/1647 nodes) with fp16 partitions that overflow → EVERY vector comes
 *  back NaN and chroma rejects every upsert ("Embeddings must not contain NaN
 *  or Infinity values"), so no memory ever gets indexed. Reproduced + verified
 *  2026-08-16: same input is NaN under CoreMLExecutionProvider and clean under
 *  CPU. Pin cpu for BOTH the mine loop and the agents' own `mempalace search`
 *  (a query embedded to NaN breaks recall the same way).
 *
 *  Scope, deliberately macOS-WIDE rather than per-model: the pin costs the
 *  other model nothing. minilm rides chromadb's ONNXMiniLM_L6_V2, whose model
 *  build UNCONDITIONALLY removes CoreMLExecutionProvider ("not as well
 *  optimized as CPU" — chromadb's words), so minilm never runs on CoreML with
 *  or without this pin; embeddinggemma (mempalace's own ONNX class, no such
 *  pruning) is the only path that would reach CoreML, and that path is the NaN
 *  bug. Other platforms keep mempalace's own default ("auto").
 *
 *  A user's OWN device choice wins: if MEMPALACE_EMBEDDING_DEVICE is already
 *  exported we emit nothing, so the inherited value flows through untouched —
 *  which also leaves a one-command way to reproduce the NaN behaviour
 *  (`MEMPALACE_EMBEDDING_DEVICE=coreml`). Exported as a function of
 *  (platform, envOverride) so every branch is reachable from a test on any
 *  platform — same trick as `buildMissingCliScript`. */
export function mempalaceDevice(
  platform: NodeJS.Platform,
  envOverride: string | undefined
): string | undefined {
  if (envOverride) return undefined; // explicit user choice — never override
  return platform === 'darwin' ? 'cpu' : undefined;
}
const MEMPALACE_DEVICE = mempalaceDevice(process.platform, process.env.MEMPALACE_EMBEDDING_DEVICE);

export class MemoryManager {
  private binCache: string | null | undefined;
  private mineTimer: NodeJS.Timeout | null = null;
  private mineStopped = false;
  /** Current gap between mine passes. Widens while the palace is quarantining. */
  private mineDelayMs = MINE_INTERVAL_MS;
  /** Newest quarantine stamp seen so far, so a LATER one means the palace
   *  quarantined again. A count would be useless: the reaper deletes them. */
  private lastQuarantineTs = 0;
  private initStarted = false;
  /** True while a mineNow() pass is in flight — serializes palace writers. */
  private mining = false;

  /** The company knowledge mirror last indexed, by its document set, so an
   *  unchanged store isn't indexed again (see indexCompanyKnowledge). */
  private companySignature: string | null = null;
  /** Company knowledge changed while a pass was running: run another after it. */
  private companyPending = false;
  /** The search language changed: clear the palace on the next pass. */
  private rebuildPending = false;

  constructor(
    private getHome: () => string | null,
    private getSettings: () => MemorySettings,
    /** Company knowledge's mirror folder for searching by meaning
     *  (KnowledgeManager.meaningMirror), or null when it is off. */
    private getCompanyKnowledge?: () => { dir: string; signature: string } | null
  ) {}

  /** The palace section company knowledge is indexed into. */
  static readonly COMPANY_WING = 'company';

  palacePath(): string | null {
    const h = this.getHome();
    return h ? join(h, 'palace') : null;
  }

  /** Resolve the mempalace CLI against the user's PATH + common uv/pip spots. */
  bin(): string | null {
    if (this.binCache !== undefined) return this.binCache;
    let found: string | null = null;
    const isWin = process.platform === 'win32';
    // 1) Ask the shell/PATH resolver. Windows has no POSIX shell + uses `where`
    //    and a `.exe` suffix; everything else goes through the login shell.
    try {
      if (isWin) {
        const res = spawnSync('where', ['mempalace'], { encoding: 'utf8', timeout: 3000 });
        const p = res.stdout.trim().split(/\r?\n/)[0]?.trim();
        if (p && existsSync(p)) found = p;
      } else {
        const res = spawnSync(process.env.SHELL ?? '/bin/zsh', ['-ilc', 'which mempalace'], {
          encoding: 'utf8', timeout: 3000
        });
        const p = res.stdout.trim().split('\n').pop();
        if (p && existsSync(p)) found = p;
      }
    } catch { /* fall through */ }
    // 2) Probe common install locations (uv tool / homebrew / pip).
    if (!found) {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
      const candidates = isWin
        ? [
            join(home, '.local', 'bin', 'mempalace.exe'),
            join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python', 'Scripts', 'mempalace.exe')
          ]
        : [
            `${home}/.local/bin/mempalace`,
            '/opt/homebrew/bin/mempalace',
            '/usr/local/bin/mempalace'
          ];
      for (const c of candidates) if (c && existsSync(c)) { found = c; break; }
    }
    this.binCache = found;
    return found;
  }
  /** Force re-resolution (e.g. after the user installs mempalace). */
  resetBinCache(): void { this.binCache = undefined; }

  available(): boolean { return this.bin() !== null; }
  enabled(): boolean { return this.getSettings().enabled; }
  active(): boolean { return this.available() && this.enabled() && this.getHome() !== null; }
  model(): EmbeddingModel { return this.getSettings().model === 'embeddinggemma' ? 'embeddinggemma' : 'minilm'; }

  status(): MemoryStatus {
    const palace = this.palacePath();
    return {
      available: this.available(),
      enabled: this.enabled(),
      active: this.active(),
      initialized: !!palace && existsSync(palace),
      palacePath: palace,
      model: this.model(),
      bin: this.bin()
    };
  }

  /** Env merged into each agent's spawn so its `mempalace` CLI finds company knowledge. */
  env(): Record<string, string> {
    const palace = this.palacePath();
    if (!this.active() || !palace) return {};
    return {
      MEMPALACE_PALACE_PATH: palace,
      MEMPALACE_EMBEDDING_MODEL: this.model(),
      ...(MEMPALACE_DEVICE ? { MEMPALACE_EMBEDDING_DEVICE: MEMPALACE_DEVICE } : {})
    };
  }

  private childEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      MEMPALACE_PALACE_PATH: this.palacePath() ?? '',
      MEMPALACE_EMBEDDING_MODEL: this.model(),
      ...(MEMPALACE_DEVICE ? { MEMPALACE_EMBEDDING_DEVICE: MEMPALACE_DEVICE } : {})
    };
  }

  // — lifecycle —

  /** Start the mine loop. `mempalace mine` auto-creates the palace on first run
   *  (lazily downloading the embedding model, one-time). We deliberately do NOT
   *  run `mempalace init`: it ends in an interactive "Mine now? [Y/n]" prompt
   *  that --yes doesn't cover, so a spawned child would hang forever. */
  start(): void {
    if (!this.active() || this.initStarted) return;
    if (!this.bin() || !this.getHome() || !this.palacePath()) return;
    this.initStarted = true;
    // Sweep once at boot, before the first mine. An app updating into this fix
    // arrives at a palace that has been accumulating copies for as long as it
    // has been running — 357 of them here — and waiting for the first agent to
    // edit its memory.md would leave all of that on disk for an arbitrary
    // while. This is the pass that makes the existing pile go away by itself.
    this.reapPalace();
    this.startMineLoop();
  }

  stop(): void {
    this.mineStopped = true;
    if (this.mineTimer) { clearTimeout(this.mineTimer); this.mineTimer = null; }
  }

  /**
   * Re-resolve the CLI, arm the mine loop if it is only now possible, and report.
   *
   * `start()` runs once at boot and bails when mempalace isn't on PATH yet. If the
   * user installs it AFTER that — the common case, since the settings panel is
   * where they find out they need it — nothing re-invoked `start()`, so the mine
   * loop never ran. The palace is created by the first `mempalace mine`, so it
   * never appeared either, and `initialized` (existsSync(palace)) stayed false
   * while `available` flipped true: the status pill read "On — getting ready…"
   * forever and only an app restart cleared it.
   *
   * The status poll is the one thing that reliably notices the install, so it is
   * where the re-arm belongs. `start()` is idempotent (initStarted), so repeated
   * polls never start a second loop — and it still deliberately does NOT run
   * `mempalace init`, which ends in an interactive "Mine now? [Y/n]" that `--yes`
   * doesn't cover and that hangs a spawned child.
   */
  refresh(): MemoryStatus {
    this.resetBinCache();
    this.start();
    return this.status();
  }

  /** Self-scheduling rather than `setInterval`, so the gap can widen when the
   *  palace is quarantining and snap back the moment it stops. */
  private startMineLoop(): void {
    if (this.mineTimer) return;
    const tick = () => {
      void this.mineNow().finally(() => {
        if (this.mineStopped) return;
        this.mineTimer = setTimeout(tick, this.mineDelayMs);
        this.mineTimer.unref?.();
      });
    };
    // Armed synchronously. `mineTimer` is the "is the loop running" signal that
    // `refresh()` reports on right after `start()`, and setting it only once the
    // first mine resolves would report the loop as dead for a whole pass —
    // which is exactly the re-arm-after-install case that has its own test.
    this.mineTimer = setTimeout(tick, 0);
    this.mineTimer.unref?.();
  }

  // — mining (store) —

  /** One pass: keep the palace to company knowledge, then index company
   *  knowledge if it changed. The palace permits a single writer, so passes are
   *  serialized; `mining` guards against a slow pass overlapping the next tick. */
  async mineNow(): Promise<void> {
    const home = this.getHome();
    const bin = this.bin();
    if (!this.active() || !home || !bin) return;
    if (this.mining) return; // a previous pass is still running; let it finish
    this.mining = true;
    try {
      if (this.rebuildPending) this.rebuild();
      await this.keepCompanyOnly();
      await this.indexCompanyKnowledge();
    } finally {
      this.mining = false;
    }
    if (this.companyPending) {
      this.companyPending = false;
      void this.mineNow();
    }
    // Every pass above may have left another copy behind, and whether it did
    // decides how long we wait before the next one.
    const quarantined = this.reapPalace();
    this.mineDelayMs = nextMineDelayMs(
      this.mineDelayMs, MINE_INTERVAL_MS, MINE_BACKOFF_MAX_MS, quarantined
    );
  }

  /** Members' notes are theirs alone (owner, 2026-10-16). If the palace holds
   *  any section but company knowledge (members' notes mined before this rule,
   *  or something a member filed with its own `mempalace mine`), it is cleared
   *  and company knowledge is indexed again on this pass. Research's cleaned
   *  copy of its notes, kept for that old mining, goes too. */
  private async keepCompanyOnly(): Promise<void> {
    const home = this.getHome();
    const palace = this.palacePath();
    if (home) { try { rmSync(join(privateRoot(home), 'research-mined'), { recursive: true, force: true }); } catch { /* next pass */ } }
    if (!palace || !existsSync(palace)) return;
    const status = await this.runCli(['status'], 'status');
    if (!status.ok) return;
    const others = otherWings(status.output, MemoryManager.COMPANY_WING);
    if (!others.length) return;
    try {
      rmSync(palace, { recursive: true, force: true });
      this.companySignature = null; // index company knowledge again now
      console.log(`[memory] cleared ${others.length} section(s) that were not company knowledge`);
    } catch { /* locked: next pass */ }
  }

  /**
   * Delete quarantined segment copies MemPalace renamed aside and never removed.
   *
   * Safe to delete: the rename is precisely what takes them OUT of the palace's
   * live set, and Chroma has already rebuilt by the time we see one. They are
   * diagnostic residue. `quarantineDirsToReap` keeps the newest couple so there
   * is still something to look at, and refuses to touch anything recent enough
   * to still be mid-recovery.
   *
   * Best-effort throughout. A palace we cannot read, or a directory we cannot
   * remove, must never take down the mine loop — this is disk hygiene, not a
   * correctness path.
   */
  private reapPalace(): boolean {
    const palace = this.palacePath();
    if (!palace || !existsSync(palace)) return false;
    let names: string[];
    try { names = readdirSync(palace); } catch { return false; }

    let newest = 0;
    for (const name of names) {
      const ts = quarantineStampMs(name);
      if (ts !== null && ts > newest) newest = ts;
    }
    // The boot sweep runs before the first mine precisely so it can seed this:
    // otherwise a palace that arrives with a backlog would read as "just
    // quarantined" and back the loop off before it has mined anything.
    const fresh = this.lastQuarantineTs > 0 && newest > this.lastQuarantineTs;
    if (newest > this.lastQuarantineTs) this.lastQuarantineTs = newest;

    const doomed = quarantineDirsToReap(names.map((name) => ({ name })), Date.now());
    if (!doomed.length) return fresh;
    let removed = 0;
    for (const name of doomed) {
      try { rmSync(join(palace, name), { recursive: true, force: true }); removed += 1; }
      catch { /* locked, gone, or not ours — leave it and try again next pass */ }
    }
    if (removed) console.log(`[memory] reaped ${removed} quarantined palace segment(s)`);
    return fresh;
  }

  /**
   * Index company knowledge for searching by meaning (owner, 2026-09-25):
   * mine the store's mirror into the "company" section, then prune documents
   * the owner removed. Runs inside mineNow's single-writer pass. Skipped while
   * the set of documents is unchanged.
   */
  private async indexCompanyKnowledge(): Promise<void> {
    const src = this.getCompanyKnowledge?.();
    if (!src || src.signature === this.companySignature) return;
    const wing = MemoryManager.COMPANY_WING;
    // The mine gets the same generous ceiling as an agent's: a first run may
    // download the embedding model, and a big document takes a while to embed.
    const mined = await this.runCli(['mine', src.dir, '--wing', wing, '--agent', wing], 'mine company', MINE_TIMEOUT_MS);
    const synced = await this.runCli(['sync', '--wing', wing, '--apply', src.dir], 'sync company');
    if (mined.ok && synced.ok) this.companySignature = src.signature;
  }

  /**
   * The search language changed (Settings). MemPalace records which model
   * built each section and refuses a search with another, so the palace is
   * cleared and company knowledge indexed again with the new one. While off
   * or not installed, the rebuild waits for the next pass that runs.
   */
  modelChanged(): void {
    this.rebuildPending = true;
    if (this.mining) { this.companyPending = true; return; } // one follow up pass rebuilds
    void this.mineNow();
  }

  /** Clear the palace so the next index builds it with the current model. */
  private rebuild(): void {
    const palace = this.palacePath();
    this.rebuildPending = false;
    this.companySignature = null;
    if (!palace || !existsSync(palace)) return;
    try {
      rmSync(palace, { recursive: true, force: true });
      console.log(`[memory] cleared the index to build it with ${this.model()}`);
    } catch { this.rebuildPending = true; /* locked: next pass */ }
  }

  /** Index company knowledge now, after the owner added or removed a
   *  document, rather than at the next timed pass. */
  companyKnowledgeChanged(): void {
    if (this.mining) { this.companyPending = true; return; }
    void this.mineNow();
  }

  // — recall (read) —

  /** Run one mempalace read command asynchronously. These used to be spawnSync
   *  with a 120s timeout — on a cold model load that BLOCKED the Electron main
   *  process (renderer IPC, timers, every window) for up to two minutes. Same
   *  contract, but the event loop keeps breathing and a wedged CLI is swept. */
  private runCli(args: string[], label: string, timeoutMs = 120_000): Promise<{ ok: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      const bin = this.bin();
      if (!this.active() || !bin) { resolve({ ok: false, output: '', error: 'semantic memory not active' }); return; }
      let proc: ReturnType<typeof spawn>;
      try {
        proc = spawn(bin, args, { env: this.childEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        resolve({ ok: false, output: '', error: e instanceof Error ? e.message : String(e) });
        return;
      }
      let out = '', err = '';
      let settled = false;
      const settle = (r: { ok: boolean; output: string; error?: string }): void => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(r); }
      };
      proc.stdout?.setEncoding('utf8');
      proc.stderr?.setEncoding('utf8');
      proc.stdout?.on('data', (d: string) => { out += d; });
      proc.stderr?.on('data', (d: string) => { err += d; });
      const timer = setTimeout(() => {
        try { proc.kill('SIGTERM'); } catch { /* gone */ }
        ensureKilled(proc.pid);
        settle({ ok: false, output: out, error: `${label} timed out` });
      }, timeoutMs);
      timer.unref?.();
      proc.on('close', (code) => {
        if (code !== 0) settle({ ok: false, output: out, error: (err || `${label} failed`).trim() });
        else settle({ ok: true, output: out });
      });
      proc.on('error', (e) => settle({ ok: false, output: '', error: e.message }));
    });
  }

  /** Session-start digest (~600-900 tokens). */
  wakeUp(wing?: string): Promise<{ ok: boolean; output: string; error?: string }> {
    const args = ['wake-up'];
    if (wing) args.push('--wing', wing);
    return this.runCli(args, 'wake-up');
  }
}

/** The sections `mempalace status` lists, other than `keep`. */
export function otherWings(statusOutput: string, keep: string): string[] {
  const wings = [...String(statusOutput ?? '').matchAll(/^\s*WING:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  return Array.from(new Set(wings.filter((w) => w !== keep)));
}
