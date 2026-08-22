/**
 * Bans raw hex colours in components.
 *
 * The design system is a token set; a hex literal in a component is a colour that
 * cannot follow a theme change and will not be found by anyone auditing the
 * palette. The CVD-validated chart ramp in `ui/tokens.css` is worth nothing if a
 * component quietly paints its own blue.
 *
 * Deliberately narrow about what counts, because the naive version has two
 * false-positive families: `href="#features"` (an anchor, not a colour) and
 * `key="#3"`. Only a full-string hex colour, or a hex inside a Tailwind arbitrary
 * value, is reported.
 *
 * Colour keywords (`white`, `currentColor`, `transparent`) are allowed: they are
 * not palette decisions.
 */

// Anchored: the whole string must be a hex colour. "#features" cannot match.
const FULL_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// A Tailwind arbitrary value — bg-[#123456], text-[#abc] — anywhere in a string.
const ARBITRARY_HEX = /\[#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})\]/i;
// An inline style value: style={{ color: "#fff" }} or a css`` template.
const EMBEDDED_HEX = /(?:^|[\s:(,])#(?:[0-9a-f]{6}|[0-9a-f]{8})\b/i;

const rule = {
  meta: {
    type: "problem",
    docs: { description: "Disallow raw hex colours outside the token stylesheet" },
    schema: [],
    messages: {
      rawHex:
        'Raw hex colour "{{value}}". Use a token — `var(--primary)`, a Tailwind utility such as `text-brand-400`, or a colour keyword. Hex belongs only in src/ui/tokens.css, where the palette can be audited and validated.',
      arbitrary:
        'Tailwind arbitrary colour "{{value}}". Add a token to src/ui/tokens.css and use its generated utility instead.',
    },
  },

  create(context) {
    function inspect(node, raw) {
      if (typeof raw !== "string") return;
      if (ARBITRARY_HEX.test(raw)) {
        context.report({ node, messageId: "arbitrary", data: { value: raw.trim().slice(0, 40) } });
        return;
      }
      if (FULL_HEX.test(raw.trim()) || EMBEDDED_HEX.test(raw)) {
        context.report({ node, messageId: "rawHex", data: { value: raw.trim().slice(0, 40) } });
      }
    }

    return {
      Literal(node) {
        if (typeof node.value === "string") inspect(node, node.value);
      },
      TemplateElement(node) {
        inspect(node, node.value?.raw);
      },
      JSXText(node) {
        // A hex in visible copy is documentation, not styling — skip it.
        void node;
      },
    };
  },
};

export default rule;
