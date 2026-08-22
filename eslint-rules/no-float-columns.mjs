/**
 * Bans floating-point column builders in the Drizzle schema.
 *
 * `tests/schema-integrity.spec.ts` is the real guard here, because it inspects
 * the generated migrations and so catches hand-written SQL too. This rule exists
 * to fail at the moment of typing rather than at the moment of testing, which is
 * where the fix is cheapest.
 */

const FLOAT_BUILDERS = new Set(["real", "numeric", "doublePrecision", "float"]);

/** Column modes that are not an exact integer count. */
const SAFE_INTEGER_MODES = new Set(["number", "boolean", "timestamp", "timestamp_ms"]);

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow floating-point columns in the database schema" },
    schema: [],
    messages: {
      floatColumn:
        "`{{builder}}()` declares a floating-point column. Money is INTEGER minor units, quantities are scaled integers. SQLite will store 0.1 + 0.2 without complaint and every report built on it is then wrong.",
      unknownMode:
        "integer() mode \"{{mode}}\" is not one of number, boolean, timestamp, timestamp_ms — check it cannot lose precision.",
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        const name = node.callee.type === "Identifier" ? node.callee.name : null;
        if (name && FLOAT_BUILDERS.has(name)) {
          context.report({ node, messageId: "floatColumn", data: { builder: name } });
          return;
        }
        if (name !== "integer") return;
        const options = node.arguments[1];
        if (options?.type !== "ObjectExpression") return;
        for (const property of options.properties) {
          if (
            property.type === "Property" &&
            property.key.type === "Identifier" &&
            property.key.name === "mode" &&
            property.value.type === "Literal" &&
            typeof property.value.value === "string" &&
            !SAFE_INTEGER_MODES.has(property.value.value)
          ) {
            context.report({
              node: property,
              messageId: "unknownMode",
              data: { mode: property.value.value },
            });
          }
        }
      },
    };
  },
};

export default rule;
