/**
 * Per-project session-pointer file under `~/.agentcore/identity-sessions/`.
 *
 * Stores ONLY a pointer — never raw OAuth tokens. The actual access /
 * refresh tokens live server-side in AgentCore Identity's vault and are
 * never returned to the CLI. The session pointer records:
 *
 *   - the developer principal (workload identity ARN, if known)
 *   - which (gateway, target) bindings have been consented to and when
 *
 * The file path is keyed on the project's absolute path so two checkouts
 * of the same project don't collide. The key is sha256(absPath).slice(0, 16)
 * for compactness.
 */
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

function sessionsDir(): string {
  return join(homedir(), '.agentcore', 'identity-sessions');
}

export interface ConsentRecord {
  gatewayName: string;
  targetName: string;
  /** ISO 8601 timestamp of the most recent successful consent. */
  lastConsentedAt: string;
  /** Optional: the strategy used for the last consent (browserLoopback / headlessPasteUrl). */
  strategy?: string;
}

/**
 * Bumped whenever the on-disk shape of `SessionPointer` changes in a way
 * that requires a reader to behave differently. Readers tolerant of older
 * shapes can compare `schemaVersion`; readers that can't migrate should
 * refuse to interpret an unknown future version rather than guess.
 */
export const SESSION_POINTER_SCHEMA_VERSION = 1;

export interface SessionPointer {
  /** On-disk schema version. See `SESSION_POINTER_SCHEMA_VERSION`. */
  schemaVersion?: number;
  /** Absolute project path (used for human-readable identification, not lookup). */
  projectPath: string;
  /** sha256(projectPath).slice(0, 16) — same value used to compute the file path. */
  projectIdentifier: string;
  /** When known: the workload-identity principal that completed consent. */
  principal?: string;
  /** Per-target consent records. Keyed by `${gatewayName}/${targetName}`. */
  consents: Record<string, ConsentRecord>;
}

/**
 * Canonicalize a project path so two checkouts reached via different
 * symlinks don't get different identifiers (e.g. macOS `/var → /private/var`,
 * NFS mounts, hand-crafted dev symlinks). Falls back to plain `resolve` if
 * the path doesn't exist on disk yet (still gives a stable hash).
 */
function canonicalProjectPath(projectAbsPath: string): string {
  const resolved = resolve(projectAbsPath);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export function getProjectIdentifier(projectAbsPath: string): string {
  // 32 hex chars = 128 bits of identifier space (birthday-paradox-safe far
  // beyond any realistic project count). The trailing 32 chars are dropped
  // for a 32-char filename; the leading 32 are sufficient for collision
  // resistance.
  return createHash('sha256').update(canonicalProjectPath(projectAbsPath)).digest('hex').slice(0, 32);
}

export function sessionPointerPath(projectAbsPath: string): string {
  return join(sessionsDir(), `${getProjectIdentifier(projectAbsPath)}.json`);
}

export function readSessionPointer(projectAbsPath: string): SessionPointer | undefined {
  const path = sessionPointerPath(projectAbsPath);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as SessionPointer;

    // Collision / mismatch detection: the file's stored projectPath should
    // canonicalize to the same path the caller asked about. If it doesn't,
    // we've either hit a sha256 collision (vanishingly unlikely at 128 bits)
    // or the on-disk file was authored from a different filesystem layout
    // (e.g. an NFS path that resolved differently when the file was written).
    // Refuse to return a pointer that does not match — recording fresh
    // consent for this caller is safer than silently treating someone
    // else's consent record as our own.
    const expectedCanonical = canonicalProjectPath(projectAbsPath);
    if (parsed.projectPath && parsed.projectPath !== expectedCanonical) {
      return undefined;
    }
    // A future-versioned file we don't understand should be treated as
    // missing for this reader rather than partially interpreted.
    if (parsed.schemaVersion !== undefined && parsed.schemaVersion > SESSION_POINTER_SCHEMA_VERSION) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

export function writeSessionPointer(pointer: SessionPointer): void {
  mkdirSync(sessionsDir(), { recursive: true });
  const path = sessionPointerPath(pointer.projectPath);
  const stamped: SessionPointer = { schemaVersion: SESSION_POINTER_SCHEMA_VERSION, ...pointer };
  writeFileSync(path, JSON.stringify(stamped, null, 2), { mode: 0o600 });
  // `writeFileSync` only honors `mode` on creation. If the file already
  // exists with looser permissions (e.g. a pre-fix file at 0644), tighten
  // it explicitly on every write.
  chmodSync(path, 0o600);
}

/**
 * Record that consent was successfully completed for a (gateway, target)
 * binding in the given project. Creates the pointer file if missing,
 * updates it otherwise.
 */
export function recordConsent(args: {
  projectAbsPath: string;
  gatewayName: string;
  targetName: string;
  principal?: string;
  strategy?: string;
  now?: () => Date;
}): SessionPointer {
  const projectPath = canonicalProjectPath(args.projectAbsPath);
  const projectIdentifier = getProjectIdentifier(projectPath);
  const existing = readSessionPointer(projectPath) ?? {
    projectPath,
    projectIdentifier,
    consents: {} as Record<string, ConsentRecord>,
  };

  const key = `${args.gatewayName}/${args.targetName}`;
  existing.projectPath = projectPath;
  existing.projectIdentifier = projectIdentifier;
  if (args.principal) existing.principal = args.principal;
  existing.consents[key] = {
    gatewayName: args.gatewayName,
    targetName: args.targetName,
    lastConsentedAt: (args.now ?? (() => new Date()))().toISOString(),
    ...(args.strategy ? { strategy: args.strategy } : {}),
  };

  writeSessionPointer(existing);
  return existing;
}

export function getConsentRecord(
  projectAbsPath: string,
  gatewayName: string,
  targetName: string
): ConsentRecord | undefined {
  return readSessionPointer(projectAbsPath)?.consents?.[`${gatewayName}/${targetName}`];
}
