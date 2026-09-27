import { describe, expect, it } from "bun:test";
import { tokenize } from "@/server/search/local-provider";

describe("Unicode search tokenizer", () => {
  it("retains English and Arabic terms as normalized searchable tokens", () => {
    expect(tokenize("Dubai Marina دبي مارينا شقة")).toEqual([
      "dubai",
      "marina",
      "دبي",
      "مارينا",
      "شقة",
    ]);
  });
});
