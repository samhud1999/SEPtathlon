import { describe, expect, it } from "vitest";
import { BloodPatchBody } from "@/lib/api-schemas";

describe("BloodPatchBody", () => {
  it("accepts a score in [0,10] or null", () => {
    expect(BloodPatchBody.parse({ score: 7.5 })).toEqual({ score: 7.5 });
    expect(BloodPatchBody.parse({ score: null })).toEqual({ score: null });
  });

  it("rejects out-of-range, missing, and legacy card bodies", () => {
    expect(() => BloodPatchBody.parse({ score: 11 })).toThrow();
    expect(() => BloodPatchBody.parse({ score: -1 })).toThrow();
    expect(() => BloodPatchBody.parse({})).toThrow();
    expect(() => BloodPatchBody.parse({ cardA: "PURE", reveal: true })).toThrow();
  });
});
