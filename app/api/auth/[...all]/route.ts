import { auth } from "@/infra/auth/server";
import { toNextJsHandler } from "better-auth/next-js";

/**
 * The better-auth HTTP handler.
 *
 * v1 had no such route — it drove auth entirely through server actions calling
 * `auth.api.*`. That works for sign-in and sign-up but leaves the emailed
 * verification and password-reset links with nothing to resolve against, which
 * is half of why the reset flow never completed.
 */
export const { GET, POST } = toNextJsHandler(auth);
