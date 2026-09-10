import assert from "node:assert/strict";
import test from "node:test";
import { MAX_TEMPO, MIN_TEMPO, normalizeTempo } from "../app/tempo.ts";

test("shared tempo normalization accepts direct three-digit entry", () => {
  assert.equal(normalizeTempo(117), 117);
  assert.equal(normalizeTempo(116.6), 117);
});

test("shared tempo normalization enforces the site-wide rehearsal range", () => {
  assert.equal(normalizeTempo(-1), MIN_TEMPO);
  assert.equal(normalizeTempo(999), MAX_TEMPO);
});
