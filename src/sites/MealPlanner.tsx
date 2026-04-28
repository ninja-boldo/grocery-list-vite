import { useState, useMemo, useEffect, useCallback, memo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import { apiClient } from "@/lib/api/client";
import {
  API_PATHS,
  buildClassifyItemsAgainstPantryUrl,
  buildFetchItemsUrl,
  type AddEanRequest,
  type PantryClassificationWishItem,
} from "@/lib/api/openapi";
import FeedbackToast, { useFeedbackToast } from "@/comp/utils/FeedbackToast";
import type { ApiResponse } from "@/lib/utils";
import { useTranslation, Trans } from "react-i18next";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Ingredient {
  id: number;
  name: string;
  amount: number;
  unit: string;
}
interface Recipe {
  id: number;
  name: string;
  emoji: string;
  baseTime: number;
  baseServings: number;
  tags: string[];
  favorited: boolean;
  ingredients: Ingredient[];
  steps: string[];
}
interface MealSlot {
  recipe: Recipe;
  servings: number;
}
interface DayPlan {
  breakfast: MealSlot | null;
  lunch: MealSlot | null;
  dinner: MealSlot | null;
}
type Week = Record<string, DayPlan>;
type DayType = "quick" | "normal" | "relaxed";
interface DaySettingsEntry {
  type: DayType;
  blocked: { breakfast: boolean; lunch: boolean; dinner: boolean };
}
interface PlannerWeekItem {
  name: string;
  amount: number;
  unit: string;
}

type Modal =
  | { type: "addRecipe" }
  | { type: "editRecipe"; recipe: Recipe }
  | { type: "detail"; recipe: Recipe }
  | { type: "picker"; day: string; mealKey: keyof DayPlan; mealType: string }
  | {
      type: "slotPopover";
      day: string;
      mealKey: keyof DayPlan;
      mealLabel: string;
      slot: MealSlot;
    }
  | null;

// ─── Constants ───────────────────────────────────────────────────────────────
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
// These are computed at render time via t() — see useDayFull/useMealLabels hooks below
const DAY_FULL_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
const DAY_FULL_DEFAULTS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MEAL_KEYS: (keyof DayPlan)[] = ["breakfast", "lunch", "dinner"];
const MEAL_LABEL_KEYS = ["breakfast", "lunch", "dinner"] as const;
const MEAL_LABEL_DEFAULTS = ["Breakfast", "Lunch", "Dinner"];
const UNITS = [
  "g",
  "kg",
  "ml",
  "L",
  "EL",
  "TL",
  "Stück",
  "Prise",
  "Bund",
  "Scheiben",
  "Zehe",
];
const FOOD_EMOJIS = [
  "🥗",
  "🍝",
  "🍜",
  "🍛",
  "🥘",
  "🍲",
  "🥙",
  "🌮",
  "🥑",
  "🍳",
  "🥞",
  "🥣",
  "🍗",
  "🐟",
  "🥩",
  "🥦",
  "🍅",
  "🍋",
  "🧅",
  "🧄",
  "🍚",
  "🍞",
  "🥐",
  "🧆",
  "🫕",
  "🫙",
];
const ALL_TAGS = [
  "Frühstück",
  "Mittagessen",
  "Abendessen",
  "Vegan",
  "Vegetarisch",
  "Highprotein",
  "Lowcarb",
  "Schnell",
];
const LS_SETTINGS = "planner_settings";
const LS_WEEK = "planner_week";
const LS_DAY_SETTINGS = "planner_day_settings";

// ─── Day-key mapping (app ↔ API) ─────────────────────────────────────────────
const DAY_TO_API: Record<string, string> = {
  Mo: "mo",
  Di: "tu",
  Mi: "we",
  Do: "th",
  Fr: "fr",
  Sa: "sa",
  So: "su",
};
const API_TO_DAY: Record<string, string> = {
  mo: "Mo",
  tu: "Di",
  we: "Mi",
  th: "Do",
  fr: "Fr",
  sa: "Sa",
  su: "So",
};

// ─── App Color Palette — uses CSS variables for full theme support ────────────
const C = {
  bg: "var(--bg)",
  surf: "var(--surface)",
  surf2: "var(--surface-2)",
  border: "var(--border)",
  text: "var(--text-main)",
  muted: "var(--text-muted)",
  dim: "var(--text-dim)",
  accent: "var(--accent)",
  accentBg: "var(--accent-light)",
  accentBorder: "var(--accent-border)",
  green: "var(--success)",
  greenBg: "var(--success-bg)",
  greenBorder: "var(--success-border)",
  red: "var(--error)",
  redBg: "var(--error-bg)",
  redBorder: "var(--error-border)",
} as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────
let _uid = 2000;
const uid = () => ++_uid;

const fmtAmt = (amount: number, base: number, current: number) => {
  const s = amount * (current / base);
  return s % 1 === 0 ? s : parseFloat(s.toFixed(1));
};

const fmtTime = (baseTime: number, base: number, current: number) => {
  if (current === base) return baseTime;
  return Math.max(
    5,
    Math.round((baseTime * Math.pow(current / base, 0.6)) / 5) * 5,
  );
};

const EMPTY_WEEK = (): Week =>
  Object.fromEntries(
    DAYS.map((d) => [d, { breakfast: null, lunch: null, dinner: null }]),
  );

const DEFAULT_DAY_SETTINGS = (): Record<string, DaySettingsEntry> =>
  Object.fromEntries(
    DAYS.map((d, i) => [
      d,
      {
        type: (i >= 5 ? "relaxed" : "normal") as DayType,
        blocked: { breakfast: false, lunch: false, dinner: false },
      },
    ]),
  );

const readLS = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeLS = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
};

const normalizeItemName = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const toTokenSet = (value: string): Set<string> =>
  new Set(
    normalizeItemName(value)
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length > 1),
  );

function collectMissing(
  week: Week,
  checkInventory: (name: string) => boolean,
): PlannerWeekItem[] {
  const map: Record<string, PlannerWeekItem> = {};
  DAYS.forEach((day) => {
    MEAL_KEYS.forEach((key) => {
      const slot = week[day][key];
      if (!slot) return;
      const { recipe, servings } = slot;
      recipe.ingredients.forEach((ing) => {
        if (!checkInventory(ing.name)) {
          const k = ing.name.toLowerCase();
          const scaled = fmtAmt(ing.amount, recipe.baseServings, servings);
          if (map[k])
            map[k].amount = parseFloat((map[k].amount + scaled).toFixed(1));
          else map[k] = { name: ing.name, amount: scaled, unit: ing.unit };
        }
      });
    });
  });
  return Object.values(map);
}

const MEAL_LABELS = MEAL_LABEL_KEYS.map((k, i) =>
    MEAL_LABEL_DEFAULTS[i],
  );
  
function generateWeekPlan(
  recipes: Recipe[],
  daySettings: Record<string, DaySettingsEntry>,
  globalPersons: number,
  thresholds: { quick: number; normal: number },
): Week {
  if (!recipes.length) return EMPTY_WEEK();
  const result = EMPTY_WEEK();
  DAYS.forEach((day) => {
    const { type, blocked } = daySettings[day];
    const maxTime =
      type === "quick"
        ? thresholds.quick
        : type === "normal"
          ? thresholds.normal
          : 9999;
    MEAL_KEYS.forEach((mealKey, mIdx) => {
      if (blocked[mealKey]) return;
      const mealType = MEAL_LABELS[mIdx];
      let pool = recipes.filter((r) => r.tags.includes(mealType));
      if (pool.length < 2) pool = [...recipes];
      const timed = pool.filter((r) => r.baseTime <= maxTime);
      if (timed.length > 0) pool = timed;
      const weighted = pool.flatMap((r) => (r.favorited ? [r, r, r] : [r]));
      const pick = weighted[Math.floor(Math.random() * weighted.length)];
      result[day][mealKey] = { recipe: pick, servings: globalPersons };
    });
  });
  return result;
}

// ─── Atom Components ─────────────────────────────────────────────────────────
const Pill = ({
  active,
  onClick,
  children,
  small,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
}) => (
  <button
    onClick={onClick}
    style={{
      padding: small ? "5px 11px" : "7px 16px",
      borderRadius: 20,
      fontSize: small ? 12 : 13,
      fontWeight: 700,
      cursor: "pointer",
      border: "none",
      background: active ? C.accent : C.surf2,
      color: active ? C.bg : C.muted,
      transition: "all .15s",
      letterSpacing: "-0.2px",
      fontFamily: "inherit",
    }}
  >
    {children}
  </button>
);

