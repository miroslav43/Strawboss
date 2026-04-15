import { z } from "zod";

/** Admin UI locale — stored on users.locale, drives i18n in admin-web. */
export const updateProfileLocaleSchema = z.object({
  locale: z.enum(["en", "ro"]),
});
