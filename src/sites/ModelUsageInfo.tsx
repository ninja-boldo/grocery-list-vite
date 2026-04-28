import React, { useState, useEffect, useMemo } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { useTheme } from "../ctx/ThemeContext";

// =======================
// 1. Model Cost Dictionary
// =======================
interface ModelCost {
  inputCostPerMillion: number;
  outputCostPerMillion: number;
}

const PROVIDER_MAP = [
  { urlContains: "generativelanguage.googleapis.com", name: "Google" },
  { urlContains: "api.openai.com", name: "OpenAI" },
  { urlContains: "api.anthropic.com", name: "Anthropic" },
  { urlContains: "api.groq.com", name: "Groq" },
  { urlContains: "openrouter.ai", name: "OpenRouter" },
  { urlContains: "api.fireworks.ai", name: "Fireworks AI" },
  { urlContains: "api.together.xyz", name: "Together AI" },
  { urlContains: "api.deepseek.com", name: "DeepSeek" },
];

const getProviderName = (url: string | null | undefined) => {
  if (!url) return "Unknown";
  for (const provider of PROVIDER_MAP) {
    if (url.includes(provider.urlContains)) return provider.name;
  }
  return "Other";
};

// =======================
// 2. Model Normalization
// =======================
// Maps canonical model keys to one or more alias substrings (matched case-insensitively).
// Order matters: more specific aliases should come before broader ones.
const MODEL_ALIASES: [canonical: string, aliases: string[]][] = [
  // ── Anthropic ──────────────────────────────────────────────────────────────
  ["claude-3.7-sonnet", ["claude-3-7", "claude-3.7"]],
  [
    "claude-3.5-sonnet",
    [
      "claude-3-5-sonnet",
      "claude-3.5-sonnet",
      "claude35-sonnet",
      "claude3-5-sonnet",
    ],
  ],
  [
    "claude-3.5-haiku",
    ["claude-3-5-haiku", "claude-3.5-haiku", "claude35-haiku"],
  ],
  ["claude-3-opus", ["claude-3-opus", "claude-3.0-opus", "claude3-opus"]],
  [
    "claude-3-sonnet",
    ["claude-3-sonnet", "claude-3.0-sonnet", "claude3-sonnet"],
  ],
  ["claude-3-haiku", ["claude-3-haiku", "claude-3.0-haiku", "claude3-haiku"]],

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  ["gpt-oss-120b", ["gpt-oss-120b", "gpt-os-120b"]],
  ["gpt-oss-20b", ["gpt-oss-20b", "gpt-os-20b"]],
  ["o3-mini", ["o3-mini"]],
  ["o3", ["o3-2025", "/o3"]],
  ["o1-preview", ["o1-preview"]],
  ["o1-mini", ["o1-mini"]],
  ["o1", ["o1-2024", "/o1", "o1-all"]],
  ["gpt-4o-mini", ["gpt-4o-mini", "gpt4o-mini"]],
  ["gpt-4o", ["gpt-4o", "gpt4o"]],
  ["gpt-4-turbo", ["gpt-4-turbo", "gpt4-turbo", "gpt-4-1106"]],
  ["gpt-4", ["gpt-4-0", "gpt-4-0314", "gpt-4-32k", "/gpt-4"]],
  ["gpt-3.5-turbo", ["gpt-3.5-turbo", "gpt35-turbo", "gpt-3.5"]],

  // ── Google ─────────────────────────────────────────────────────────────────
  ["gemini-3.1-pro", ["gemini-3.1-pro", "gemini-3-1-pro"]],
  ["gemini-3.1-flash-lite", ["gemini-3.1-flash-lite", "gemini-3-1-flash-lite"]],
  ["gemini-3.1-flash", ["gemini-3.1-flash", "gemini-3-1-flash"]],
  ["gemini-2.5-pro", ["gemini-2.5-pro"]],
  ["gemini-2.5-flash-lite", ["gemini-2.5-flash-lite"]],
  ["gemini-2.5-flash", ["gemini-2.5-flash"]],
  ["gemini-2.0-pro", ["gemini-2.0-pro"]],
  [
    "gemini-2.0-flash-thinking",
    ["gemini-2.0-flash-thinking", "flash-thinking"],
  ],
  ["gemini-2.0-flash-lite", ["gemini-2.0-flash-lite", "flash-lite"]],
  ["gemini-2.0-flash", ["gemini-2.0-flash"]],
  ["gemini-1.5-pro", ["gemini-1.5-pro"]],
  ["gemini-1.5-flash-8b", ["gemini-1.5-flash-8b", "flash-8b"]],
  ["gemini-1.5-flash", ["gemini-1.5-flash"]],
  ["gemini-1.0-pro", ["gemini-1.0-pro", "gemini-pro"]],

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  ["deepseek-r1-distill", ["r1-distill"]],
  ["deepseek-r1", ["deepseek-r1", "deepseek-reasoner"]],
  ["deepseek-v3", ["deepseek-v3", "deepseek-chat"]],

  // ── Meta / Llama ───────────────────────────────────────────────────────────
  [
    "llama-3.3-70b",
    ["llama-3.3-70b", "llama3.3-70b", "llama-3.3-70b-versatile"],
  ],
  ["llama-3.2-90b", ["llama-3.2-90b", "llama3.2-90b", "llama-3.2-90b-vision"]],
  ["llama-3.2-11b", ["llama-3.2-11b", "llama3.2-11b", "llama-3.2-11b-vision"]],
  ["llama-3.2-3b", ["llama-3.2-3b", "llama3.2-3b"]],
  ["llama-3.2-1b", ["llama-3.2-1b", "llama3.2-1b"]],
  ["llama-3.1-405b", ["llama-3.1-405b", "llama-3.1-405"]],
  ["llama-3.1-70b", ["llama-3.1-70b", "llama-3.1-70"]],
  ["llama-3.1-8b", ["llama-3.1-8b", "llama-3.1-8"]],
  ["llama-3-70b", ["llama-3-70b", "llama3-70b"]],
  ["llama-3-8b", ["llama-3-8b", "llama3-8b"]],

  // ── Mistral ────────────────────────────────────────────────────────────────
  ["mistral-large", ["mistral-large"]],
  ["mistral-small", ["mistral-small"]],
  ["mistral-7b", ["mistral-7b", "open-mistral-7b"]],
  ["mixtral-8x22b", ["mixtral-8x22b"]],
  ["mixtral-8x7b", ["mixtral-8x7b"]],

  // ── Google/Gemma ───────────────────────────────────────────────────────────
  ["gemma-2-27b", ["gemma-2-27b", "gemma2-27b"]],
  ["gemma-2-9b", ["gemma-2-9b", "gemma2-9b"]],
  ["gemma-7b", ["gemma-7b", "gemma-7b-it"]],

  // ── xAI / Grok ─────────────────────────────────────────────────────────────
  ["grok-3", ["grok-3"]],
  ["grok-2", ["grok-2"]],
];

