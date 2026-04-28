import json
import traceback

from fastapi import APIRouter, Request, status

from utils.api_helpers import (
    getIdFromUsername,
    getUsernameFromReq,
    handleUsernameNoneAfterAuth,
    addRecipeToDb,
    deleteRecipeById,
    getWeekPlanForUser,
    getWeekSettingsForUser,
    modifyRecipe,
    replaceWeekPlanForUser,
    replaceWeekSettingsForUser,
    getPlannerSettings,
    replacePlannerSettings,
    getSpecificMealInWeek,
    deleteMealInWeek,
    replaceMealByTimestamp,
)
from utils.types_custom import (
    AddRecipe,
    Recipe,
    Ingredient,
    MealSlot,
    PlannerSettings,
    AddWeekPlan,
)

router = APIRouter(prefix="", tags=["meal planning"])


@router.get("/recipes")
async def get_recipes(request: Request):
    username = getUsernameFromReq(request) or "benno"
    if not username:
        return handleUsernameNoneAfterAuth()

    async with request.app.state.pool.acquire() as con:
        userId = await getIdFromUsername(con, username)
        res = await con.fetch(
            """SELECT re.recipe_id, re.name, re.base_time, re.default_portions, re.tags, re.emoji,
               json_agg(json_build_object('amount', ing.amount, 'unit', ing.unit, 'name', ing.name, 'count', rip.count)) AS ingredients
               FROM recipes re
               JOIN recipe_ingredient_map rip ON rip.recipe_id = re.recipe_id
               JOIN ingredients ing ON ing.ingredient_id = rip.ingredient_id
               WHERE re.user_id = $1
               GROUP BY re.recipe_id, re.name, re.base_time, re.default_portions, re.tags, re.emoji""",
            userId,
        )

        recipes = [
            Recipe(
                recipe_id=row["recipe_id"],
                name=row["name"],
                base_time=row["base_time"],
                default_portions=row["default_portions"],
                tags=row["tags"],
                emoji=row["emoji"],
                ingredients=[
                    Ingredient(**ing) for ing in json.loads(row["ingredients"])
                ],
            )
            for row in res
        ]

        return {
            "recipes": [r.model_dump() for r in recipes],
            "recipe_count": len(recipes),
        }


@router.post("/recipes")
async def add_recipe(request: Request, body: AddRecipe):

    try:
        username = getUsernameFromReq(request)
        if not username:
            return handleUsernameNoneAfterAuth()
        async with request.app.state.pool.acquire() as con:
            userId = await getIdFromUsername(con, username)
            result = await addRecipeToDb(con, userId, body)
        return result
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}\n{traceback.format_exception(e)}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@router.get("/recipes/{recipe_id}")
async def get_recipe_by_id(request: Request, recipe_id: int):
    username = getUsernameFromReq(request)

    async with request.app.state.pool.acquire() as con:
        uid = await getIdFromUsername(con, username) if username else -1
        res = await con.fetchrow(
            "select recipe_id, name, base_time, default_portions, emoji, tags, steps from recipes where recipe_id = $1 and user_id = $2",
            recipe_id,
            uid,
        )

        if res is not None:
            return {
                "recipe_id": res.get("recipe_id"),
                "name": res.get("name"),
                "base_time": res.get("base_time"),
                "default_portions": res.get("default_portions"),
                "emoji": res.get("emoji"),
                "tags": res.get("tags"),
                "steps": res.get("steps"),
            }
        else:
            return {
                "status": "error",
                "code": status.HTTP_404_NOT_FOUND,
                "detail": f"no recipe with id {recipe_id}",
            }


@router.put("/recipes/{recipe_id}")
async def modify_recipe(request: Request, body: AddRecipe, recipe_id: int):
    try:
        print(f"got this body: {body.model_dump_json()}")
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            await modifyRecipe(con, uid, recipe_id, body)
        return {
            "message": f"Successfully deleted recipe for user {uid}",
            "status": "success",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


@router.delete("/recipes/{recipe_id}")
async def delete_recipe(request: Request, recipe_id: int):

    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            await deleteRecipeById(con, recipe_id)
        return {
            "message": f"Successfully deleted recipe for user {uid}",
            "status": "success",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


@router.get("/week_plan/single_meal")
async def get_specific_meal(request: Request, day: str, day_time: str):
    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            meal = await getSpecificMealInWeek(con, day, day_time, uid)
        return {
            "message": f"Successfully retrieved meal for user {uid}",
            "meal_slot": meal,
            "status": "success",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": "500",
        }


@router.get("/planner_settings")
async def get_planner_settings(request: Request):

    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            settings: PlannerSettings = await getPlannerSettings(con, uid)
        return {
            "message": f"Successfully retrieved planner settings for user {uid}",
            "status": "success",
            "planner_settings": settings,
            "code": status.HTTP_200_OK,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@router.post("/planner_settings")
async def put_planner_settings(request: Request, body: PlannerSettings):

    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            await replacePlannerSettings(con, uid, body)
        return {
            "message": f"Successfully replaced planner settings for user {uid}",
            "status": "success",
            "code": status.HTTP_200_OK,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@router.delete("/week_plan")
async def delete_meal_slot(request: Request, body: MealSlot):

    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            await deleteMealInWeek(con, uid, body)
        return {
            "message": f"Successfully deleted meal for user {uid}",
            "status": "success",
            "code": status.HTTP_200_OK,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@router.post("/week_plan/replace_meal")
async def replace_meal(request: Request, body: MealSlot):

    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            await replaceMealByTimestamp(con, uid, body)
        return {
            "message": f"Successfully replaced meal slot for {body.day} at {body.day_time} for user {uid}",
            "status": "success",
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@router.post("/week_plan")
async def post_week_plan(request: Request, body: AddWeekPlan):

    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            await replaceWeekPlanForUser(con, body.week, uid)
            await replaceWeekSettingsForUser(con, body.DaySettings, uid)
        return {
            "message": f"Successfully replaced week's settings and meal slots for user {uid}",
            "status": "success",
            "code": status.HTTP_201_CREATED,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }


@router.get("/week_plan")
async def get_week_plan(request: Request):

    try:
        username = getUsernameFromReq(request)
        async with request.app.state.pool.acquire() as con:
            uid = await getIdFromUsername(con, username)
            weekPlan = await getWeekPlanForUser(con, uid)
            weekSettings = await getWeekSettingsForUser(con, uid)
        return {
            "week_plan": weekPlan.model_dump_json(),
            "week_settings": weekSettings,
            "code": status.HTTP_200_OK,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"failed with this error: {e}",
            "code": status.HTTP_500_INTERNAL_SERVER_ERROR,
        }
