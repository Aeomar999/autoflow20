import Handlebars from "handlebars";

/**
 * Central template compilation for all node executors (ADR-0007).
 *
 * Posture: user-authored templates are a product feature, so runtime
 * compilation stays — but every executor must compile through this
 * wrapper, which pins the safe runtime options explicitly instead of
 * relying on Handlebars' current defaults:
 *
 * - Prototype access (constructor / __proto__ / non-own properties)
 *   is denied at render time. Templates can only read own properties
 *   of the data context they are given.
 * - There is no path to globals: `process`, `globalThis`, etc. only
 *   resolve if present in the context, which the engine never puts there.
 * - Output is always HTML-escaped unless a helper deliberately returns
 *   SafeString (e.g. `json`).
 */

Handlebars.registerHelper("json", (context) => {
  const jsonString = JSON.stringify(context, null, 2);
  return new Handlebars.SafeString(jsonString);
});

export type SafeTemplate = (context: Record<string, unknown>) => string;

export const compileTemplate = (source: string): SafeTemplate => {
  const compiled = Handlebars.compile(source);

  return (context) =>
    compiled(context ?? {}, {
      allowProtoPropertiesByDefault: false,
      allowProtoMethodsByDefault: false,
    });
};
