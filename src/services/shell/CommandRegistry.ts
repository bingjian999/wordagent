/**
 * CommandRegistry — Whitelist-based command registry for the Shell sandbox.
 *
 * Each allowed command has a specification that defines:
 * - The executable name (looked up via PATH)
 * - An ordered list of argument specifications (regex patterns)
 * - Optional flags (boolean options that are explicitly allowed)
 * - A default timeout
 *
 * Arguments are validated against regex patterns to prevent injection.
 * Since `execFile` is used (not `exec`), there is no shell parsing —
 * arguments are passed directly to the process as an array.
 *
 * This design mirrors the C# CPAHelper ShellTool's command whitelist approach.
 */

/**
 * Specification for a single positional argument.
 */
export interface ArgSpec {
  /** Regex pattern that the argument must fully match. */
  pattern: RegExp;
  /** Whether this argument is required. */
  required: boolean;
  /** Human-readable description of what this argument represents. */
  description: string;
}

/**
 * Specification for an allowed flag (boolean option).
 * Flags are matched case-sensitively against the allowed list.
 */
export interface FlagSpec {
  /** The flag string as it appears on the command line, e.g. "-l" or "--all". */
  name: string;
  /** Whether this flag accepts a value (e.g. "--max-count 10"). */
  takesValue?: boolean;
  /** If `takesValue` is true, the value must match this pattern. */
  valuePattern?: RegExp;
}

/**
 * Full specification for an allowed command.
 */
export interface CommandSpec {
  /** The executable name (must exist in PATH). */
  name: string;
  /** Ordered list of positional argument specifications. */
  args: ArgSpec[];
  /** Allowed flags/options. If empty, no flags are permitted. */
  flags?: FlagSpec[];
  /** Default timeout in milliseconds (overrides global default). */
  timeout?: number;
  /** Maximum number of total arguments (positional + flag values). */
  maxArgs?: number;
}

/**
 * Result of a command validation.
 */
export interface ValidationResult {
  ok: boolean;
  error?: string;
  command?: string;
  validatedArgs?: string[];
}

/**
 * Registry of allowed commands.
 *
 * Pre-configured with a safe set of read-only commands suitable for
 * a CPA/financial AI assistant: file inspection, text search, and
 * directory listing. No write or execute commands are included.
 */
export class CommandRegistry {
  private readonly commands: Map<string, CommandSpec> = new Map();

  /**
   * Create a registry pre-populated with default safe commands.
   */
  constructor(defaults: boolean = true) {
    if (defaults) {
      this.registerDefaults();
    }
  }

  /**
   * Register a command specification.
   * @param spec - The command specification to register.
   */
  register(spec: CommandSpec): void {
    this.commands.set(spec.name, spec);
  }

  /**
   * Check if a command is registered.
   */
  isAllowed(command: string): boolean {
    return this.commands.has(command);
  }

  /**
   * Get a command specification.
   */
  getSpec(command: string): CommandSpec | undefined {
    return this.commands.get(command);
  }

  /**
   * List all registered command names.
   */
  listCommands(): string[] {
    return Array.from(this.commands.keys()).sort();
  }

  /**
   * Validate a command and its arguments against the whitelist.
   *
   * This method separates flags from positional arguments, validates
   * each against the command's specification, and returns the validated
   * argument array safe to pass to `execFile`.
   *
   * @param command - The command name (e.g. "ls", "cat").
   * @param rawArgs - Raw argument strings from the user.
   * @returns Validation result with validated args or an error message.
   */
  validate(command: string, rawArgs: string[]): ValidationResult {
    const spec = this.commands.get(command);
    if (!spec) {
      return {
        ok: false,
        error: `Command '${command}' is not allowed. Allowed commands: ${this.listCommands().join(", ")}`,
      };
    }

    // Check max args limit
    if (spec.maxArgs !== undefined && rawArgs.length > spec.maxArgs) {
      return {
        ok: false,
        error: `Too many arguments for '${command}': maximum ${spec.maxArgs}, got ${rawArgs.length}`,
      };
    }

    // Separate flags from positional arguments
    const positionalArgs: string[] = [];
    const validatedArgs: string[] = [];
    const allowedFlags = spec.flags ?? [];

    let i = 0;
    while (i < rawArgs.length) {
      const arg = rawArgs[i];

      // Check if this is a flag (starts with -)
      if (arg.startsWith("-")) {
        const flagSpec = allowedFlags.find((f) => f.name === arg);
        if (!flagSpec) {
          return {
            ok: false,
            error: `Flag '${arg}' is not allowed for command '${command}'`,
          };
        }
        validatedArgs.push(arg);

        // If the flag takes a value, validate the next argument
        if (flagSpec.takesValue) {
          i++;
          if (i >= rawArgs.length) {
            return {
              ok: false,
              error: `Flag '${arg}' requires a value for command '${command}'`,
            };
          }
          const flagValue = rawArgs[i];
          if (flagSpec.valuePattern && !flagSpec.valuePattern.test(flagValue)) {
            return {
              ok: false,
              error: `Value '${flagValue}' for flag '${arg}' is not allowed for command '${command}'`,
            };
          }
          validatedArgs.push(flagValue);
        }
      } else {
        // Positional argument
        positionalArgs.push(arg);
        validatedArgs.push(arg);
      }
      i++;
    }

    // Validate positional arguments against specs
    for (let j = 0; j < spec.args.length; j++) {
      const argSpec = spec.args[j];
      const argValue = positionalArgs[j];

      if (argValue === undefined) {
        if (argSpec.required) {
          return {
            ok: false,
            error: `Missing required argument #${j + 1} (${argSpec.description}) for command '${command}'`,
          };
        }
        // Optional argument not provided — OK
        continue;
      }

      if (!argSpec.pattern.test(argValue)) {
        return {
          ok: false,
          error: `Argument '${argValue}' does not match allowed pattern for '${command}' (expected: ${argSpec.description})`,
        };
      }
    }

    // Check for extra positional arguments beyond the spec
    if (positionalArgs.length > spec.args.length) {
      return {
        ok: false,
        error: `Too many positional arguments for '${command}': expected at most ${spec.args.length}, got ${positionalArgs.length}`,
      };
    }

    return { ok: true, command, validatedArgs };
  }

