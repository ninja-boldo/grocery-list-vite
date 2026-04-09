import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import AppHeader from "@/comp/other/AppHeader";
import BottomTabBar from "@/comp/other/BottomTabBar";
import AuthPopup from "@/comp/other/AuthPopup";
import { RecipeBookMobile } from "@/comp/recipe/RecipeBookMobile";
import { RecipeBookWeb } from "@/comp/recipe/RecipeBookWeb";
import { hasStoredJwtToken } from "@/lib/authApi";
import { fetchRecipes, type RecipeItem } from "@/lib/recipesApi";

const MOBILE_BREAKPOINT = 900;

const pageStyle: CSSProperties = {
  minHeight: "100dvh",
  background: "#0D1117",
  color: "#E6EDF3",
  paddingBottom: 92,
};

const containerStyle: CSSProperties = {
  maxWidth: 1120,
  margin: "0 auto",
  padding: "0 16px 16px",
  display: "grid",
  gap: 14,
};

export default function RecipesPage() {
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [recipes, setRecipes] = useState<RecipeItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needReauth, setNeedReauth] = useState(false);
  const [query, setQuery] = useState("");

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
      const message = err instanceof Error ? err.message : "Failed to load recipes";
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
      const recipeLabel = `recipe ${recipe.recipe_id}`;
      const inTags = recipe.tags.some((tag) => tag.toLowerCase().includes(normalized));
      const inIngredients = recipe.ingredients.some((ingredient) =>
        ingredient.name.toLowerCase().includes(normalized),
      );
      return recipeLabel.includes(normalized) || inTags || inIngredients;
    });
  }, [query, recipes]);

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
            placeholder="Search recipes by ingredient or tag"
            style={{
              flex: "1 1 320px",
              minWidth: 220,
              maxWidth: 460,
              border: "1px solid #30363D",
              borderRadius: 12,
              background: "#161B22",
              color: "#E6EDF3",
              padding: "10px 12px",
              fontSize: 14,
            }}
          />

          <button
            type="button"
            onClick={() => void loadRecipes()}
            disabled={isLoading}
            style={{
              border: "1px solid #1D9E75",
              borderRadius: 12,
              background: isLoading ? "#0F2A28" : "#1D9E75",
              color: "#FFFFFF",
              padding: "9px 14px",
              fontSize: 13,
              fontWeight: 600,
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </section>

        {error && (
          <section
            style={{
              border: "1px solid #7F1D1D",
              background: "#2B1111",
              color: "#FCA5A5",
              borderRadius: 12,
              padding: "10px 12px",
              fontSize: 13,
            }}
          >
            {error}
          </section>
        )}

        {isLoading && recipes.length === 0 && (
          <section style={{ color: "#93A4B5", fontSize: 14 }}>Loading recipes...</section>
        )}

        {!isLoading && filteredRecipes.length === 0 && (
          <section style={{ color: "#93A4B5", fontSize: 14 }}>
            {recipes.length === 0
              ? "No recipes available from the server yet."
              : "No recipes matched your search."}
          </section>
        )}

        {filteredRecipes.length > 0 &&
          (isMobile ? (
            <RecipeBookMobile recipes={filteredRecipes} />
          ) : (
            <RecipeBookWeb recipes={filteredRecipes} />
          ))}
      </main>

      <BottomTabBar />

      {needReauth && <AuthPopup onAuthenticated={() => setNeedReauth(false)} />}
    </div>
  );
}
