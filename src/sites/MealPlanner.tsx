import { useState, useMemo, useEffect, useCallback, memo } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import FeedbackToast, { useFeedbackToast } from "@/comp/utils/FeedbackToast";
import type { ApiResponse } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Ingredient { id: number; name: string; amount: number; unit: string; }
interface Recipe {
  id: number; name: string; emoji: string;
  baseTime: number; baseServings: number;
  tags: string[]; favorited: boolean;
  ingredients: Ingredient[]; steps: string[];
}
interface MealSlot { recipe: Recipe; servings: number; }
interface DayPlan { breakfast: MealSlot | null; lunch: MealSlot | null; dinner: MealSlot | null; }
type Week = Record<string, DayPlan>;
type DayType = "quick" | "normal" | "relaxed";
interface DaySettingsEntry { type: DayType; blocked: { breakfast: boolean; lunch: boolean; dinner: boolean }; }
interface PlannerManualItem { id: number; name: string; amount: number; unit: string; fromRecipe: string; }
interface PlannerWeekItem { name: string; amount: number; unit: string; }

type Modal =
  | { type: "addRecipe" }
  | { type: "editRecipe"; recipe: Recipe }
  | { type: "detail"; recipe: Recipe }
  | { type: "picker"; day: string; mealKey: keyof DayPlan; mealType: string }
  | { type: "slotPopover"; day: string; mealKey: keyof DayPlan; mealLabel: string; slot: MealSlot }
  | null;

// ─── Constants ───────────────────────────────────────────────────────────────
const DAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DAY_FULL = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const MEAL_KEYS: (keyof DayPlan)[] = ["breakfast", "lunch", "dinner"];
const MEAL_LABELS = ["Frühstück", "Mittagessen", "Abendessen"];
const UNITS = ["g", "kg", "ml", "L", "EL", "TL", "Stück", "Prise", "Bund", "Scheiben", "Zehe"];
const FOOD_EMOJIS = ["🥗","🍝","🍜","🍛","🥘","🍲","🥙","🌮","🥑","🍳","🥞","🥣","🍗","🐟","🥩","🥦","🍅","🍋","🧅","🧄","🍚","🍞","🥐","🧆","🫕","🫙"];
const ALL_TAGS = ["Frühstück","Mittagessen","Abendessen","Vegan","Vegetarisch","Highprotein","Lowcarb","Schnell"];
const LS_SHOPPING = "planner_shopping_list";
const LS_SETTINGS = "planner_settings";
const LS_RECIPES  = "planner_recipes";
const LS_WEEK     = "planner_week";
const LS_DAY_SETTINGS = "planner_day_settings";

// ─── App Color Palette ───────────────────────────────────────────────────────
const C = {
  bg:     "#0D1117",
  surf:   "#161b22",
  surf2:  "#21262d",
  border: "#21262d",
  text:   "#e6edf3",
  muted:  "#8b949e",
  dim:    "#4A5568",
  accent: "#2dd4bf",
  accentBg:     "#0f2a28",
  accentBorder: "#0d9488",
  green:       "#1D9E75",
  greenBg:     "#0f2a28",
  greenBorder: "#0d9488",
  red:         "#e05252",
  redBg:       "#1f0d0d",
  redBorder:   "#3d1e1e",
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
  return Math.max(5, Math.round((baseTime * Math.pow(current / base, 0.6)) / 5) * 5);
};

const EMPTY_WEEK = (): Week =>
  Object.fromEntries(DAYS.map((d) => [d, { breakfast: null, lunch: null, dinner: null }]));

const DEFAULT_DAY_SETTINGS = (): Record<string, DaySettingsEntry> =>
  Object.fromEntries(
    DAYS.map((d, i) => [d, {
      type: (i >= 5 ? "relaxed" : "normal") as DayType,
      blocked: { breakfast: false, lunch: false, dinner: false },
    }])
  );

const readLS = <T,>(key: string, fallback: T): T => {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : fallback; }
  catch { return fallback; }
};

const writeLS = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
};

function collectMissing(week: Week, checkInventory: (name: string) => boolean): PlannerWeekItem[] {
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
          if (map[k]) map[k].amount = parseFloat((map[k].amount + scaled).toFixed(1));
          else map[k] = { name: ing.name, amount: scaled, unit: ing.unit };
        }
      });
    });
  });
  return Object.values(map);
}

function generateWeekPlan(
  recipes: Recipe[], daySettings: Record<string, DaySettingsEntry>,
  globalPersons: number, thresholds: { quick: number; normal: number },
): Week {
  if (!recipes.length) return EMPTY_WEEK();
  const result = EMPTY_WEEK();
  DAYS.forEach((day) => {
    const { type, blocked } = daySettings[day];
    const maxTime = type === "quick" ? thresholds.quick : type === "normal" ? thresholds.normal : 9999;
    MEAL_KEYS.forEach((mealKey, mIdx) => {
      if (blocked[mealKey]) return;
      const mealType = MEAL_LABELS[mIdx];
      let pool = recipes.filter((r) => r.tags.includes(mealType));
      if (pool.length < 2) pool = [...recipes];
      const timed = pool.filter((r) => r.baseTime <= maxTime);
      if (timed.length > 0) pool = timed;
      const weighted = pool.flatMap((r) => r.favorited ? [r, r, r] : [r]);
      const pick = weighted[Math.floor(Math.random() * weighted.length)];
      result[day][mealKey] = { recipe: pick, servings: globalPersons };
    });
  });
  return result;
}