  /**
   * Register the default set of safe, read-only commands.
   *
   * These commands cover common file inspection and text search operations
   * that a CPA/financial AI assistant would need:
   * - ls: list directory contents
   * - cat: print file contents
   * - head: print first lines of a file
   * - tail: print last lines of a file
   * - wc: count lines/words/characters
   * - grep: search text in files
   * - find: find files by name
   * - file: determine file type
   * - echo: print text (Unix only)
   * - date: print date/time (Unix only)
   * - hostname: print computer name (Windows + Unix)
   * - whoami: print current user (Windows + Unix)
   */
  private registerDefaults(): void {
    // Common path pattern: alphanumeric, dots, dashes, underscores, forward slashes, backslashes
    const PATH_PATTERN = /^[\w./\\-]+$/;
    // Simple word pattern for patterns/names
    const WORD_PATTERN = /^[\w.-]+$/;
    // Grep pattern: alphanumeric and common regex chars
    const GREP_PATTERN = /^[\w./*?^$[\]\\-]+$/;

    this.register({
      name: "ls",
      args: [
        { pattern: PATH_PATTERN, required: false, description: "directory path" },
      ],
      flags: [
        { name: "-l" },
        { name: "-a" },
        { name: "-la" },
        { name: "-al" },
        { name: "-h" },
        { name: "-R" },
        { name: "-1" },
      ],
      timeout: 10000,
      maxArgs: 5,
    });

    this.register({
      name: "cat",
      args: [
        { pattern: PATH_PATTERN, required: true, description: "file path" },
      ],
      flags: [
        { name: "-n" },
      ],
      timeout: 10000,
      maxArgs: 3,
    });

    this.register({
      name: "head",
      args: [
        { pattern: PATH_PATTERN, required: true, description: "file path" },
      ],
      flags: [
        { name: "-n", takesValue: true, valuePattern: /^\d+$/ },
      ],
      timeout: 10000,
      maxArgs: 3,
    });

    this.register({
      name: "tail",
      args: [
        { pattern: PATH_PATTERN, required: true, description: "file path" },
      ],
      flags: [
        { name: "-n", takesValue: true, valuePattern: /^\d+$/ },
      ],
      timeout: 10000,
      maxArgs: 3,
    });

    this.register({
      name: "wc",
      args: [
        { pattern: PATH_PATTERN, required: true, description: "file path" },
      ],
      flags: [
        { name: "-l" },
        { name: "-w" },
        { name: "-c" },
        { name: "-m" },
      ],
      timeout: 10000,
      maxArgs: 3,
    });

    this.register({
      name: "grep",
      args: [
        { pattern: GREP_PATTERN, required: true, description: "search pattern" },
        { pattern: PATH_PATTERN, required: true, description: "file path" },
      ],
      flags: [
        { name: "-i" },
        { name: "-n" },
        { name: "-v" },
        { name: "-c" },
        { name: "-r" },
        { name: "--color", takesValue: true, valuePattern: /^(never|always|auto)$/ },
        { name: "-E" },
        { name: "-F" },
      ],
      timeout: 15000,
      maxArgs: 5,
    });

    this.register({
      name: "find",
      args: [
        { pattern: PATH_PATTERN, required: true, description: "directory path" },
        { pattern: WORD_PATTERN, required: false, description: "name pattern" },
      ],
      flags: [
        { name: "-name", takesValue: true, valuePattern: /^[\w.*?[\]\\-]+$/ },
        { name: "-type", takesValue: true, valuePattern: /^[fd]$/ },
        { name: "-maxdepth", takesValue: true, valuePattern: /^\d+$/ },
      ],
      timeout: 15000,
      maxArgs: 7,
    });

    this.register({
      name: "file",
      args: [
        { pattern: PATH_PATTERN, required: true, description: "file path" },
      ],
      flags: [
        { name: "-b" },
        { name: "-i" },
        { name: "--mime-type" },
      ],
      timeout: 10000,
      maxArgs: 3,
    });

    this.register({
      name: "echo",
      args: [
        { pattern: /^[\w\s./\\:-]+$/, required: true, description: "text to echo" },
      ],
      flags: [],
      timeout: 5000,
      maxArgs: 1,
    });

    this.register({
      name: "date",
      args: [],
      flags: [
        { name: "-u" },
        { name: "-R" },
        { name: "-I", takesValue: true, valuePattern: /^[ds]$/ },
      ],
      timeout: 5000,
      maxArgs: 2,
    });

    // Cross-platform commands (available on both Windows and Unix)
    this.register({
      name: "hostname",
      args: [],
      flags: [],
      timeout: 5000,
      maxArgs: 1,
    });

    this.register({
      name: "whoami",
      args: [],
      flags: [],
      timeout: 5000,
      maxArgs: 1,
    });
  }
}
