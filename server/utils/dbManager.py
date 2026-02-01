import asyncio
import os
from typing import Any, Optional
import asyncpg
import urllib.parse


class Config:
    # Feature toggles
    ENABLE_ML_MODEL = False
    ENABLE_WHISPER_MODEL_LOCAL = False
    ENABLE_WHISPER_MODEL_CLOUD = True
    ENABLE_LOKI_LOGGING = True
    ENABLE_PROMETHEUS = True
    ENABLE_FILE_LOGGING = True

    # Database settings
    DB_POOL_MIN_SIZE = 1
    DB_POOL_MAX_SIZE = 5
    DB_COMMAND_TIMEOUT = 30
    DB_RETRY_ATTEMPTS = 10
    DB_RETRY_DELAY = 2.0

    # Cache settings
    LRU_CACHE_SIZE = 20

    # Logging settings
    LOG_FILE_MAX_SIZE = 5 * 1024 * 1024
    LOG_FILE_BACKUP_COUNT = 2

    # Loki settings
    LOKI_URL = "http://192.168.1.13:3100"

    # Backend proxy URL
    BACKEND_URL = "http://192.168.1.165:3030"

    @classmethod
    def get_database_url(cls) -> str:
        if os.getenv("RUNNING_IN_CONTAINER"):
            return "postgresql://postgres:postgres@postgres-db:5432/maindb"
        return "postgresql://postgres:postgres@127.0.0.1:5432/maindb"

    @classmethod
    def get_csv_path(cls) -> str:
        if os.getenv("RUNNING_IN_CONTAINER"):
            return "/app/openfoodfacts.csv"
        return "/Users/bennetjollenbeck/Desktop/programming/web/react/family_projects/grocery-list2/server/openfoodfacts.csv"


class DatabaseManager:
    """Centralized database operations with retry logic and self-healing"""

    def __init__(self, pool: asyncpg.Pool, logger):
        self.pool = pool
        self.logger = logger

    async def execute_with_retry(
        self,
        query: str,
        *args,
        retries: int = Config.DB_RETRY_ATTEMPTS,
        delay: float = Config.DB_RETRY_DELAY,
    ) -> Any:
        """Execute query with automatic retry on transient failures"""
        last_error = None

        for attempt in range(retries):
            try:
                async with self.pool.acquire() as con:
                    return await con.execute(query, *args)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                last_error = e
                self.logger.warning(
                    f"DB connection error (attempt {attempt + 1}/{retries}): {e}"
                )
                if attempt < retries - 1:
                    await asyncio.sleep(delay * (attempt + 1))
            except Exception as e:
                raise e

        raise last_error # type: ignore

    async def fetch_with_retry(
        self, query: str, *args, retries: int = Config.DB_RETRY_ATTEMPTS
    ) -> list:
        """Fetch rows with automatic retry"""
        last_error = None

        for attempt in range(retries):
            try:
                async with self.pool.acquire() as con:
                    return await con.fetch(query, *args)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                last_error = e
                self.logger.warning(f"DB fetch error (attempt {attempt + 1}/{retries}): {e}")
                if attempt < retries - 1:
                    await asyncio.sleep(Config.DB_RETRY_DELAY * (attempt + 1))
            except Exception as e:
                raise e

        raise last_error # type: ignore

    async def fetchrow_with_retry(self, query: str, *args) -> Optional[asyncpg.Record]:
        """Fetch single row with retry"""
        for attempt in range(Config.DB_RETRY_ATTEMPTS):
            try:
                async with self.pool.acquire() as con:
                    return await con.fetchrow(query, *args)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                self.logger.warning(f"DB fetchrow error (attempt {attempt + 1}): {e}")
                if attempt < Config.DB_RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(Config.DB_RETRY_DELAY * (attempt + 1))
        return None

    async def fetchval_with_retry(self, query: str, *args) -> Any:
        """Fetch single value with retry"""
        for attempt in range(Config.DB_RETRY_ATTEMPTS):
            try:
                async with self.pool.acquire() as con:
                    return await con.fetchval(query, *args)
            except (asyncpg.PostgresConnectionError, asyncpg.InterfaceError) as e:
                self.logger.warning(f"DB fetchval error (attempt {attempt + 1}): {e}")
                if attempt < Config.DB_RETRY_ATTEMPTS - 1:
                    await asyncio.sleep(Config.DB_RETRY_DELAY * (attempt + 1))
        return None


    def parse_db_url(
        self,
        db_url: str,
    ) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str], dict]:
        """Parse database URL into components"""
        p = urllib.parse.urlparse(db_url)
        user = urllib.parse.unquote(p.username) if p.username else None
        password = urllib.parse.unquote(p.password) if p.password else None
        host = p.hostname
        port = str(p.port) if p.port else None
        dbname = p.path.lstrip("/") if p.path else None
        env = dict(os.environ)
        if password:
            env["PGPASSWORD"] = password
        return user, host, port, dbname, env


    async def run_psql_command(
        self,
        cmd_args: list[str], env: Optional[dict] = None
    ) -> tuple[int, str, str]:
        """Execute psql command asynchronously"""
        proc = await asyncio.create_subprocess_exec(
            *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        out, err = await proc.communicate()
        return proc.returncode, out.decode(errors="ignore"), err.decode(errors="ignore") # type: ignore


    def get_script_path(self, level: int = 0) -> str:
        """Get script directory path, optionally going up levels"""
        script_dir = os.path.dirname(os.path.abspath(__file__))
        if level < 0:
            parts = script_dir.split(os.sep)
            parts = parts[: (len(parts) + level)]
            script_dir = os.sep.join(parts) or os.sep
        return script_dir