// ─── Initial Recipes ─────────────────────────────────────────────────────────
const INITIAL_RECIPES: Recipe[] = [
  { id:1, name:"Avocado Toast", emoji:"🥑", baseTime:10, baseServings:1, favorited:true, tags:["Frühstück","Vegan"],
    ingredients:[{id:1,name:"Sauerteigbrot",amount:2,unit:"Scheiben"},{id:2,name:"Avocado",amount:1,unit:"Stück"},{id:3,name:"Zitrone",amount:0.5,unit:"Stück"},{id:4,name:"Chiliflocken",amount:1,unit:"Prise"},{id:5,name:"Salz",amount:1,unit:"Prise"}],
    steps:["Brot toasten bis es goldbraun ist.","Avocado halbieren, Kern entfernen, Fruchtfleisch zerdrücken.","Mit Zitronensaft, Salz und Chiliflocken abschmecken.","Masse auf dem Toast verteilen und sofort servieren."] },
  { id:2, name:"Hähnchen Bowl", emoji:"🍗", baseTime:25, baseServings:2, favorited:true, tags:["Mittagessen","Highprotein"],
    ingredients:[{id:1,name:"Hähnchenbrustfilet",amount:300,unit:"g"},{id:2,name:"Reis",amount:150,unit:"g"},{id:3,name:"Avocado",amount:1,unit:"Stück"},{id:4,name:"Tomate",amount:1,unit:"Stück"},{id:5,name:"Olivenöl",amount:2,unit:"EL"},{id:6,name:"Zitrone",amount:1,unit:"Stück"}],
    steps:["Reis nach Packungsanweisung kochen.","Hähnchen in Olivenöl je 5 Min. pro Seite braten.","Hähnchen in Streifen schneiden, Gemüse würfeln.","Alles in einer Bowl anrichten, mit Zitrone beträufeln."] },
  { id:3, name:"Pasta Arrabiata", emoji:"🍝", baseTime:20, baseServings:2, favorited:false, tags:["Abendessen","Vegan"],
    ingredients:[{id:1,name:"Pasta",amount:250,unit:"g"},{id:2,name:"gehackte Tomaten",amount:400,unit:"g"},{id:3,name:"Knoblauch",amount:3,unit:"Zehe"},{id:4,name:"Chili",amount:1,unit:"Stück"},{id:5,name:"Olivenöl",amount:3,unit:"EL"},{id:6,name:"Basilikum",amount:1,unit:"Bund"}],
    steps:["Pasta in Salzwasser al dente kochen.","Knoblauch und Chili in Olivenöl anbraten.","Tomaten dazugeben, 10 Min. einköcheln lassen.","Pasta abgießen, mit Sauce vermengen, Basilikum drauf."] },
  { id:4, name:"Overnight Oats", emoji:"🥣", baseTime:5, baseServings:1, favorited:true, tags:["Frühstück","Vegan"],
    ingredients:[{id:1,name:"Haferflocken",amount:80,unit:"g"},{id:2,name:"Hafermilch",amount:250,unit:"ml"},{id:3,name:"Chiasamen",amount:1,unit:"EL"},{id:4,name:"Banane",amount:1,unit:"Stück"},{id:5,name:"Beeren",amount:100,unit:"g"}],
    steps:["Haferflocken, Milch und Chiasamen mischen.","Abdecken, über Nacht im Kühlschrank quellen lassen.","Am Morgen mit Banane und Beeren toppen."] },
  { id:5, name:"Shakshuka", emoji:"🍳", baseTime:25, baseServings:2, favorited:false, tags:["Frühstück","Mittagessen","Vegetarisch"],
    ingredients:[{id:1,name:"Eier",amount:4,unit:"Stück"},{id:2,name:"Tomaten",amount:400,unit:"g"},{id:3,name:"Paprika",amount:1,unit:"Stück"},{id:4,name:"Zwiebel",amount:1,unit:"Stück"},{id:5,name:"Kreuzkümmel",amount:1,unit:"TL"},{id:6,name:"Paprikapulver",amount:1,unit:"TL"}],
    steps:["Zwiebel und Paprika in Öl weich dünsten.","Gewürze hinzufügen, 1 Min. rösten.","Tomaten dazugeben, 10 Min. einköcheln.","Mulden formen, Eier hineingeben, 5–7 Min. stocken lassen."] },
  { id:6, name:"Linsensuppe", emoji:"🥘", baseTime:35, baseServings:4, favorited:false, tags:["Mittagessen","Abendessen","Vegan"],
    ingredients:[{id:1,name:"Rote Linsen",amount:300,unit:"g"},{id:2,name:"Zwiebel",amount:1,unit:"Stück"},{id:3,name:"Karotte",amount:2,unit:"Stück"},{id:4,name:"Gemüsebrühe",amount:800,unit:"ml"},{id:5,name:"Kreuzkümmel",amount:1,unit:"TL"},{id:6,name:"Kurkuma",amount:0.5,unit:"TL"},{id:7,name:"Zitrone",amount:1,unit:"Stück"}],
    steps:["Zwiebel und Karotte würfeln, in Öl anbraten.","Gewürze hinzufügen und kurz rösten.","Linsen und Brühe dazugeben, aufkochen.","20 Min. köcheln bis Linsen weich sind.","Mit Zitronensaft abschmecken, nach Wunsch pürieren."] },
  { id:7, name:"Lachsfilet", emoji:"🐟", baseTime:20, baseServings:2, favorited:true, tags:["Abendessen","Highprotein"],
    ingredients:[{id:1,name:"Lachsfilet",amount:400,unit:"g"},{id:2,name:"Zitrone",amount:1,unit:"Stück"},{id:3,name:"Dill",amount:0.5,unit:"Bund"},{id:4,name:"Olivenöl",amount:2,unit:"EL"},{id:5,name:"Brokkoli",amount:300,unit:"g"},{id:6,name:"Salz",amount:1,unit:"Prise"}],
    steps:["Lachsfilet mit Salz, Pfeffer und Dill würzen.","In Olivenöl je 3–4 Min. pro Seite braten.","Brokkoli parallel in Salzwasser 5 Min. kochen.","Mit Zitronenspalten servieren."] },
];

