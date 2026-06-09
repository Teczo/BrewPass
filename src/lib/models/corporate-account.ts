import { z } from "zod";

import { baseDocumentSchema, objectIdSchema } from "@/lib/models/shared";

export const corporateAccountSchema = baseDocumentSchema.extend({
  company: z.string().min(1),
  billingOwnerUserId: objectIdSchema,
  memberUserIds: z.array(objectIdSchema),
  seatCount: z.number().int().positive(),
});
export type CorporateAccount = z.infer<typeof corporateAccountSchema>;
