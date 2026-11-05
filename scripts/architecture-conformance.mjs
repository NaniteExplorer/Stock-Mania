/** F.8 structural and exported numeric-boundary checks. No baselines or source mutations. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const scopeOf = (node) => {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current) || ts.isBlock(current) || ts.isSourceFile(current)) return current;
  }
};
const tagName = (name) => name === "kind" || name === "type";
const returnedFactoryValue = (statements) => statements.length === 1 && ts.isReturnStatement(statements[0]) && (ts.isNewExpression(unwrap(statements[0].expression)) || unwrap(statements[0].expression)?.kind === ts.SyntaxKind.NullKeyword);
const branchStatements = (node) => ts.isBlock(node) ? node.statements : [node];

function isInfra(specifier, path) {
  const clean = specifier.replaceAll("\\", "/");
  if (/^(?:@\/|src\/)infra(?:\/|$)/.test(clean)) return true;
  if (clean.startsWith("@/")) return /(?:^|\/)src\/infra(?:\/|$)/.test(resolve("src", clean.slice(2)).replaceAll("\\", "/"));
  if (!clean.startsWith(".")) return false;
  return /(?:^|\/)src\/infra(?:\/|$)/.test(resolve(dirname(path), clean).replaceAll("\\", "/"));
}

/** Pure AST analysis; all input source is supplied by the caller. No source mutations. */
export function analyzeSources(files) {
  const diagnostics = [];
  const boundaryDiagnostics = analyzeNumericBoundaries(files);
  for (const { path, source } of files) {
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const declarations = new Map();
    const add = (node, rule, message) => diagnostics.push({ path, line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1, rule, message });
    const register = (scope, name, declaration) => {
      if (!declarations.has(scope)) declarations.set(scope, new Map());
      declarations.get(scope).set(name, declaration);
    };
    const definitions = (node) => {
      if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
        const scope = scopeOf(node);
        if (ts.isIdentifier(node.name)) register(scope, node.name.text, node);
        else if (ts.isObjectBindingPattern(node.name)) for (const item of node.name.elements) {
          if (ts.isIdentifier(item.name)) register(scope, item.name.text, item);
        }
      }
      ts.forEachChild(node, definitions);
    };
    definitions(ast);
    const declarationFor = (node) => {
      for (let current = node.parent; current; current = current.parent) {
        const found = declarations.get(current)?.get(node.text);
        if (found) return found;
      }
    };
    const stringValue = (input, seen = new Set()) => {
      const node = unwrap(input);
      if (!node) return;
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = stringValue(node.left, seen), right = stringValue(node.right, seen);
        if (left !== undefined && right !== undefined) return left + right;
      }
      if (ts.isIdentifier(node)) {
        const declaration = declarationFor(node);
        if (declaration?.initializer && !seen.has(declaration)) return stringValue(declaration.initializer, new Set([...seen, declaration]));
      }
    };
    const isTag = (input, seen = new Set()) => {
      const node = unwrap(input);
      if (!node) return false;
      if (ts.isPropertyAccessExpression(node)) return tagName(node.name.text);
      if (ts.isElementAccessExpression(node)) return tagName(stringValue(node.argumentExpression));
      if (!ts.isIdentifier(node)) return false;
      if (tagName(node.text)) return true;
      const definition = declarationFor(node);
      if (definition && seen.has(definition)) return false;
      const next = new Set([...seen, definition]);
      if (definition && ts.isBindingElement(definition)) {
        const key = definition.propertyName ?? definition.name;
        return (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && tagName(key.text);
      }
      if (definition?.initializer) return isTag(definition.initializer, next);
      return tagName(node.text);
    };
    const conditionHasTag = (node) => {
      node = unwrap(node);
      if (!node) return false;
      if (ts.isBinaryExpression(node)) {
        if ([ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) return isTag(node.left) || isTag(node.right);
        if ([ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) return conditionHasTag(node.left) || conditionHasTag(node.right);
      }
      return false;
    };
    const switchFactory = (node) => {
      const clauses = node.caseBlock.clauses;
      // Consecutive empty case labels share the next arm (loanFor PERSONAL/OTHER).
      return clauses.length > 0 && clauses.at(-1).statements.length > 0 && clauses.every((arm) => arm.statements.length === 0 || returnedFactoryValue(arm.statements));
    };
    const ifFactory = (node) => {
      let branch = node;
      while (ts.isIfStatement(branch)) {
        if (!conditionHasTag(branch.expression) || !returnedFactoryValue(branchStatements(branch.thenStatement)) || !branch.elseStatement) return false;
        branch = branch.elseStatement;
      }
      return returnedFactoryValue(branchStatements(branch));
    };
    const factoryBody = (node) => {
      let owner = node.parent;
      while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
      if (!owner?.body || !ts.isBlock(owner.body)) return false;
      const statements = owner.body.statements;
      const allowed = (statement) => {
        if (ts.isReturnStatement(statement)) return returnedFactoryValue([statement]);
        if (ts.isSwitchStatement(statement)) return switchFactory(statement);
        if (ts.isIfStatement(statement)) return returnedFactoryValue(branchStatements(statement.thenStatement)) &&
          (!statement.elseStatement || allowed(statement.elseStatement));
        if (ts.isBlock(statement)) return statement.statements.length === 1 && allowed(statement.statements[0]);
        return false;
      };
      const last = statements.at(-1);
      const terminates = last && (ts.isReturnStatement(last) || ts.isSwitchStatement(last) ||
        (ts.isIfStatement(last) && !!last.elseStatement && ifFactory(last)));
      return !!terminates && statements.every(allowed);
    };
    const refusalOrFilter = (node) => {
      const statements = branchStatements(node.thenStatement);
      return !node.elseStatement && statements.length === 1 &&
        (ts.isThrowStatement(statements[0]) || ts.isContinueStatement(statements[0]));
    };
    const visit = (node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword) add(node, "domain-instanceof", "Use polymorphic behavior; instanceof is forbidden in domain code.");
      if (ts.isSwitchStatement(node) && isTag(node.expression) && !switchFactory(node)) add(node, "domain-tag-dispatch", "Tag dispatch is allowed only when every arm directly returns a new class instance or null.");
      if (ts.isIfStatement(node) && conditionHasTag(node.expression) && !(ts.isIfStatement(node.parent) && node.parent.elseStatement === node && conditionHasTag(node.parent.expression))) {
        if (!refusalOrFilter(node) && !ifFactory(node) && !factoryBody(node)) add(node, "domain-tag-dispatch", "Tag conditionals require an exact construction/null factory, throw-only invariant guard, or continue-only filter.");
      }
      let dependency;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) dependency = node.moduleSpecifier;
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) dependency = node.argument.literal;
      if (ts.isExternalModuleReference(node) && node.expression && ts.isStringLiteralLike(node.expression)) dependency = node.expression;
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0]) dependency = node.arguments[0];
      const specifier = stringValue(dependency);
      if (specifier && isInfra(specifier, path)) add(node, "domain-infra-import", "Domain code cannot depend on src/infra, including type-only imports and re-exports.");
      ts.forEachChild(node, visit);
    };
    for (const diagnostic of ast.parseDiagnostics) add(ast, "source-syntax", ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
    visit(ast);
  }
  return [...diagnostics, ...boundaryDiagnostics].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.rule.localeCompare(b.rule));
}

