// The `dw-sdlc/review` commit status the script and `pr reviewed` post on a head: its state and the gh call
// that posts it.

import { type PrState, REVIEW } from "./state.ts"

/**
 * The state of the review status a clean or skipped Review leaves; the read mark's is failure, on a
 * head the fix then leaves behind. A pending status would turn the pull request unstable.
 */
export const REVIEW_STATE = "success"

/**
 * The gh arguments that post `dw-sdlc/review` on the head, a success unless `state` says otherwise,
 * `description` saying how it was read. The path names the repository, so the call reads the same from
 * any checkout.
 */
export function reviewStatusArgs(
  pr: Pick<PrState, "url" | "repo" | "head">,
  description: string,
  state: string = REVIEW_STATE
): string[] {
  const fields = { state, context: REVIEW, target_url: pr.url, description }
  const flags = Object.entries(fields).flatMap(([key, value]) => ["-f", `${key}=${value}`])
  return ["api", `repos/${pr.repo}/statuses/${pr.head}`, "--method", "POST", "--silent", ...flags]
}
