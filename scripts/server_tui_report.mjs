#!/usr/bin/env node

/*
 * Server probe + TUI report
 * Runs feature checks across OpenAPI operations and prints a terminal dashboard.
 */

import process from "node:process";

const BASE_URL = (process.env.SERVER_BASE_URL ?? "http://localhost:3030").replace(/\/$/, "");
const SAMPLES = Number(process.env.SERVER_SPEED_SAMPLES ?? 10);
const MAX_P95 = Number(process.env.SERVER_MAX_P95_MS ?? 1500);
const MAX_P99 = Number(process.env.SERVER_MAX_P99_MS ?? 3000);
const MAX_ENDPOINT_P95 = Number(process.env.SERVER_MAX_ENDPOINT_P95_MS ?? 2200);
const USERNAME = process.env.SERVER_USER;
const PASSWORD = process.env.SERVER_PASSWORD;
const HAS_CREDENTIALS = Boolean(USERNAME && PASSWORD);
let GLOBAL_AUTH_TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJiZW5ubyIsImV4cCI6MTc3NTc0NzU0Nn0.66EJ4rmMDc7F6qX0OsZivIJFBQVa4tjJpAg1n2mFi3A";

const HTTP_METHODS = ["get", "post", "put", "delete", "patch"];
const PROTECTED_PATHS = new Set([
  "/fetch_items",
  "/add_ean_to_list/",
  "/add_fetched_items",
  "/transcribe",
  "/change_password",
  "/get_supermarkets_close",
  "/add_new_market",
  "/post_catalogue",
  "/get_catalogue_offers",
  "/recipes",
  "/recipes/{id}",
  "/recipes/{recipe_id}",
  "/week_plan",
  "/planner_settings",
  "/week_plan/replace_meal",
]);

// Endpoints that are not safe or practical for generic probing.
const SKIP_PROBE_PATHS = new Set([
  "/change_password",
  "/classify_items_against_pantry",
]);

const LATENCY_PATHS = [
  "/health",
  "/fetch_items",
  "/recipes",
  "/planner_settings",
  "/week_plan",
];

const C = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
  gray: "\u001b[90m",
};

function color(value, tone) {
  return `${C[tone] ?? ""}${value}${C.reset}`;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function mean(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values) {
  if (values.length === 0) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - m) ** 2)));
}

function refName(ref) {
  return ref.split("/").pop() ?? ref;
}

function resolveSchema(doc, schema) {
  if (!schema) return {};
  if (!schema.$ref) return schema;
  return doc.components?.schemas?.[refName(schema.$ref)] ?? {};
}

function mergeAllOfSchemas(doc, schema) {
  const merged = { type: "object", properties: {}, required: [] };

  for (const part of schema.allOf ?? []) {
    const resolved = resolveSchema(doc, part);
    const normalized = resolved.allOf?.length ? mergeAllOfSchemas(doc, resolved) : resolved;

    if (normalized.properties) {
      merged.properties = { ...merged.properties, ...normalized.properties };
    }

    if (normalized.required?.length) {
      merged.required = [...new Set([...(merged.required ?? []), ...normalized.required])];
    }

    if (!merged.type && normalized.type) {
      merged.type = normalized.type;
    }
  }

  return merged;
}

function sampleFromSchema(doc, schema, fieldName = "", depth = 0) {
  if (depth > 8 || !schema) return null;

  let resolved = resolveSchema(doc, schema);
  if (resolved.allOf?.length) {
    resolved = mergeAllOfSchemas(doc, resolved);
  }

  if (resolved.default !== undefined) return resolved.default;
  if (resolved.enum?.length) return resolved.enum[0];
  if (resolved.anyOf?.length) return sampleFromSchema(doc, resolved.anyOf[0], fieldName, depth + 1);
  if (resolved.oneOf?.length) return sampleFromSchema(doc, resolved.oneOf[0], fieldName, depth + 1);

  const lowered = fieldName.toLowerCase();

  switch (resolved.type) {
    case "string":
      if (resolved.format === "date-time") return new Date().toISOString();
      if (resolved.format === "binary") return "__binary__";
      if (lowered.includes("username")) return HAS_CREDENTIALS ? USERNAME : "invalid-user";
      if (lowered.includes("password")) return HAS_CREDENTIALS ? PASSWORD : "invalid-password";
      if (lowered === "day") return "monday";
      if (lowered === "day_time") return "breakfast";
      return "sample";
    case "integer":
      return 1;
    case "number":
      return 1;
    case "boolean":
      return true;
    case "array": {
      const item = sampleFromSchema(doc, resolved.items, fieldName, depth + 1);
      return item === null ? [] : [item];
    }
    case "object": {
      const result = {};
      const required = resolved.required ?? [];
      const properties = resolved.properties ?? {};

      for (const key of required) {
        result[key] = sampleFromSchema(doc, properties[key], key, depth + 1);
      }

      if (required.length === 0) {
        for (const [key, value] of Object.entries(properties)) {
          result[key] = sampleFromSchema(doc, value, key, depth + 1);
          break;
        }
      }

      return result;
    }
    default:
      return null;
  }
}

