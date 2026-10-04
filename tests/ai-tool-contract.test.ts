import { expect, test } from "bun:test";
import { z } from "zod";
import { advisorToolContract } from "../src/server/ai/tool-contract";

test("provider sees enum casing, array item types, bounded limits and input defaults", () => {
  const schema=z.object({listingType:z.enum(["SALE","RENT","SHORT_TERM"]).optional(),propertyTypes:z.array(z.string()).optional(),limit:z.number().int().min(1).max(6).optional(),years:z.number().int().min(1).max(30).default(5),purchasePrice:z.number().positive()});
  const contract=JSON.parse(advisorToolContract(schema));
  expect(contract.properties.listingType.enum).toEqual(["SALE","RENT","SHORT_TERM"]);
  expect(contract.properties.propertyTypes).toMatchObject({type:"array",items:{type:"string"}});
  expect(contract.properties.limit).toMatchObject({type:"integer",minimum:1,maximum:6});
  expect(contract.required).toEqual(["purchasePrice"]);
  expect(contract.properties.years.default).toBe(5);
  expect(contract.$schema).toBeUndefined();
});
