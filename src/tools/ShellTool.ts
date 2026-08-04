import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { CommandRegistry } from "../services/shell/CommandRegistry.js";

const execFileAsync = promisify(execFile);

/**
 * Result of a shell command execution.
 */
export interface ShellResult {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  command?: string;
  args?: string[];
  exitCode?: number;
  durationMs?: number;
  error?: string;
  timedOut?: boolean;
}

/**
 * ShellTool — Sandboxed shell command execution.
 *
 * Executes whitelisted commands using `execFile` (not `exec`) to avoid
 * shell parsing and command injection. Each command and its arguments
 * are validated against a `CommandRegistry` whitelist before execution.
 *
 * Security measures:
 * - `execFile` instead of `exec` — no shell string parsing
 * - Command + argument whitelist via `CommandRegistry`
 * - Working directory locked to `cwd`
 * - `AbortController` + timeout (default 30s)
 * - Output size limit via `maxBuffer` (default 1MB)
 *
 * Ported from the C# CPAHelper ShellTool's sandbox approach.
 */
export class ShellTool {
  private readonly registry: CommandRegistry;
  private readonly cwd: string;
  private readonly defaultTimeout: number;
  private readonly maxBuffer: number;

  /**
   * @param cwd - Working directory for command execution (locked).
   * @param registry - Command registry (creates default if not provided).
   * @param defaultTimeout - Default timeout in ms (default: 30000).
   * @param maxBuffer - Max output size in bytes (default: 1MB).
   */
  constructor(
    cwd: string,
    registry?: CommandRegistry,
    defaultTimeout: number = 30000,
    maxBuffer: number = 1024 * 1024,
  ) {
    if (!cwd) {
      throw new Error("Working directory cannot be null or empty.");
    }
    this.cwd = cwd;
    this.registry = registry ?? new CommandRegistry();
    this.defaultTimeout = defaultTimeout;
    this.maxBuffer = maxBuffer;
  }

  /**
   * Get the command registry instance.
   */
  getRegistry(): CommandRegistry {
    return this.registry;
  }

  /**
   * List all allowed commands.
   */
  listAllowedCommands(): string[] {
    return this.registry.listCommands();
  }

  /**
   * Execute a shell command in the sandbox.
   *
   * Steps:
   * 1. Validate the command and arguments against the whitelist.
   * 2. Validate path arguments are contained within the sandbox directory.
   * 3. Determine the timeout (command-specific or default).
   * 4. Execute via `execFile` (no shell parsing).
   * 5. Return structured result with stdout, stderr, exit code, and timing.
   *
   * @param command - The command name (must be in the whitelist).
   * @param args - Arguments to pass to the command.
   * @returns Execution result.
   */
  async execute(command: string, args: string[]): Promise<ShellResult> {
    const startTime = Date.now();

    // 1. Validate command and arguments
    const validation = this.registry.validate(command, args);
    if (!validation.ok || !validation.validatedArgs) {
      return {
        ok: false,
        command,
        args,
        error: validation.error,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. Validate path arguments are contained within cwd sandbox
    const pathError = this.checkPathContainment(
      validation.command!,
      validation.positionalArgs ?? [],
    );
    if (pathError) {
      return {
        ok: false,
        command,
        args,
        error: pathError,
        durationMs: Date.now() - startTime,
      };
    }

    const validatedArgs = validation.validatedArgs;
    const spec = this.registry.getSpec(command)!;
    const timeout = spec.timeout ?? this.defaultTimeout;

    // 2. Execute via execFile (no shell parsing, no injection risk)
    try {
      const { stdout, stderr } = await execFileAsync(command, validatedArgs, {
        cwd: this.cwd,
        timeout,
        maxBuffer: this.maxBuffer,
        windowsHide: true,
        shell: false, // Explicitly disable shell
      });

      return {
        ok: true,
        stdout,
        stderr,
        command,
        args: validatedArgs,
        exitCode: 0,
        durationMs: Date.now() - startTime,
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;

      // Timeout
      if (err.killed === true || err.signal === "SIGTERM") {
        return {
          ok: false,
          command,
          args: validatedArgs,
          error: `Command timed out after ${timeout}ms`,
          timedOut: true,
          exitCode: err.code,
          stdout: err.stdout,
          stderr: err.stderr,
          durationMs,
        };
      }

      // Non-zero exit code (command ran but returned an error)
      if (err.code !== undefined && typeof err.code === "number") {
        return {
          ok: false,
          command,
          args: validatedArgs,
          error: `Command exited with code ${err.code}`,
          exitCode: err.code,
          stdout: err.stdout,
          stderr: err.stderr,
          durationMs,
        };
      }

      // Command not found or other execution error
      return {
        ok: false,
        command,
        args: validatedArgs,
        error: err.message ?? String(err),
        durationMs,
      };
    }
  }

  /**
   * Check that all path-type arguments resolve to a location within the
   * sandbox working directory (`cwd`).
   *
   * This prevents path traversal attacks where a command like `cat` is given
   * an absolute path (e.g. `/etc/passwd`) or a relative path with `..`
   * segments (e.g. `../../etc/passwd`) that escapes the sandbox.
   *
   * The check uses `path.resolve(cwd, arg)` to compute the absolute path,
   * then verifies the resolved path starts with `cwd` (normalized).
   * Symlink resolution is intentionally NOT performed — the check is purely
   * lexical, which is sufficient to prevent the common traversal vectors.
   *
   * @param command - The validated command name.
   * @param positionalArgs - Positional arguments (no flags), in spec order.
   * @returns An error message if a path escapes the sandbox, or `null` if OK.
   */
  private checkPathContainment(
    command: string,
    positionalArgs: string[],
  ): string | null {
    const spec = this.registry.getSpec(command);
    if (!spec) return null;

    const normalizedCwd = path.resolve(this.cwd);

    for (let j = 0; j < spec.args.length; j++) {
      const argSpec = spec.args[j];
      if (!argSpec.isPath) continue;

      const argValue = positionalArgs[j];
      if (argValue === undefined) continue;

      // Resolve the path relative to cwd, then check containment
      const resolved = path.resolve(normalizedCwd, argValue);

      // Check if resolved path is within the sandbox directory
      // (either equals cwd or is a descendant of cwd)
      if (resolved !== normalizedCwd && !resolved.startsWith(normalizedCwd + path.sep)) {
        return (
          `Path '${argValue}' resolves to '${resolved}' which is outside ` +
          `the sandbox directory '${normalizedCwd}'. Path traversal is not allowed.`
        );
      }
    }

    return null;
  }
}
