import { describe, expect, it } from "vitest";

import { workerConcurrency } from "../src/infrastructure/queue/queue.module";

/**
 * The knob an operator reaches for when the droplet is struggling.
 *
 * One vCPU runs the whole stack, so this has to be a ceiling and nothing else:
 * a variable that could also *raise* concurrency would let a typo in
 * `.env.production` do to the box exactly what it was set to prevent
 * (milestone 13 §19).
 */
const env = (value?: string) => ({ get: () => value });

describe("WORKER_CONCURRENCY", () => {
  it("leaves each worker's own value alone when unset", () => {
    expect(workerConcurrency(env(undefined), 4)).toBe(4);
    expect(workerConcurrency(env(""), 2)).toBe(2);
  });

  it("lowers a worker that asks for more", () => {
    expect(workerConcurrency(env("1"), 4)).toBe(1);
    expect(workerConcurrency(env("2"), 4)).toBe(2);
  });

  it("never raises one that asks for less", () => {
    expect(workerConcurrency(env("16"), 2)).toBe(2);
  });

  it("ignores a value that is not a usable number", () => {
    for (const bad of ["zero", "0", "-3", "NaN"]) {
      expect(workerConcurrency(env(bad), 4)).toBe(4);
    }
  });

  it("floors a fractional cap rather than handing BullMQ 1.5", () => {
    expect(workerConcurrency(env("1.9"), 4)).toBe(1);
  });
});
