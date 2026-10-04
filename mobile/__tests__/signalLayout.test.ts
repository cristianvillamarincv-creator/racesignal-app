import { ANSWER_TO_QUESTION_GAP, isNearBottom, messageTopGap, NEAR_BOTTOM_THRESHOLD, QUESTION_TO_ANSWER_GAP } from '@/lib/signalLayout';

describe('messageTopGap', () => {
  it('uses 12pt between a question and its answer and 28pt before the next question, and none before the first message', () => {
    expect(QUESTION_TO_ANSWER_GAP).toBe(12);
    expect(ANSWER_TO_QUESTION_GAP).toBe(28);
    expect(messageTopGap('user', undefined)).toBe(0);
    expect(messageTopGap('assistant', 'user')).toBe(12);
    expect(messageTopGap('user', 'assistant')).toBe(28);
  });
});

describe('isNearBottom (do not force-scroll someone reading earlier messages)', () => {
  const viewportHeight = 600;
  it('is true at the end and within the threshold of it', () => {
    expect(isNearBottom({ contentOffsetY: 400, contentHeight: 1000, viewportHeight })).toBe(true);
    expect(isNearBottom({ contentOffsetY: 400 - NEAR_BOTTOM_THRESHOLD, contentHeight: 1000, viewportHeight })).toBe(true);
  });
  it('is false once the athlete has scrolled further up than the threshold', () => {
    expect(isNearBottom({ contentOffsetY: 400 - NEAR_BOTTOM_THRESHOLD - 1, contentHeight: 1000, viewportHeight })).toBe(false);
    expect(isNearBottom({ contentOffsetY: 0, contentHeight: 3000, viewportHeight })).toBe(false);
  });
  it('is true when everything fits on screen', () => {
    expect(isNearBottom({ contentOffsetY: 0, contentHeight: 300, viewportHeight })).toBe(true);
  });
});
