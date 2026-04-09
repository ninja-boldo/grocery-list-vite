import { beforeAll, describe, expect, it } from "vitest";

type JsonObject = Record<string, unknown>;
type HttpMethod = "get" | "post" | "put" | "delete" | "patch";

type OpenApiSchema = {
  $ref?: string;
  type?: string;
  format?: string;
  enum?: unknown[];
  default?: unknown;
  anyOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  allOf?: OpenApiSchema[];
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
};

type OpenApiParameter = {
  name: string;
  in: "query" | "path" | "header" | "cookie";
  required?: boolean;
  schema?: OpenApiSchema;
};

type OpenApiOperation = {
  operationId?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: OpenApiSchema }>;
  };
};

type OpenApiDocument = {
  paths: Record<string, Partial<Record<HttpMethod, OpenApiOperation>>>;
  components?: {
    schemas?: Record<string, OpenApiSchema>;
  };
};

type OperationProbe = {
  path: string;
  method: HttpMethod;
  operation: OpenApiOperation;
};

const SHOULD_RUN = process.env.RUN_SERVER_INTEGRATION_TESTS === "1";
const SERVER_BASE_URL = (process.env.SERVER_BASE_URL ?? "http://localhost:3030").replace(/\/$/, "");
const SERVER_MAX_P95_MS = Number(process.env.SERVER_MAX_P95_MS ?? 1500);
const SERVER_MAX_P99_MS = Number(process.env.SERVER_MAX_P99_MS ?? 3000);
const SERVER_MAX_ENDPOINT_P95_MS = Number(
  process.env.SERVER_MAX_ENDPOINT_P95_MS ?? 2200,
);
const SERVER_SPEED_SAMPLES = Number(process.env.SERVER_SPEED_SAMPLES ?? 8);
const SERVER_USER = process.env.SERVER_USER;
const SERVER_PASSWORD = process.env.SERVER_PASSWORD;
const HAS_CREDENTIALS = Boolean(SERVER_USER && SERVER_PASSWORD);

const HTTP_METHODS: HttpMethod[] = ["get", "post", "put", "delete", "patch"];

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

const LATENCY_PATHS = [
  "/health",
  "/fetch_items",
  "/recipes",
  "/planner_settings",
  "/week_plan",
];

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const maybeRecord = (value: unknown): JsonObject | null =>
  isRecord(value) ? value : null;

const isStringNumberOrNull = (value: unknown): boolean =>
  value === null || typeof value === "string" || typeof value === "number";

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const stdDev = (values: number[]): number => {
  if (values.length === 0) return 0;
  const m = mean(values);
  const variance = mean(values.map((value) => (value - m) ** 2));
  return Math.sqrt(variance);
};

const refName = (ref: string): string => ref.split("/").pop() ?? ref;

function resolveSchema(doc: OpenApiDocument, schema?: OpenApiSchema): OpenApiSchema {
  if (!schema) {
    return {};
  }

  if (!schema.$ref) {
    return schema;
  }

  return doc.components?.schemas?.[refName(schema.$ref)] ?? {};
}

function mergeAllOfSchemas(doc: OpenApiDocument, schema: OpenApiSchema): OpenApiSchema {
  const merged: OpenApiSchema = {
    type: "object",
    properties: {},
    required: [],
  };

  for (const part of schema.allOf ?? []) {
    const resolved = resolveSchema(doc, part);
    const partMerged = resolved.allOf?.length ? mergeAllOfSchemas(doc, resolved) : resolved;

    if (partMerged.properties) {
      merged.properties = { ...merged.properties, ...partMerged.properties };
    }

    if (partMerged.required?.length) {
      merged.required = [...new Set([...(merged.required ?? []), ...partMerged.required])];
    }

    if (!merged.type && partMerged.type) {
      merged.type = partMerged.type;
    }
  }

  return merged;
}

