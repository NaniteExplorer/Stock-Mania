/** Mechanical DESIGN conformance checks. No baselines, waivers, or source mutations. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import ts from "typescript";

const heights = new Map([["--h-xs", 24], ["--h-sm", 28], ["--h-md", 32], ["--h-lg", 36], ["--h-xl", 40]]);
const markerSizes = new Map([["--mk-sm", 16], ["--mk-track-width", 32], ["--mk-track-height", 18]]);
const radii = new Map([["--r-1", 2], ["--r-2", 3], ["--r-3", 4], ["--r-4", 6], ["--r-5", 8], ["--r-pill", 999]]);
const animated = new Set(["background-color", "border-color", "color", "box-shadow", "transform"]);
const hex = /#[\da-f]{3,8}\b/i;
const cssName = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
const key = (path, name) => `${resolve(path)}:${name}`;
const interactiveTag = (tag) => /^(button|input|select|textarea|summary)$/.test(tag) || /(?:\.|^)(?:Trigger|Item|CheckboxItem|RadioItem|ScrollUpButton|ScrollDownButton)$/.test(tag) || /Button$/.test(tag);
const colorProperty = (name) => /color|background|fill|stroke|shadow|border|outline|decoration/i.test(name);
const split = (value) => postcss.list.comma(value);
const token = (value) => /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim())?.[1];

/** Pure entry point used by fixtures and the CLI. Files may be in-memory. */
export function analyzeSources(files) {
  const diagnostics = [];
  const cssFiles = new Map();
  const roles = new Map();
  const jsxNodes = [];
  const baseGeometry = new Map();
  const globalVariables = new Map();
  const globalClasses = new Map();
  const add = (path, line, rule, message) => diagnostics.push({ path, line, rule, message });
  const roleFor = (path, name) => roles.get(key(path, name)) ?? {};
  const setRole = (path, name, role) => roles.set(key(path, name), { ...roleFor(path, name), ...role });

  // Global declarations are inherited by controls; plain JSX class strings bind
  // global CSS selectors, while module classes still require their imported map.
  for (const file of files.filter((file) => extname(file.path) === ".css")) {
    try { cssFiles.set(resolve(file.path), { file, root: postcss.parse(file.source, { from: file.path }) }); }
    catch (error) { add(file.path, error.line ?? 1, "css-parse", error.reason ?? error.message); }
  }
  for (const { file, root } of cssFiles.values()) root.walkRules((rule) => {
    if (split(rule.selector).some((selector) => /^(?::root|html|body)$/.test(selector.trim()))) {
      for (const decl of (rule.nodes ?? []).filter((node) => node.type === "decl" && node.prop.startsWith("--"))) globalVariables.set(decl.prop, decl.value);
    }
    if (!file.path.endsWith(".module.css")) for (const [, name] of rule.selector.matchAll(/\.([\w-]+)/g)) {
      const paths = globalClasses.get(name) ?? new Set();
      paths.add(file.path);
      globalClasses.set(name, paths);
    }
  });

  // First bind JSX classes to their semantic owner. A marker is established by its
  // actual token declarations below, not by a magic class-name naming convention.
  for (const file of files.filter((file) => /\.[cm]?[jt]sx?$/.test(file.path))) {
    const ast = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true, file.path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const variables = new Map();
    const imports = new Map();
    const visitDefinitions = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer);
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text.endsWith(".css") && node.importClause?.name) imports.set(node.importClause.name.text, resolve(dirname(file.path), node.moduleSpecifier.text));
      ts.forEachChild(node, visitDefinitions);
    };
    visitDefinitions(ast);
    const classes = (node, seen = new Set()) => {
      if (!node) return [];
      if (ts.isStringLiteralLike(node)) return node.text.split(/\s+/).flatMap((name) => [...globalClasses.get(name) ?? []].map((path) => ({ path, name })));
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && imports.has(node.expression.text)) return [{ path: imports.get(node.expression.text), name: node.name.text }];
      if (ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) return classes(variables.get(node.text), new Set([...seen, node.text]));
      const result = [];
      ts.forEachChild(node, (child) => { result.push(...classes(child, seen)); });
      return result;
    };
    const literal = (node, seen = new Set()) => {
      if (!node) return undefined;
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isNumericLiteral(node)) return node.text;
      if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literal(node.expression, seen);
      if (ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) return literal(variables.get(node.text), new Set([...seen, node.text]));
      if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) return node.getText(ast);
      if (node.kind === ts.SyntaxKind.TrueKeyword) return "true";
      if (node.kind === ts.SyntaxKind.FalseKeyword) return "false";
      return undefined;
    };
    const styleDeclarations = (node, seen = new Set()) => {
      if (!node) return [];
      if (ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) return styleDeclarations(variables.get(node.text), new Set([...seen, node.text]));
      if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return styleDeclarations(node.expression, seen);
      if (!ts.isObjectLiteralExpression(node)) return [];
      return node.properties.flatMap((property) => {
        if (ts.isSpreadAssignment(property)) return styleDeclarations(property.expression, seen);
        if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
          const value = ts.isPropertyAssignment(property) ? property.initializer : property.name;
          return [{ prop: cssName(property.name.getText(ast).replaceAll(/["']/g, "")), value: literal(value) ?? value.getText(ast), line: ast.getLineAndCharacterOfPosition(property.getStart(ast)).line + 1 }];
        }
        return [];
      });
    };
    const unconditionalClasses = (node, seen = new Set()) => {
      if (!node) return true;
      if (ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) return unconditionalClasses(variables.get(node.text), new Set([...seen, node.text]));
      if (ts.isConditionalExpression(node) || ts.isBinaryExpression(node) || ts.isObjectLiteralExpression(node)) return false;
      if (ts.isCallExpression(node) && (!ts.isIdentifier(node.expression) || !["cn", "clsx", "classes"].includes(node.expression.text))) return false;
      let result = true;
      ts.forEachChild(node, (child) => { result = unconditionalClasses(child, seen) && result; });
      return result;
    };
    const line = (node) => ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
    const checkDisplay = (node, seen = new Set()) => {
      if (!node) return;
      if (ts.isIdentifier(node) && variables.has(node.text) && !seen.has(node.text)) { checkDisplay(variables.get(node.text), new Set([...seen, node.text])); return; }
      // Numeric arithmetic and SVG attributes are not display strings.
      if (ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        if (/(?:^|\s)-\s*(?:\d|\u20b9|Rs\b|INR\b|[$\u20ac\u00a3])/.test(node.text) || /^\s*-\s*$/.test(node.text)) add(file.path, line(node), "figure-minus", "Display figures use U+2212; unknown values use an em-dash.");
      }
      ts.forEachChild(node, (child) => { checkDisplay(child, seen); });
    };
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(ast);
        const attrs = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map((attribute) => [attribute.name.getText(ast), attribute]));
        const attrValue = (name) => literal(attrs.get(name)?.initializer);
        const tagDefinition = variables.get(tag)?.getText(ast) ?? "";
        const interactive = interactiveTag(tag) || /["'](?:button|input|select|textarea)["']/.test(tagDefinition) || attrs.has("onClick") || /^(button|checkbox|radio|switch|menuitem|combobox)$/.test(attrValue("role") ?? "") || (tag === "a" && attrs.has("href")) || (attrs.has("tabIndex") && attrValue("tabIndex") !== "-1");
        const classAttr = attrs.get("className")?.initializer;
        const refs = classes(classAttr);
        for (const ref of refs) setRole(ref.path, ref.name, { interactive: interactive || roleFor(ref.path, ref.name).interactive, decorative: attrValue("aria-hidden") === "true" || roleFor(ref.path, ref.name).decorative });
        const styleAttr = attrs.get("style")?.initializer;
        const inlineGeometry = styleAttr && ts.isJsxExpression(styleAttr) ? styleDeclarations(styleAttr.expression) : [];
        const target = { file, node, ast, refs, attrs, interactive, line: line(node), tag, attrValue, inlineGeometry, utilityGeometry: [], unconditional: unconditionalClasses(classAttr) };
        jsxNodes.push(target);
        if (classAttr) {
          const strings = [];
          const getStrings = (value, seen = new Set()) => {
            if (ts.isIdentifier(value) && variables.has(value.text) && !seen.has(value.text)) {
              getStrings(variables.get(value.text), new Set([...seen, value.text]));
              return;
            }
            if (ts.isStringLiteralLike(value)) strings.push(value);
            ts.forEachChild(value, (child) => getStrings(child, seen));
          };
          getStrings(classAttr);
          for (const value of strings) target.utilityGeometry.push(...checkUtilities(value.text, interactive, file.path, line(value), add));
          if (strings.some((value) => /(?:h|w|size)-\[var\(--mk-[\w-]+\)\]/.test(value.text)) && (interactive || attrs.has("tabIndex") || attrs.has("aria-label") || attrs.has("aria-labelledby"))) add(file.path, line(node), "focusable-marker", "A marker cannot own focus, interaction, or an accessible name.");
        }
        for (const [name, attribute] of attrs) {
          const value = literal(attribute.initializer);
          if (colorProperty(name) && value && hex.test(value)) add(file.path, line(attribute), "raw-hex", "Use a semantic colour token.");
          if (/^(title|aria-label|placeholder|label)$/.test(name) && attribute.initializer) checkDisplay(attribute.initializer);
          if (name === "style" && ts.isJsxExpression(attribute.initializer)) {
            const declarations = styleDeclarations(attribute.initializer.expression);
            const marker = declarations.some((decl) => /^(?:height|width)$/.test(decl.prop) && token(decl.value)?.startsWith("--mk-"));
            checkDeclarations(file.path, declarations, interactive, marker, globalVariables, add);
            if (marker && (interactive || attrs.has("aria-label") || attrs.has("aria-labelledby"))) add(file.path, line(attribute), "focusable-marker", "A marker cannot own focus, interaction, or an accessible name.");
          }
        }
      }
      if (ts.isJsxText(node)) checkDisplay(node);
      if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) checkDisplay(node.expression);
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }

  // Same-class token bindings let variants such as --control-height resolve without
  // interpreting a class as a control merely because it has a decorative height.
  for (const { file, root } of cssFiles.values()) root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    const declarations = (rule.nodes ?? []).filter((node) => node.type === "decl");
    const ownMarker = declarations.some((decl) => /^(?:height|width)$/.test(decl.prop) && /var\(\s*--mk-/.test(decl.value));
    for (const selector of split(rule.selector)) {
      const subject = selectorSubject(selector);
      if (subject.name) setRole(file.path, subject.name, { marker: ownMarker || roleFor(file.path, subject.name).marker, interactive: declarations.some((decl) => decl.prop === "cursor" && decl.value === "pointer") || roleFor(file.path, subject.name).interactive });
    }
  });
  for (const { file, root } of cssFiles.values()) {
    const classVariables = new Map();
    const classGeometry = new Map();
    const aliases = new Map();
    const aliasDefaults = new Map();
    root.walkDecls((decl) => {
      if (/^(height|min-height|max-height|border-radius)$/.test(decl.prop) && token(decl.value) && !heights.has(token(decl.value)) && !radii.has(token(decl.value))) aliases.set(token(decl.value), decl.prop);
      if (decl.prop.startsWith("--") && !aliasDefaults.has(decl.prop)) aliasDefaults.set(decl.prop, decl.value);
    });
    root.walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
      for (const selector of split(rule.selector)) {
        const name = selectorSubject(selector).name;
        if (!name) continue;
        const map = classVariables.get(name) ?? new Map();
        const geometry = classGeometry.get(name) ?? new Map();
        for (const decl of (rule.nodes ?? []).filter((node) => node.type === "decl" && node.prop.startsWith("--"))) if (!map.has(decl.prop)) map.set(decl.prop, decl.value);
        if (rule.parent?.type !== "atrule" && !/[\[:]/.test(selector)) for (const decl of (rule.nodes ?? []).filter((node) => node.type === "decl" && /^(height|min-height|max-height|border-radius)$/.test(node.prop))) {
          const candidate = { prop: decl.prop, value: decl.value, line: decl.source.start.line, path: file.path, priority: selectorPriority(selector), important: !!decl.important, position: decl.source.start.offset ?? decl.source.start.line * 100000 + decl.source.start.column };
          if (!geometry.has(decl.prop) || cascadeAfter(candidate, geometry.get(decl.prop))) geometry.set(decl.prop, candidate);
        }
        classVariables.set(name, map);
        classGeometry.set(name, geometry);
      }
    });
    for (const [name, geometry] of classGeometry) baseGeometry.set(key(file.path, name), { geometry, variables: classVariables.get(name) });
    root.walkRules((rule) => {
      const declarations = (rule.nodes ?? []).filter((node) => node.type === "decl").map((decl) => ({ prop: decl.prop, value: decl.value, line: decl.source.start.line }));
      if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name)) {
        for (const decl of declarations) if (!animated.has(decl.prop)) add(file.path, decl.line, "animated-property", `Keyframes may not animate ${decl.prop}.`);
        return;
      }
      for (const selector of split(rule.selector)) {
        const subject = selectorSubject(selector);
        const role = roleFor(file.path, subject.name);
        const interactive = subject.interactive || role.interactive;
        const marker = role.marker && !subject.pseudoElement;
        const variables = new Map([...globalVariables, ...classVariables.get(subject.name) ?? []]);
        for (const decl of declarations.filter((decl) => decl.prop.startsWith("--"))) variables.set(decl.prop, decl.value);
        const effective = [...declarations];
        for (const [prop, inherited] of classGeometry.get(subject.name) ?? []) if (!effective.some((decl) => decl.prop === prop)) effective.push(inherited);
        // cva variants often override private height/radius aliases instead of the
        // properties themselves. Resolve their closed defaults without a name waiver.
        if (declarations.some((decl) => aliases.has(decl.prop))) {
          for (const [alias, property] of aliases) {
            if (!variables.has(alias) && aliasDefaults.has(alias)) variables.set(alias, aliasDefaults.get(alias));
            if (variables.has(alias) && !effective.some((decl) => decl.prop === property)) effective.push({ prop: property, value: `var(${alias})`, line: rule.source.start.line });
          }
        }
        checkDeclarations(file.path, effective, !!interactive && !subject.pseudoElement, marker, variables, add);
        if (marker && /:(?:focus|focus-visible|focus-within)\b/.test(selector) && !selector.includes(":has(")) add(file.path, rule.source.start.line, "focusable-marker", "Focus belongs to the surrounding hit target, never a marker.");
      }
    });
  }
  for (const item of jsxNodes) {
    const marker = item.refs.some((ref) => roleFor(ref.path, ref.name).marker);
    if (marker && (item.interactive || item.attrs.has("tabIndex") || /^(img|button|checkbox|radio|switch)$/.test(item.attrValue("role") ?? "") || item.attrs.has("aria-label") || item.attrs.has("aria-labelledby"))) add(item.file.path, item.line, "focusable-marker", "A marker cannot own focus, interaction, or an accessible name.");
    // Two unconditional module classes can split height and radius. Check their
    // combined base geometry as well as each rule. Conditional/cva alternatives
    // are not simultaneous classes and must not be collapsed into one target.
    if (item.interactive && item.unconditional) {
      const combined = new Map();
      const variables = new Map(globalVariables);
      // Unconditional native tag selectors also apply when JSX has no class.
      for (const { file, root } of cssFiles.values()) root.walkRules((rule) => {
        if (rule.parent?.type === "atrule" || !split(rule.selector).some((selector) => selector.trim() === item.tag)) return;
        for (const decl of (rule.nodes ?? []).filter((node) => node.type === "decl" && /^(height|min-height|max-height|border-radius)$/.test(node.prop))) {
          const candidate = { prop: decl.prop, value: decl.value, line: item.line, path: file.path, priority: 1, important: !!decl.important, position: decl.source.start.offset ?? 0 };
          const previous = combined.get(decl.prop);
          if (!previous || cascadeAfter(candidate, previous)) combined.set(decl.prop, candidate);
        }
      });
      for (const ref of item.refs) {
        const base = baseGeometry.get(key(ref.path, ref.name));
        for (const [name, value] of base?.variables ?? []) variables.set(name, value);
        for (const [name, decl] of base?.geometry ?? []) {
          const previous = combined.get(name);
          if (previous && previous.path !== decl.path && previous.priority === decl.priority && previous.important === decl.important && previous.value !== decl.value) add(item.file.path, item.line, "cascade-order", `Cannot prove ${name} across equal-priority stylesheets; keep the target geometry in one binding.`);
          if (!previous || cascadeAfter(decl, previous)) combined.set(name, decl);
        }
      }
      for (const decl of item.utilityGeometry.filter((decl) => !decl.conditional)) {
        const previous = combined.get(decl.prop);
        if (previous && previous.path === "tailwind" && previous.value !== decl.value) add(item.file.path, item.line, "cascade-order", `Conflicting ${decl.prop} utilities need an explicit target binding.`);
        if (!previous?.important) combined.set(decl.prop, { ...decl, path: "tailwind" });
      }
      for (const decl of item.inlineGeometry) {
        if (decl.prop.startsWith("--")) variables.set(decl.prop, decl.value);
        const previous = combined.get(decl.prop);
        // Author !important beats normal inline style; otherwise inline wins.
        if (!previous?.important) combined.set(decl.prop, decl);
      }
      checkDeclarations(item.file.path, [...combined.values()].map((decl) => ({ ...decl, line: item.line })), true, marker, variables, add);
    }
  }
  return [...new Map(diagnostics.map((diagnostic) => [`${diagnostic.path}:${diagnostic.line}:${diagnostic.rule}:${diagnostic.message}`, diagnostic])).values()].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule) || a.message.localeCompare(b.message));
}

