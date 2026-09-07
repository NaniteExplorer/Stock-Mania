import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const fragmentPath = "D:/WorkStation/Artifacts/stock-mania-investment-20260906/investment-workspace.html";
const html = await readFile(fragmentPath, "utf8");

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
assert.equal(scripts.length, 1, "fragment should contain one local script");
assert(!html.includes("fetch("), "fragment must not call fetch");
assert(!html.includes("XMLHttpRequest"), "fragment must not use XHR");
assert(!html.includes("WebSocket"), "fragment must not use WebSocket");
assert(!html.includes("position: fixed"), "fragment must avoid viewport-fixed layout");

class FakeNode {
  constructor(id = "") {
    this.id = id;
    this.value = "";
    this.checked = false;
    this.dataset = {};
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this._html = "";
    this.classList = { toggle() {}, add() {}, remove() {} };
  }
  set innerHTML(value) { this._html = String(value); }
  get innerHTML() { return this._html; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name]; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  trigger(type, value) {
    if (value !== undefined) this.value = value;
    assert(this.listeners[type], `missing ${type} listener for ${this.id || "node"}`);
    this.listeners[type]({ target: this });
  }
  appendChild(child) { this.children.push(child); return child; }
  querySelector(selector) {
    if (!this._html.includes(selector.slice(1, -1))) return null;
    const node = control(selector);
    if (selector === "[data-manual-fallback]") node.dataset = { manualFallback: "" };
    return node;
  }
  querySelectorAll(selector) {
    const attr = selector.match(/^\[data-([a-z-]+)\]$/)?.[1];
    if (!attr) return [];
    const prop = attr.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    const pattern = new RegExp(`data-${attr}="([^"]+)"`, "g");
    return [...this._html.matchAll(pattern)].map((match) => {
      const node = new FakeNode(`${attr}:${match[1]}`);
      node.dataset[prop] = match[1];
      return node;
    });
  }
}

const nodes = new Map();
const root = new FakeNode("sm-investment-workspace");
nodes.set(root.id, root);
for (const id of ["portfolioChart", "analyticsChart", "trade-impact", "trade-results", "selected-identity", "holdings-rows"]) {
  nodes.set(id, new FakeNode(id));
}
const controls = new Map();
function control(selector) {
  if (!controls.has(selector)) controls.set(selector, new FakeNode(selector));
  return controls.get(selector);
}

const document = {
  getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, new FakeNode(id));
    return nodes.get(id);
  },
  createElementNS(_ns, tag) {
    return new FakeNode(tag);
  },
};

const context = {
  window: {},
  document,
  console,
  setTimeout,
  clearTimeout,
  ResizeObserver: class { observe() {} disconnect() {} },
};
context.window.document = document;
context.window.lucide = { createIcons() {} };
context.lucide = context.window.lucide;

vm.createContext(context);
vm.runInContext(scripts[0], context, { filename: fragmentPath });

const api = context.window.StockManiaInvestmentExperiment;
assert(api, "prototype API should be exposed");

const { core, fixtures } = api;
assert.equal(core.overviewMetrics(fixtures).length, 3, "overview has no more than three metrics");
assert.equal((root.innerHTML.match(/data-overview-chart/g) || []).length, 1, "overview has exactly one chart");
assert(!root.innerHTML.includes("data-trade-form"), "overview should not render trade form by default");
assert(!root.innerHTML.includes("data-strategy-parameters"), "overview should not render strategy parameters by default");
assert(!root.innerHTML.includes("data-lease-form"), "overview should not render lease form by default");

const graph = core.navigationGraph();
for (const target of ["holdings", "holding-detail", "analytics", "activity", "trading"]) {
  assert(core.distance(graph, "overview", target) <= 2, `${target} should be within two actions`);
}

assert.equal(core.filterHoldings(fixtures.holdings, "gold", "Gold").length, 1, "holding filters should combine search and category");
api.goto("holdings");
const renderCountBeforeFilter = api.snapshot().rootRenderCount;
control("[data-search]").trigger("input", "gold");
assert.equal(api.state.query, "gold", "holding search input should update state through bound handler");
assert.equal(api.snapshot().rootRenderCount, renderCountBeforeFilter, "holding search should update rows without rebuilding the root");
api.selectHolding("HLD-GOLD");
api.setHoldingTab("income");
assert.equal(api.state.selectedHoldingId, "HLD-GOLD");
assert.equal(api.state.holdingTab, "income");
assert(root.innerHTML.includes("Gold lease"), "gold lease branch should be inside selected holding detail");

