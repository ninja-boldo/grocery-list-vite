import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { RecipeBookMobile } from "@/comp/recipe/RecipeBookMobile";
import { RecipeBookWeb } from "@/comp/recipe/RecipeBookWeb";
import { authApiCall, hasStoredJwtToken } from "@/lib/authApi";
import { apiClient } from "@/lib/api/client";
import { isAddEanSuccess } from "@/lib/api/addEanFlow";
import type {
  AddEanRequest,
  PantryClassificationWishItem,
} from "@/lib/api/openapi";
import {
  deleteRecipeById,
  fetchRecipes,
  type RecipeItem,
} from "@/lib/recipesApi";
import FeedbackToast, { useFeedbackToast } from "@/comp/utils/FeedbackToast";
import { useTranslation } from "react-i18next";

const MOBILE_BREAKPOINT = 900;

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  background: "transparent",
  color: "var(--text-main)",
  fontFamily: "var(--font-body)",
  paddingBottom: 92,
};

const containerStyle: CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "016px16px",
  display: "grid",
  gap: 14,
};

const normalizeItemName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

type QuantityPrompt = {
  itemName: string;
  displayName: string;
  resolve: (data: { quantity: number; unit: string } | null) => void;
};

export default function RecipesPage() {
  const { t } = useTranslation();
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needReauth, setNeedReauth] = useState(false);
  const [query, setQuery] = useState("");
  const [addingRecipeId, setAddingRecipeId] = useState<number | null>(null);
  const [deletingRecipeId, setDeletingRecipeId] = useState<number | null>(null);
  const [toast, showToast, clearToast] = useFeedbackToast(4000);
  const [quantityPrompt, setQuantityPrompt] = useState<QuantityPrompt | null>(
    null,
  );
  const [quantityInput, setQuantityInput] = useState("");
  const [unitInput, setUnitInput] = useState("Stück");

  const isMobile = windowWidth <= MOBILE_BREAKPOINT;
  const username = localStorage.getItem("username") ?? "User";

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!hasStoredJwtToken()) {
      setNeedReauth(true);
    }
  }, []);

  const handleNeedReauth = useCallback(() => {
    setNeedReauth(true);
  }, []);

  const loadRecipes = useCallback(async () => {
    if (!hasStoredJwtToken()) {
      handleNeedReauth();
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetchRecipes(handleNeedReauth);
      setRecipes(response.recipes);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : t("failedToLoadRecipes", "Failed to load recipes");
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [handleNeedReauth]);

  useEffect(() => {
    void loadRecipes();
  }, [loadRecipes]);

  const filteredRecipes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return recipes;
    }

    return recipes.filter((recipe) => {
      const recipeName = (recipe.name ?? "").toLowerCase();
      const inName = recipeName.includes(normalized);
      const inTags = recipe.tags.some((tag) =>
        tag.toLowerCase().includes(normalized),
      );
      const inIngredients = recipe.ingredients.some((ingredient) =>
        ingredient.name.toLowerCase().includes(normalized),
      );
      return inName || inTags || inIngredients;
    });
  }, [query, recipes]);

  const promptForQuantity = useCallback(
    (itemName: string): Promise<{ quantity: number; unit: string } | null> => {
      return new Promise((resolve) => {
        setQuantityInput("");
        setUnitInput("Stück");
        setQuantityPrompt({ itemName, displayName: itemName, resolve });
      });
    },
    [],
  );

  const handleQuantitySubmit = useCallback(() => {
    if (!quantityPrompt) return;
    const qty = parseFloat(quantityInput);
    if (isNaN(qty) || qty <= 0) {
      quantityPrompt.resolve(null);
      setQuantityPrompt(null);
      return;
    }
    quantityPrompt.resolve({ quantity: qty, unit: unitInput });
    setQuantityPrompt(null);
  }, [quantityPrompt, quantityInput, unitInput]);

  const handleQuantitySkip = useCallback(() => {
    if (!quantityPrompt) return;
    quantityPrompt.resolve(null);
    setQuantityPrompt(null);
  }, [quantityPrompt]);

  const handleAddMissingToWishList = useCallback(
    async (recipe: RecipeItem) => {
      if (!hasStoredJwtToken()) {
        handleNeedReauth();
        return;
      }

      if (recipe.ingredients.length === 0) {
        showToast("This recipe has no ingredients to add", "error");
        return;
      }

      setAddingRecipeId(recipe.recipe_id);

      try {
        const indexedIngredients = recipe.ingredients.map(
          (ingredient, index) => ({
            ingredient,
            wishItemId: `recipe-${recipe.recipe_id}-${index}`,
          }),
        );

        const payload: PantryClassificationWishItem[] = indexedIngredients.map(
          ({ ingredient, wishItemId }) => ({
            item_name: ingredient.name,
            item_id: wishItemId,
            count: 1,
            quantity: {
              product_quantity:
                typeof ingredient.amount === "number" &&
                Number.isFinite(ingredient.amount)
                  ? Math.max(1, Math.round(ingredient.amount))
                  : null,
              product_quantity_unit: ingredient.unit,
            },
            info: "",
          }),
        );

        const alreadyInPantryNames: Set<string> = new Set();
        const alreadyInWishlistNames: Set<string> = new Set();

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

          for (const entry of classification.mapping ?? []) {
            if (entry.foundMappingWish && entry.mappedWishItem?.item_id) {
              alreadyInWishlistNames.add(entry.mappedWishItem.item_id);
            }
            if (entry.pantryItem?.item_name && !entry.foundMappingWish) {
              alreadyInPantryNames.add(
                entry.pantryItem.item_name.toLowerCase(),
              );
            }
          }
        } catch {
          // Classification unavailable, skip check
        }

        const missingIngredients = indexedIngredients.filter(
          ({ wishItemId, ingredient }) => {
            if (alreadyInWishlistNames.has(wishItemId)) return false;
            if (alreadyInPantryNames.has(ingredient.name.toLowerCase()))
              return false;
            return true;
          },
        );

        if (missingIngredients.length === 0) {
          setAddingRecipeId(null);
          showToast(
            "All ingredients are already in your pantry and wishlist",
            "success",
          );
          return;
        }

        const aggregated = new Map<
          string,
          { name: string; count: number; needsQuantity: boolean }
        >();
        for (const { ingredient } of missingIngredients) {
          const key = normalizeItemName(ingredient.name);
          if (!key) continue;
          const needsQty =
            ingredient.amount === null && ingredient.unit === null;
          const existing = aggregated.get(key);
          if (existing) {
            existing.count += 1;
          } else {
            aggregated.set(key, {
              name: ingredient.name,
              count: 1,
              needsQuantity: needsQty,
            });
          }
        }

        if (aggregated.size === 0) {
          setAddingRecipeId(null);
          showToast("No new ingredients found to add", "success");
          return;
        }

        const itemsNeedingQuantity: string[] = [];
        for (const item of aggregated.values()) {
          if (item.needsQuantity) {
            itemsNeedingQuantity.push(item.name);
          }
        }

        // Prompt user for quantities on items missing them
        const quantityOverrides = new Map<
          string,
          { quantity: number; unit: string }
        >();
        for (const itemName of itemsNeedingQuantity) {
          const result = await promptForQuantity(itemName);
          if (result) {
            quantityOverrides.set(normalizeItemName(itemName), result);
          }
        }

        let addedCount = 0;
        for (const [key, item] of aggregated) {
          const override = quantityOverrides.get(key);
          const body: AddEanRequest = {
            item_name: item.name,
            count: item.count,
            wish_list: "true",
          };
          if (override) {
            body.quantity_data = {
              product_quantity: Math.max(1, Math.round(override.quantity)),
              product_quantity_unit: override.unit,
            };
          }

          try {
            const response = await apiClient.addEanToList(body, {
              retries: 1,
              retryDelayMs: 300,
              onUnauthorized: handleNeedReauth,
            });
            if (isAddEanSuccess(response)) {
              addedCount++;
            }
          } catch {
            // Continue adding remaining items even if one fails
          }
        }

        setAddingRecipeId(null);
        const recipeName = recipe.name?.trim() || "Unnamed Recipe";
        if (addedCount > 0) {
          showToast(
            `${addedCount} ingredient${addedCount === 1 ? "" : "s"} added to wishlist from ${recipeName}`,
            "success",
          );
        } else {
          showToast("Could not add ingredients to wishlist", "error");
        }
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t(
                "failedToAddMissingIngredientsToWishlist",
                "Failed to add missing ingredients to wishlist.",
              );
        setAddingRecipeId(null);
        showToast(message, "error");
      }
    },
    [handleNeedReauth, promptForQuantity, showToast],
  );

  const handleDeleteRecipe = useCallback(
    async (recipe: RecipeItem) => {
      if (!hasStoredJwtToken()) {
        handleNeedReauth();
        return;
      }

      const recipeLabel = recipe.name?.trim() || "Unnamed Recipe";
      const shouldDelete = window.confirm(
        t(
          "deleteRecipeRecipelabelThisCannotBeUndone",
          'Delete recipe "{{recipeLabel}}"? This cannot be undone.',
          { recipeLabel },
        ),
      );
      if (!shouldDelete) {
        return;
      }

      setDeletingRecipeId(recipe.recipe_id);
      try {
        await deleteRecipeById(recipe.recipe_id, handleNeedReauth);
        setRecipes((previous) =>
          previous.filter((entry) => entry.recipe_id !== recipe.recipe_id),
        );
        showToast(
          t("recipe_deleted_success", "Deleted {{recipeLabel}}", {
            recipeLabel,
          }),
          "success",
        );
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : t("failedToDeleteRecipe", "Failed to delete recipe.");
        showToast(message, "error");
      } finally {
        setDeletingRecipeId(null);
      }
    },
    [handleNeedReauth, showToast],
  );

  return (
    <div style={pageStyle}>
      <AppHeader username={username} />

      <main style={containerStyle}>
        <section
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search_recipes_placeholder", "Search recipes...")}
            style={{
              flex: "1 1 320px",
              minWidth: 220,
              maxWidth: 460,
              border: "1px solid var(--border)",
              borderRadius: 12,
              background: "var(--surface-2)",
              color: "var(--text-main)",
              padding: "10px 12px",
              fontSize: 14,
            }}
          />

          <button
            type="button"
            onClick={() => void loadRecipes()}
            disabled={isLoading}
            style={{
              border: "1px solid var(--accent-border)",
              borderRadius: 12,
              background: isLoading ? "var(--accent-light)" : "var(--accent)",
              color: "#fff",
              padding: "9px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading
              ? t("refreshing", "Refreshing...")
              : t("refresh", "Refresh")}
          </button>
        </section>

        {error && (
          <section
            style={{
              border: "1px solid var(--error-border)",
              background: "var(--error-bg)",
              color: "var(--error)",
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 13,
            }}
          >
            {t("error_loading_recipes", "Error: {{error}}", { error })}
          </section>
        )}

        {isLoading && recipes.length === 0 && (
          <section style={{ color: "var(--text-muted)", fontSize: 14 }}>
            {t("loading_recipes", "Loading recipes...")}
          </section>
        )}

        {!isLoading && filteredRecipes.length === 0 && error && (
          <section style={{ color: "var(--error)", fontSize: 13 }}>
            {t("error_loading_recipes", "Error: {{error}}", { error })}
          </section>
        )}

        {filteredRecipes.length > 0 &&
          (isMobile ? (
            <RecipeBookMobile
              recipes={filteredRecipes}
              addingRecipeId={addingRecipeId}
              deletingRecipeId={deletingRecipeId}
              onAddMissingToWishList={handleAddMissingToWishList}
              onDeleteRecipe={handleDeleteRecipe}
            />
          ) : (
            <RecipeBookWeb
              recipes={filteredRecipes}
              addingRecipeId={addingRecipeId}
              deletingRecipeId={deletingRecipeId}
              onAddMissingToWishList={handleAddMissingToWishList}
              onDeleteRecipe={handleDeleteRecipe}
            />
          ))}
      </main>

      {quantityPrompt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.85)",
            zIndex: 300,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            backdropFilter: "blur(6px)",
          }}
          onClick={handleQuantitySkip}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "24px 24px 0 0",
              padding: "20px 20px 44px",
              width: "100%",
              maxWidth: 480,
              maxHeight: "90vh",
              overflowY: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                background: "var(--surface-2)",
                margin: "0 auto 18px",
              }}
            />
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: "var(--text-main)",
                marginBottom: 8,
              }}
            >
              {t("add_quantity_title", "Quantity")}
            </div>
            <div
              style={{
                fontSize: 14,
                color: "var(--text-muted)",
                marginBottom: 18,
              }}
            >
              {t("quantity_for_item_prompt", "How much")}{" "}
              <strong style={{ color: "var(--accent)" }}>
                {quantityPrompt.displayName}
              </strong>{" "}
              {t("quantity_needed", "do you need?")}
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              <input
                type="number"
                min="1"
                step="1"
                value={quantityInput}
                onChange={(e) => setQuantityInput(e.target.value)}
                placeholder={t("quantity_input_placeholder", "Enter quantity")}
                autoFocus
                style={{
                  flex: 1,
                  background: "var(--surface-3)",
                  border: "1.5px solid var(--border)",
                  borderRadius: 10,
                  padding: "10px 12px",
                  color: "var(--text-main)",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              />
              <select
                value={unitInput}
                onChange={(e) => setUnitInput(e.target.value)}
                style={{
                  width: 110,
                  background: "var(--surface-3)",
                  border: "1.5px solid var(--border)",
                  borderRadius: 10,
                  padding: "10px 8px",
                  color: "var(--text-main)",
                  fontSize: 14,
                  outline: "none",
                  fontFamily: "inherit",
                }}
              >
                {[
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
                ].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={handleQuantitySkip}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 13,
                  background: "var(--surface-2)",
                  color: "var(--text-muted)",
                  fontSize: 14,
                  fontWeight: 700,
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {t("skip_button", "Skip")}
              </button>
              <button
                type="button"
                onClick={handleQuantitySubmit}
                disabled={!quantityInput || parseFloat(quantityInput) <= 0}
                style={{
                  flex: 1,
                  padding: 12,
                  borderRadius: 13,
                  background:
                    quantityInput && parseFloat(quantityInput) > 0
                      ? "var(--accent)"
                      : "var(--accent-light)",
                  color:
                    quantityInput && parseFloat(quantityInput) > 0
                      ? "#fff"
                      : "var(--text-subtle)",
                  fontSize: 14,
                  fontWeight: 700,
                  border: "none",
                  cursor:
                    quantityInput && parseFloat(quantityInput) > 0
                      ? "pointer"
                      : "not-allowed",
                  fontFamily: "inherit",
                }}
              >
                {t("add_with_quantity_button", "Add with quantity")}
              </button>
            </div>
          </div>
        </div>
      )}

      <FeedbackToast toast={toast} onDismiss={clearToast} />
      <BottomTabBar />

      {needReauth && <AuthPopup onAuthenticated={() => setNeedReauth(false)} />}
    </div>
  );
}
