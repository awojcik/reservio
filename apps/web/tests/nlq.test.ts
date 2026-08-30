import { describe, expect, it } from "vitest";

import { interpretQuery } from "@/lib/nlq";

describe("interpretQuery", () => {
  it("maps the demo sentence onto concrete filters", () => {
    const { patch, matched } = interpretQuery(
      "Rodzina 2+2, blisko plaży, parking i basen, do 3000 zł",
    );

    expect(patch).toMatchObject({
      pool: true,
      parking: true,
      nearBeach: true,
      maxPrice: 3000,
      adults: 2,
      children: 2,
    });
    expect(matched.length).toBeGreaterThan(3);
  });

  it("works without Polish diacritics", () => {
    expect(interpretQuery("dom z basenem blisko plazy").patch).toMatchObject({
      pool: true,
      nearBeach: true,
    });
  });

  it("reports nothing understood for an unrelated sentence", () => {
    const { patch, matched } = interpretQuery("cokolwiek");

    expect(matched).toHaveLength(0);
    expect(Object.keys(patch)).toHaveLength(0);
  });
});
