// Node's util.inspect, loaded without Node types: the test program only has web APIs (types: []).
const moduleName = "node:util";
const nodeUtil = (await import(moduleName)) as { inspect(value: unknown, options?: { depth?: number; showHidden?: boolean }): string };

export const inspect = (value: unknown): string => nodeUtil.inspect(value, { depth: 10 });