api.openTrade();
const renderCountBeforeTyping = api.snapshot().rootRenderCount;
control("[data-trade-query]").trigger("input", "reliance");
assert.equal(api.state.tradeQuery, "reliance", "trade search input should update through bound handler");
assert.equal(api.snapshot().rootRenderCount, renderCountBeforeTyping, "trade search typing should preserve root render count");
assert(core.searchCatalogue("reliance", fixtures.catalogue).some((item) => item.exchange === "NSE"), "search should find NSE listing");
assert(core.searchCatalogue("reliance", fixtures.catalogue).some((item) => item.exchange === "BSE"), "search should disambiguate BSE listing");
api.selectInstrument("RELIANCE-NSE");
assert(root.innerHTML.includes("ISIN SYN-IN000RELI001"), "selected identity should be visible");
control("[data-trade-qty]").trigger("input", 10);
control("[data-trade-price]").trigger("input", 1568.75);
const impact = core.tradeImpact(api.state.tradeDraft);
assert.equal(api.state.tradeDraft.isin, "SYN-IN000RELI001");
assert.equal(impact.cashImpact, 15734.34);
assert.equal(impact.taxableGain, null);
assert.equal(impact.economicNetPnl, null);
control("[data-trade-side]").trigger("change", "SELL");
api.setTradeField("costBasis", 14800);
const sellImpact = core.tradeImpact(api.state.tradeDraft);
assert.equal(sellImpact.cashImpact, 15640.66);
assert.equal(sellImpact.taxableGain, 856.35);
assert.equal(sellImpact.economicNetPnl, 840.66);
assert.equal(core.searchCatalogue("unknown scrip", fixtures.catalogue).length, 0, "unknown query should have no fixture result");
api.setTradeQuery("unknown scrip");
api.manualFallback();
assert.equal(api.state.tradeDraft.providerKey, "Manual");
assert(nodes.get("selected-identity").innerHTML.includes("Manual historical instrument"), "manual fallback identity should be visible");

const xirr = core.xirr(fixtures.xirrCashflows);
assert(Math.abs(xirr - 0.1) < 0.000001, `xirr should recover 10%, got ${xirr}`);
const twrBase = core.linkedTwr(fixtures.twrPeriods);
const twrLargeFlow = core.linkedTwr(fixtures.twrLargeExternalFlowPeriods);
assert(Math.abs(twrBase - 0.155) < 0.000001, "linked TWR should equal 15.5%");
assert(Math.abs(twrBase - twrLargeFlow) < 0.000001, "linked TWR should be neutral to external cashflow size");
assert.equal(core.portfolioGain(fixtures.holdings).available, false, "missing quote should prevent invented total gain");

const baseIntent = {
  idempotencyKey: "LAB-001",
  quoteAgeMinutes: 3,
  projectedDailyLoss: 3500,
  dailyLossLimit: 10000,
  killSwitch: false,
  seenKeys: [],
};
assert.equal(core.riskGate(baseIntent).ok, true, "base paper intent should pass");
assert(core.riskGate({ ...baseIntent, quoteAgeMinutes: 24 }).reasons.includes("Stale market data"), "stale data should block");
assert(core.riskGate({ ...baseIntent, projectedDailyLoss: 12000 }).reasons.includes("Daily loss limit breached"), "daily loss should block");
assert(core.riskGate({ ...baseIntent, seenKeys: ["LAB-001"] }).reasons.includes("Duplicate order intent"), "duplicate should block");
assert(core.riskGate({ ...baseIntent, killSwitch: true }).reasons.includes("Kill switch enabled"), "kill switch should block");

api.goto("analytics");
api.setScenario("missingTwrBoundary");
assert.equal(api.state.section, "analytics");
assert(root.innerHTML.includes("Boundary valuation missing"), "analytics should show TWR unavailable reason");
api.state.analytics = "xirr";
api.setScenario("missingTwrBoundary");
assert(!root.innerHTML.includes("Boundary valuation missing"), "TWR unavailable state should not leak into XIRR");
api.state.analytics = "drawdown";
api.setScenario("complete");
assert(nodes.get("analyticsChart").innerHTML.includes("Drawdown, %"), "drawdown should render its own unit");
api.selectHolding("HLD-GOLD");
api.setHoldingTab("performance");
assert(nodes.get("analyticsChart").innerHTML.includes("Value, Rs thousand"), "selected holding chart should use holding path units");

const css320 = /@media\s*\(max-width:\s*520px\)/.test(html);
const css736 = /@media\s*\(min-width:\s*720px\)/.test(html);
const css1024 = /@media\s*\(min-width:\s*960px\)/.test(html);
assert(css320 && css736 && css1024, "fragment should include responsive breakpoints");
assert(html.includes("<button type=\"button\""), "fragment should use native buttons");
assert(html.includes("<input"), "fragment should use native inputs");
assert(html.includes("<select"), "fragment should use native selects");

console.log("PASS investment workspace experiment checks");
