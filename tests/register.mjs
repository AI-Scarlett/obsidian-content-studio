import { registerHooks } from "node:module";
// Obsidian ships its runtime module; tests inject the public requestUrl boundary.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "obsidian")
      return {
        url: new URL("./obsidian-api.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    return nextResolve(specifier, context);
  },
});
