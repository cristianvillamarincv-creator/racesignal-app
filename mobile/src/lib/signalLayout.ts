/**
 * Pure layout rules for the Signal conversation, kept out of the screen so they can be tested without rendering it.
 *
 * Spacing: a question and its answer sit 12pt apart; the next question starts 28pt after an answer.
 * Scrolling: new content follows to the end only while the athlete is already near the end (or has just sent a
 * message), so reading earlier messages is never interrupted by a reply arriving.
 */
export const QUESTION_TO_ANSWER_GAP = 12;
export const ANSWER_TO_QUESTION_GAP = 28;
export const QUESTION_BUBBLE_MAX_WIDTH = '85%';
export const NEAR_BOTTOM_THRESHOLD = 120;

/** Space above a message, from the message before it (none for the first). */
export function messageTopGap(role: 'user' | 'assistant', previousRole: 'user' | 'assistant' | undefined): number {
  if (previousRole === undefined) return 0;
  return role === 'assistant' ? QUESTION_TO_ANSWER_GAP : ANSWER_TO_QUESTION_GAP;
}

export interface ScrollPosition {
  contentOffsetY: number;
  contentHeight: number;
  viewportHeight: number;
}

/** True when the visible area is within `threshold` points of the end of the content. */
export function isNearBottom({ contentOffsetY, contentHeight, viewportHeight }: ScrollPosition, threshold = NEAR_BOTTOM_THRESHOLD): boolean {
  return contentHeight - (contentOffsetY + viewportHeight) <= threshold;
}