// ─── Atom Components ─────────────────────────────────────────────────────────
const Pill = ({ active, onClick, children, small }: { active: boolean; onClick: () => void; children: React.ReactNode; small?: boolean }) => (
  <button onClick={onClick} style={{ padding: small ? "5px 11px" : "7px 16px", borderRadius: 20, fontSize: small ? 12 : 13, fontWeight: 700, cursor: "pointer", border: "none", background: active ? C.accent : C.surf2, color: active ? C.bg : C.muted, transition: "all .15s", letterSpacing: "-0.2px", fontFamily: "inherit" }}>
    {children}
  </button>
);

const Stepper = ({ value, onChange, min = 1, max = 99, label, accent, compact }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label?: string; accent?: boolean; compact?: boolean }) => (
  <div style={{ display: "flex", alignItems: "center", gap: compact ? 5 : 8 }}>
    <button onClick={() => onChange(Math.max(min, value - 1))} style={{ width: compact ? 26 : 30, height: compact ? 26 : 30, borderRadius: 8, background: C.surf2, border: `1.5px solid ${C.border}`, color: C.text, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>−</button>
    <div style={{ textAlign: "center", minWidth: compact ? 28 : 34 }}>
      <div style={{ fontSize: compact ? 14 : 17, fontWeight: 800, color: accent ? C.accent : C.text }}>{value}</div>
      {label && <div style={{ fontSize: 9, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</div>}
    </div>
    <button onClick={() => onChange(Math.min(max, value + 1))} style={{ width: compact ? 26 : 30, height: compact ? 26 : 30, borderRadius: 8, background: C.surf2, border: `1.5px solid ${C.border}`, color: C.text, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit" }}>+</button>
  </div>
);

const SLabel = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.dim }}>{children}</div>
    {action}
  </div>
);

// ─── RecipeForm ───────────────────────────────────────────────────────────────
interface RecipeFormProps { initial?: Recipe; onSave: (r: Recipe) => void; onClose: () => void; }

function RecipeForm({ initial, onSave, onClose }: RecipeFormProps) {
  const blank: Recipe = { id: 0, name: "", emoji: "🍳", baseTime: 15, baseServings: 2, tags: [], ingredients: [{ id: uid(), name: "", amount: 1, unit: "g" }], steps: [""], favorited: false };
  const [f, setF] = useState<Recipe>(initial ?? blank);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const set = <K extends keyof Recipe>(k: K, v: Recipe[K]) => setF((p) => ({ ...p, [k]: v }));
  const inp: React.CSSProperties = { background: C.surf2, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 14, width: "100%", boxSizing: "border-box", outline: "none", fontFamily: "inherit" };
  const lbl: React.CSSProperties = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.dim, marginBottom: 7, display: "block" };
  const save = () => {
    if (!f.name.trim()) return;
    onSave({ ...f, id: f.id || uid(), baseTime: +f.baseTime || 15, baseServings: +f.baseServings || 2, ingredients: f.ingredients.filter((i) => i.name.trim()).map((i) => ({ ...i, amount: parseFloat(String(i.amount)) || 1 })), steps: f.steps.filter((s) => s.trim()) });
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 200, display: "flex", alignItems: "flex-end", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div style={{ background: C.surf, borderRadius: "24px 24px 0 0", padding: "20px 20px 44px", width: "100%", maxWidth: 480, margin: "0 auto", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 18px" }} />
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 18, color: C.text }}>{initial ? "Rezept bearbeiten" : "Neues Rezept"}</div>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <button onClick={() => setEmojiOpen(!emojiOpen)} style={{ fontSize: 26, padding: "8px 12px", borderRadius: 12, background: C.surf2, border: `1.5px solid ${C.border}`, cursor: "pointer", flexShrink: 0 }}>{f.emoji}</button>
          <input style={{ ...inp, flex: 1 }} placeholder="Rezeptname *" value={f.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        {emojiOpen && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, background: C.surf2, borderRadius: 12, padding: 10, marginBottom: 12 }}>
            {FOOD_EMOJIS.map((e) => <button key={e} onClick={() => { set("emoji", e); setEmojiOpen(false); }} style={{ fontSize: 22, background: f.emoji === e ? C.accentBg : "none", border: "none", cursor: "pointer", padding: "3px 4px", borderRadius: 6 }}>{e}</button>)}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
          <div style={{ flex: 1 }}><span style={lbl}>Grundzeit (Min.)</span><input type="number" style={inp} value={f.baseTime} onChange={(e) => set("baseTime", parseInt(e.target.value) || 15)} min={1} /></div>
          <div style={{ flex: 1 }}><span style={lbl}>Portionen</span><input type="number" style={inp} value={f.baseServings} onChange={(e) => set("baseServings", parseInt(e.target.value) || 2)} min={1} max={20} /></div>
        </div>
        <span style={lbl}>Kategorien</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 18 }}>
          {ALL_TAGS.map((t) => { const on = f.tags.includes(t); return <button key={t} onClick={() => set("tags", on ? f.tags.filter((x) => x !== t) : [...f.tags, t])} style={{ padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: `1.5px solid ${on ? C.accentBorder : C.border}`, background: on ? C.accentBg : "transparent", color: on ? C.accent : C.muted, cursor: "pointer", fontFamily: "inherit" }}>{t}</button>; })}
        </div>
        <span style={lbl}>Zutaten</span>
        {f.ingredients.map((ing, i) => (
          <div key={ing.id} style={{ display: "flex", gap: 6, marginBottom: 7, alignItems: "center" }}>
            <input style={{ ...inp, flex: 2 }} placeholder="Zutat" value={ing.name} onChange={(e) => set("ingredients", f.ingredients.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input type="number" style={{ ...inp, width: 62, flex: "0 0 62px" }} placeholder="Menge" value={ing.amount} onChange={(e) => set("ingredients", f.ingredients.map((x, j) => j === i ? { ...x, amount: parseFloat(e.target.value) || 1 } : x))} />
            <select style={{ ...inp, width: 74, flex: "0 0 74px", padding: "10px 6px" }} value={ing.unit} onChange={(e) => set("ingredients", f.ingredients.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
            {f.ingredients.length > 1 && <button onClick={() => set("ingredients", f.ingredients.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer", flexShrink: 0 }}>×</button>}
          </div>
        ))}
        <button onClick={() => set("ingredients", [...f.ingredients, { id: uid(), name: "", amount: 1, unit: "g" }])} style={{ background: "none", border: "none", color: C.accent, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "4px 0", marginBottom: 18, fontFamily: "inherit" }}>+ Zutat hinzufügen</button>
        <span style={lbl}>Kochschritte</span>
        {f.steps.map((step, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "flex-start" }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: C.accentBg, border: `1px solid ${C.accentBorder}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: C.accent, flexShrink: 0, marginTop: 10 }}>{i + 1}</div>
            <textarea style={{ ...inp, flex: 1, resize: "none", minHeight: 52, lineHeight: 1.5 }} placeholder={`Schritt ${i + 1}…`} value={step} onChange={(e) => set("steps", f.steps.map((s, j) => j === i ? e.target.value : s))} />
            {f.steps.length > 1 && <button onClick={() => set("steps", f.steps.filter((_, j) => j !== i))} style={{ background: "none", border: "none", color: C.dim, fontSize: 20, cursor: "pointer", padding: "0 2px", marginTop: 8 }}>×</button>}
          </div>
        ))}
        <button onClick={() => set("steps", [...f.steps, ""])} style={{ background: "none", border: "none", color: C.accent, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "4px 0", marginBottom: 24, fontFamily: "inherit" }}>+ Schritt hinzufügen</button>
        <button onClick={save} style={{ width: "100%", padding: 14, borderRadius: 13, background: C.accent, color: C.bg, fontSize: 15, fontWeight: 800, border: "none", cursor: "pointer", fontFamily: "inherit" }}>Rezept speichern</button>
      </div>
    </div>
  );
}

// ─── RecipeDetail ─────────────────────────────────────────────────────────────
interface RecipeDetailProps { recipe: Recipe; onClose: () => void; onAddMissing: (r: Recipe, s: number) => void; onEdit: (r: Recipe) => void; onToggleFav: (r: Recipe) => void; inInventory: (name: string) => boolean; }

function RecipeDetail({ recipe, onClose, onAddMissing, onEdit, onToggleFav, inInventory }: RecipeDetailProps) {
  const [servings, setServings] = useState(recipe.baseServings);
  const [tab, setTab] = useState<"zutaten" | "schritte">("zutaten");
  const scaledTime = fmtTime(recipe.baseTime, recipe.baseServings, servings);
  const missingIngs = recipe.ingredients.filter((i) => !inInventory(i.name));
  const availIngs   = recipe.ingredients.filter((i) =>  inInventory(i.name));
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 200, display: "flex", alignItems: "flex-end", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div style={{ background: C.surf, borderRadius: "24px 24px 0 0", padding: "20px 20px 44px", width: "100%", maxWidth: 480, margin: "0 auto", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 18px" }} />
        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 16 }}>
          <div style={{ fontSize: 46, lineHeight: 1 }}>{recipe.emoji}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.4px", color: C.text }}>{recipe.name}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
              {recipe.tags.map((t) => <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: C.surf2, color: C.muted }}>{t}</span>)}
            </div>
          </div>
          <button onClick={() => onToggleFav(recipe)} style={{ background: "none", border: "none", fontSize: 22, cursor: "pointer", padding: 4 }}>{recipe.favorited ? "❤️" : "🤍"}</button>
        </div>
        <div style={{ background: C.surf2, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>{scaledTime}<span style={{ fontSize: 11, color: C.muted, marginLeft: 2 }}>min</span></div>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Kochzeit</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>{recipe.ingredients.length}</div>
            <div style={{ fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.5px" }}>Zutaten</div>
          </div>
          <Stepper value={servings} onChange={setServings} label="Port." accent />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <Pill active={tab === "zutaten"} onClick={() => setTab("zutaten")}>Zutaten ({recipe.ingredients.length})</Pill>
          <Pill active={tab === "schritte"} onClick={() => setTab("schritte")}>Schritte ({recipe.steps.length})</Pill>
        </div>
        {tab === "zutaten" && (
          <>
            <div style={{ display: "flex", gap: 14, marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green }} /> Im Inventar ({availIngs.length})</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: C.muted }}><div style={{ width: 8, height: 8, borderRadius: "50%", background: C.red }} /> Fehlt ({missingIngs.length})</div>
            </div>
            {recipe.ingredients.map((ing) => {
              const has = inInventory(ing.name);
              return (
                <div key={ing.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderRadius: 10, marginBottom: 6, background: has ? C.greenBg : C.redBg, border: `1px solid ${has ? C.greenBorder : C.redBorder}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: has ? C.green : C.red, flexShrink: 0 }} />
                    <span style={{ fontSize: 14, color: C.text }}>{ing.name}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: has ? C.green : C.red, flexShrink: 0 }}>{fmtAmt(ing.amount, recipe.baseServings, servings)} {ing.unit}</span>
                </div>
              );
            })}
            {missingIngs.length > 0
              ? <button onClick={() => onAddMissing(recipe, servings)} style={{ width: "100%", padding: 14, borderRadius: 13, background: C.accent, color: C.bg, fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", marginTop: 12, fontFamily: "inherit" }}>🛒 {missingIngs.length} fehlende Zutaten auf Einkaufsliste</button>
              : <div style={{ textAlign: "center", padding: "14px 0", fontSize: 13, color: C.green, fontWeight: 700 }}>✓ Alle Zutaten im Inventar vorhanden</div>
            }
            <button onClick={() => onEdit(recipe)} style={{ width: "100%", padding: 12, borderRadius: 13, background: C.surf2, color: C.muted, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", marginTop: 8, fontFamily: "inherit" }}>Rezept bearbeiten</button>
          </>
        )}
        {tab === "schritte" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {recipe.steps.length === 0 && <div style={{ textAlign: "center", color: C.muted, fontSize: 13, padding: 24 }}>Keine Kochschritte hinterlegt.</div>}
            {recipe.steps.map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 12, padding: 13, background: C.surf2, borderRadius: 13 }}>
                <div style={{ width: 26, height: 26, borderRadius: 8, background: C.accentBg, border: `1px solid ${C.accentBorder}`, color: C.accent, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                <div style={{ fontSize: 14, color: C.text, lineHeight: 1.55 }}>{step}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── RecipePicker ─────────────────────────────────────────────────────────────
function RecipePicker({ mealType, recipes, onSelect, onClose }: { mealType: string; recipes: Recipe[]; onSelect: (r: Recipe) => void; onClose: () => void }) {
  const tagged = recipes.filter((r) => r.tags.includes(mealType));
  const others  = recipes.filter((r) => !r.tags.includes(mealType));
  const renderList = (list: Recipe[], label: string) => list.length > 0 && (
    <>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.dim, marginBottom: 6, marginTop: 14 }}>{label}</div>
      {list.map((r) => (
        <div key={r.id} onClick={() => onSelect(r)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: `1px solid ${C.border}`, cursor: "pointer" }}>
          <div style={{ fontSize: 24, width: 44, height: 44, background: C.surf2, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.emoji}</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{r.name}</div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{r.baseTime} min · {r.baseServings} Port.</div>
          </div>
          {r.favorited && <span>❤️</span>}
        </div>
      ))}
    </>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.88)", zIndex: 200, display: "flex", alignItems: "flex-end", backdropFilter: "blur(6px)" }} onClick={onClose}>
      <div style={{ background: C.surf, borderRadius: "24px 24px 0 0", padding: "20px 20px 44px", width: "100%", maxWidth: 480, margin: "0 auto", maxHeight: "85vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 18px" }} />
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4, color: C.text }}>{mealType} wählen</div>
        {renderList(tagged, "Passende Rezepte")}
        {renderList(others, "Weitere Rezepte")}
      </div>
    </div>
  );
}

// ─── SlotPopover ─────────────────────────────────────────────────────────────
function SlotPopover({ slot, mealLabel, globalPersons, onServingsChange, onRemove, onClose, onOpenDetail }: { slot: MealSlot; mealLabel: string; globalPersons: number; onServingsChange: (s: number) => void; onRemove: () => void; onClose: () => void; onOpenDetail: (recipe: Recipe) => void }) {
  const [s, setS] = useState(slot.servings);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.7)", zIndex: 200, display: "flex", alignItems: "flex-end", backdropFilter: "blur(4px)" }} onClick={onClose}>
      <div style={{ background: C.surf, borderRadius: "24px 24px 0 0", padding: "20px 20px 40px", width: "100%", maxWidth: 480, margin: "0 auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: C.border, margin: "0 auto 18px" }} />
        {/* Recipe header — tap emoji or name to open detail */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onOpenDetail(slot.recipe)}
          onKeyDown={(e) => e.key === "Enter" && onOpenDetail(slot.recipe)}
          style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, cursor: "pointer", borderRadius: 12, padding: "8px 10px", margin: "-8px -10px 12px", transition: "background 0.15s" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.surf2; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
        >
          <span style={{ fontSize: 32 }}>{slot.recipe.emoji}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, display: "flex", alignItems: "center", gap: 6 }}>
              {slot.recipe.name}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.accent} strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
            <div style={{ fontSize: 12, color: C.muted }}>{mealLabel} · {fmtTime(slot.recipe.baseTime, slot.recipe.baseServings, s)} min</div>
          </div>
        </div>
        <div style={{ background: C.surf2, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Portionen</div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Global: {globalPersons} · Hier anpassen für dieses Gericht</div>
          </div>
          <Stepper value={s} onChange={setS} label="Port." accent />
        </div>
        {s !== globalPersons && (
          <div style={{ fontSize: 11, color: C.accent, marginBottom: 12, paddingLeft: 4 }}>
            ↕ Abweichend vom globalen Wert ({globalPersons} Pers.) – wirkt sich auf die Einkaufsliste aus
          </div>
        )}
        <button onClick={() => { onServingsChange(s); onClose(); }} style={{ width: "100%", padding: 13, borderRadius: 13, background: C.accent, color: C.bg, fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", marginBottom: 10, fontFamily: "inherit" }}>Übernehmen</button>
        <button onClick={() => { onRemove(); onClose(); }} style={{ width: "100%", padding: 12, borderRadius: 13, background: C.surf2, color: C.red, fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", fontFamily: "inherit" }}>Gericht entfernen</button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
function MealPlanner() {
  const navigate = useNavigate();
  const username = localStorage.getItem("username") ?? "L";

  // ── Auth ──────────────────────────────────────────────────────────────────
  const [needReauth, setNeedReauth] = useState(false);
  const handleNeedReauth = useCallback(() => setNeedReauth(true), []);
  useEffect(() => { if (!hasStoredJwtToken()) setNeedReauth(true); }, []);

  // ── Planner settings (read from Settings page via localStorage) ──────────
  const savedSettings = readLS<{ globalPersons: number; thresholds: { quick: number; normal: number } }>(
    LS_SETTINGS, { globalPersons: 2, thresholds: { quick: 20, normal: 35 } }
  );
  const [globalPersons] = useState(savedSettings.globalPersons);
  const [thresholds]    = useState(savedSettings.thresholds);

  // ── Persisted state ───────────────────────────────────────────────────────
  const [recipes, setRecipes]         = useState<Recipe[]>(() => readLS<Recipe[]>(LS_RECIPES, INITIAL_RECIPES));
  const [week, setWeek]               = useState<Week>(() => readLS<Week>(LS_WEEK, EMPTY_WEEK()));
  const [daySettings, setDaySettings] = useState<Record<string, DaySettingsEntry>>(() => readLS(LS_DAY_SETTINGS, DEFAULT_DAY_SETTINGS()));
  const [manualItems, setManualItems] = useState<PlannerManualItem[]>([]);

  // ── Inventory from real API ───────────────────────────────────────────────
  const [inventoryNames, setInventoryNames] = useState<string[]>([]);

  useEffect(() => {
    if (!hasStoredJwtToken()) return;
    authApiCall<ApiResponse>("/api/fetch_items?only_wish_list=false", undefined, { retries: 2, onUnauthorized: handleNeedReauth })
      .then((data) => {
        const names = data.items.map((i) => i.text?.toLowerCase() ?? "").filter(Boolean);
        setInventoryNames(names);
      })
      .catch(() => setInventoryNames([]));
  }, [handleNeedReauth]);

  const inInventory = useCallback((name: string) => {
    if (!inventoryNames.length) return false;
    const n = name.toLowerCase();
    return inventoryNames.some((inv) => inv.includes(n) || n.includes(inv));
  }, [inventoryNames]);

  // ── Reactive shopping list ────────────────────────────────────────────────
  const weekPlanItems = useMemo(() => collectMissing(week, inInventory), [week, inInventory]);

  // Sync to localStorage so WishList can read it
  useEffect(() => {
    writeLS(LS_SHOPPING, { weekPlanItems, manualItems });
  }, [weekPlanItems, manualItems]);

  // Persist recipes / week / daySettings
  useEffect(() => { writeLS(LS_RECIPES, recipes); }, [recipes]);
  useEffect(() => { writeLS(LS_WEEK, week); }, [week]);
  useEffect(() => { writeLS(LS_DAY_SETTINGS, daySettings); }, [daySettings]);

  // ── UI state ─────────────────────────────────────────────────────────────
  const [mainTab, setMainTab]   = useState<"plan" | "recipes">("plan");
  const [activeDay, setActiveDay] = useState(0);
  const [modal, setModal]        = useState<Modal>(null);
  const [favFilter, setFavFilter] = useState(false);
  const [search, setSearch]       = useState("");
  const [toast, showToast, clearToast] = useFeedbackToast(3000);

  const today     = new Date().getDay();
  const todayIdx  = today === 0 ? 6 : today - 1;

  const DAY_TYPE_OPTIONS = [
    { id: "quick",   icon: "⚡", label: "Schnelltag",  desc: `≤ ${thresholds.quick} min` },
    { id: "normal",  icon: "🏠", label: "Normaltag",   desc: `≤ ${thresholds.normal} min` },
    { id: "relaxed", icon: "🌿", label: "Entspannt",   desc: "Alle Rezepte" },
  ] as const;

  // ── Handlers ─────────────────────────────────────────────────────────────
  const setDayType = (day: string, type: DayType) =>
    setDaySettings((p) => ({ ...p, [day]: { ...p[day], type } }));

  const toggleBlock = (day: string, mealKey: keyof DayPlan) => {
    setDaySettings((p) => {
      const nowBlocked = !p[day].blocked[mealKey];
      if (nowBlocked) setWeek((w) => ({ ...w, [day]: { ...w[day], [mealKey]: null } }));
      return { ...p, [day]: { ...p[day], blocked: { ...p[day].blocked, [mealKey]: nowBlocked } } };
    });
  };

  const saveRecipe = (r: Recipe) => {
    setRecipes((prev) => prev.find((x) => x.id === r.id) ? prev.map((x) => x.id === r.id ? r : x) : [...prev, r]);
    setModal(null);
    showToast(`${r.emoji} ${r.name} gespeichert`, "success");
  };

  const toggleFav = (recipe: Recipe) =>
    setRecipes((prev) => prev.map((r) => r.id === recipe.id ? { ...r, favorited: !r.favorited } : r));

  const addMissingToList = (recipe: Recipe, servings: number) => {
    const items = recipe.ingredients
      .filter((i) => !inInventory(i.name))
      .map((i) => ({ id: uid(), name: i.name, amount: fmtAmt(i.amount, recipe.baseServings, servings), unit: i.unit, fromRecipe: recipe.name }));
    setManualItems((prev) => {
      const updated = [...prev];
      items.forEach((m) => {
        const idx = updated.findIndex((w) => w.name.toLowerCase() === m.name.toLowerCase());
        if (idx >= 0) updated[idx] = { ...updated[idx], amount: parseFloat((updated[idx].amount + m.amount).toFixed(1)) };
        else updated.push(m);
      });
      return updated;
    });
    setModal(null);
    showToast(`${items.length} Zutaten zur Einkaufsliste hinzugefügt`, "success");
  };

  const handleGenerate = () => {
    const newWeek = generateWeekPlan(recipes, daySettings, globalPersons, thresholds);
    setWeek(newWeek);
    const missing = collectMissing(newWeek, inInventory);
    showToast(
      missing.length > 0
        ? `Plan erstellt · ${missing.length} Zutaten auf Einkaufsliste`
        : "Plan erstellt – alles im Inventar!",
      "success",
    );
  };

  const addSlot = (day: string, mealKey: keyof DayPlan, recipe: Recipe) => {
    setWeek((prev) => ({ ...prev, [day]: { ...prev[day], [mealKey]: { recipe, servings: globalPersons } } }));
    setModal(null);
    showToast(`${recipe.emoji} ${recipe.name} geplant`, "success");
  };

  const updateSlotServings = (day: string, mealKey: keyof DayPlan, servings: number) =>
    setWeek((prev) => ({ ...prev, [day]: { ...prev[day], [mealKey]: { ...prev[day][mealKey]!, servings } } }));

  const removeSlot = (day: string, mealKey: keyof DayPlan) =>
    setWeek((prev) => ({ ...prev, [day]: { ...prev[day], [mealKey]: null } }));

  // ── Derived values ───────────────────────────────────────────────────────
  const filteredRecipes = useMemo(() => {
    let list = favFilter ? recipes.filter((r) => r.favorited) : recipes;
    if (search) list = list.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [recipes, favFilter, search]);

  const dayData    = week[DAYS[activeDay]];
  const daySetting = daySettings[DAYS[activeDay]];
  const allMeals   = DAYS.flatMap((d) => Object.values(week[d]).filter(Boolean) as MealSlot[]);
  const totalShoppingItems = weekPlanItems.length + manualItems.length;

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Sans', system-ui, sans-serif", paddingBottom: 80 }}>
      {needReauth && <AuthPopup onAuthenticated={() => { setNeedReauth(false); }} />}

      <AppHeader username={username} />

      {/* Sub-tabs */}
      <div style={{ padding: "4px 16px 12px", display: "flex", gap: 7, borderBottom: `1px solid ${C.border}` }}>
        <Pill active={mainTab === "plan"} onClick={() => setMainTab("plan")}>Wochenplan</Pill>
        <Pill active={mainTab === "recipes"} onClick={() => setMainTab("recipes")}>Rezepte</Pill>
        {/* Shopping list shortcut */}
        {totalShoppingItems > 0 && (
          <button
            onClick={() => navigate("/wish_list")}
            style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, padding: "6px 12px", borderRadius: 20, background: C.accentBg, border: `1px solid ${C.accentBorder}`, color: C.accent, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            {totalShoppingItems}
          </button>
        )}
      </div>

      {/* ═══ WOCHENPLAN ═══ */}
      {mainTab === "plan" && (
        <div style={{ padding: "12px 16px 0" }}>
          {/* Generate button */}
          <button onClick={handleGenerate} style={{ width: "100%", padding: 13, borderRadius: 13, background: C.accent, color: C.bg, fontSize: 14, fontWeight: 800, border: "none", cursor: "pointer", fontFamily: "inherit", marginBottom: 6 }}>
            ✨ Wochenplan zufällig erstellen
          </button>
          <div style={{ fontSize: 11, color: C.dim, textAlign: "center", marginBottom: 14 }}>
            Favoriten ↑ gewichtet · Tagestyp & blockierte Slots berücksichtigt
          </div>

          {/* Day tabs */}
          <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
            {DAYS.map((day, i) => {
              const active   = activeDay === i;
              const isToday  = i === todayIdx;
              const typeIcon = DAY_TYPE_OPTIONS.find((t) => t.id === daySettings[day].type)?.icon ?? "🏠";
              return (
                <button key={day} onClick={() => setActiveDay(i)}
                  style={{ flexShrink: 0, width: 54, height: 70, borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, background: active ? C.accentBg : C.surf, border: `1.5px solid ${active ? C.accentBorder : C.border}`, cursor: "pointer", fontFamily: "inherit" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", color: active ? C.accent : C.dim }}>{day}</div>
                  <div style={{ fontSize: isToday ? 7 : 16, fontWeight: 800, color: active ? C.accent : C.text, lineHeight: 1.2 }}>{isToday ? "HEUTE" : i + 1}</div>
                  <div style={{ fontSize: 12 }}>{typeIcon}</div>
                  <div style={{ display: "flex", gap: 3 }}>
                    {MEAL_KEYS.map((k) => {
                      const blocked = daySettings[day].blocked[k];
                      const filled  = !!week[day][k];
                      return <div key={k} style={{ width: 4, height: 4, borderRadius: "50%", background: blocked ? C.dim : filled ? C.accent : C.surf2, opacity: blocked ? 0.4 : filled ? 1 : 0.3 }} />;
                    })}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Day header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{DAY_FULL[activeDay]}</div>
            <div style={{ display: "flex", gap: 5 }}>
              {DAY_TYPE_OPTIONS.map((t) => (
                <button key={t.id} onClick={() => setDayType(DAYS[activeDay], t.id)} title={`${t.label} (${t.desc})`}
                  style={{ width: 32, height: 32, borderRadius: 9, fontSize: 14, border: `1.5px solid ${daySetting.type === t.id ? C.accentBorder : C.border}`, background: daySetting.type === t.id ? C.accentBg : C.surf2, cursor: "pointer" }}>
                  {t.icon}
                </button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>
            {DAY_TYPE_OPTIONS.find((t) => t.id === daySetting.type)?.icon} {DAY_TYPE_OPTIONS.find((t) => t.id === daySetting.type)?.label} · {DAY_TYPE_OPTIONS.find((t) => t.id === daySetting.type)?.desc}
          </div>

          {/* Meal slots */}
          <div style={{ marginBottom: 20 }}>
            {MEAL_KEYS.map((key, i) => {
              const slot    = dayData[key];
              const blocked = daySetting.blocked[key];
              return (
                <div key={key} style={{ position: "relative", marginBottom: 9 }}>
                  <div
                    onClick={() => !blocked && (slot
                      ? setModal({ type: "slotPopover", day: DAYS[activeDay], mealKey: key, mealLabel: MEAL_LABELS[i], slot })
                      : setModal({ type: "picker",      day: DAYS[activeDay], mealKey: key, mealType: MEAL_LABELS[i] }))}
                    style={{ background: blocked ? C.surf : C.surf, border: `1.5px ${blocked ? "solid" : slot ? "solid" : "dashed"} ${blocked ? C.dim + "44" : slot ? C.border : C.dim + "55"}`, borderRadius: 16, padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: blocked ? "default" : "pointer", opacity: blocked ? 0.45 : 1, transition: "all .15s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {blocked ? (
                        <><div style={{ width: 28, height: 28, borderRadius: 8, background: C.surf2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🚫</div>
                          <span style={{ fontSize: 13, color: C.dim, fontWeight: 500 }}>{MEAL_LABELS[i]} – kein Essen</span></>
                      ) : slot ? (
                        <><span style={{ fontSize: 26 }}>{slot.recipe.emoji}</span>
                          <div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{slot.recipe.name}</div>
                            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
                              {MEAL_LABELS[i]} · {fmtTime(slot.recipe.baseTime, slot.recipe.baseServings, slot.servings)} min
                              <span style={{ color: slot.servings !== globalPersons ? C.accent : C.muted }}> · {slot.servings} Port.</span>
                            </div>
                          </div></>
                      ) : (
                        <><div style={{ width: 28, height: 28, borderRadius: 8, background: C.surf2, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, color: C.dim }}>+</div>
                          <span style={{ fontSize: 13, color: C.dim, fontWeight: 500 }}>{MEAL_LABELS[i]} hinzufügen</span></>
                      )}
                    </div>
                    {slot && !blocked && <div style={{ fontSize: 18, color: C.dim }}>›</div>}
                  </div>
                  {/* Lock toggle */}
                  <button onClick={(e) => { e.stopPropagation(); toggleBlock(DAYS[activeDay], key); }}
                    title={blocked ? "Entsperren" : "Blockieren"}
                    style={{ position: "absolute", top: 10, right: slot ? 36 : 10, width: 22, height: 22, borderRadius: 6, background: blocked ? C.surf2 : "transparent", border: `1px solid ${blocked ? C.accentBorder : "transparent"}`, color: blocked ? C.accent : C.dim + "88", fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}>
                    {blocked ? "🔓" : "🔒"}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Week summary */}
          {allMeals.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <SLabel>Wochenübersicht</SLabel>
              <div style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 16, padding: 14, display: "flex", justifyContent: "space-around" }}>
                {[
                  { label: "Geplant",   val: `${allMeals.length}/21` },
                  { label: "Rezepte",   val: new Set(allMeals.map((s) => s.recipe.id)).size },
                  { label: "Ø Kochzeit", val: `${Math.round(allMeals.reduce((sum, m) => sum + fmtTime(m.recipe.baseTime, m.recipe.baseServings, m.servings), 0) / allMeals.length)} min` },
                ].map((item) => (
                  <div key={item.label} style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 20, fontWeight: 800, color: C.accent }}>{item.val}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{item.label}</div>
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
              style={{ background: C.surf2, border: `1.5px solid ${C.border}`, borderRadius: 10, padding: "10px 12px", color: C.text, fontSize: 14, flex: 1, outline: "none", fontFamily: "inherit" }}
              placeholder="Suchen…" value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <button onClick={() => setFavFilter(!favFilter)} style={{ padding: "10px 12px", borderRadius: 10, background: favFilter ? C.accentBg : C.surf2, border: `1.5px solid ${favFilter ? C.accentBorder : C.border}`, cursor: "pointer", fontSize: 15, flexShrink: 0 }}>❤️</button>
            <button onClick={() => setModal({ type: "addRecipe" })} style={{ padding: "10px 16px", borderRadius: 10, background: C.accent, color: C.bg, fontSize: 18, fontWeight: 800, border: "none", cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}>+</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {filteredRecipes.length === 0 && <div style={{ textAlign: "center", color: C.muted, padding: 36, fontSize: 14 }}>{favFilter ? "Noch keine Favoriten." : "Keine Rezepte gefunden."}</div>}
            {filteredRecipes.map((r) => (
              <div key={r.id} onClick={() => setModal({ type: "detail", recipe: r })} style={{ background: C.surf, border: `1px solid ${C.border}`, borderRadius: 16, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, cursor: "pointer" }}>
                <div style={{ fontSize: 28, width: 50, height: 50, background: C.surf2, borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{r.emoji}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{r.baseTime} min · {r.baseServings} Port. · {r.ingredients.length} Zutaten</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                    {r.tags.map((t) => <span key={t} style={{ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 5, background: C.surf2, color: C.muted }}>{t}</span>)}
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); toggleFav(r); }} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer", padding: 4, flexShrink: 0 }}>{r.favorited ? "❤️" : "🤍"}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals ── */}
      {modal?.type === "addRecipe" && <RecipeForm onSave={saveRecipe} onClose={() => setModal(null)} />}
      {modal?.type === "editRecipe" && <RecipeForm initial={modal.recipe} onSave={saveRecipe} onClose={() => setModal(null)} />}
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
        <RecipePicker mealType={modal.mealType} recipes={recipes} onSelect={(r) => addSlot(modal.day, modal.mealKey, r)} onClose={() => setModal(null)} />
      )}
      {modal?.type === "slotPopover" && (
        <SlotPopover slot={modal.slot} mealLabel={modal.mealLabel} globalPersons={globalPersons}
          onServingsChange={(s) => updateSlotServings(modal.day, modal.mealKey, s)}
          onRemove={() => removeSlot(modal.day, modal.mealKey)}
          onClose={() => setModal(null)}
          onOpenDetail={(recipe) => setModal({ type: "detail", recipe })} />
      )}

      <FeedbackToast toast={toast} onDismiss={clearToast} />
      <BottomTabBar />
    </div>
  );
}

export default memo(MealPlanner);