const Stepper = ({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
  accent,
  compact,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
  accent?: boolean;
  compact?: boolean;
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: compact ? 5 : 8 }}>
    <button
      onClick={() => onChange(Math.max(min, value - 1))}
      style={{
        width: compact ? 26 : 30,
        height: compact ? 26 : 30,
        borderRadius: 8,
        background: C.surf2,
        border: `1.5px solid ${C.border}`,
        color: C.text,
        fontSize: 16,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "inherit",
      }}
    >
      −
    </button>
    <div style={{ textAlign: "center", minWidth: compact ? 28 : 34 }}>
      <div
        style={{
          fontSize: compact ? 14 : 17,
          fontWeight: 800,
          color: accent ? C.accent : C.text,
        }}
      >
        {value}
      </div>
      {label && (
        <div
          style={{
            fontSize: 9,
            color: C.muted,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
          }}
        >
          {label}
        </div>
      )}
    </div>
    <button
      onClick={() => onChange(Math.min(max, value + 1))}
      style={{
        width: compact ? 26 : 30,
        height: compact ? 26 : 30,
        borderRadius: 8,
        background: C.surf2,
        border: `1.5px solid ${C.border}`,
        color: C.text,
        fontSize: 16,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "inherit",
      }}
    >
      +
    </button>
  </div>
);

const SLabel = ({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    }}
  >
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "1px",
        color: C.dim,
      }}
    >
      {children}
    </div>
    {action}
  </div>
);

// ─── RecipeForm ───────────────────────────────────────────────────────────────
interface RecipeFormProps {
  initial?: Recipe;
  onSave: (r: Recipe) => void;
  onClose: () => void;
}