function collectOperations(doc) {
  const probes = [];
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const operation = methods?.[method];
      if (!operation) continue;
      probes.push({ path, method, operation });
    }
  }
  return probes;
}

function buildPath(pathTemplate) {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, name) => {
    const lowered = name.toLowerCase();
    if (lowered.includes("id") || lowered.includes("count")) return "1";
    return "sample";
  });
}

function parameterSample(name, schema) {
  const lowered = name.toLowerCase();
  if (lowered === "lat" || lowered === "latitude") return "53.5703703";
  if (lowered === "lon" || lowered === "longitude") return "10.0633401";
  if (lowered === "radius_meters") return "2000";
  if (lowered === "day") return "monday";
  if (lowered === "day_time") return "breakfast";
  if (lowered.includes("password")) return "invalid-password";
  if (lowered.includes("username")) return "invalid-user";

  const type = schema?.type;
  if (type === "integer" || type === "number") return "1";
  if (type === "boolean") return "true";
  return "sample";
}

function shouldInjectOptionalParameter(name) {
  return ["lat", "lon", "latitude", "longitude", "radius_meters", "day", "day_time"].includes(
    name.toLowerCase(),
  );
}

async function initializeGlobalToken() {
  // Keep a manually injected token (e.g. for local debugging) if present.
  if (GLOBAL_AUTH_TOKEN) {
    return;
  }

  if (!HAS_CREDENTIALS) {
    return;
  }

  const body = new URLSearchParams({
    username: String(USERNAME),
    password: String(PASSWORD),
  });

  const tokenRes = await fetch(`${BASE_URL}/token`, { method: "POST", body });
  if (!tokenRes.ok) {
    return;
  }

  const tokenJson = await tokenRes.json();
  GLOBAL_AUTH_TOKEN = tokenJson?.access_token ?? null;
}

function buildRequestForOperation(doc, probe) {
  const query = new URLSearchParams();
  const pathParams = [];

  for (const parameter of probe.operation.parameters ?? []) {
    if (parameter.in === "path") {
      pathParams.push(parameter);
      continue;
    }

    if (parameter.in !== "query") continue;
    if (!parameter.required && !shouldInjectOptionalParameter(parameter.name)) continue;

    query.set(parameter.name, parameterSample(parameter.name, parameter.schema));
  }

  // The first /week_plan GET route expects these query params.
  if (probe.method === "get" && probe.path === "/week_plan") {
    if (!query.has("day")) query.set("day", "monday");
    if (!query.has("day_time")) query.set("day_time", "breakfast");
  }

  let urlPath = buildPath(probe.path);
  for (const parameter of pathParams) {
    urlPath = urlPath.replace(`{${parameter.name}}`, parameterSample(parameter.name, parameter.schema));
  }

  const url = `${BASE_URL}${urlPath}${query.size > 0 ? `?${query.toString()}` : ""}`;

  const headers = new Headers();
  const token = PROTECTED_PATHS.has(probe.path) ? GLOBAL_AUTH_TOKEN : null;
  if (token) {
    headers.set("Authorization", token.startsWith("Bearer ") ? token : `Bearer ${token}`);
  }

  const init = {
    method: probe.method.toUpperCase(),
    headers,
  };

  if (probe.method === "get") {
    return { url, init };
  }

  const content = probe.operation.requestBody?.content ?? {};

  if (content["application/x-www-form-urlencoded"]) {
    const body = new URLSearchParams();
    const sample = sampleFromSchema(doc, content["application/x-www-form-urlencoded"].schema);

    if (probe.path === "/token") {
      body.set("username", HAS_CREDENTIALS ? String(USERNAME) : "invalid-user");
      body.set("password", HAS_CREDENTIALS ? String(PASSWORD) : "invalid-password");
    } else if (isRecord(sample)) {
      for (const [key, value] of Object.entries(sample)) {
        body.set(key, value === null ? "" : String(value));
      }
    }

    init.body = body;
    return { url, init };
  }

  if (content["multipart/form-data"]) {
    if (probe.path === "/post_catalogue") {
      const formData = new FormData();
      formData.append("lat", "50.1109");
      formData.append("lon", "8.6821");
      formData.append("name", "sample-market");
      formData.append(
        "catalogue",
        new Blob(["%PDF-1.4\n%mock-catalogue\n"], { type: "application/pdf" }),
        "sample.pdf",
      );
      init.body = formData;
      return { url, init };
    }

    const sample = sampleFromSchema(doc, content["multipart/form-data"].schema);
    const formData = new FormData();

    if (isRecord(sample)) {
      for (const [key, value] of Object.entries(sample)) {
        const isFile = value === "__binary__" || /file|audio|catalogue/i.test(key.toLowerCase());
        if (isFile) {
          formData.append(
            key,
            new Blob(["integration-test-payload"], { type: "text/plain" }),
            "sample.txt",
          );
        } else {
          formData.append(key, value === null ? "" : String(value));
        }
      }
    }

    if ([...formData.keys()].length === 0) {
      formData.append(
        "catalogue",
        new Blob(["integration-test-payload"], { type: "text/plain" }),
        "sample.txt",
      );
    }

    init.body = formData;
    return { url, init };
  }

  if (content["application/json"] || probe.operation.requestBody) {
    const sample = sampleFromSchema(doc, content["application/json"]?.schema) ?? {};
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(sample);
  }

  return { url, init };
}

