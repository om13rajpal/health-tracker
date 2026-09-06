import { timingSafeEqual } from "node:crypto";

export function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length === 0 || bufferB.length === 0) {
    return false;
  }

  if (bufferA.length !== bufferB.length) {
    // Compare against a same-length dummy so the early return above and this
    // branch take roughly comparable time either way — this is a personal,
    // single-user app, so this is a reasonable (not cryptographically
    // rigorous) mitigation, not a guarantee against a determined attacker.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