function selectorPriority(selector) {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const types = (selector.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
  return ids * 1000000 + classes * 1000 + types;
}

function cascadeAfter(candidate, previous) {
  if (candidate.important !== previous.important) return candidate.important;
  if (candidate.priority !== previous.priority) return candidate.priority > previous.priority;
  if (candidate.path !== previous.path) return false;
  return candidate.position >= previous.position;
}

function selectorSubject(selector) {
  // Strip :has() so its descendant cannot accidentally become this rule's owner.
  const clean = selector.replace(/:has\([^)]*\)/g, "");
  const tail = clean.split(/\s+|[>+~]/).filter(Boolean).at(-1) ?? "";
  const names = [...tail.matchAll(/\.([\w-]+)/g)];
  return { name: names.at(-1)?.[1], interactive: /^(button|input|select|textarea|summary)(?:\b|:)/.test(tail) || /\[role=["']?(?:button|checkbox|radio|switch|menuitem)/.test(tail), pseudoElement: /::/.test(tail) };
}

function checkDeclarations(path, declarations, interactive, marker, variables, add) {
  const resolveValue = (value, seen = new Set()) => {
    const name = token(value);
    if (name && variables.has(name) && !seen.has(name)) return resolveValue(variables.get(name), new Set([...seen, name]));
    return value.trim();
  };
  let height;
  const dimensions = new Map();
  let radius;
  for (const declaration of declarations) {
    const { prop, value, line } = declaration;
    if (hex.test(value)) add(path, line, "raw-hex", "Use a semantic colour token.");
    if (prop === "transition" || prop === "transition-property") {
      for (const entry of split(value)) {
        const property = entry.trim().split(/\s+/)[0];
        if (property && property !== "none" && !animated.has(property)) add(path, line, "animated-property", `Transitions may not animate ${property}.`);
      }
    }
    if (prop.startsWith("--mk-") && !markerSizes.has(prop)) add(path, line, "marker-scale", `Undeclared marker rank ${prop}.`);
    if (markerSizes.has(prop) && resolveValue(value) !== `${markerSizes.get(prop)}px`) add(path, line, "marker-scale", `Marker ${prop} must remain ${markerSizes.get(prop)}px.`);
    if ((prop === "height" || prop === "min-height" || prop === "max-height") && interactive) {
      const resolved = resolveValue(value);
      const rank = token(resolved);
      if (rank?.startsWith("--mk-")) add(path, line, "marker-control-height", "Marker measurements cannot size a hit target.");
      else if (rank && heights.has(rank)) dimensions.set(prop, { size: heights.get(rank), line });
      else if (/^\d+(?:\.\d+)?(?:px|rem)?$/.test(resolved)) {
        const number = parseFloat(resolved) * (resolved.endsWith("rem") ? 16 : 1);
        if (![...heights.values()].includes(number)) add(path, line, "control-height", `Interactive height ${resolved} is off the 24/28/32/36/40 scale.`);
        else dimensions.set(prop, { size: number, line });
      } else if (/\b(?:calc|min|max|clamp)\(/.test(resolved)) add(path, line, "control-height", "Computed hit-target heights must use a closed height token, not arithmetic.");
      else if (/\bvar\(/.test(resolved)) add(path, line, "control-height", `Unresolved hit-target height ${resolved}; use a closed height token.`);
      // auto/100%/inherit and framework available-height bounds are structural,
      // not numeric scale declarations. Browser computed layout is a separate check.
    }
    if (marker && /^(?:height|width|min-height|min-width|max-height|max-width)$/.test(prop)) {
      const resolved = resolveValue(value);
      if (/var\(\s*--h-/.test(resolved)) add(path, line, "height-marker", "Control-height tokens cannot size a marker.");
      const rank = token(resolved);
      if (rank?.startsWith("--mk-") && !markerSizes.has(rank)) add(path, line, "marker-scale", `Undeclared marker rank ${rank}.`);
    }
    if (prop === "border-radius" && interactive) radius = { value: resolveValue(value), line };
  }
  if (dimensions.size) {
    const base = dimensions.get("height") ?? dimensions.get("min-height") ?? dimensions.get("max-height");
    height = { ...base, size: Math.max(dimensions.get("min-height")?.size ?? 0,
      Math.min(base.size, dimensions.get("max-height")?.size ?? Infinity)) };
  }
  if (height && radius) {
    const expected = height.size <= 32 ? "--r-2" : "--r-3";
    const number = /^\d+(?:\.\d+)?(?:px)?$/.test(radius.value) ? parseFloat(radius.value) : radii.get(token(radius.value));
    if (number !== radii.get(expected)) add(path, radius.line, "radius-height", `A ${height.size}px hit target requires var(${expected}).`);
  }
}

function checkUtilities(value, interactive, path, line, add) {
  if (hex.test(value)) add(path, line, "raw-hex", "Use a semantic colour token.");
  const declarations = [];
  const marker = /(?:h|w|size)-\[var\(--mk-[\w-]+\)\]/.test(value);
  for (const item of value.split(/\s+/)) {
    const utility = item.split(":").at(-1);
    if (/^(?:transition-all|transition-opacity|animate-(?:pulse|ping|bounce))$/.test(utility)) add(path, line, "animated-property", `Forbidden motion utility ${utility}.`);
    // Arbitrary descendant selectors target their descendant, not the control.
    // In particular an SVG's size is optical geometry, not the hit-target height.
    if ((!interactive && !marker) || /\[&[^\]]*(?:_|>|\s)[^\]]*\]/.test(item)) continue;
    const dimension = /^(h|min-h|max-h|w|min-w|max-w|size)-(?:\[([^\]]+)\]|(\d+(?:\.\d+)?))$/.exec(utility);
    if (dimension) {
      const value = dimension[2]?.replaceAll("_", " ") ?? `${Number(dimension[3]) * 4}px`;
      const prop = ({ h: "height", "min-h": "min-height", "max-h": "max-height", w: "width", "min-w": "min-width", "max-w": "max-width", size: "height" })[dimension[1]];
      declarations.push({ prop, value, line, conditional: item.includes(":") });
      if (dimension[1] === "size") declarations.push({ prop: "width", value, line, conditional: item.includes(":") });
    }
    const radius = /^rounded(?:-\[([^\]]+)\]|-(none|xs|sm|md|lg|xl|full))?$/.exec(utility);
    if (radius) declarations.push({ prop: "border-radius", value: radius[1]?.replaceAll("_", " ") ?? ({ none: "0px", xs: "2px", sm: "4px", md: "6px", lg: "8px", xl: "12px", full: "999px" }[radius[2]] ?? "4px"), line, conditional: item.includes(":") });
  }
  checkDeclarations(path, declarations, interactive, marker, new Map(), add);
  return declarations;
}

export function checkPaths(paths = ["components/ui"], cwd = process.cwd()) {
  const selected = new Map();
  const walk = (path) => {
    const absolute = resolve(cwd, path);
    const stat = statSync(absolute);
    if (stat.isDirectory()) { for (const name of readdirSync(absolute).sort()) walk(resolve(absolute, name)); }
    else if (/\.(?:css|[cm]?[jt]sx?)$/.test(absolute)) selected.set(absolute, { path: relative(cwd, absolute).replaceAll("\\", "/"), source: readFileSync(absolute, "utf8") });
  };
  for (const path of paths) walk(path);
  return analyzeSources([...selected.values()]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const diagnostics = checkPaths(process.argv.slice(2).length ? process.argv.slice(2) : undefined);
    for (const item of diagnostics) console.error(`${item.path}:${item.line} [${item.rule}] ${item.message}`);
    console.log(`UI conformance: ${diagnostics.length ? "FAIL" : "PASS"} (${diagnostics.length} violation(s))`);
    process.exitCode = diagnostics.length ? 1 : 0;
  } catch (error) { console.error(`UI conformance: ${error.message}`); process.exitCode = 1; }
}

