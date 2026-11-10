import { z } from "zod";

const note = z.string().trim().max(2000, "Note is too long (2000 characters max)");

/** What a client submits when answering a quote. Edits cannot be requested without saying what to change. */
export const portalQuoteResponseSchema = z
  .object({
    response: z.enum(["ACCEPTED", "DECLINED", "CHANGES_REQUESTED"]),
    note: note.optional().transform((n) => n || undefined),
  })
  .superRefine((v, ctx) => {
    if (v.response === "CHANGES_REQUESTED" && !v.note) {
      ctx.addIssue({ code: "custom", path: ["note"], message: "Please describe the changes you would like." });
    }
  });

/** Optional message the admin attaches when sending a revised quote. */
export const revisedQuoteNoteSchema = z.object({ note: note.optional().transform((n) => n || undefined) });

export type PortalQuoteResponse = z.infer<typeof portalQuoteResponseSchema>;