/**
 * Normalises a raw model string returned by the API into a canonical key
 * present in MODEL_COSTS. Returns the input unchanged if no alias matches,
 * so previously-unseen models still appear in the UI rather than silently
 * collapsing to "default".
 */
export const normalizeModelName = (raw: string | null | undefined): string => {
  if (!raw) return "unknown";
  const lower = raw.toLowerCase();
  for (const [canonical, aliases] of MODEL_ALIASES) {
    if (aliases.some((a) => lower.includes(a))) return canonical;
  }
  return raw; // pass through — still visible in the UI
};

// =======================
// 3. Pricing Table (per-million tokens, USD, mid-2025)
// =======================
const MODEL_COSTS: Record<string, ModelCost> = {
  // ── Anthropic (The Claude 4 & 3 Generations) ──────────────────────────────
  "claude-4.7-opus": { inputCostPerMillion: 5.0, outputCostPerMillion: 25.0 },
  "claude-4.6-sonnet": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "claude-4.5-haiku": { inputCostPerMillion: 0.8, outputCostPerMillion: 4.0 },
  "claude-3.7-sonnet": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "claude-3.5-sonnet": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "claude-3.5-haiku": { inputCostPerMillion: 0.25, outputCostPerMillion: 1.25 },
  "claude-3-opus": { inputCostPerMillion: 15.0, outputCostPerMillion: 75.0 },
  "claude-3-sonnet": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "claude-3-haiku": { inputCostPerMillion: 0.25, outputCostPerMillion: 1.25 },

  // ── OpenAI (The GPT-5 & GPT-4 Families) ───────────────────────────────────
  "gpt-5.4": { inputCostPerMillion: 2.5, outputCostPerMillion: 15.0 },
  "gpt-5.1": { inputCostPerMillion: 1.25, outputCostPerMillion: 10.0 },
  "gpt-5-mini": { inputCostPerMillion: 0.25, outputCostPerMillion: 1.0 },
  "gpt-5-nano": { inputCostPerMillion: 0.05, outputCostPerMillion: 0.4 },
  "o3-high": { inputCostPerMillion: 2.0, outputCostPerMillion: 8.0 },
  "o3-mini": { inputCostPerMillion: 1.1, outputCostPerMillion: 4.4 },
  o1: { inputCostPerMillion: 15.0, outputCostPerMillion: 60.0 },
  "o1-mini": { inputCostPerMillion: 3.0, outputCostPerMillion: 12.0 },
  "gpt-4o": { inputCostPerMillion: 2.5, outputCostPerMillion: 10.0 },
  "gpt-4o-mini": { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  "gpt-4-turbo": { inputCostPerMillion: 10.0, outputCostPerMillion: 30.0 },
  "gpt-4": { inputCostPerMillion: 30.0, outputCostPerMillion: 60.0 },
  "gpt-3.5-turbo": { inputCostPerMillion: 0.5, outputCostPerMillion: 1.5 },
  "gpt-oss-120b": { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  "gpt-oss-20b": { inputCostPerMillion: 0.075, outputCostPerMillion: 0.3 },

  // ── Google Gemini (Ultra-Long Context) ────────────────────────────────────
  "gemini-3.1-pro": { inputCostPerMillion: 2.0, outputCostPerMillion: 12.0 },
  "gemini-3.1-flash": { inputCostPerMillion: 0.5, outputCostPerMillion: 3.0 },
  "gemini-3.1-flash-lite": {
    inputCostPerMillion: 0.25,
    outputCostPerMillion: 1.5,
  },
  "gemini-2.5-pro": { inputCostPerMillion: 1.25, outputCostPerMillion: 10.0 },
  "gemini-2.5-flash": { inputCostPerMillion: 0.3, outputCostPerMillion: 2.5 },
  "gemini-2.0-flash-thinking": {
    inputCostPerMillion: 0.5,
    outputCostPerMillion: 1.5,
  },
  "gemini-1.5-pro": { inputCostPerMillion: 1.25, outputCostPerMillion: 3.75 },
  "gemini-1.5-flash-8b": {
    inputCostPerMillion: 0.037,
    outputCostPerMillion: 0.15,
  },
  "gemini-1.5-flash": { inputCostPerMillion: 0.075, outputCostPerMillion: 0.3 },
  "gemini-1.0-pro": { inputCostPerMillion: 0.5, outputCostPerMillion: 1.5 },

  // ── DeepSeek (The Economy Class) ──────────────────────────────────────────
  "deepseek-v4-pro": { inputCostPerMillion: 1.74, outputCostPerMillion: 3.48 },
  "deepseek-v4-flash": {
    inputCostPerMillion: 0.14,
    outputCostPerMillion: 0.28,
  },
  "deepseek-v3.2": { inputCostPerMillion: 0.25, outputCostPerMillion: 0.38 },
  "deepseek-r1": { inputCostPerMillion: 0.55, outputCostPerMillion: 2.19 },
  "deepseek-v3": { inputCostPerMillion: 0.27, outputCostPerMillion: 1.1 },

  // ── Meta Llama (Llama 4 & 3) ──────────────────────────────────────────────
  "llama-4-maverick": { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  "llama-4-scout": { inputCostPerMillion: 0.08, outputCostPerMillion: 0.3 },
  "llama-3.3-70b": { inputCostPerMillion: 0.59, outputCostPerMillion: 0.79 },
  "llama-3.2-90b": { inputCostPerMillion: 0.8, outputCostPerMillion: 0.8 },
  "llama-3.2-11b": { inputCostPerMillion: 0.15, outputCostPerMillion: 0.15 },
  "llama-3.1-405b": { inputCostPerMillion: 1.0, outputCostPerMillion: 1.0 },
  "llama-3.1-70b": { inputCostPerMillion: 0.35, outputCostPerMillion: 0.4 },
  "llama-3.1-8b": { inputCostPerMillion: 0.02, outputCostPerMillion: 0.05 },

  // ── Mistral AI ─────────────────────────────────────────────────────────────
  "mistral-large-3": { inputCostPerMillion: 0.5, outputCostPerMillion: 1.5 },
  "mistral-small-4": { inputCostPerMillion: 0.15, outputCostPerMillion: 0.6 },
  "codestral-2508": { inputCostPerMillion: 0.3, outputCostPerMillion: 0.9 },
  "mixtral-8x22b": { inputCostPerMillion: 1.2, outputCostPerMillion: 1.2 },

  // ── xAI Grok ───────────────────────────────────────────────────────────────
  "grok-4": { inputCostPerMillion: 3.0, outputCostPerMillion: 15.0 },
  "grok-4.1-fast": { inputCostPerMillion: 0.2, outputCostPerMillion: 0.5 },
  "grok-3-mini": { inputCostPerMillion: 0.3, outputCostPerMillion: 0.5 },

  default: { inputCostPerMillion: 0.0, outputCostPerMillion: 0.0 },
};

const getModelCost = (
  rawModel: string,
  customRates: Record<string, ModelCost> = {},
): ModelCost => {
  const canonical = normalizeModelName(rawModel);
  return (
    customRates[canonical] ??
    customRates[rawModel] ??
    MODEL_COSTS[canonical] ??
    MODEL_COSTS.default
  );
};

// =======================
// 4. Component
// =======================
export default function ModelUsageDashboard() {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { theme, toggle } = useTheme();

  // Custom Local Rates
  const [customRates, setCustomRates] = useState<Record<string, ModelCost>>(
    () => {
      try {
        const saved = localStorage.getItem("glb_custom_model_rates");
        return saved ? JSON.parse(saved) : {};
      } catch {
        return {};
      }
    },
  );

  const [newCustModel, setNewCustModel] = useState("");
  const [newCustRawI, setNewCustRawI] = useState("");
  const [newCustRawO, setNewCustRawO] = useState("");

  const addCustomRate = () => {
    if (!newCustModel.trim()) return;
    const rates = {
      ...customRates,
      [newCustModel.trim()]: {
        inputCostPerMillion: Number(newCustRawI) || 0,
        outputCostPerMillion: Number(newCustRawO) || 0,
      },
    };
    setCustomRates(rates);
    localStorage.setItem("glb_custom_model_rates", JSON.stringify(rates));
    setNewCustModel("");
    setNewCustRawI("");
    setNewCustRawO("");
  };

  const removeCustomRate = (model: string) => {
    const rates = { ...customRates };
    delete rates[model];
    setCustomRates(rates);
    localStorage.setItem("glb_custom_model_rates", JSON.stringify(rates));
  };

  // Monthly Assumption Overrides
  const [assumedMonthlyInputTokens, setAssumedMonthlyInputTokens] = useState<
    number | null
  >(null);
  const [assumedMonthlyOutputTokens, setAssumedMonthlyOutputTokens] = useState<
    number | null
  >(null);
  // Cost Overrides
  const [overrideInputCost, setOverrideInputCost] = useState<number | null>(
    null,
  );
  const [overrideOutputCost, setOverrideOutputCost] = useState<number | null>(
    null,
  );
  const [selectedAssumptionModel, setSelectedAssumptionModel] =
    useState<string>("historical-mix");

  // Sorting for Process Table
  const [processSort, setProcessSort] = useState<{
    key: string;
    dir: "asc" | "desc";
  }>({ key: "monthlyCost", dir: "desc" });

  // =======================
  // Fetch stats
  // =======================
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/model_usage");
        if (!response.ok) throw new Error("Failed to fetch stats");
        const data = await response.json();
        setStats(data.stats);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };
    fetchStats();
  }, []);

  // =======================
  // Parse stats — normalise model name on ingestion
  // =======================
  const parsedStats = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats)
      .map(([timestamp, data]: any) => {
        let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        try {
          usage = JSON.parse(data.usage_stats);
        } catch {}
        return {
          timestamp,
          model: normalizeModelName(data.model_name), // ← normalised here
          rawModel: data.model_name,
          provider_url: data.provider_url,
          process: data.process_name || "Unknown",
          ...usage,
        };
      })
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
  }, [stats]);

  // =======================
  // Model & Totals Aggregation
  // =======================
  const modelUsage = useMemo(() => {
    const result: Record<
      string,
      {
        input: number;
        output: number;
        count: number;
        cost: number;
        inputCost: number;
        outputCost: number;
      }
    > = {};
    parsedStats.forEach((item) => {
      if (!result[item.model])
        result[item.model] = {
          input: 0,
          output: 0,
          count: 0,
          cost: 0,
          inputCost: 0,
          outputCost: 0,
        };
      result[item.model].input += item.prompt_tokens;
      result[item.model].output += item.completion_tokens;
      result[item.model].count += 1;

      const rates = getModelCost(item.model, customRates);
      const iCost =
        (item.prompt_tokens / 1_000_000) * rates.inputCostPerMillion;
      const oCost =
        (item.completion_tokens / 1_000_000) * rates.outputCostPerMillion;
      result[item.model].inputCost += iCost;
      result[item.model].outputCost += oCost;
      result[item.model].cost += iCost + oCost;
    });
    return result;
  }, [parsedStats, customRates]);

  const providerUsage = useMemo(() => {
    const result: Record<string, { cost: number; count: number }> = {};
    parsedStats.forEach((item) => {
      const providerName = getProviderName(item.provider_url);
      if (!result[providerName]) result[providerName] = { cost: 0, count: 0 };
      const rates = getModelCost(item.model, customRates);
      const iCost =
        (item.prompt_tokens / 1_000_000) * rates.inputCostPerMillion;
      const oCost =
        (item.completion_tokens / 1_000_000) * rates.outputCostPerMillion;
      result[providerName].cost += iCost + oCost;
      result[providerName].count += 1;
    });
    return result;
  }, [parsedStats, customRates]);

  const processUsage = useMemo(() => {
    const result: Record<
      string,
      {
        cost: number;
        count: number;
        input: number;
        output: number;
        models: Record<string, number>;
        providers: Record<string, number>;
      }
    > = {};
    parsedStats.forEach((item) => {
      const processName = item.process;
      if (!result[processName])
        result[processName] = {
          cost: 0,
          count: 0,
          input: 0,
          output: 0,
          models: {},
          providers: {},
        };
      const rates = getModelCost(item.model, customRates);
      const iCost =
        (item.prompt_tokens / 1_000_000) * rates.inputCostPerMillion;
      const oCost =
        (item.completion_tokens / 1_000_000) * rates.outputCostPerMillion;

      result[processName].cost += iCost + oCost;
      result[processName].count += 1;
      result[processName].input += item.prompt_tokens;
      result[processName].output += item.completion_tokens;

      if (!result[processName].models[item.model])
        result[processName].models[item.model] = 0;
      result[processName].models[item.model] += 1;

      const providerName = getProviderName(item.provider_url);
      if (!result[processName].providers[providerName])
        result[processName].providers[providerName] = 0;
      result[processName].providers[providerName] += 1;
    });
    return result;
  }, [parsedStats, customRates]);

  const totals = useMemo(() => {
    return parsedStats.reduce(
      (acc, item) => {
        acc.input += item.prompt_tokens;
        acc.output += item.completion_tokens;
        return acc;
      },
      { input: 0, output: 0 },
    );
  }, [parsedStats]);

  const historicalInputCost = Object.values(modelUsage).reduce(
    (acc, curr) => acc + curr.inputCost,
    0,
  );
  const historicalOutputCost = Object.values(modelUsage).reduce(
    (acc, curr) => acc + curr.outputCost,
    0,
  );
  const historicalTotalCost = historicalInputCost + historicalOutputCost;

  // =======================
  // Projections
  // =======================
  const timeSpanDays =
    parsedStats.length > 1
      ? Math.max(
          1,
          (new Date(parsedStats[parsedStats.length - 1].timestamp).getTime() -
            new Date(parsedStats[0].timestamp).getTime()) /
            (1000 * 60 * 60 * 24),
        )
      : 1;

  const estimatedMonthlyInput = (totals.input / timeSpanDays) * 30;
  const estimatedMonthlyOutput = (totals.output / timeSpanDays) * 30;

  const monthlyInputTokens =
    assumedMonthlyInputTokens !== null
      ? assumedMonthlyInputTokens
      : Math.round(estimatedMonthlyInput);
  const monthlyOutputTokens =
    assumedMonthlyOutputTokens !== null
      ? assumedMonthlyOutputTokens
      : Math.round(estimatedMonthlyOutput);

  const blendedInputCpm =
    totals.input > 0 ? historicalInputCost / (totals.input / 1_000_000) : 0;
  const blendedOutputCpm =
    totals.output > 0 ? historicalOutputCost / (totals.output / 1_000_000) : 0;

  const activeModelRates =
    selectedAssumptionModel === "historical-mix"
      ? {
          inputCostPerMillion: blendedInputCpm,
          outputCostPerMillion: blendedOutputCpm,
        }
      : getModelCost(selectedAssumptionModel, customRates);

  const cpmInput =
    overrideInputCost !== null
      ? overrideInputCost
      : activeModelRates.inputCostPerMillion;
  const cpmOutput =
    overrideOutputCost !== null
      ? overrideOutputCost
      : activeModelRates.outputCostPerMillion;

  const monthlyProjection =
    (monthlyInputTokens / 1_000_000) * cpmInput +
    (monthlyOutputTokens / 1_000_000) * cpmOutput;

  // Final process array for table
  const processDataArray = useMemo(() => {
    return Object.entries(processUsage)
      .map(([process, data]) => {
        const costPerReq = data.count > 0 ? data.cost / data.count : 0;
        const monthlyReqs = (data.count / timeSpanDays) * 30;
        const monthlyCost = (data.cost / timeSpanDays) * 30;
        return { process, ...data, costPerReq, monthlyReqs, monthlyCost };
      })
      .sort((a, b) => {
        const { key, dir } = processSort;
        let diff = 0;
        if (key === "costPerReq") diff = a.costPerReq - b.costPerReq;
        else if (key === "monthlyReqs") diff = a.monthlyReqs - b.monthlyReqs;
        else if (key === "monthlyCost") diff = a.monthlyCost - b.monthlyCost;
        else if (key === "historicalReqs") diff = a.count - b.count;
        else if (key === "historicalCost") diff = a.cost - b.cost;
        else if (key === "process") diff = a.process.localeCompare(b.process);
        return dir === "asc" ? diff : -diff;
      });
  }, [processUsage, timeSpanDays, processSort]);

  const getSpendingTrend = () => {
    if (parsedStats.length < 2) return "neutral";
    const first = parsedStats[0].total_tokens;
    const last = parsedStats[parsedStats.length - 1].total_tokens;
    if (last > first * 1.1) return "increasing";
    if (last < first * 0.9) return "decreasing";
    return "neutral";
  };
  const trend = getSpendingTrend();

  // =======================
  // Chart Data
  // =======================
  const timeSeries = parsedStats.map((item) => {
    const d = new Date(item.timestamp);
    return {
      timestamp: d.toLocaleDateString() + " " + d.toLocaleTimeString(),
      shortTime: d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      tt: item.total_tokens,
    };
  });

  const dailyUsage = parsedStats.reduce((acc: any[], item) => {
    const day = new Date(item.timestamp).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const existing = acc.find((d) => d.day === day);
    if (existing) existing.total_tokens += item.total_tokens;
    else acc.push({ day, total_tokens: item.total_tokens });
    return acc;
  }, []);

  // =======================
  // Render Helpers
  // =======================
  const MetricCard = ({ label, value, subtext, superscript }: any) => (
    <div
      style={{
        background: "var(--surface)",
        padding: 16,
        borderRadius: 12,
        border: "1px solid var(--border)",
        flex: 1,
        minWidth: 160,
      }}
    >
      <div
        style={{
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 600,
          color: "var(--text-main)",
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {value}
        {superscript && (
          <span
            style={{
              fontSize: "1rem",
              color: "var(--text-muted)",
              fontWeight: 500,
            }}
          >
            {superscript}
          </span>
        )}
        {subtext && (
          <span
            style={{
              fontSize: "0.85rem",
              color: "var(--text-dim)",
              fontWeight: 400,
            }}
          >
            {subtext}
          </span>
        )}
      </div>
    </div>
  );

  if (loading)
    return <div style={{ textAlign: "center", marginTop: 40 }}>Loading...</div>;
  if (error)
    return (
      <div style={{ textAlign: "center", marginTop: 40, color: "red" }}>
        {error}
      </div>
    );

  const handleProcessSort = (key: string) => {
    setProcessSort((prev) => ({
      key,
      dir: prev.key === key ? (prev.dir === "asc" ? "desc" : "asc") : "desc",
    }));
  };

  const ProcessTh = ({
    sortKey,
    label,
    align = "left",
  }: {
    sortKey?: string;
    label: string;
    align?: any;
  }) => (
    <th
      onClick={() => (sortKey ? handleProcessSort(sortKey) : undefined)}
      style={{
        padding: "12px 16px",
        color: "var(--text-muted)",
        fontWeight: 600,
        fontSize: "0.85rem",
        textTransform: "uppercase",
        textAlign: align as any,
        cursor: sortKey ? "pointer" : "default",
        userSelect: "none",
      }}
    >
      {label}
      {sortKey && processSort.key === sortKey && (
        <span style={{ marginLeft: 4 }}>
          {processSort.dir === "asc" ? "↑" : "↓"}
        </span>
      )}
    </th>
  );

  return (
    <div
      data-theme={theme}
      style={{
        maxWidth: 1200,
        margin: "0 auto",
        padding: "32px 16px",
        color: "var(--text-main)",
        display: "flex",
        flexDirection: "column",
        gap: 24,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <h1
            style={{
              fontSize: "2rem",
              fontFamily: "var(--font-display)",
              margin: 0,
            }}
          >
            Model Telemetry
          </h1>
          <p style={{ margin: "4px 0 0", color: "var(--text-muted)" }}>
            Usage metrics and cost projections
          </p>
        </div>
        <button
          onClick={toggle}
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            padding: "8px 12px",
            borderRadius: 8,
            cursor: "pointer",
            color: "var(--text-main)",
            fontWeight: 500,
          }}
        >
          {theme === "dark" ? "☀️ Light Theme" : "🌙 Dark Theme"}
        </button>
      </div>

      {/* Main Aggregates */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
        <MetricCard
          label="Historical Input"
          value={totals.input.toLocaleString()}
          subtext="tokens"
        />
        <MetricCard
          label="Historical Output"
          value={totals.output.toLocaleString()}
          subtext="tokens"
        />
        <MetricCard
          label="Total Requests"
          value={parsedStats.length.toLocaleString()}
        />
        <MetricCard
          label="Historical Cost"
          value={`$${historicalTotalCost.toFixed(4)}`}
          superscript={
            historicalTotalCost > 0 && historicalTotalCost < 0.1
              ? `(${(historicalTotalCost * 100).toFixed(2)}¢)`
              : ""
          }
          subtext="actual rates"
        />
      </div>

      {/* Monthly Projection Config & View */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: 16,
        }}
      >
        {/* Assumption Form */}
        <div
          style={{
            background: "var(--surface)",
            padding: 20,
            borderRadius: 12,
            border: "1px solid var(--border)",
          }}
        >
          <h3
            style={{
              margin: "0 0 16px 0",
              fontSize: "1.25rem",
              fontWeight: 600,
            }}
          >
            Projection Assumptions
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label
                style={{
                  display: "block",
                  fontSize: "0.85rem",
                  color: "var(--text-muted)",
                  marginBottom: 4,
                }}
              >
                Target Model for Projection
              </label>
              <select
                value={selectedAssumptionModel}
                onChange={(e) => {
                  setSelectedAssumptionModel(e.target.value);
                  setOverrideInputCost(null);
                  setOverrideOutputCost(null);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: "var(--text-main)",
                  outline: "none",
                }}
              >
                <option value="historical-mix">
                  {Object.keys(modelUsage).length === 1
                    ? Object.keys(modelUsage)[0]
                    : "Historical Mix (Blended Actuals)"}
                </option>
                {Object.keys(customRates).length > 0 && (
                  <optgroup label="Custom Models">
                    {Object.keys(customRates)
                      .sort()
                      .map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                  </optgroup>
                )}
                <optgroup label="Specific Models">
                  {Object.keys(MODEL_COSTS)
                    .filter((k) => k !== "default")
                    .sort()
                    .map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  Assumed Monthly Input
                </label>
                <input
                  type="number"
                  placeholder={`Auto: ${Math.round(estimatedMonthlyInput)}`}
                  value={
                    assumedMonthlyInputTokens === null
                      ? ""
                      : assumedMonthlyInputTokens
                  }
                  onChange={(e) =>
                    setAssumedMonthlyInputTokens(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text-main)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  Assumed Monthly Output
                </label>
                <input
                  type="number"
                  placeholder={`Auto: ${Math.round(estimatedMonthlyOutput)}`}
                  value={
                    assumedMonthlyOutputTokens === null
                      ? ""
                      : assumedMonthlyOutputTokens
                  }
                  onChange={(e) =>
                    setAssumedMonthlyOutputTokens(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text-main)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  Rate / 1M Input ($)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  placeholder={activeModelRates.inputCostPerMillion.toFixed(4)}
                  value={overrideInputCost === null ? "" : overrideInputCost}
                  onChange={(e) =>
                    setOverrideInputCost(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text-main)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div style={{ flex: 1 }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  Rate / 1M Output ($)
                </label>
                <input
                  type="number"
                  step="0.0001"
                  placeholder={activeModelRates.outputCostPerMillion.toFixed(4)}
                  value={overrideOutputCost === null ? "" : overrideOutputCost}
                  onChange={(e) =>
                    setOverrideOutputCost(
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                  style={{
                    width: "100%",
                    padding: "8px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "var(--bg)",
                    color: "var(--text-main)",
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>

            <details style={{ fontSize: "0.85rem" }}>
              <summary
                style={{
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  fontWeight: 500,
                  outline: "none",
                  userSelect: "none",
                }}
              >
                Manage Custom Pricing
              </summary>
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  background: "var(--surface-2)",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 8 }}
                >
                  <input
                    type="text"
                    placeholder="Model Name (e.g. openai/gpt-oss-120b)"
                    value={newCustModel}
                    onChange={(e) => setNewCustModel(e.target.value)}
                    style={{
                      padding: "6px",
                      borderRadius: 4,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text-main)",
                    }}
                  />
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="IN cost/1M"
                      value={newCustRawI}
                      onChange={(e) => setNewCustRawI(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "6px",
                        borderRadius: 4,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text-main)",
                      }}
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="OUT cost/1M"
                      value={newCustRawO}
                      onChange={(e) => setNewCustRawO(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "6px",
                        borderRadius: 4,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: "var(--text-main)",
                      }}
                    />
                  </div>
                  <button
                    onClick={addCustomRate}
                    style={{
                      padding: "6px",
                      background: "var(--accent)",
                      color: "var(--surface)",
                      border: "none",
                      borderRadius: 4,
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Save/Update Model Code
                  </button>
                </div>
                {Object.keys(customRates).length > 0 && (
                  <div
                    style={{
                      marginTop: 12,
                      borderTop: "1px solid var(--border)",
                      paddingTop: 12,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        marginBottom: 8,
                        color: "var(--text-muted)",
                      }}
                    >
                      Saved Overrides:
                    </div>
                    {Object.entries(customRates).map(([m, r]) => (
                      <div
                        key={m}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          marginBottom: 4,
                          alignItems: "center",
                        }}
                      >
                        <span style={{ color: "var(--text-main)" }}>
                          {m} (${r.inputCostPerMillion}/$
                          {r.outputCostPerMillion})
                        </span>
                        <button
                          onClick={() => removeCustomRate(m)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "red",
                            cursor: "pointer",
                            fontSize: "1rem",
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </div>
        </div>

        {/* Projection Result */}
        <div
          style={{
            background: "var(--surface)",
            padding: 20,
            borderRadius: 12,
            border: "1px solid var(--accent-border)",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              background: "var(--accent-glow)",
              opacity: 0.2,
              pointerEvents: "none",
            }}
          />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div
              style={{
                fontSize: "1rem",
                color: "var(--text-muted)",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              Estimated Monthly Cost
            </div>
            <div
              style={{
                fontSize: "3rem",
                fontWeight: 700,
                color: "var(--text-main)",
                marginBottom: 4,
                display: "flex",
                alignItems: "baseline",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              ${monthlyProjection.toFixed(4)}
              {monthlyProjection > 0 && monthlyProjection < 0.1 && (
                <span
                  style={{
                    fontSize: "1.25rem",
                    color: "var(--text-muted)",
                    fontWeight: 500,
                  }}
                >
                  ({(monthlyProjection * 100).toFixed(2)}¢)
                </span>
              )}
            </div>
            <div style={{ fontSize: "0.9rem", color: "var(--text-dim)" }}>
              Based on <strong>{monthlyInputTokens.toLocaleString()}</strong>{" "}
              input and <strong>{monthlyOutputTokens.toLocaleString()}</strong>{" "}
              output tokens using{" "}
              <strong>
                {selectedAssumptionModel === "historical-mix"
                  ? Object.keys(modelUsage).length === 1
                    ? Object.keys(modelUsage)[0]
                    : "historically blended"
                  : selectedAssumptionModel}
              </strong>{" "}
              rates (${cpmInput.toFixed(4)} IN / ${cpmOutput.toFixed(4)} OUT).
              Trend is currently <em>{trend}</em>.
            </div>

            {selectedAssumptionModel === "historical-mix" &&
              Object.keys(modelUsage).length > 0 && (
                <details style={{ marginTop: 12, fontSize: "0.85rem" }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      color: "var(--accent)",
                      fontWeight: 600,
                      outline: "none",
                      userSelect: "none",
                    }}
                  >
                    View Mix Details
                  </summary>
                  <div
                    style={{
                      marginTop: 8,
                      padding: 12,
                      background: "var(--surface-2)",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        marginBottom: 6,
                        fontWeight: 500,
                        color: "var(--text-muted)",
                      }}
                    >
                      Historical Distribution:
                    </div>
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 16,
                        color: "var(--text-dim)",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {Object.entries(modelUsage)
                        .sort((a, b) => b[1].input - a[1].input)
                        .map(([model, data]) => {
                          const inputPct =
                            totals.input > 0
                              ? ((data.input / totals.input) * 100).toFixed(1)
                              : "0.0";
                          const outputPct =
                            totals.output > 0
                              ? ((data.output / totals.output) * 100).toFixed(1)
                              : "0.0";
                          const mRates = getModelCost(model, customRates);
                          return (
                            <li key={model}>
                              <strong>{model}</strong> • {inputPct}% of Input ($
                              {mRates.inputCostPerMillion.toFixed(4)} rate),{" "}
                              {outputPct}% of Output ($
                              {mRates.outputCostPerMillion.toFixed(4)} rate)
                            </li>
                          );
                        })}
                    </ul>
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 8,
                        borderTop: "1px dashed var(--border)",
                        color: "var(--text-muted)",
                        fontSize: "0.8rem",
                      }}
                    >
                      * Blended rates dynamically scale as your token
                      distribution shifts.
                    </div>
                  </div>
                </details>
              )}
          </div>
        </div>

        {/* Provider Breakdown Card */}
        <div
          style={{
            background: "var(--surface)",
            padding: 20,
            borderRadius: 12,
            border: "1px solid var(--border)",
          }}
        >
          <h3
            style={{
              margin: "0 0 16px 0",
              fontSize: "1.25rem",
              fontWeight: 600,
            }}
          >
            Spending by Provider
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Object.entries(providerUsage)
              .sort((a, b) => b[1].cost - a[1].cost)
              .map(([provider, data]) => {
                const pct =
                  historicalTotalCost > 0
                    ? ((data.cost / historicalTotalCost) * 100).toFixed(1)
                    : "0.0";
                return (
                  <div
                    key={provider}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      paddingBottom: 8,
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <div>
                      <div
                        style={{ fontWeight: 600, color: "var(--text-main)" }}
                      >
                        {provider}
                      </div>
                      <div
                        style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}
                      >
                        {data.count.toLocaleString()} requests
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div
                        style={{
                          fontWeight: 600,
                          color: "var(--text-main)",
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        ${data.cost.toFixed(4)}
                        {data.cost > 0 && data.cost < 0.1 && (
                          <span
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--text-muted)",
                              fontWeight: 500,
                            }}
                          >
                            ({(data.cost * 100).toFixed(2)}¢)
                          </span>
                        )}
                      </div>
                      <div
                        style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}
                      >
                        {pct}%
                      </div>
                    </div>
                  </div>
                );
              })}
            {Object.keys(providerUsage).length === 0 && (
              <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
                No provider usage recorded
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gap: 16,
        }}
      >
        {/* Charts */}
        <div
          style={{
            background: "var(--surface)",
            padding: 20,
            borderRadius: 12,
            border: "1px solid var(--border)",
          }}
        >
          <h3
            style={{
              margin: "0 0 16px 0",
              fontSize: "1.1rem",
              fontWeight: 600,
            }}
          >
            Requests Timeline
          </h3>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <LineChart data={timeSeries}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="shortTime"
                  stroke="var(--text-muted)"
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={30}
                />
                <YAxis
                  stroke="var(--text-muted)"
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  labelFormatter={(label, payload) =>
                    payload?.[0]?.payload?.timestamp || label
                  }
                  contentStyle={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                />
                <Line
                  type="stepAfter"
                  dataKey="tt"
                  name="Tokens"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={{
                    r: 3,
                    fill: "var(--accent)",
                    stroke: "var(--surface)",
                    strokeWidth: 2,
                  }}
                  activeDot={{ r: 5, fill: "var(--accent)" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div
          style={{
            background: "var(--surface)",
            padding: 20,
            borderRadius: 12,
            border: "1px solid var(--border)",
          }}
        >
          <h3
            style={{
              margin: "0 0 16px 0",
              fontSize: "1.1rem",
              fontWeight: 600,
            }}
          >
            Daily Aggregate (Tokens)
          </h3>
          <div style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={dailyUsage}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  stroke="var(--text-muted)"
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="var(--text-muted)"
                  tick={{ fill: "var(--text-muted)", fontSize: 12 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  cursor={{ fill: "var(--surface-2)" }}
                  contentStyle={{
                    backgroundColor: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                  }}
                />
                <Bar
                  dataKey="total_tokens"
                  name="Tokens"
                  fill="var(--accent)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Model Breakdown Grid */}
      <div
        style={{
          background: "var(--surface)",
          padding: 20,
          borderRadius: 12,
          border: "1px solid var(--border)",
          overflowX: "auto",
        }}
      >
        <h3
          style={{ margin: "0 0 16px 0", fontSize: "1.25rem", fontWeight: 600 }}
        >
          Actual Usage by Model
        </h3>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
            minWidth: 600,
          }}
        >
          <thead>
            <tr style={{ background: "var(--surface-2)" }}>
              <th
                style={{
                  padding: "12px 16px",
                  borderRadius: "8px 0 0 8px",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                }}
              >
                Model
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                  textAlign: "right",
                }}
              >
                Requests
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                  textAlign: "right",
                }}
              >
                Input (Tkns)
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                  textAlign: "right",
                }}
              >
                Output (Tkns)
              </th>
              <th
                style={{
                  padding: "12px 16px",
                  borderRadius: "0 8px 8px 0",
                  color: "var(--text-muted)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  textTransform: "uppercase",
                  textAlign: "right",
                }}
              >
                Est. Core Cost
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(modelUsage)
              .sort((a, b) => b[1].count - a[1].count)
              .map(([model, data]) => (
                <tr
                  key={model}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td
                    style={{
                      padding: "16px",
                      fontWeight: 500,
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: "var(--accent)",
                      }}
                    />
                    {model}
                  </td>
                  <td
                    style={{
                      padding: "16px",
                      textAlign: "right",
                      color: "var(--text-dim)",
                    }}
                  >
                    {data.count.toLocaleString()}
                  </td>
                  <td
                    style={{
                      padding: "16px",
                      textAlign: "right",
                      color: "var(--text-dim)",
                    }}
                  >
                    {data.input.toLocaleString()}
                  </td>
                  <td
                    style={{
                      padding: "16px",
                      textAlign: "right",
                      color: "var(--text-dim)",
                    }}
                  >
                    {data.output.toLocaleString()}
                  </td>
                  <td
                    style={{
                      padding: "16px",
                      textAlign: "right",
                      color: "var(--text-main)",
                      fontWeight: 600,
                    }}
                  >
                    ${data.cost.toFixed(4)}
                    {data.cost > 0 && data.cost < 0.1 && (
                      <div
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--text-muted)",
                          fontWeight: 500,
                        }}
                      >
                        ({(data.cost * 100).toFixed(2)}¢)
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Process Breakdown Grid */}
      <div
        style={{
          background: "var(--surface)",
          padding: 20,
          borderRadius: 12,
          border: "1px solid var(--border)",
          overflowX: "auto",
        }}
      >
        <h3
          style={{ margin: "0 0 16px 0", fontSize: "1.25rem", fontWeight: 600 }}
        >
          Usage & Estimates by Process
        </h3>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            textAlign: "left",
            minWidth: 800,
          }}
        >
          <thead>
            <tr style={{ background: "var(--surface-2)", borderRadius: 8 }}>
              <ProcessTh sortKey="process" label="Process" />
              <ProcessTh label="Provider & Model Composition" />
              <ProcessTh
                sortKey="monthlyReqs"
                label="Est. / Month"
                align="right"
              />
              <ProcessTh
                sortKey="costPerReq"
                label="Cost / Req"
                align="right"
              />
              <ProcessTh
                sortKey="monthlyCost"
                label="Est. Monthly Cost"
                align="right"
              />
            </tr>
          </thead>
          <tbody>
            {processDataArray.map((row) => (
              <tr
                key={row.process}
                style={{ borderBottom: "1px solid var(--border)" }}
              >
                <td
                  style={{
                    padding: "16px",
                    fontWeight: 500,
                    color: "var(--text-main)",
                  }}
                >
                  {row.process}
                </td>
                <td
                  style={{
                    padding: "16px",
                    color: "var(--text-dim)",
                    fontSize: "0.85rem",
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <strong
                      style={{ color: "var(--text-main)", fontWeight: 600 }}
                    >
                      Models:
                    </strong>{" "}
                    {Object.entries(row.models)
                      .map(([m, c]) => `${m} (${c})`)
                      .join(", ")}
                  </div>
                  <div>
                    <strong
                      style={{ color: "var(--text-main)", fontWeight: 600 }}
                    >
                      Providers:
                    </strong>{" "}
                    {Object.entries(row.providers)
                      .map(([p, c]) => `${p} (${c})`)
                      .join(", ")}
                  </div>
                </td>
                <td
                  style={{
                    padding: "16px",
                    textAlign: "right",
                    color: "var(--text-main)",
                    fontWeight: 500,
                  }}
                >
                  <div style={{ fontSize: "1rem" }}>
                    ~{Math.round(row.monthlyReqs).toLocaleString()}
                  </div>
                  <div
                    style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}
                  >
                    ({row.count} historical)
                  </div>
                </td>
                <td
                  style={{
                    padding: "16px",
                    textAlign: "right",
                    color: "var(--text-dim)",
                  }}
                >
                  <div style={{ fontSize: "0.9rem" }}>
                    ${row.costPerReq.toFixed(5)}
                  </div>
                  {row.costPerReq > 0 && row.costPerReq < 0.1 && (
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--text-muted)",
                      }}
                    >
                      ({(row.costPerReq * 100).toFixed(3)}¢)
                    </div>
                  )}
                </td>
                <td
                  style={{
                    padding: "16px",
                    textAlign: "right",
                    color: "var(--text-main)",
                    fontWeight: 600,
                  }}
                >
                  <div style={{ fontSize: "1.1rem" }}>
                    ${row.monthlyCost.toFixed(4)}
                  </div>
                  {row.monthlyCost > 0 && row.monthlyCost < 0.1 && (
                    <div
                      style={{
                        fontSize: "0.8rem",
                        color: "var(--text-muted)",
                        fontWeight: 500,
                      }}
                    >
                      ({(row.monthlyCost * 100).toFixed(2)}¢)
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