function RecipeForm({ initial, onSave, onClose }: RecipeFormProps) {
  const { t } = useTranslation();
  const blank: Recipe = {
    id: 0,
    name: "",
    emoji: "🍳",
    baseTime: 15,
    baseServings: 2,
    tags: [],
    ingredients: [{ id: uid(), name: "", amount: 1, unit: "g" }],
    steps: [""],
    favorited: false,
  };
  const [f, setF] = useState<Recipe>(initial ?? blank);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const set = <K extends keyof Recipe>(k: K, v: Recipe[K]) =>
    setF((p) => ({ ...p, [k]: v }));
  const inp: React.CSSProperties = {
    background: C.surf2,
    border: `1.5px solid var(--border)`,
    borderRadius: 10,
    padding: "10px 12px",
    color: C.text,
    fontSize: 14,
    width: "100%",
    boxSizing: "border-box",
    outline: "none",
    fontFamily: "inherit",
  };
  const lbl: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "1px",
    color: C.dim,
    marginBottom: 7,
    display: "block",
  };
  const save = () => {
    if (!f.name.trim()) return;
    onSave({
      ...f,
      id: f.id || uid(),
      baseTime: +f.baseTime || 15,
      baseServings: +f.baseServings || 2,
      ingredients: f.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({ ...i, amount: parseFloat(String(i.amount)) || 1 })),
      steps: f.steps.filter((s) => s.trim()),
    });
  };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.88)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        backdropFilter: "blur(6px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.surf,
          borderRadius: "24px 24px 0 0",
          padding: "20px 20px 44px",
          width: "100%",
          maxWidth: 480,
          margin: "0 auto",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: C.border,
            margin: "0 auto 18px",
          }}
        />
        <div
          style={{
            fontSize: 17,
            fontWeight: 800,
            marginBottom: 18,
            color: C.text,
          }}
        >
          {initial
            ? t("edit_recipe", "Edit recipe")
            : t("create_recipe", "Create recipe")}
        </div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <button
            onClick={() => setEmojiOpen(!emojiOpen)}
            style={{
              fontSize: 26,
              padding: "8px 12px",
              borderRadius: 12,
              background: C.surf2,
              border: `1.5px solid ${C.border}`,
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {f.emoji}
          </button>
          <input
            style={{ ...inp, flex: 1 }}
            placeholder={t("recipeName", "Recipe name *")}
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        {emojiOpen && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              background: C.surf2,
              borderRadius: 12,
              padding: 10,
              marginBottom: 12,
            }}
          >
            {FOOD_EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => {
                  set("emoji", e);
                  setEmojiOpen(false);
                }}
                style={{
                  fontSize: 22,
                  background: f.emoji === e ? C.accentBg : "none",
                  border: "none",
                  cursor: "pointer",
                  padding: "3px 4px",
                  borderRadius: 6,
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <span style={lbl}>{t("base_time_min", "Base time (min)")}</span>
            <input
              type="number"
              style={inp}
              value={f.baseTime}
              onChange={(e) => set("baseTime", parseInt(e.target.value) || 15)}
              min={1}
            />
          </div>
          <div style={{ flex: 1 }}>
            <span style={lbl}>{t("base_servings", "Base servings")}</span>
            <input
              type="number"
              style={inp}
              value={f.baseServings}
              onChange={(e) =>
                set("baseServings", parseInt(e.target.value) || 2)
              }
              min={1}
              max={20}
            />
          </div>
        </div>
        <span style={lbl}>{t("categories", "Categories")}</span>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 18,
          }}
        >
          {ALL_TAGS.map((tag) => {
            const on = f.tags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() =>
                  set(
                    "tags",
                    on ? f.tags.filter((x) => x !== tag) : [...f.tags, tag],
                  )
                }
                style={{
                  padding: "5px 12px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1.5px solid ${on ? C.accentBorder : C.border}`,
                  background: on ? C.accentBg : "transparent",
                  color: on ? C.accent : C.muted,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
        <span style={lbl}>{t("ingredients", "Ingredients")}</span>
        {f.ingredients.map((ing, i) => (
          <div
            key={ing.id}
            style={{
              display: "flex",
              gap: 6,
              marginBottom: 7,
              alignItems: "center",
            }}
          >
            <input
              style={{ ...inp, flex: 2 }}
              placeholder="Zutat"
              value={ing.name}
              onChange={(e) =>
                set(
                  "ingredients",
                  f.ingredients.map((x, j) =>
                    j === i ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
            />
            <input
              type="number"
              style={{ ...inp, width: 62, flex: "0 0 62px" }}
              placeholder="Menge"
              value={ing.amount === 0 ? "" : ing.amount}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const parsed = parseFloat(e.target.value);
                set(
                  "ingredients",
                  f.ingredients.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          amount:
                            Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
                        }
                      : x,
                  ),
                );
              }}
              onBlur={(e) => {
                if (!e.target.value || parseFloat(e.target.value) <= 0) {
                  set(
                    "ingredients",
                    f.ingredients.map((x, j) =>
                      j === i ? { ...x, amount: 1 } : x,
                    ),
                  );
                }
              }}
            />
            <select
              style={{
                ...inp,
                width: 74,
                flex: "0 0 74px",
                padding: "10px 6px",
              }}
              value={ing.unit}
              onChange={(e) =>
                set(
                  "ingredients",
                  f.ingredients.map((x, j) =>
                    j === i ? { ...x, unit: e.target.value } : x,
                  ),
                )
              }
            >
              {UNITS.map((u) => (
                <option key={u}>{u}</option>
              ))}
            </select>
            {f.ingredients.length > 1 && (
              <button
                onClick={() =>
                  set(
                    "ingredients",
                    f.ingredients.filter((_, j) => j !== i),
                  )
                }
                style={{
                  background: "none",
                  border: "none",
                  color: C.dim,
                  fontSize: 20,
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() =>
            set("ingredients", [
              ...f.ingredients,
              { id: uid(), name: "", amount: 1, unit: "g" },
            ])
          }
          style={{
            background: "none",
            border: "none",
            color: C.accent,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            padding: "4px 0",
            marginBottom: 18,
            fontFamily: "inherit",
          }}
        >
          {t("add_ingredient", "+ Add ingredient")}
        </button>
        <span style={lbl}>{t("steps", "Steps")}</span>
        {f.steps.map((step, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 8,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: 7,
                background: C.accentBg,
                border: `1px solid ${C.accentBorder}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 800,
                color: C.accent,
                flexShrink: 0,
                marginTop: 10,
              }}
            >
              {i + 1}
            </div>
            <textarea
              style={{
                ...inp,
                flex: 1,
                resize: "none",
                minHeight: 52,
                lineHeight: 1.5,
              }}
              placeholder={t("step_placeholder", "Step {{val}}…", {
                val: i + 1,
              })}
              value={step}
              onChange={(e) =>
                set(
                  "steps",
                  f.steps.map((s, j) => (j === i ? e.target.value : s)),
                )
              }
            />
            {f.steps.length > 1 && (
              <button
                onClick={() =>
                  set(
                    "steps",
                    f.steps.filter((_, j) => j !== i),
                  )
                }
                style={{
                  background: "none",
                  border: "none",
                  color: C.dim,
                  fontSize: 20,
                  cursor: "pointer",
                  padding: "0 2px",
                  marginTop: 8,
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => set("steps", [...f.steps, ""])}
          style={{
            background: "none",
            border: "none",
            color: C.accent,
            fontSize: 13,
            fontWeight: 700,
            cursor: "pointer",
            padding: "4px 0",
            marginBottom: 24,
            fontFamily: "inherit",
          }}
        >
          {t("add_step", "+ Add step")}
        </button>
        <button
          onClick={save}
          style={{
            width: "100%",
            padding: 14,
            borderRadius: 13,
            background: C.accent,
            color: C.bg,
            fontSize: 15,
            fontWeight: 800,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t("save_recipe", "Save recipe")}
        </button>
      </div>
    </div>
  );
}

// ─── RecipeDetail ─────────────────────────────────────────────────────────────
interface RecipeDetailProps {
  recipe: Recipe;
  onClose: () => void;
  onAddMissing: (r: Recipe, s: number) => void;
  onEdit: (r: Recipe) => void;
  onToggleFav: (r: Recipe) => void;
  inInventory: (name: string) => boolean;
}

function RecipeDetail({
  recipe,
  onClose,
  onAddMissing,
  onEdit,
  onToggleFav,
  inInventory,
}: RecipeDetailProps) {
  const { t } = useTranslation();
  const [servings, setServings] = useState(recipe.baseServings);
  const [tab, setTab] = useState<"ingredients" | "steps">("ingredients");
  const scaledTime = fmtTime(recipe.baseTime, recipe.baseServings, servings);
  const missingIngs = recipe.ingredients.filter((i) => !inInventory(i.name));
  const availIngs = recipe.ingredients.filter((i) => inInventory(i.name));
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.88)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        backdropFilter: "blur(6px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.surf,
          borderRadius: "24px 24px 0 0",
          padding: "20px 20px 44px",
          width: "100%",
          maxWidth: 480,
          margin: "0 auto",
          maxHeight: "92vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: C.border,
            margin: "0 auto 18px",
          }}
        />
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 14,
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 46, lineHeight: 1 }}>{recipe.emoji}</div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                letterSpacing: "-0.4px",
                color: C.text,
              }}
            >
              {recipe.name}
            </div>
            <button
              onClick={() => onEdit(recipe)}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 13,
                background: C.surf2,
                color: C.muted,
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                marginTop: 8,
                fontFamily: "inherit",
              }}
            >
              {t("edit_recipe_btn", "Edit recipe")}
            </button>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 5,
                marginTop: 6,
              }}
            >
              {recipe.tags.map((t) => (
                <span
                  key={t}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "3px 8px",
                    borderRadius: 6,
                    background: C.surf2,
                    color: C.muted,
                  }}
                >
                  {t}
                </span>
              ))}
            </div>
          </div>
          <button
            onClick={() => onToggleFav(recipe)}
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              cursor: "pointer",
              padding: 4,
            }}
          >
            {recipe.favorited ? "❤️" : "🤍"}
          </button>
        </div>
        <div
          style={{
            background: C.surf2,
            borderRadius: 14,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>
              {scaledTime}
              <span style={{ fontSize: 11, color: C.muted, marginLeft: 2 }}>
                {t("min", "min")}
              </span>
            </div>
            <div
              style={{
                fontSize: 10,
                color: C.muted,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {t("cook_time", "Cook time")}
            </div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>
              {recipe.ingredients.length}
            </div>
            <div
              style={{
                fontSize: 10,
                color: C.muted,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              {t("ingredients", "Ingredients")}
            </div>
          </div>
          <Stepper
            value={servings}
            onChange={setServings}
            label="Port."
            accent
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Pill
            active={tab === "ingredients"}
            onClick={() => setTab("ingredients")}
          >
            {t("ingredients_count", "Ingredients ({{length}})", {
              length: recipe.ingredients.length,
            })}
          </Pill>
          <Pill active={tab === "steps"} onClick={() => setTab("steps")}>
            {t("steps_count", "Steps ({{length}})", {
              length: recipe.steps.length,
            })}
          </Pill>
        </div>
        {tab === "ingredients" && (
          <>
            <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: C.muted,
                }}
              >
                <Trans i18nKey="ingredient_in_inventory">
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: C.green,
                    }}
                  />{" "}
                  In Inventory ({{ length: availIngs.length }})
                </Trans>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                  fontSize: 11,
                  color: C.muted,
                }}
              >
                <Trans i18nKey="missing_ingredients_count">
                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: C.red,
                    }}
                  />{" "}
                  Missing ({{ length: missingIngs.length }})
                </Trans>
              </div>
            </div>
            {recipe.ingredients.map((ing) => {
              const has = inInventory(ing.name);
              return (
                <div
                  key={ing.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderRadius: 10,
                    marginBottom: 6,
                    background: has ? C.greenBg : C.redBg,
                    border: `1px solid ${has ? C.greenBorder : C.redBorder}`,
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 9 }}
                  >
                    <div
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: has ? C.green : C.red,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: 14, color: C.text }}>
                      {ing.name}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: has ? C.green : C.red,
                      flexShrink: 0,
                    }}
                  >
                    {fmtAmt(ing.amount, recipe.baseServings, servings)}{" "}
                    {ing.unit}
                  </span>
                </div>
              );
            })}
            {missingIngs.length > 0 ? (
              <button
                onClick={() => onAddMissing(recipe, servings)}
                style={{
                  width: "100%",
                  padding: 14,
                  borderRadius: 13,
                  background: C.accent,
                  color: C.bg,
                  fontSize: 14,
                  fontWeight: 800,
                  border: "none",
                  cursor: "pointer",
                  marginTop: 12,
                  fontFamily: "inherit",
                }}
              >
                {t(
                  "missing_ingredients_to_shopping_list",
                  "🛒 {{length}} missing ingredients to shopping list",
                  { length: missingIngs.length },
                )}
              </button>
            ) : (
              <div
                style={{
                  textAlign: "center",
                  padding: "14px 0",
                  fontSize: 13,
                  color: C.green,
                  fontWeight: 700,
                }}
              >
                {t(
                  "all_ingredients_in_inventory",
                  "✓ All ingredients in inventory",
                )}
              </div>
            )}
            <button
              onClick={() => onEdit(recipe)}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 13,
                background: C.surf2,
                color: C.muted,
                fontSize: 13,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                marginTop: 8,
                fontFamily: "inherit",
              }}
            >
              {t("edit_recipe_btn", "Edit recipe")}
            </button>
          </>
        )}
        {tab === "steps" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {recipe.steps.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: C.muted,
                  fontSize: 13,
                  padding: 24,
                }}
              >
                {t("no_steps_added", "No steps added")}
              </div>
            )}
            {recipe.steps.map((step, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: 13,
                  background: C.surf2,
                  borderRadius: 13,
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 8,
                    background: C.accentBg,
                    border: `1px solid ${C.accentBorder}`,
                    color: C.accent,
                    fontSize: 12,
                    fontWeight: 800,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ fontSize: 14, color: C.text, lineHeight: 1.55 }}>
                  {step}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RecipePicker ─────────────────────────────────────────────────────────────
function RecipePicker({
  mealType,
  recipes,
  onSelect,
  onClose,
}: {
  mealType: string;
  recipes: Recipe[];
  onSelect: (r: Recipe) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const tagged = recipes.filter((r) => r.tags.includes(mealType));
  const others = recipes.filter((r) => !r.tags.includes(mealType));
  const renderList = (list: Recipe[], label: string) =>
    list.length > 0 && (
      <>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "1px",
            color: C.dim,
            marginBottom: 6,
            marginTop: 14,
          }}
        >
          {label}
        </div>
        {list.map((r) => (
          <div
            key={r.id}
            onClick={() => onSelect(r)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 0",
              borderBottom: `1px solid ${C.border}`,
              cursor: "pointer",
            }}
          >
            <div
              style={{
                fontSize: 24,
                width: 44,
                height: 44,
                background: C.surf2,
                borderRadius: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              {r.emoji}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
                {r.name}
              </div>
              <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                {t(
                  "recipe_preview_time_servings",
                  "{{baseTime}} min · {{baseServings}} servings",
                  { baseTime: r.baseTime, baseServings: r.baseServings },
                )}
              </div>
            </div>
            {r.favorited && <span>❤️</span>}
          </div>
        ))}
      </>
    );
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.88)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        backdropFilter: "blur(6px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.surf,
          borderRadius: "24px 24px 0 0",
          padding: "20px 20px 44px",
          width: "100%",
          maxWidth: 480,
          margin: "0 auto",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: C.border,
            margin: "0 auto 18px",
          }}
        />
        <div
          style={{
            fontSize: 17,
            fontWeight: 800,
            marginBottom: 4,
            color: C.text,
          }}
        >
          {t("choose_meal_type", "Choose {{mealType}}", { mealType })}
        </div>
        {renderList(tagged, "Passende Rezepte")}
        {renderList(others, "Weitere Rezepte")}
      </div>
    </div>
  );
}

// ─── SlotPopover ─────────────────────────────────────────────────────────────
function SlotPopover({
  slot,
  mealLabel,
  globalPersons,
  onServingsChange,
  onRemove,
  onClose,
  onOpenDetail,
}: {
  slot: MealSlot;
  mealLabel: string;
  globalPersons: number;
  onServingsChange: (s: number) => void;
  onRemove: () => void;
  onClose: () => void;
  onOpenDetail: (recipe: Recipe) => void;
}) {
  const { t } = useTranslation();
  const [s, setS] = useState(slot.servings);
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.7)",
        zIndex: 200,
        display: "flex",
        alignItems: "flex-end",
        backdropFilter: "blur(4px)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.surf,
          borderRadius: "24px 24px 0 0",
          padding: "20px 20px 40px",
          width: "100%",
          maxWidth: 480,
          margin: "0 auto",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: C.border,
            margin: "0 auto 18px",
          }}
        />
        {/* Recipe header — tap emoji or name to open detail */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenDetail(slot.recipe)}
          onKeyDown={(e) => e.key === "Enter" && onOpenDetail(slot.recipe)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 20,
            cursor: "pointer",
            borderRadius: 12,
            padding: "8px 10px",
            margin: "-8px -10px 12px",
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = C.surf2;
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <span style={{ fontSize: 32 }}>{slot.recipe.emoji}</span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 16,
                fontWeight: 700,
                color: C.text,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {slot.recipe.name}
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke={C.accent}
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>
              {t("meallabel", "{{mealLabel}} ·", { mealLabel })}
              {fmtTime(slot.recipe.baseTime, slot.recipe.baseServings, s)}{" "}
              {t("min", "min")}
            </div>
          </div>
        </div>
        <div
          style={{
            background: C.surf2,
            borderRadius: 14,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
              {t("servings", "Servings")}
            </div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
              {t(
                "global_servings_override",
                "Global: {{globalPersons}} · Override for this dish",
                { globalPersons },
              )}
            </div>
          </div>
          <Stepper value={s} onChange={setS} label="Port." accent />
        </div>
        {s !== globalPersons && (
          <div
            style={{
              fontSize: 11,
              color: C.accent,
              marginBottom: 12,
              paddingLeft: 4,
            }}
          >
            {t(
              "servings_override_warning",
              "↕ Deviation from global value ({{globalPersons}} servings) – affects shopping list",
              { globalPersons },
            )}
          </div>
        )}
        <button
          onClick={() => {
            onServingsChange(s);
            onClose();
          }}
          style={{
            width: "100%",
            padding: 13,
            borderRadius: 13,
            background: C.accent,
            color: C.bg,
            fontSize: 14,
            fontWeight: 800,
            border: "none",
            cursor: "pointer",
            marginBottom: 10,
            fontFamily: "inherit",
          }}
        >
          {t("bernehmen", "Übernehmen")}
        </button>
        <button
          onClick={() => {
            onRemove();
            onClose();
          }}
          style={{
            width: "100%",
            padding: 12,
            borderRadius: 13,
            background: C.surf2,
            color: C.red,
            fontSize: 13,
            fontWeight: 700,
            border: "none",
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {t("gerichtEntfernen", "Gericht entfernen")}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
function MealPlanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const username = localStorage.getItem("username") ?? "L";

  // Translated day and meal label arrays
  const DAY_FULL = DAY_FULL_KEYS.map((k, i) => t(k, DAY_FULL_DEFAULTS[i]));
  const MEAL_LABELS = MEAL_LABEL_KEYS.map((k, i) =>
    t(k, MEAL_LABEL_DEFAULTS[i]),
  );

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [needReauth, setNeedReauth] = useState(false);
  const handleNeedReauth = useCallback(() => setNeedReauth(true), []);
  useEffect(() => {
    if (!hasStoredJwtToken()) setNeedReauth(true);
  }, []);

  // ── Planner settings (localStorage as initial; overridden by API load below) ──
  const savedSettings = readLS<{
    globalPersons: number;
    thresholds: { quick: number; normal: number };
  }>(LS_SETTINGS, { globalPersons: 2, thresholds: { quick: 20, normal: 35 } });
  const [globalPersons, setGlobalPersons] = useState(
    savedSettings.globalPersons,
  );
  const [thresholds, setThresholds] = useState(savedSettings.thresholds);

  // ── Core state (populated from API) ──────────────────────────────────────
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [week, setWeek] = useState<Week>(EMPTY_WEEK);
  const [daySettings, setDaySettings] =
    useState<Record<string, DaySettingsEntry>>(DEFAULT_DAY_SETTINGS);

  // ── Inventory from real API ───────────────────────────────────────────────
  const [inventoryNames, setInventoryNames] = useState<string[]>([]);

  // ── Refs for week-plan load/save coordination ─────────────────────────────
  const weekLoadedRef = useRef(false);
  const weekSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hasStoredJwtToken()) return;
    authApiCall<ApiResponse>(
      buildFetchItemsUrl({ onlyWishList: false }),
      undefined,
      { retries: 2, onUnauthorized: handleNeedReauth },
    )
      .then((data) => {
        const names = data.items
          .map((i) => normalizeItemName(i.text ?? ""))
          .filter(Boolean);
        setInventoryNames(names);
      })
      .catch(() => setInventoryNames([]));
  }, [handleNeedReauth]);

  useEffect(() => {
    if (!hasStoredJwtToken()) return;
    authApiCall<{
      recipes?: Array<{
        recipe_id?: number;
        name?: string;
        emoji?: string;
        base_time?: number;
        default_portions?: number;
        tags?: string[];
        ingredients?: Array<{
          amount?: number | null;
          unit?: string | null;
          name?: string;
        }>;
        steps?: string[];
      }>;
      recipe_count?: number;
    }>(API_PATHS.recipes, undefined, {
      retries: 1,
      onUnauthorized: handleNeedReauth,
    })
      .then((data) => {
        if (data.recipes && data.recipes.length > 0) {
          const serverRecipes: Recipe[] = data.recipes.map((r) => ({
            id: r.recipe_id ?? 0,
            name: r.name ?? "",
            emoji: r.emoji ?? "🍳",
            baseTime: r.base_time ?? 15,
            baseServings: r.default_portions ?? 2,
            tags: r.tags ?? [],
            favorited: false,
            ingredients: (r.ingredients ?? []).map((ing, idx) => ({
              id: idx + 1,
              name: ing.name ?? "",
              amount: ing.amount ?? 1,
              unit: ing.unit ?? "Stück",
            })),
            steps: r.steps ?? [],
          }));
          setRecipes(serverRecipes);
        }
      })
      .catch(() => {
        /* fallback: recipes stay empty */
      });
  }, [handleNeedReauth]);

  // ── Load planner settings from API ────────────────────────────────────────
  useEffect(() => {
    if (!hasStoredJwtToken()) return;
    authApiCall<{
      defaultServings?: number;
      quickMealMinutes?: number;
      normalMealMinutes?: number;
    }>(API_PATHS.plannerSettings, undefined, {
      retries: 1,
      onUnauthorized: handleNeedReauth,
    })
      .then((data) => {
        if (typeof data.defaultServings === "number")
          setGlobalPersons(data.defaultServings);
        if (
          typeof data.quickMealMinutes === "number" &&
          typeof data.normalMealMinutes === "number"
        ) {
          setThresholds({
            quick: data.quickMealMinutes,
            normal: data.normalMealMinutes,
          });
        }
      })
      .catch(() => {
        /* keep localStorage defaults */
      });
  }, [handleNeedReauth]);

  // ── Load week plan from API (runs once recipes are available) ─────────────
  useEffect(() => {
    if (!hasStoredJwtToken()) return;
    if (recipes.length === 0) return; // wait until recipes are loaded
    if (weekLoadedRef.current) return; // only load once
    weekLoadedRef.current = true;

    type ApiSlot = { recipe_id: number; servings: number } | null;
    type ApiDayPlan = {
      breakfast?: ApiSlot;
      lunch?: ApiSlot;
      dinner?: ApiSlot;
    };
    type ApiDaySettings = {
      day_meal_time_type?: DayType;
      breakfast_blocked?: boolean;
      lunch_blocked?: boolean;
      dinner_blocked?: boolean;
    };

    authApiCall<{
      week?: Record<string, ApiDayPlan>;
      DaySettings?: Record<string, ApiDaySettings>;
    }>(API_PATHS.weekPlan, undefined, {
      retries: 1,
      onUnauthorized: handleNeedReauth,
    })
      .then((data) => {
        if (data.week && Object.keys(data.week).length > 0) {
          const newWeek = EMPTY_WEEK();
          for (const [apiDay, apiDayPlan] of Object.entries(data.week)) {
            const appDay = API_TO_DAY[apiDay];
            if (!appDay || !apiDayPlan) continue;
            for (const mealKey of MEAL_KEYS) {
              const slot = apiDayPlan[mealKey];
              if (!slot) continue;
              const recipe = recipes.find((r) => r.id === slot.recipe_id);
              if (recipe)
                newWeek[appDay][mealKey] = { recipe, servings: slot.servings };
            }
          }
          setWeek(newWeek);
        }
        if (data.DaySettings && Object.keys(data.DaySettings).length > 0) {
          const newDS = DEFAULT_DAY_SETTINGS();
          for (const [apiDay, ds] of Object.entries(data.DaySettings)) {
            const appDay = API_TO_DAY[apiDay];
            if (!appDay || !ds) continue;
            newDS[appDay] = {
              type: ds.day_meal_time_type ?? "normal",
              blocked: {
                breakfast: ds.breakfast_blocked ?? false,
                lunch: ds.lunch_blocked ?? false,
                dinner: ds.dinner_blocked ?? false,
              },
            };
          }
          setDaySettings(newDS);
        }
      })
      .catch(() => {
        // Fall back to localStorage if API unavailable
        setWeek(readLS<Week>(LS_WEEK, EMPTY_WEEK()));
        setDaySettings(
          readLS<Record<string, DaySettingsEntry>>(
            LS_DAY_SETTINGS,
            DEFAULT_DAY_SETTINGS(),
          ),
        );
      });
  }, [recipes, handleNeedReauth]);

  // ── Auto-save week plan to API (debounced, only after initial load) ────────
  useEffect(() => {
    if (!weekLoadedRef.current) return;
    if (!hasStoredJwtToken()) return;

    if (weekSaveTimerRef.current) clearTimeout(weekSaveTimerRef.current);
    weekSaveTimerRef.current = setTimeout(() => {
      const apiWeek: Record<string, unknown> = {};
      const apiDaySettings: Record<string, unknown> = {};
      for (const [appDay, apiDay] of Object.entries(DAY_TO_API)) {
        const dp = week[appDay];
        const ds = daySettings[appDay];
        const slots: Record<string, unknown> = {};
        for (const mk of MEAL_KEYS) {
          const slot = dp[mk];
          slots[mk] = slot
            ? {
                recipe_id: slot.recipe.id,
                servings: slot.servings,
                meal_type: mk,
                day: apiDay,
                day_time: mk,
              }
            : null;
        }
        apiWeek[apiDay] = slots;
        apiDaySettings[apiDay] = {
          day: apiDay,
          day_meal_time_type: ds.type,
          breakfast_blocked: ds.blocked.breakfast,
          lunch_blocked: ds.blocked.lunch,
          dinner_blocked: ds.blocked.dinner,
        };
      }
      void authApiCall(
        API_PATHS.weekPlan,
        {
          method: "POST",
          headers: {
            "Content-Type": t(
              "content_type_application_json_utf8",
              "application/json; charset=UTF-8",
            ),
          },
          body: JSON.stringify({ week: apiWeek, DaySettings: apiDaySettings }),
        },
        { retries: 1, onUnauthorized: handleNeedReauth },
      );
    }, 1500);

    return () => {
      if (weekSaveTimerRef.current) clearTimeout(weekSaveTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, daySettings, handleNeedReauth]);

  const inInventory = useCallback(
    (name: string) => {
      if (!inventoryNames.length) return false;
      const queryTokens = toTokenSet(name);
      if (queryTokens.size === 0) {
        return false;
      }

      return inventoryNames.some((inventoryItem) => {
        const inventoryTokens = toTokenSet(inventoryItem);
        if (inventoryTokens.size === 0) {
          return false;
        }

        // Require every ingredient token to be present in the pantry item token set.
        for (const token of queryTokens) {
          if (!inventoryTokens.has(token)) {
            return false;
          }
        }
        return true;
      });
    },
    [inventoryNames],
  );

  // ── Reactive shopping list ────────────────────────────────────────────────
  const weekPlanItems = useMemo(
    () => collectMissing(week, inInventory),
    [week, inInventory],
  );

  // Cache week / daySettings in localStorage as offline fallback
  useEffect(() => {
    writeLS(LS_WEEK, week);
  }, [week]);
  useEffect(() => {
    writeLS(LS_DAY_SETTINGS, daySettings);
  }, [daySettings]);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [mainTab, setMainTab] = useState<"plan" | "recipes">("plan");
  const [activeDay, setActiveDay] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [favFilter, setFavFilter] = useState(false);
  const [search, setSearch] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [toast, showToast, clearToast] = useFeedbackToast(3000);

  const today = new Date().getDay();
  const todayIdx = today === 0 ? 6 : today - 1;

  const DAY_TYPE_OPTIONS = [
    {
      id: "quick",
      icon: "⚡",
      label: t("quick_day_type", "Quick day"),
      desc: t("quick_min", "≤ {{quick}} min", { quick: thresholds.quick }),
    },
    {
      id: "normal",
      icon: "🏠",
      label: t("normal_day_type", "Normal day"),
      desc: t("normal_min", "≤ {{normal}} min", { normal: thresholds.normal }),
    },
    {
      id: "relaxed",
      icon: "🌿",
      label: t("relaxed_day_type", "Relaxed"),
      desc: t("all_recipes_no_limit", "All recipes, no limit"),
    },
  ] as const;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const setDayType = (day: string, type: DayType) =>
    setDaySettings((p) => ({ ...p, [day]: { ...p[day], type } }));

  const toggleBlock = (day: string, mealKey: keyof DayPlan) => {
    setDaySettings((p) => {
      const nowBlocked = !p[day].blocked[mealKey];
      if (nowBlocked)
        setWeek((w) => ({ ...w, [day]: { ...w[day], [mealKey]: null } }));
      return {
        ...p,
        [day]: {
          ...p[day],
          blocked: { ...p[day].blocked, [mealKey]: nowBlocked },
        },
      };
    });
  };

  const saveRecipe = async (r: Recipe) => {
    const isExistingRecipe = recipes.some((x) => x.id === r.id);
    let savedRecipe = r;


      try {
        const method = isExistingRecipe ? "PUT" : "POST";
        const endpoint = isExistingRecipe
          ? API_PATHS.recipeById(r.id)
          : API_PATHS.recipes;
        const created = await authApiCall<{ recipe_id?: number }>(
          endpoint,
          {
            method: method,
            headers: {
              "Content-Type": "application/json; charset=UTF-8",
            },
            body: JSON.stringify({
              name: r.name,
              emoji: r.emoji,
              baseTime: r.baseTime,
              baseServings: r.baseServings,
              tags: r.tags,
              favorited: r.favorited,
              ingredients: r.ingredients.map((ingredient) => ({
                amount: Math.max(1, Math.round(ingredient.amount)),
                unit: ingredient.unit,
                name: ingredient.name,
                count: null,
              })),
              steps: r.steps,
            }),
          },
          { retries: 1, onUnauthorized: handleNeedReauth },
        );
        // Use server-assigned ID so subsequent deletes hit the right resource
        if (typeof created.recipe_id === "number") {
          savedRecipe = { ...r, id: created.recipe_id };
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t(
                "recipe_not_saved_backend_error",
                "Recipe could not be saved to backend",
              );
        showToast(message, "error");
        return;
      
    }

    setRecipes((prev) =>
      prev.find((x) => x.id === savedRecipe.id)
        ? prev.map((x) => (x.id === savedRecipe.id ? savedRecipe : x))
        : [...prev, savedRecipe],
    );
    setModal(null);
    showToast(`${savedRecipe.emoji} ${savedRecipe.name} saved`, "success");
  };

  const toggleFav = (recipe: Recipe) =>
    setRecipes((prev) =>
      prev.map((r) =>
        r.id === recipe.id ? { ...r, favorited: !r.favorited } : r,
      ),
    );

  const deleteRecipe = useCallback(
    async (recipe: Recipe) => {
      // Optimistic: remove from list and any week-plan slots immediately
      setRecipes((prev) => prev.filter((r) => r.id !== recipe.id));
      setWeek((prev) => {
        const next = { ...prev };
        DAYS.forEach((day) => {
          const dp = { ...next[day] };
          MEAL_KEYS.forEach((key) => {
            if (dp[key]?.recipe.id === recipe.id) dp[key] = null;
          });
          next[day] = dp;
        });
        return next;
      });
      setConfirmDeleteId(null);
      if (modal?.type === "detail" && modal.recipe.id === recipe.id)
        setModal(null);

      try {
        await authApiCall(
          API_PATHS.recipeById(recipe.id),
          { method: "DELETE" },
          { retries: 1, onUnauthorized: handleNeedReauth },
        );
        showToast(`${recipe.emoji} „${recipe.name}" gelöscht`, "success");
      } catch {
        // Revert on failure
        setRecipes((prev) => [...prev, recipe]);
        showToast("Löschen fehlgeschlagen", "error");
      }
    },
    [handleNeedReauth, modal, showToast],
  );

  const addMissingToList = async (recipe: Recipe, servings: number) => {
    const scaledIngredients = recipe.ingredients.map((ingredient, index) => ({
      ingredient,
      scaledAmount: fmtAmt(ingredient.amount, recipe.baseServings, servings),
      wishItemId: t("planner_slot_id", "planner-{{id}}-{{id2}}-{{index}}", {
        id: recipe.id,
        id2: ingredient.id,
        index,
      }),
    }));

    const missingByInventory = scaledIngredients.filter(
      ({ ingredient }) => !inInventory(ingredient.name),
    );

    if (missingByInventory.length === 0) {
      setModal(null);
      showToast("Alle Zutaten sind bereits im Vorrat", "success");
      return;
    }

    const payload: PantryClassificationWishItem[] = missingByInventory.map(
      ({ ingredient, scaledAmount, wishItemId }) => ({
        item_name: ingredient.name,
        item_id: wishItemId,
        count: 1,
        quantity: {
          product_quantity: Math.max(1, Math.round(scaledAmount)),
          product_quantity_unit: ingredient.unit,
        },
        info: "",
      }),
    );

    let toAdd = missingByInventory;

    try {
      const classification = await authApiCall<{
        mapping?: Array<{
          foundMappingWish?: boolean;
          mappedWishItem?: {
            item_id?: string | null;
            item_name?: string | null;
          } | null;
          pantryItem?: { item_name?: string | null } | null;
        }>;
      }>(buildClassifyItemsAgainstPantryUrl(payload), undefined, {
        retries: 1,
        onUnauthorized: handleNeedReauth,
      });

      const mappedWishIds = new Set<string>();
      for (const entry of classification.mapping ?? []) {
        if (entry.foundMappingWish && entry.mappedWishItem?.item_id) {
          mappedWishIds.add(entry.mappedWishItem.item_id);
        }
      }

      toAdd = missingByInventory.filter(({ wishItemId }) => {
        if (mappedWishIds.has(wishItemId)) return false;
        return true;
      });

      if (toAdd.length === 0) {
        setModal(null);
        showToast(
          "Alle fehlenden Zutaten sind bereits in deiner Vorratsliste erfasst",
          "success",
        );
        return;
      }
    } catch {
      toAdd = missingByInventory;
    }

    const aggregated = new Map<
      string,
      {
        name: string;
        count: number;
        quantity: number | null;
        unit: string | null;
      }
    >();
    for (const entry of toAdd) {
      const key = normalizeItemName(entry.ingredient.name);
      if (!key) continue;
      const existing = aggregated.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        aggregated.set(key, {
          name: entry.ingredient.name,
          count: 1,
          quantity: entry.scaledAmount,
          unit: entry.ingredient.unit,
        });
      }
    }

    if (aggregated.size === 0) {
      setModal(null);
      showToast("Keine neuen Zutaten für die Wunschliste gefunden", "success");
      return;
    }

    try {
      for (const value of aggregated.values()) {
        const body: AddEanRequest = {
          item_name: value.name,
          count: value.count,
          wish_list: "true",
        };
        if (value.quantity !== null && value.unit !== null) {
          body.quantity_data = {
            product_quantity: Math.max(1, Math.round(value.quantity)),
            product_quantity_unit: value.unit,
          };
        }
        await apiClient.addEanToList(body, {
          retries: 1,
          retryDelayMs: 300,
          onUnauthorized: handleNeedReauth,
        });
      }

      setModal(null);
      showToast(`${aggregated.size} ingredients added to wishlist`, "success");
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t(
              "missing_ingredients_not_added_to_wishlist",
              "Missing ingredients could not be added to wishlist",
            );
      showToast(message, "error");
    }
  };

  const handleGenerate = () => {
    const newWeek = generateWeekPlan(
      recipes,
      daySettings,
      globalPersons,
      thresholds,
    );
    setWeek(newWeek);
    const missing = collectMissing(newWeek, inInventory);
    showToast(
      missing.length > 0
        ? t(
            "plan_created_missing_ingredients",
            "Plan created · {{length}} missing ingredients on shopping list",
            { length: missing.length },
          )
        : t(
            "plan_created_all_in_inventory",
            "Plan created – all in inventory!",
          ),
      "success",
    );
  };

  // Silent wish-list sync used when adding a slot – runs in background
  const addIngredientsToWishListSilently = useCallback(
    async (recipe: Recipe, servings: number) => {
      const scaledIngredients = recipe.ingredients.map((ingredient, index) => ({
        ingredient,
        scaledAmount: fmtAmt(ingredient.amount, recipe.baseServings, servings),
        wishItemId: t("planneridid2index", "planner-{{id}}-{{id2}}-{{index}}", {
          id: recipe.id,
          id2: ingredient.id,
          index,
        }),
      }));

      let toAdd = scaledIngredients.filter(
        ({ ingredient }) => !inInventory(ingredient.name),
      );
      if (toAdd.length === 0) return;

      const payload: PantryClassificationWishItem[] = toAdd.map(
        ({ ingredient, scaledAmount, wishItemId }) => ({
          item_name: ingredient.name,
          item_id: wishItemId,
          count: 1,
          quantity: {
            product_quantity: Math.max(1, Math.round(scaledAmount)),
            product_quantity_unit: ingredient.unit,
          },
          info: "",
        }),
      );

      try {
        const classification = await authApiCall<{
          mapping?: Array<{
            foundMappingWish?: boolean;
            mappedWishItem?: { item_id?: string | null } | null;
          }>;
        }>(buildClassifyItemsAgainstPantryUrl(payload), undefined, {
          retries: 1,
          onUnauthorized: handleNeedReauth,
        });

        const alreadyInWishList = new Set<string>();
        for (const entry of classification.mapping ?? []) {
          if (entry.foundMappingWish && entry.mappedWishItem?.item_id) {
            alreadyInWishList.add(entry.mappedWishItem.item_id);
          }
        }
        toAdd = toAdd.filter(
          ({ wishItemId }) => !alreadyInWishList.has(wishItemId),
        );
      } catch {
        /* fallback: add all missing */
      }

      if (toAdd.length === 0) return;

      const aggregated = new Map<
        string,
        { name: string; scaledAmount: number; unit: string }
      >();
      for (const { ingredient, scaledAmount } of toAdd) {
        const key = normalizeItemName(ingredient.name);
        if (!key) continue;
        const existing = aggregated.get(key);
        if (existing)
          existing.scaledAmount = parseFloat(
            (existing.scaledAmount + scaledAmount).toFixed(1),
          );
        else
          aggregated.set(key, {
            name: ingredient.name,
            scaledAmount,
            unit: ingredient.unit,
          });
      }

      for (const { name, scaledAmount, unit } of aggregated.values()) {
        await apiClient.addEanToList(
          {
            item_name: name,
            count: 1,
            wish_list: "true",
            quantity_data: {
              product_quantity: Math.max(1, Math.round(scaledAmount)),
              product_quantity_unit: unit,
            },
          },
          { retries: 1, retryDelayMs: 300, onUnauthorized: handleNeedReauth },
        );
      }

      if (aggregated.size > 0) {
        showToast(
          `🛒 ${aggregated.size} Zutat${aggregated.size > 1 ? "en" : ""} auf Wunschliste`,
          "success",
        );
      }
    },
    [inInventory, handleNeedReauth, showToast],
  );

  const addSlot = (day: string, mealKey: keyof DayPlan, recipe: Recipe) => {
    setWeek((prev) => ({
      ...prev,
      [day]: { ...prev[day], [mealKey]: { recipe, servings: globalPersons } },
    }));
    setModal(null);
    showToast(`${recipe.emoji} ${recipe.name} geplant`, "success");
    // Fire-and-forget: sync missing ingredients to wish list
    void addIngredientsToWishListSilently(recipe, globalPersons);
  };

  const updateSlotServings = (
    day: string,
    mealKey: keyof DayPlan,
    servings: number,
  ) =>
    setWeek((prev) => ({
      ...prev,
      [day]: { ...prev[day], [mealKey]: { ...prev[day][mealKey]!, servings } },
    }));

  const removeSlot = (day: string, mealKey: keyof DayPlan) =>
    setWeek((prev) => ({ ...prev, [day]: { ...prev[day], [mealKey]: null } }));

  // ── Derived values ───────────────────────────────────────────────────────
  const filteredRecipes = useMemo(() => {
    let list = favFilter ? recipes.filter((r) => r.favorited) : recipes;
    if (search)
      list = list.filter((r) =>
        r.name.toLowerCase().includes(search.toLowerCase()),
      );
    return list;
  }, [recipes, favFilter, search]);

  const dayData = week[DAYS[activeDay]];
  const daySetting = daySettings[DAYS[activeDay]];
  const allMeals = DAYS.flatMap(
    (d) => Object.values(week[d]).filter(Boolean) as MealSlot[],
  );
  const totalShoppingItems = weekPlanItems.length;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "transparent",
        color: C.text,
        fontFamily: "var(--font-body)",
        paddingBottom: 80,
      }}
    >
      {needReauth && (
        <AuthPopup
          onAuthenticated={() => {
            setNeedReauth(false);
          }}
        />
      )}

      <AppHeader username={username} />

      {/* Sub-tabs */}
      <div
        style={{
          padding: "4px 16px 12px",
          display: "flex",
          gap: 7,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <Pill active={mainTab === "plan"} onClick={() => setMainTab("plan")}>
          {t("wochenplan", "Wochenplan")}
        </Pill>
        <Pill
          active={mainTab === "recipes"}
          onClick={() => setMainTab("recipes")}
        >
          {t("rezepte", "Rezepte")}
        </Pill>
        {/* Shopping list shortcut */}
        {totalShoppingItems > 0 && (
          <button
            onClick={() => navigate("/wish_list")}
            style={{
              marginLeft: "auto",
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "6px 12px",
              borderRadius: 20,
              background: C.accentBg,
              border: `1px solid ${C.accentBorder}`,
              color: C.accent,
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            <svg
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth="2.5"
            >
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
            {totalShoppingItems}
          </button>
        )}
      </div>

      {/* ═══ WOCHENPLAN ═══ */}
      {mainTab === "plan" && (
        <div style={{ padding: "12px 16px 0" }}>
          {/* Generate button */}
          <button
            onClick={handleGenerate}
            style={{
              width: "100%",
              padding: 13,
              borderRadius: 13,
              background: C.accent,
              color: C.bg,
              fontSize: 14,
              fontWeight: 800,
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              marginBottom: 6,
            }}
          >
            {t(
              "wochenplanZuflligErstellen",
              "✨ Wochenplan zufällig erstellen",
            )}
          </button>
          <div
            style={{
              fontSize: 11,
              color: C.dim,
              textAlign: "center",
              marginBottom: 14,
            }}
          >
            {t(
              "FavoritesWeightedDayTypeBlockedSlotsConsidered",
              "Favorites ↑ weighted · day type & blocked slots considered",
            )}
          </div>

          {/* Day tabs */}
          <div
            style={{
              display: "flex",
              gap: 8,
              overflowX: "auto",
              paddingBottom: 4,
              marginBottom: 14,
            }}
          >
            {DAYS.map((day, i) => {
              const active = activeDay === i;
              const isToday = i === todayIdx;
              const typeIcon =
                DAY_TYPE_OPTIONS.find((t) => t.id === daySettings[day].type)
                  ?.icon ?? "🏠";
              return (
                <button
                  key={day}
                  onClick={() => setActiveDay(i)}
                  style={{
                    flexShrink: 0,
                    width: 54,
                    height: 70,
                    borderRadius: 14,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 2,
                    background: active ? C.accentBg : C.surf,
                    border: `1.5px solid ${active ? C.accentBorder : C.border}`,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      color: active ? C.accent : C.dim,
                    }}
                  >
                    {day}
                  </div>
                  <div
                    style={{
                      fontSize: isToday ? 7 : 16,
                      fontWeight: 800,
                      color: active ? C.accent : C.text,
                      lineHeight: 1.2,
                    }}
                  >
                    {isToday ? "HEUTE" : i + 1}
                  </div>
                  <div style={{ fontSize: 12 }}>{typeIcon}</div>
                  <div style={{ display: "flex", gap: 3 }}>
                    {MEAL_KEYS.map((k) => {
                      const blocked = daySettings[day].blocked[k];
                      const filled = !!week[day][k];
                      return (
                        <div
                          key={k}
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: "50%",
                            background: blocked
                              ? C.dim
                              : filled
                                ? C.accent
                                : C.surf2,
                            opacity: blocked ? 0.4 : filled ? 1 : 0.3,
                          }}
                        />
                      );
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Day header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>
              {DAY_FULL[activeDay]}
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              {DAY_TYPE_OPTIONS.map((x) => (
                <button
                  key={x.id}
                  onClick={() => setDayType(DAYS[activeDay], x.id)}
                  title={t("labelDesc", "label desc", {
                    label: x.label,
                    desc: x.desc,
                  })}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    fontSize: 14,
                    border: `1.5px solid ${daySetting.type === x.id ? C.accentBorder : C.border}`,
                    background: daySetting.type === x.id ? C.accentBg : C.surf2,
                    cursor: "pointer",
                  }}
                >
                  {x.icon}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
            {DAY_TYPE_OPTIONS.find((t) => t.id === daySetting.type)?.icon}{" "}
            {DAY_TYPE_OPTIONS.find((t) => t.id === daySetting.type)?.label} ·{" "}
            {DAY_TYPE_OPTIONS.find((t) => t.id === daySetting.type)?.desc}
          </div>

          {/* Meal slots */}
          <div style={{ marginBottom: 20 }}>
            {MEAL_KEYS.map((key, i) => {
              const slot = dayData[key];
              const blocked = daySetting.blocked[key];
              return (
                <div
                  key={key}
                  style={{ position: "relative", marginBottom: 9 }}
                >
                  <div
                    onClick={() =>
                      !blocked &&
                      (slot
                        ? setModal({
                            type: "slotPopover",
                            day: DAYS[activeDay],
                            mealKey: key,
                            mealLabel: MEAL_LABELS[i],
                            slot,
                          })
                        : setModal({
                            type: "picker",
                            day: DAYS[activeDay],
                            mealKey: key,
                            mealType: MEAL_LABELS[i],
                          }))
                    }
                    style={{
                      background: blocked ? C.surf : C.surf,
                      border: `1.5px ${blocked ? "solid" : slot ? "solid" : "dashed"} ${blocked ? C.dim + "44" : slot ? C.border : C.dim + "55"}`,
                      borderRadius: 16,
                      padding: "12px 14px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      cursor: blocked ? "default" : "pointer",
                      opacity: blocked ? 0.45 : 1,
                      transition: "all .15s",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 12 }}
                    >
                      {blocked ? (
                        <>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 8,
                              background: C.surf2,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 14,
                            }}
                          >
                            {t("key3", "🚫")}
                          </div>
                          <span
                            style={{
                              fontSize: 13,
                              color: C.dim,
                              fontWeight: 500,
                            }}
                          >
                            {MEAL_LABELS[i]} {t("noFood", "– no food")}
                          </span>
                        </>
                      ) : slot ? (
                        <>
                          <span style={{ fontSize: 26 }}>
                            {slot.recipe.emoji}
                          </span>
                          <div>
                            <div
                              style={{
                                fontSize: 14,
                                fontWeight: 700,
                                color: C.text,
                              }}
                            >
                              {slot.recipe.name}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: C.muted,
                                marginTop: 2,
                              }}
                            >
                              {MEAL_LABELS[i]} ·{" "}
                              {fmtTime(
                                slot.recipe.baseTime,
                                slot.recipe.baseServings,
                                slot.servings,
                              )}{" "}
                              {t("min", "min")}
                              <span
                                style={{
                                  color:
                                    slot.servings !== globalPersons
                                      ? C.accent
                                      : C.muted,
                                }}
                              >
                                {t("servingsPort", "· {{servings}} Port.", {
                                  servings: slot.servings,
                                })}
                              </span>
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 8,
                              background: C.surf2,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 16,
                              color: C.dim,
                            }}
                          >
                            +
                          </div>
                          <span
                            style={{
                              fontSize: 13,
                              color: C.dim,
                              fontWeight: 500,
                            }}
                          >
                            {MEAL_LABELS[i]} {t("add", "add")}
                          </span>
                        </>
                      )}
                    </div>
                    {slot && !blocked && (
                      <div style={{ fontSize: 18, color: C.dim }}>›</div>
                    )}
                  </div>
                  {/* Lock toggle */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBlock(DAYS[activeDay], key);
                    }}
                    title={blocked ? "Entsperren" : "Blockieren"}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: slot ? 36 : 10,
                      width: 22,
                      height: 22,
                      borderRadius: 6,
                      background: blocked ? C.surf2 : "transparent",
                      border: `1px solid ${blocked ? C.accentBorder : "transparent"}`,
                      color: blocked ? C.accent : C.dim + "88",
                      fontSize: 11,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "all .15s",
                    }}
                  >
                    {blocked ? "🔓" : "🔒"}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Week summary */}
          {allMeals.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SLabel>{t("weekOverview", "weekly overview")}</SLabel>
              <div
                style={{
                  background: C.surf,
                  border: `1px solid ${C.border}`,
                  borderRadius: 16,
                  padding: 14,
                  display: "flex",
                  justifyContent: "space-around",
                }}
              >
                {[
                  {
                    label: t("planed", "planed"),
                    val: t("length21", "{{length}}/21", {
                      length: allMeals.length,
                    }),
                  },
                  {
                    label: t("recipes", "recipes"),
                    val: new Set(allMeals.map((s) => s.recipe.id)).size,
                  },
                  {
                    label: t("cookingTime2", "Ø cooking time"),
                    val: t("valMin", "{{val}} min", {
                      val: Math.round(
                        allMeals.reduce(
                          (sum, m) =>
                            sum +
                            fmtTime(
                              m.recipe.baseTime,
                              m.recipe.baseServings,
                              m.servings,
                            ),
                          0,
                        ) / allMeals.length,
                      ),
                    }),
                  },
                ].map((item) => (
                  <div key={item.label} style={{ textAlign: "center" }}>
                    <div
                      style={{ fontSize: 20, fontWeight: 800, color: C.accent }}
                    >
                      {item.val}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ REZEPTE ═══ */}
      {mainTab === "recipes" && (
        <div style={{ padding: "12px 16px 0" }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            <input
              style={{
                background: C.surf2,
                border: `1.5px solid ${C.border}`,
                borderRadius: 10,
                padding: "10px 12px",
                color: C.text,
                fontSize: 14,
                flex: 1,
                outline: "none",
                fontFamily: "inherit",
              }}
              placeholder="Suchen…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              onClick={() => setFavFilter(!favFilter)}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: favFilter ? C.accentBg : C.surf2,
                border: `1.5px solid ${favFilter ? C.accentBorder : C.border}`,
                cursor: "pointer",
                fontSize: 15,
                flexShrink: 0,
              }}
            >
              {t("key2", "❤️")}
            </button>
            <button
              onClick={() => setModal({ type: "addRecipe" })}
              style={{
                padding: "10px 16px",
                borderRadius: 10,
                background: C.accent,
                color: C.bg,
                fontSize: 18,
                fontWeight: 800,
                border: "none",
                cursor: "pointer",
                flexShrink: 0,
                fontFamily: "inherit",
              }}
            >
              +
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {filteredRecipes.length === 0 && (
              <div
                style={{
                  textAlign: "center",
                  color: C.muted,
                  padding: 36,
                  fontSize: 14,
                }}
              >
                {favFilter
                  ? t("nochKeineFavoriten", "Noch keine Favoriten.")
                  : t("keineRezepteGefunden", "Keine Rezepte gefunden.")}
              </div>
            )}
            {filteredRecipes.map((r) => {
              const isConfirming = confirmDeleteId === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() => {
                    if (!isConfirming) setModal({ type: "detail", recipe: r });
                  }}
                  style={{
                    background: isConfirming ? C.redBg : C.surf,
                    border: `1px solid ${isConfirming ? C.redBorder : C.border}`,
                    borderRadius: 16,
                    padding: "14px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: isConfirming ? "default" : "pointer",
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <div
                    style={{
                      fontSize: 28,
                      width: 50,
                      height: 50,
                      background: C.surf2,
                      borderRadius: 13,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    {r.emoji}
                  </div>
                  {isConfirming ? (
                    /* ── Inline delete confirmation ── */
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          color: C.red,
                          marginBottom: 4,
                        }}
                      >
                        {t("recipeDelete", "Delete Recipe")}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: C.muted,
                          marginBottom: 10,
                        }}
                      >
                        {t(
                          "nameLongtermRemoval",
                          '„{{name}}" will be deleted longterm.',
                          { name: r.name },
                        )}
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteRecipe(r);
                          }}
                          style={{
                            flex: 1,
                            padding: "7px 0",
                            borderRadius: 9,
                            background: C.red,
                            color: "#fff",
                            fontSize: 13,
                            fontWeight: 700,
                            border: "none",
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {t("yesDelete", "Ja, löschen")}
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                          style={{
                            flex: 1,
                            padding: "7px 0",
                            borderRadius: 9,
                            background: C.surf2,
                            color: C.muted,
                            fontSize: 13,
                            fontWeight: 600,
                            border: `1px solid ${C.border}`,
                            cursor: "pointer",
                            fontFamily: "inherit",
                          }}
                        >
                          {t("abort", "abort")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal card content ── */
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{ fontSize: 15, fontWeight: 700, color: C.text }}
                      >
                        {r.name}
                      </div>
                      <div
                        style={{ fontSize: 12, color: C.muted, marginTop: 2 }}
                      >
                        {t(
                          "basetimeMinBaseservingsPortLengthZutaten",
                          "{{baseTime}} min · {{baseServings}} Port. · {{length}} Zutaten",
                          {
                            baseTime: r.baseTime,
                            baseServings: r.baseServings,
                            length: r.ingredients.length,
                          },
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: 4,
                          marginTop: 5,
                          flexWrap: "wrap",
                        }}
                      >
                        {r.tags.map((t) => (
                          <span
                            key={t}
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              padding: "2px 7px",
                              borderRadius: 5,
                              background: C.surf2,
                              color: C.muted,
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {!isConfirming && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        flexShrink: 0,
                      }}
                    >
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFav(r);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          fontSize: 18,
                          cursor: "pointer",
                          padding: 4,
                        }}
                      >
                        {r.favorited ? "❤️" : "🤍"}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(r.id);
                        }}
                        aria-label={t("deleteRecipe", "Rezept löschen")}
                        style={{
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          padding: 4,
                          color: C.dim,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.color = C.red;
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.color = C.dim;
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4h6v2" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {modal?.type === "addRecipe" && (
        <RecipeForm onSave={saveRecipe} onClose={() => setModal(null)} />
      )}
      {modal?.type === "editRecipe" && (
        <RecipeForm
          initial={modal.recipe}
          onSave={saveRecipe}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "detail" && (
        <RecipeDetail
          recipe={recipes.find((r) => r.id === modal.recipe.id) ?? modal.recipe}
          onClose={() => setModal(null)}
          onAddMissing={addMissingToList}
          onEdit={(r) => setModal({ type: "editRecipe", recipe: r })}
          onToggleFav={toggleFav}
          inInventory={inInventory}
        />
      )}
      {modal?.type === "picker" && (
        <RecipePicker
          mealType={modal.mealType}
          recipes={recipes}
          onSelect={(r) => addSlot(modal.day, modal.mealKey, r)}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === "slotPopover" && (
        <SlotPopover
          slot={modal.slot}
          mealLabel={modal.mealLabel}
          globalPersons={globalPersons}
          onServingsChange={(s) =>
            updateSlotServings(modal.day, modal.mealKey, s)
          }
          onRemove={() => removeSlot(modal.day, modal.mealKey)}
          onClose={() => setModal(null)}
          onOpenDetail={(recipe) => setModal({ type: "detail", recipe })}
        />
      )}

      <FeedbackToast toast={toast} onDismiss={clearToast} />
      <BottomTabBar />
    </div>
  );
}

export default memo(MealPlanner);