async function requestOperation(doc, probe) {
  const { url, init } = buildRequestForOperation(doc, probe);

  const started = performance.now();
  const response = await fetch(url, init);
  const durationMs = performance.now() - started;
  const rawText = await response.text();

  let json = null;
  if (rawText.length > 0) {
    try {
      json = JSON.parse(rawText);
    } catch {
      json = null;
    }
  }

  return { response, durationMs, url, json, rawText };
}

function statusTone(status) {
  if (status >= 200 && status < 300) return "green";
  if (status >= 400 && status < 500) return "yellow";
  return "red";
}

function renderGauge(value, max, width = 20) {
  const ratio = Math.min(1, max <= 0 ? 1 : value / max);
  const filled = Math.round(ratio * width);
  const bar = "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));

  const tone = ratio > 0.9 ? "red" : ratio > 0.7 ? "yellow" : "green";
  return color(bar, tone);
}

function fmtMs(ms) {
  return `${ms.toFixed(1)}ms`;
}

function row(parts) {
  return parts.join(" ");
}

function section(title) {
  console.log("\n" + color(`┏━ ${title}`, "cyan"));
}

async function main() {
  section("Server TUI Report");
  console.log(row([color("base:", "gray"), BASE_URL]));
  console.log(row([color("samples:", "gray"), String(SAMPLES)]));
  console.log(
    row([
      color("credentials(env):", "gray"),
      HAS_CREDENTIALS ? color("provided", "green") : color("missing", "yellow"),
    ]),
  );
  console.log(
    row([
      color("token(initial):", "gray"),
      GLOBAL_AUTH_TOKEN ? color("present", "green") : color("missing", "yellow"),
    ]),
  );

  const openApiResponse = await fetch(`${BASE_URL}/openapi.json`);
  if (!openApiResponse.ok) {
    throw new Error(`Failed to load OpenAPI: HTTP ${openApiResponse.status}`);
  }

  const doc = await openApiResponse.json();
  const probes = collectOperations(doc);

  await initializeGlobalToken();
  console.log(
    row([
      color("token(active):", "gray"),
      GLOBAL_AUTH_TOKEN ? color("present", "green") : color("missing", "yellow"),
    ]),
  );

  section("Feature Sweep");

  const featureResults = [];
  let skipCount = 0;
  for (const probe of probes) {
    if (SKIP_PROBE_PATHS.has(probe.path)) {
      skipCount += 1;
      console.log(
        row([
          color("SKIP", "cyan"),
          color(probe.method.toUpperCase().padEnd(6), "blue"),
          probe.path.padEnd(30),
          color("n/a".padStart(8), "gray"),
          color("-".padStart(10), "gray"),
        ]),
      );
      continue;
    }

    const protectedPath = PROTECTED_PATHS.has(probe.path);
    const result = await requestOperation(doc, probe);

    let ok;
    if (protectedPath && !GLOBAL_AUTH_TOKEN) {
      ok = result.response.status === 401;
    } else {
      ok = result.response.status < 500;
    }

    featureResults.push({
      key: `${probe.method.toUpperCase()} ${probe.path}`,
      status: result.response.status,
      latency: result.durationMs,
      ok,
    });

    const statusLabel = ok ? color("PASS", "green") : color("FAIL", "red");
    const statusCode = color(String(result.response.status), statusTone(result.response.status));

    console.log(
      row([
        statusLabel,
        color(probe.method.toUpperCase().padEnd(6), "blue"),
        probe.path.padEnd(30),
        color(statusCode.padStart(8), "reset"),
        color(fmtMs(result.durationMs).padStart(10), "gray"),
      ]),
    );
  }

  const passCount = featureResults.filter((entry) => entry.ok).length;
  const failCount = featureResults.length - passCount;
  console.log(
    row([
      color("summary:", "gray"),
      color(`${passCount} pass`, "green"),
      color(`${failCount} fail`, failCount > 0 ? "red" : "green"),
      color(`${skipCount} skipped`, "cyan"),
      color(`${featureResults.length + skipCount} total`, "cyan"),
    ]),
  );

  section("Latency Distribution");

  const latencyProbes = probes.filter((probe) => probe.method === "get" && LATENCY_PATHS.includes(probe.path));
  const latenciesByEndpoint = new Map();
  const allLatencies = [];

  for (let i = 0; i < SAMPLES; i += 1) {
    for (const probe of latencyProbes) {
      const protectedPath = PROTECTED_PATHS.has(probe.path);
      if (protectedPath && !GLOBAL_AUTH_TOKEN) continue;

      const result = await requestOperation(doc, probe);
      if (result.response.status >= 500) continue;

      const key = `${probe.method.toUpperCase()} ${probe.path}`;
      if (!latenciesByEndpoint.has(key)) latenciesByEndpoint.set(key, []);
      latenciesByEndpoint.get(key).push(result.durationMs);
      allLatencies.push(result.durationMs);
    }
  }

  for (const [key, values] of latenciesByEndpoint.entries()) {
    const p50 = percentile(values, 50);
    const p95 = percentile(values, 95);
    const p99 = percentile(values, 99);
    const endpointPass = p95 <= MAX_ENDPOINT_P95;

    console.log(
      row([
        endpointPass ? color("OK  ", "green") : color("WARN", "yellow"),
        key.padEnd(24),
        color(`p50 ${fmtMs(p50)}`.padStart(12), "gray"),
        color(`p95 ${fmtMs(p95)}`.padStart(12), p95 <= MAX_ENDPOINT_P95 ? "green" : "yellow"),
        color(`p99 ${fmtMs(p99)}`.padStart(12), p99 <= MAX_P99 ? "green" : "yellow"),
        renderGauge(p95, MAX_ENDPOINT_P95),
      ]),
    );
  }

  const globalP50 = percentile(allLatencies, 50);
  const globalP95 = percentile(allLatencies, 95);
  const globalP99 = percentile(allLatencies, 99);
  const globalMean = mean(allLatencies);
  const globalStd = stdDev(allLatencies);

  console.log("\n" + color("Global", "cyan"));
  console.log(row([color("p50:", "gray"), fmtMs(globalP50)]));
  console.log(row([color("p95:", "gray"), fmtMs(globalP95), renderGauge(globalP95, MAX_P95)]));
  console.log(row([color("p99:", "gray"), fmtMs(globalP99), renderGauge(globalP99, MAX_P99)]));
  console.log(row([color("mean:", "gray"), fmtMs(globalMean)]));
  console.log(row([color("stddev:", "gray"), fmtMs(globalStd)]));

  const budgetsPassed =
    globalP95 <= MAX_P95 &&
    globalP99 <= MAX_P99 &&
    [...latenciesByEndpoint.values()].every((values) => percentile(values, 95) <= MAX_ENDPOINT_P95);

  section("Verdict");
  if (failCount > 0 || !budgetsPassed) {
    console.log(color("✖ server checks found failures or latency budget regressions", "red"));
    process.exitCode = 1;
  } else {
    console.log(color("✔ server checks passed with latency budgets respected", "green"));
  }
}

main().catch((error) => {
  console.error(color(`error: ${error?.message ?? String(error)}`, "red"));
  process.exit(1);
});
