import { CapabilityError, InvalidArgumentError } from "./errors.js";

export type CapabilityLevel = "supported" | "beta" | "unsupported";

export type Capabilities<Name extends string = string> = Readonly<Record<Name, CapabilityLevel>>;

export interface CapabilityOptions {
  readonly allowBeta?: boolean;
  readonly gateway?: string;
}

const LEVELS: ReadonlySet<unknown> = new Set<CapabilityLevel>(["supported", "beta", "unsupported"]);

export function isCapabilityLevel(value: unknown): value is CapabilityLevel {
  return LEVELS.has(value);
}

export function defineCapabilities<const Declared extends Record<string, CapabilityLevel>>(declared: Declared): Readonly<Declared> {
  for (const [name, level] of Object.entries(declared)) {
    if (!isCapabilityLevel(level)) {
      throw new InvalidArgumentError(`The capability "${name}" has an unknown level`);
    }
  }

  return Object.freeze({ ...declared });
}

export function assertCapability<Name extends string>(capabilities: Capabilities<Name>, name: Name, options: CapabilityOptions = {}): void {
  const level = Object.hasOwn(capabilities, name) ? capabilities[name] : undefined;
  const errorOptions = { gateway: options.gateway };

  if (level === "supported") {
    return;
  }

  if (level === "beta") {
    if (options.allowBeta === true) {
      return;
    }

    throw new CapabilityError(`${name} is beta: it is not yet confirmed in a sandbox. Pass allowBeta: true to use it.`, "capability_beta", errorOptions);
  }

  throw new CapabilityError(`${name} is not supported`, "capability_unsupported", errorOptions);
}