function sampleFromSchema(
  doc: OpenApiDocument,
  schema?: OpenApiSchema,
  fieldName = "",
  depth = 0,
): unknown {
  if (depth > 8 || !schema) {
    return null;
  }

  let resolved = resolveSchema(doc, schema);
  if (resolved.allOf?.length) {
    resolved = mergeAllOfSchemas(doc, resolved);
  }

  if (resolved.default !== undefined) {
    return resolved.default;
  }

  if (resolved.enum?.length) {
    return resolved.enum[0];
  }

  if (resolved.anyOf?.length) {
    return sampleFromSchema(doc, resolved.anyOf[0], fieldName, depth + 1);
  }

  if (resolved.oneOf?.length) {
    return sampleFromSchema(doc, resolved.oneOf[0], fieldName, depth + 1);
  }

  const lowered = fieldName.toLowerCase();

  switch (resolved.type) {
    case "string":
      if (resolved.format === "date-time") return new Date().toISOString();
      if (resolved.format === "binary") return "__binary__";
      if (lowered.includes("username")) return HAS_CREDENTIALS ? SERVER_USER : "invalid-user";
      if (lowered.includes("password")) {
        return HAS_CREDENTIALS ? SERVER_PASSWORD : "invalid-password";
      }
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
      const result: JsonObject = {};
      const required = resolved.required ?? [];
      const properties = resolved.properties ?? {};

      for (const key of required) {
        result[key] = sampleFromSchema(doc, properties[key], key, depth + 1);
      }

      // Some schemas have no required list, but we still want a minimally useful payload.
      if (required.length === 0) {
        for (const [key, propertySchema] of Object.entries(properties)) {
          result[key] = sampleFromSchema(doc, propertySchema, key, depth + 1);
          break;
        }
      }

      return result;
    }

    default:
      return null;
  }
}

function collectOperations(doc: OpenApiDocument): OperationProbe[] {
  const probes: OperationProbe[] = [];

  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = methods[method];
      if (!operation) continue;
      probes.push({ path, method, operation });
    }
  }

  return probes;
}

function buildPath(pathTemplate: string): string {
  return pathTemplate.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const lowered = name.toLowerCase();
    if (lowered.includes("id") || lowered.includes("count")) return "1";
    return "sample";
  });
}

