import "module-alias/register";
import { test } from "node:test";
import assert from "node:assert/strict";
import { findWinners } from "@utils/winners";

test("media più alta vince", () => assert.deepEqual(findWinners([{ candidatureId: 1, sum: 150, count: 2 }, { candidatureId: 2, sum: 80, count: 1 }]), [2]));
test("pari merito con numeri di voti diversi → ex aequo", () => assert.deepEqual(findWinners([{ candidatureId: 1, sum: 140, count: 2 }, { candidatureId: 2, sum: 70, count: 1 }]).sort(), [1, 2]));
test("senza voti non si concorre", () => assert.deepEqual(findWinners([{ candidatureId: 1, sum: 0, count: 0 }]), []));
test("confronto esatto su conteggi diversi: 200/3 batte 133/2", () =>
    assert.deepEqual(findWinners([{ candidatureId: 1, sum: 133, count: 2 }, { candidatureId: 2, sum: 200, count: 3 }, { candidatureId: 3, sum: 0, count: 0 }]), [2]));
