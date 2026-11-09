import { z } from "zod";

/** Form-style boolean: true/on/1/yes (any case) are true; everything else, including "false", is false. */
export const boolish = (fallback = false) =>
  z.preprocess((v) => {
    if (v === undefined || v === null) return fallback;
    if (typeof v === "boolean") return v;
    return ["true", "on", "1", "yes"].includes(String(v).trim().toLowerCase());
  }, z.boolean());
