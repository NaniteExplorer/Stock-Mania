import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { checkTrue, done, section } from "./harness";

section("asset actions: impossible dates are field errors, not thrown");
// Bundle the real actions, replacing only the container and Next cache boundaries.
const { build } = createRequire(import.meta.url)("esbuild") as typeof import("esbuild");
await build({
  stdin: {
    resolveDir: process.cwd(), loader: "ts", contents: `
      import assert from "node:assert/strict";
      import { assertValuationAction, createAssetAction } from "./app/(root)/assets/actions";
      const state = globalThis.__assetQa = { writes: 0 };
      const form = (fields) => { const data = new FormData(); for (const [k, v] of Object.entries(fields)) data.set(k, v); return data; };
      const create = { name: "Car", kind: "VEHICLE", purchaseOn: "", purchasePrice: "", model: "NONE", rate: "", floor: "", basis: "", valuedOn: "", value: "", source: "SELF_ASSESSED", note: "" };
      const a = await createAssetAction(null, form({ ...create, purchaseOn: "2026-02-30", purchasePrice: "100" }));
      assert.equal(a.ok, false); assert.ok(a.fieldErrors?.purchaseOn?.length);
      const b = await createAssetAction(null, form({ ...create, valuedOn: "2026-02-30", value: "100" }));
      assert.equal(b.ok, false); assert.ok(b.fieldErrors?.valuedOn?.length);
      const c = await assertValuationAction(null, form({ accountId: "00000000-0000-4000-8000-000000000000", valuedOn: "2026-02-30", value: "100", source: "SELF_ASSESSED" }));
      assert.equal(c.ok, false); assert.ok(c.fieldErrors?.valuedOn?.length);
      assert.equal(state.writes, 0);
      console.log("asset actions: 7 assertions PASS");
    `,
  },
  bundle: true, platform: "node", format: "esm", outfile: "tmp/assets-action-regression.mjs",
  alias: { "@": "./src" },
  plugins: [{ name: "action-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\/infra\/container$/ }, () => ({ path: "container", namespace: "qa" }));
    builder.onResolve({ filter: /^next\/cache$/ }, () => ({ path: "cache", namespace: "qa" }));
    builder.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({ contents: path === "cache"
      ? "export const revalidatePath = () => {};"
      : `export const ensureSeeded = async () => {};
         export const services = () => { globalThis.__assetQa.writes++; throw new Error("no write expected"); };` }));
  } }],
});
const output = execFileSync(process.execPath, ["tmp/assets-action-regression.mjs"], { encoding: "utf8" });
checkTrue("2026-02-30 returns purchaseOn/valuedOn field errors without writes", output.includes("7 assertions PASS"));

done();
