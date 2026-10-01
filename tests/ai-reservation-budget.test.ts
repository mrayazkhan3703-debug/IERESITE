import { expect, test } from "bun:test";
import { aiReservationTransactionOptions } from "@/server/ai/reservation-budget";

test("remote reservation exceeds the default five seconds without an unbounded transaction", () => {
  expect(aiReservationTransactionOptions(60000, 0)).toEqual({ maxWait: 3000, timeout: 15000 });
});
test("queue wait and transaction share the remaining processing budget", () => {
  for (const remaining of [1000, 2500, 6000, 12000, 19000, 60000]) {
    const options = aiReservationTransactionOptions(remaining, 0);
    expect(options.maxWait + options.timeout).toBeLessThanOrEqual(remaining);
    expect(options.timeout).toBeLessThanOrEqual(15000);
  }
});
test("expired or unusably short budgets cannot start a reservation", () => {
  for (const deadline of [-1, 0, 999, Infinity, NaN]) expect(() => aiReservationTransactionOptions(deadline, 0)).toThrow();
});
