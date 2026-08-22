import noFloatMoney from "./no-float-money.mjs";
import noFloatColumns from "./no-float-columns.mjs";
import noRawHex from "./no-raw-hex.mjs";

/**
 * The project's own ESLint plugin.
 *
 * Written as `.mjs` so it is never part of the TypeScript program — a lint rule
 * that must itself typecheck is a build-order problem nobody needs.
 */
export default {
  rules: {
    "no-float-money": noFloatMoney,
    "no-float-columns": noFloatColumns,
    "no-raw-hex": noRawHex,
  },
};
