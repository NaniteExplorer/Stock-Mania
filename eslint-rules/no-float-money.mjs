/**
 * Bans arithmetic operators and float coercions on `Money`, `Quantity`,
 * `Percentage` and `Rate`.
 *
 * Everything here needs type information, which is the point. A purely syntactic
 * ban on `Number(` or `Math.round(` is unusable in practice: `CalendarDate.parse`
 * legitimately does `Number(year)`, and a repository legitimately does
 * `Number(row.postingCount)` on a COUNT. Both are integers, neither is money.
 * Only the type checker can tell those from `Number(money.minor)`.
 *
 * `parseFloat` is the one case that needs no types — it is never correct on a
 * money path — so it stays a `no-restricted-globals` entry in eslint.config.mjs.
 *
 * All five arithmetic operators are banned, not just `*` and `/`. `money + money`
 * looks harmless and is worse than a compile error: `Money` has no `valueOf`, so
 * `+` stringifies both operands and yields "[object Object][object Object]".
 */

const EXACT_TYPES = new Set(["Money", "Quantity", "Percentage", "Rate"]);

const METHOD_FOR = {
  "*": "`.times(n)` for an integer factor, or `.timesRatio(num, den, mode)`",
  "/": "`.dividedBy(divisor, mode)`",
  "+": "`.plus(other)`",
  "-": "`.minus(other)`",
  "%": "an explicit `.timesRatio()` / `divideRounded()` step",
  "**": "an explicit exponentiation on the minor units",
};

/** Resolves the type name at a node, following the return type of a call. */
function exactTypeName(services, checker, node) {
  let type;
  try {
    type = services.getTypeAtLocation(node);
  } catch {
    return null;
  }
  if (!type) return null;

  const seen = new Set();
  const queue = [type];
  while (queue.length) {
    const t = queue.shift();
    if (!t || seen.has(t)) continue;
    seen.add(t);

    const symbol = t.getSymbol?.() ?? t.aliasSymbol;
    const name = symbol?.getName?.();
    if (name && EXACT_TYPES.has(name)) return name;

    // A union such as `Money | null` still carries the risk.
    if (t.isUnion?.()) queue.push(...t.types);
    // `readonly Money[]` reduced by an operator, etc.
    const numberIndex = checker.getIndexTypeOfType?.(t, 1 /* Number */);
    if (numberIndex) queue.push(numberIndex);
  }
  return null;
}

/**
 * The type of the object a `.minor` / `.scaled` access is reading from, if it is
 * one of ours. `Number(money.minor)` is the exact defect
 * `30-CALCULATIONS.md` §1.2 names, and the access itself is a plain bigint, so
 * checking the argument's own type is not enough.
 */
function minorOwnerType(services, checker, node) {
  if (node.type !== "MemberExpression") return null;
  const property = node.property?.name;
  if (property !== "minor" && property !== "scaled") return null;
  return exactTypeName(services, checker, node.object);
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow arithmetic operators and float coercion on exact numeric value objects",
    },
    schema: [],
    messages: {
      arithmetic:
        "`{{op}}` on a {{type}} is not exact arithmetic. Use {{method}}. Money is bigint minor units; an operator here silently produces a float or a string.",
      interpolation:
        "A {{type}} in a template literal renders via toString(). Use `.toDecimalString()`, or the MoneyText component in the UI, so the formatting is deliberate.",
      unary:
        "Unary `{{op}}` on a {{type}} coerces to a float. Use `.negated()`.",
      coercion:
        "{{fn}}() on a {{type}} (or on its `.minor`) drops exactness. Use `.toDecimalString()` to render, or `.toMinorNumber()` where a number is genuinely required and bounded.",
      rounding:
        "{{fn}}() rounds a float, and Math.round(-0.5) is -0 — asymmetric between a charge and a refund. Use divideRounded() or timesRatio() with an explicit RoundingMode.",
    },
  },

  create(context) {
    const services = context.sourceCode.parserServices;
    if (!services?.program || !services.getTypeAtLocation) {
      // No type information available (a non-type-aware config); the syntactic
      // rules still apply, so degrade quietly rather than crashing the lint run.
      return {};
    }
    const checker = services.program.getTypeChecker();

    return {
      BinaryExpression(node) {
        const method = METHOD_FOR[node.operator];
        if (!method) return;
        for (const side of [node.left, node.right]) {
          const type = exactTypeName(services, checker, side);
          if (type) {
            context.report({
              node,
              messageId: "arithmetic",
              data: { op: node.operator, type, method },
            });
            return;
          }
        }
      },

      UnaryExpression(node) {
        if (node.operator !== "-" && node.operator !== "+") return;
        const type = exactTypeName(services, checker, node.argument);
        if (type) {
          context.report({
            node,
            messageId: "unary",
            data: { op: node.operator, type },
          });
        }
      },

      /**
       * `Number(m)`, `Number(m.minor)` — and `String(m)`, which is how a raw
       * value object reaches the DOM.
       */
      "CallExpression[callee.type='Identifier']"(node) {
        const fn = node.callee.name;
        if (fn !== "Number" && fn !== "String") return;
        const arg = node.arguments[0];
        if (!arg) return;
        const type = exactTypeName(services, checker, arg) ?? minorOwnerType(services, checker, arg);
        if (type) {
          context.report({ node, messageId: "coercion", data: { fn, type } });
        }
      },

      /** Math.round/floor/ceil/abs on anything exact. */
      "CallExpression[callee.object.name='Math']"(node) {
        const method = node.callee.property?.name;
        if (!["round", "floor", "ceil", "abs", "trunc"].includes(method)) return;
        const arg = node.arguments[0];
        if (!arg) return;
        const type = exactTypeName(services, checker, arg) ?? minorOwnerType(services, checker, arg);
        if (type) {
          context.report({
            node,
            messageId: "rounding",
            data: { fn: `Math.${method}`, type },
          });
        }
      },

      TemplateLiteral(node) {
        for (const expression of node.expressions) {
          const type = exactTypeName(services, checker, expression);
          if (type) {
            context.report({ node: expression, messageId: "interpolation", data: { type } });
          }
        }
      },
    };
  },
};

export default rule;