/** Resolve aliases and inferred signatures using TypeScript, without traversing value-object internals. */
function analyzeNumericBoundaries(files) {
  if (!files.some((file) => /\bexport\b/.test(file.source))) return [];
  const supplied = new Map(files.map((file) => [resolve(file.path), file]));
  const options = { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, skipLibCheck: true, noEmit: true, strict: true, types: [], baseUrl: process.cwd(), paths: { "@/*": ["src/*"] } };
  const host = ts.createCompilerHost(options);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) => {
    const file = supplied.get(resolve(path));
    return file ? ts.createSourceFile(path, file.source, languageVersion, true) : originalGetSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  };
  const originalExists = host.fileExists.bind(host);
  host.fileExists = (path) => supplied.has(resolve(path)) || originalExists(path);
  const program = ts.createProgram([...supplied.keys()], options, host);
  const checker = program.getTypeChecker();
  const diagnostics = [];
  const seenDiagnostics = new Set();
  const privateMember = (node) => node.name && ts.isPrivateIdentifier(node.name) || node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.PrivateKeyword);
  const numeric = (type) => !!(type.flags & ts.TypeFlags.NumberLike);
  const unitNames = new Set(["Count", "Ordinal", "Days", "DaySpan", "Months", "Years", "Minutes", "Millis", "Ratio", "PriceLevel", "IndexPoints", "SortKey", "Sign", "Polarity"]);
  const approvedUnit = (type) => {
    const symbol = type.aliasSymbol;
    if (symbol && unitNames.has(symbol.name) && symbol.declarations?.some((declaration) =>
      /(?:^|\/)src\/core\/units\.ts$/.test(declaration.getSourceFile().fileName.replaceAll("\\", "/")))) return true;
    // TypeScript may preserve a caller's local alias instead of Count's alias symbol.
    // The unique-symbol property must still originate in the approved units module.
    if (type.isIntersection?.() && type.types.some(numeric) && type.getProperties().some((property) => {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      const markerType = checker.getTypeOfPropertyOfType(type, property.name) ??
        (declaration && checker.getTypeOfSymbolAtLocation(property, declaration));
      return !!(markerType?.flags & ts.TypeFlags.StringLiteral) &&
        ["count", "ordinal", "days", "day-span", "months", "years", "minutes", "millis", "ratio", "price-level", "index-points", "sort-key"].includes(markerType.value) &&
        property.declarations?.some((declaration) => ts.isComputedPropertyName(declaration.name) &&
          /(?:^|\/)src\/core\/units\.ts$/.test(declaration.getSourceFile().fileName.replaceAll("\\", "/")));
    })) return true;
    // Bounded literal unions (including aliases and nullable forms) never widen to number.
    // Numeric enums remain subject to the separate contract question recorded in the plan.
    const literals = type.isUnion?.() ? type.types.filter((part) => !(part.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined))) : [];
    return literals.length > 1 && literals.every((part) =>
      !!(part.flags & ts.TypeFlags.NumberLiteral) && !(part.flags & ts.TypeFlags.EnumLike));
  };
  const isValueObject = (type, seen = new Set()) => {
    if (!type || seen.has(type)) return false;
    const next = new Set([...seen, type]);
    if (type.symbol?.name === "ValueObject" && type.symbol.declarations?.some((declaration) =>
      /(?:^|\/)src\/core\/kernel\.ts$/.test(declaration.getSourceFile().fileName.replaceAll("\\", "/")))) return true;
    return type.isClassOrInterface?.() && (checker.getBaseTypes(type) ?? []).some((base) => isValueObject(base, next));
  };
  const continuousUnit = (type) => {
    if (type.flags & ts.TypeFlags.TypeParameter) {
      const constraint = checker.getBaseConstraintOfType(type);
      return !!constraint && constraint !== type && continuousUnit(constraint);
    }
    if (type.isUnion?.()) return type.types.every(continuousUnit);
    if (!approvedUnit(type)) return false;
    return type.getProperties().some((property) => {
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      const marker = checker.getTypeOfPropertyOfType(type, property.name) ??
        (declaration && checker.getTypeOfSymbolAtLocation(property, declaration));
      return !!(marker?.flags & ts.TypeFlags.StringLiteral) &&
        ["ratio", "price-level", "index-points", "months", "years"].includes(marker.value) &&
        declaration && ts.isComputedPropertyName(declaration.name) &&
        /(?:^|\/)src\/core\/units\.ts$/.test(declaration.getSourceFile().fileName.replaceAll("\\", "/"));
    });
  };
  // MEMORY permits a validating continuous-unit constructor, whose input necessarily
  // starts as a raw number. Only the actual units-module contract gets this exception.
  const unitConstructor = (signature) => {
    const declaration = signature.declaration;
    return declaration && ts.isTypeAliasDeclaration(declaration.parent) &&
      declaration.parent.name.text === "UnitFactory" &&
      /(?:^|\/)src\/core\/units\.ts$/.test(declaration.getSourceFile().fileName.replaceAll("\\", "/")) &&
      continuousUnit(checker.getReturnTypeOfSignature(signature));
  };
  const standardLibrary = (declaration) => declaration &&
    /(?:^|\/)typescript\/lib\/lib\.[^/]+\.d\.ts$/.test(declaration.getSourceFile().fileName.replaceAll("\\", "/"));
  for (const [absolute, file] of supplied) {
    const ast = program.getSourceFile(absolute);
    if (!ast?.symbol) continue;
    const invalidBoundaries = new Set();
    const add = (node, name) => {
      invalidBoundaries.add(node);
      const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
      const key = `${file.path}:${line}:${name}`;
      if (seenDiagnostics.has(key)) return;
      seenDiagnostics.add(key);
      diagnostics.push({ path: file.path, line, rule: "domain-raw-number", message: `Exported boundary '${name}' carries an unbranded number; use an approved unit brand or value object.` });
    };
    const inspectedTypes = new Map();
    const inspectType = (type, name, node, seen = new Set()) => {
      if (!type || seen.has(type) || invalidBoundaries.has(node)) return;
      if (!inspectedTypes.has(node)) inspectedTypes.set(node, new Set());
      const atBoundary = inspectedTypes.get(node);
      if (atBoundary.has(type)) return;
      atBoundary.add(type);
      const next = new Set([...seen, type]);
      if (type.flags & ts.TypeFlags.TypeParameter) {
        const constraint = checker.getBaseConstraintOfType(type);
        if (constraint && constraint !== type) inspectType(constraint, name, node, next);
        return;
      }
      if (approvedUnit(type)) {
        // A genuine unit may carry metadata, but cannot hide an extra raw-number field.
        for (const property of type.getProperties()) {
          const declaration = property.valueDeclaration ?? property.declarations?.[0];
          if (declaration && !standardLibrary(declaration) && !privateMember(declaration)) {
            inspectType(checker.getTypeOfSymbolAtLocation(property, node), property.name,
              declaration.getSourceFile() === ast ? declaration : node, next);
          }
        }
        return;
      }
      if (numeric(type)) { add(node, name); return; }
      if (type.isUnionOrIntersection()) { for (const member of type.types) inspectType(member, name, node, next); return; }
      if (checker.isArrayType(type) || checker.isTupleType(type) || (type.symbol?.name === "Promise" || type.symbol?.name === "ReadonlyArray")) {
        for (const argument of checker.getTypeArguments(type)) inspectType(argument, name, node, next);
        return;
      }
      if (type.flags & ts.TypeFlags.Object && type.objectFlags & ts.ObjectFlags.Reference) {
        for (const argument of checker.getTypeArguments(type)) inspectType(argument, name, node, next);
      }
      // Real value objects encapsulate representation. Merely naming a class Money
      // does not permit a public unbranded numeric DTO to cross the boundary.
      if (isValueObject(type)) return;
      // Recursive generic methods may manufacture a fresh instantiation forever
      // (Schema<T>.optional() -> Schema<Schema<T>>). Inspect each instantiation's
      // arguments above, but expand a declaration's members once along a path.
      if (type.symbol && seen.has(type.symbol)) return;
      if (type.symbol) next.add(type.symbol);
      for (const indexKind of [ts.IndexKind.String, ts.IndexKind.Number]) inspectType(checker.getIndexTypeOfType(type, indexKind), name, node, next);
      for (const signature of [...type.getCallSignatures(), ...type.getConstructSignatures()]) {
        if (standardLibrary(signature.declaration)) continue;
        if (signature.declaration?.getSourceFile() === ast) inspectCallable(signature.declaration);
        else {
          if (!unitConstructor(signature)) {
            for (const parameter of signature.parameters) {
              inspectType(checker.getTypeOfSymbolAtLocation(parameter, node), parameter.name, node, next);
            }
          }
          inspectType(checker.getReturnTypeOfSignature(signature), name, node, next);
        }
      }
      for (const property of type.getProperties()) {
        const declaration = property.valueDeclaration ?? property.declarations?.[0];
        if (!declaration || privateMember(declaration) || standardLibrary(declaration)) continue;
        const local = declaration.getSourceFile() === ast;
        if (local && (ts.isMethodSignature(declaration) || ts.isMethodDeclaration(declaration))) inspectCallable(declaration);
        else inspectType(checker.getTypeOfSymbolAtLocation(property, node), property.name, local ? declaration : node, next);
      }
    };
    const inspectedCallables = new Set();
    const inspectCallable = (node) => {
      if (privateMember(node) || inspectedCallables.has(node)) return;
      inspectedCallables.add(node);
      for (const parameter of node.parameters ?? []) {
        if (ts.isIdentifier(parameter.name)) inspectType(checker.getTypeAtLocation(parameter), parameter.name.text, parameter);
        else inspectType(checker.getTypeAtLocation(parameter), "parameter", parameter);
      }
      if (!ts.isConstructorDeclaration(node)) {
        const signature = checker.getSignatureFromDeclaration(node);
        const name = node.name?.getText(ast) ?? (ts.isVariableDeclaration(node.parent) ? node.parent.name.getText(ast) : "default");
        if (signature) inspectType(checker.getReturnTypeOfSignature(signature), name, node);
      }
    };
    const inspectDeclaration = (node) => {
      if (node.getSourceFile() !== ast) return;
      if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
        for (const member of node.members) {
          if (privateMember(member)) continue;
          if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member) || ts.isConstructorDeclaration(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) inspectCallable(member);
          else if (member.name) inspectType(checker.getTypeAtLocation(member), member.name.getText(ast), member);
        }
        for (const property of checker.getTypeAtLocation(node).getProperties()) {
          const declaration = property.valueDeclaration ?? property.declarations?.[0];
          if (!declaration || declaration.parent === node || declaration.getSourceFile() !== ast || privateMember(declaration)) continue;
          if (ts.isMethodDeclaration(declaration) || ts.isMethodSignature(declaration) || ts.isGetAccessorDeclaration(declaration) || ts.isSetAccessorDeclaration(declaration)) inspectCallable(declaration);
          else inspectType(checker.getTypeOfSymbolAtLocation(property, declaration), property.name, declaration);
        }
      } else if (ts.isFunctionDeclaration(node)) inspectCallable(node);
      else if (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) inspectCallable(node.initializer);
      else if (node.name) inspectType(checker.getTypeAtLocation(node), node.name.getText(ast), node);
    };
    for (let symbol of checker.getExportsOfModule(ast.symbol)) {
      if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      for (const declaration of symbol.declarations ?? []) inspectDeclaration(declaration);
    }
  }
  return diagnostics;
}

export function checkPaths(paths = ["src/domain"], cwd = process.cwd()) {
  const files = new Map();
  const walk = (path) => {
    const absolute = resolve(cwd, path);
    if (statSync(absolute).isDirectory()) for (const entry of readdirSync(absolute).sort()) walk(resolve(absolute, entry));
    else if (/\.[cm]?[jt]sx?$/.test(absolute)) files.set(absolute, { path: relative(cwd, absolute).replaceAll("\\", "/"), source: readFileSync(absolute, "utf8") });
  };
  for (const path of paths) walk(path);
  return analyzeSources([...files.values()]);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const diagnostics = checkPaths(process.argv.slice(2).length ? process.argv.slice(2) : undefined);
    for (const item of diagnostics) console.error(`${item.path}:${item.line} [${item.rule}] ${item.message}`);
    console.log(`Architecture conformance: ${diagnostics.length ? "FAIL" : "PASS"} (${diagnostics.length} violation(s)).`);
    process.exitCode = diagnostics.length ? 1 : 0;
  } catch (error) { console.error(`Architecture conformance: ${error.message}`); process.exitCode = 2; }
}