function parameterSample(name: string, schema?: OpenApiSchema): string {
  const lowered = name.toLowerCase();
  if (lowered === "lat" || lowered === "latitude") return "50.1109";
  if (lowered === "lon" || lowered === "longitude") return "8.6821";
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

function shouldInjectOptionalParameter(name: string): boolean {
  const names = [
    "lat",
    "lon",
    "latitude",
    "longitude",
    "radius_meters",
    "day",
    "day_time",
  ];
  return names.includes(name.toLowerCase());
}

function buildRequestForOperation(
  doc: OpenApiDocument,
  probe: OperationProbe,
  token: string | null,
): { url: string; init: RequestInit } {
  const query = new URLSearchParams();
  const pathParams: OpenApiParameter[] = [];

  for (const parameter of probe.operation.parameters ?? []) {
    if (parameter.in === "path") {
      pathParams.push(parameter);
      continue;
    }

    if (parameter.in !== "query") {
      continue;
    }

    if (!parameter.required && !shouldInjectOptionalParameter(parameter.name)) {
      continue;
    }

    query.set(parameter.name, parameterSample(parameter.name, parameter.schema));
  }

  let urlPath = buildPath(probe.path);
  for (const parameter of pathParams) {
    const sample = parameterSample(parameter.name, parameter.schema);
    urlPath = urlPath.replace(`{${parameter.name}}`, sample);
  }

  const url = `${SERVER_BASE_URL}${urlPath}${query.size > 0 ? `?${query.toString()}` : ""}`;

  const headers = new Headers();
  if (token) {
    headers.set("Authorization", token.startsWith("Bearer ") ? token : `Bearer ${token}`);
  }

  const init: RequestInit = {
    method: probe.method.toUpperCase(),
    headers,
  };

  if (probe.method === "get") {
    return { url, init };
  }

  const content = probe.operation.requestBody?.content ?? {};

  if (content["application/x-www-form-urlencoded"]) {
    const formSchema = content["application/x-www-form-urlencoded"].schema;
    const sample = sampleFromSchema(doc, formSchema);
    const body = new URLSearchParams();

    if (probe.path === "/token") {
      body.set("username", HAS_CREDENTIALS ? String(SERVER_USER) : "invalid-user");
      body.set("password", HAS_CREDENTIALS ? String(SERVER_PASSWORD) : "invalid-password");
    } else if (isRecord(sample)) {
      for (const [key, value] of Object.entries(sample)) {
        body.set(key, value === null ? "" : String(value));
      }
    }

    init.body = body;
    return { url, init };
  }

  if (content["multipart/form-data"]) {
    const formSchema = content["multipart/form-data"].schema;
    const sample = sampleFromSchema(doc, formSchema);
    const formData = new FormData();

    if (isRecord(sample)) {
      for (const [key, value] of Object.entries(sample)) {
        const isFile =
          value === "__binary__" || /file|audio|catalogue/i.test(key.toLowerCase());

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
    const jsonSchema = content["application/json"]?.schema;
    const sample = sampleFromSchema(doc, jsonSchema) ?? {};
    headers.set("Content-Type", "application/json");
    init.body = JSON.stringify(sample);
  }

  return { url, init };
}

async function requestJson(path: string, init?: RequestInit) {
  const started = performance.now();
  const response = await fetch(`${SERVER_BASE_URL}${path}`, init);
  const durationMs = performance.now() - started;

  const rawText = await response.text();
  let json: unknown = null;

  if (rawText.length > 0) {
    try {
      json = JSON.parse(rawText);
    } catch {
      json = null;
    }
  }

  return { response, durationMs, json, rawText };
}

async function requestOperation(
  doc: OpenApiDocument,
  probe: OperationProbe,
  token: string | null,
) {
  const { url, init } = buildRequestForOperation(doc, probe, token);
  const started = performance.now();
  const response = await fetch(url, init);
  const durationMs = performance.now() - started;
  const rawText = await response.text();

  let json: unknown = null;
  if (rawText.length > 0) {
    try {
      json = JSON.parse(rawText);
    } catch {
      json = null;
    }
  }

  return {
    url,
    response,
    durationMs,
    rawText,
    json,
  };
}

let openApiDoc: OpenApiDocument;
let operationProbes: OperationProbe[] = [];
let authToken: string | null = null;

const getAuthHeaders = (): HeadersInit => ({
  Authorization: authToken?.startsWith("Bearer ") ? String(authToken) : `Bearer ${String(authToken)}`,
});

describe.runIf(SHOULD_RUN)("Server API integration (JS side)", () => {
  beforeAll(async () => {
    const { response } = await requestJson("/health");
    expect(response.ok).toBe(true);

    const openApiResponse = await fetch(`${SERVER_BASE_URL}/openapi.json`);
    expect(openApiResponse.ok).toBe(true);

    const parsedOpenApi = (await openApiResponse.json()) as OpenApiDocument;
    openApiDoc = parsedOpenApi;
    operationProbes = collectOperations(parsedOpenApi);
    expect(operationProbes.length).toBeGreaterThan(0);

    if (HAS_CREDENTIALS) {
      const body = new URLSearchParams({
        username: String(SERVER_USER),
        password: String(SERVER_PASSWORD),
      });

      const tokenResponse = await fetch(`${SERVER_BASE_URL}/token`, {
        method: "POST",
        body,
      });
      const tokenJson = (await tokenResponse.json()) as JsonObject;

      expect(tokenResponse.status).toBe(200);
      expect(typeof tokenJson.access_token).toBe("string");
      authToken = String(tokenJson.access_token);
    }
  }, 15000);

  it("/health returns expected response schema", async () => {
    const { response, json } = await requestJson("/health");

    expect(response.status).toBe(200);
    expect(isRecord(json)).toBe(true);

    if (!isRecord(json)) {
      return;
    }

    expect(typeof json.status).toBe("string");
    expect(typeof json.timestamp).toBe("string");
    expect(typeof json.database).toBe("string");
    expect(typeof json.whisper).toBe("string");
  });

  it("/fetch_items returns stable payload schema", async () => {
    const init = HAS_CREDENTIALS && authToken ? { headers: getAuthHeaders() } : undefined;
    const { response, json } = await requestJson(
      "/fetch_items?only_wish_list=false&sortOrder=new-old&skip=0&limit=5",
      init,
    );

    if (!HAS_CREDENTIALS) {
      expect(response.status).toBe(401);
      return;
    }

    expect(response.ok).toBe(true);
    expect(isRecord(json)).toBe(true);

    if (!isRecord(json)) {
      return;
    }

    const items = asArray(json.items);
    expect(Array.isArray(items)).toBe(true);
    expect(typeof json.distinct_items).toBe("number");
    expect(typeof json.accumulated_count).toBe("number");

    for (const item of items) {
      expect(isRecord(item)).toBe(true);
      if (!isRecord(item)) {
        continue;
      }

      expect(isStringNumberOrNull(item.ean)).toBe(true);
      expect(item.text === null || typeof item.text === "string").toBe(true);
      expect(typeof item.count).toBe("number");
      expect(Array.isArray(item.perish_dates)).toBe(true);
      expect(typeof item.imageUrl).toBe("string");
      expect(item.shortened_name === null || typeof item.shortened_name === "string").toBe(true);
      expect(item.tags === null || typeof item.tags === "string").toBe(true);
      expect(Array.isArray(item.mapped_items)).toBe(true);
    }
  });

  it("/recipes returns expected payload schema", async () => {
    const init = HAS_CREDENTIALS && authToken ? { headers: getAuthHeaders() } : undefined;
    const { response, json } = await requestJson("/recipes", init);

    if (!HAS_CREDENTIALS) {
      expect(response.status).toBe(401);
      return;
    }

    expect(response.ok).toBe(true);
    expect(isRecord(json)).toBe(true);

    if (!isRecord(json)) {
      return;
    }

    const recipes = asArray(json.recipes);
    expect(Array.isArray(recipes)).toBe(true);
    expect(typeof json.recipe_count).toBe("number");

    for (const recipe of recipes) {
      expect(isRecord(recipe)).toBe(true);
      if (!isRecord(recipe)) {
        continue;
      }

      expect(typeof recipe.recipe_id).toBe("number");
      expect(recipe.base_time === null || typeof recipe.base_time === "number").toBe(true);
      expect(recipe.default_portions === null || typeof recipe.default_portions === "number").toBe(true);
      expect(recipe.tags === null || Array.isArray(recipe.tags)).toBe(true);
      expect(recipe.emoji === null || typeof recipe.emoji === "string").toBe(true);
      expect(Array.isArray(recipe.ingredients)).toBe(true);
    }
  });

  it("/get_supermarkets_close validates missing coordinates", async () => {
    const init = HAS_CREDENTIALS && authToken ? { headers: getAuthHeaders() } : undefined;
    const { response, json } = await requestJson("/get_supermarkets_close", init);

    if (!HAS_CREDENTIALS) {
      expect(response.status).toBe(401);
      return;
    }

    expect(response.status).toBe(400);
    expect(isRecord(json)).toBe(true);
    if (!isRecord(json)) {
      return;
    }

    expect(typeof json.detail).toBe("string");
  });

  it("/add_new_market returns structured validation error for incomplete body", async () => {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
      ...(HAS_CREDENTIALS && authToken ? getAuthHeaders() : {}),
    };

    const { response, json } = await requestJson("/add_new_market", {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });

    if (!HAS_CREDENTIALS) {
      expect(response.status).toBe(401);
      return;
    }

    // Endpoint currently reports validation issues in payload while returning 200.
    expect(response.status).toBe(200);
    expect(isRecord(json)).toBe(true);
    if (!isRecord(json)) {
      return;
    }

    expect(json.status).toBe("error");
    expect(typeof json.message).toBe("string");
    expect(json.code).toBe("400");
  });

  it("/get_catalogue_offers returns list payload with coordinates", async () => {
    const init = HAS_CREDENTIALS && authToken ? { headers: getAuthHeaders() } : undefined;
    const { response, json } = await requestJson(
      "/get_catalogue_offers?longitude=8.6821&latitude=50.1109",
      init,
    );

    if (!HAS_CREDENTIALS) {
      expect(response.status).toBe(401);
      return;
    }

    expect(response.status).toBeLessThan(500);
    expect(isRecord(json)).toBe(true);
    if (!isRecord(json)) {
      return;
    }

    expect(Array.isArray(json.items)).toBe(true);
    expect(typeof json.count).toBe("number");
  });

  it(
    "probes all OpenAPI operations (feature sweep)",
    async () => {
      const seen = new Set<string>();

      for (const probe of operationProbes) {
        const signature = `${probe.method.toUpperCase()} ${probe.path}`;
        seen.add(signature);

        const isProtected = PROTECTED_PATHS.has(probe.path);
        const token = HAS_CREDENTIALS && isProtected ? authToken : null;

        const result = await requestOperation(openApiDoc, probe, token);

        if (isProtected && !HAS_CREDENTIALS) {
          expect(result.response.status).toBe(401);
          continue;
        }

        expect(result.response.status).toBeLessThan(500);
      }

      expect(seen.size).toBe(operationProbes.length);
    },
    120000,
  );

  it(
    "checks auth gate behavior for protected endpoints when no credentials are configured",
    async () => {
      if (HAS_CREDENTIALS) {
        return;
      }

      const protectedOps = operationProbes.filter((probe) =>
        PROTECTED_PATHS.has(probe.path),
      );
      expect(protectedOps.length).toBeGreaterThan(0);

      for (const probe of protectedOps) {
        const result = await requestOperation(openApiDoc, probe, null);
        expect(result.response.status).toBe(401);
      }
    },
    60000,
  );

  it(
    "latency distribution stays within configured budgets",
    async () => {
      const latencyProbes = operationProbes.filter(
        (probe) => probe.method === "get" && LATENCY_PATHS.includes(probe.path),
      );

      expect(latencyProbes.length).toBeGreaterThan(0);

      const latenciesByEndpoint: Record<string, number[]> = {};
      const allLatencies: number[] = [];

      for (let i = 0; i < SERVER_SPEED_SAMPLES; i += 1) {
        for (const probe of latencyProbes) {
          const isProtected = PROTECTED_PATHS.has(probe.path);
          const token = HAS_CREDENTIALS && isProtected ? authToken : null;
          if (isProtected && !token) {
            continue;
          }

          const key = `${probe.method.toUpperCase()} ${probe.path}`;
          const result = await requestOperation(openApiDoc, probe, token);

          expect(result.response.status).toBeLessThan(500);

          latenciesByEndpoint[key] ??= [];
          latenciesByEndpoint[key].push(result.durationMs);
          allLatencies.push(result.durationMs);
        }
      }

      expect(allLatencies.length).toBeGreaterThan(0);

      for (const endpointLatencies of Object.values(latenciesByEndpoint)) {
        const endpointP95 = percentile(endpointLatencies, 95);
        expect(endpointP95).toBeLessThanOrEqual(SERVER_MAX_ENDPOINT_P95_MS);
      }

      const p95 = percentile(allLatencies, 95);
      const p99 = percentile(allLatencies, 99);
      const avg = mean(allLatencies);
      const spread = stdDev(allLatencies);

      expect(p95).toBeLessThanOrEqual(SERVER_MAX_P95_MS);
      expect(p99).toBeLessThanOrEqual(SERVER_MAX_P99_MS);

      // Keep a sanity bound on variance growth under small sample windows.
      expect(avg + 4 * spread).toBeLessThanOrEqual(SERVER_MAX_P99_MS * 2);
    },
    180000,
  );
});

describe.skipIf(SHOULD_RUN)("Server API integration (JS side)", () => {
  it("is opt-in", () => {
    expect(SHOULD_RUN).toBe(false);
  });
});
