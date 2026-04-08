# ============================================================================
# CONFIGURATION - All settings in one place
# ============================================================================
import os


class Config:
    # Feature toggles
    ENABLE_WHISPER_MODEL_LOCAL = False
    ENABLE_WHISPER_MODEL_CLOUD = True
    ENABLE_LOKI_LOGGING = False
    ENABLE_PROMETHEUS = True
    ENABLE_FILE_LOGGING = True

    # Database settings
    DB_POOL_MIN_SIZE = 10
    DB_POOL_MAX_SIZE = 20
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

    # other
    SINK_LABEL_WISH_MAPPING = "other"

    @classmethod
    def get_database_url(cls) -> str:
        if os.getenv("RUNNING_IN_CONTAINER"):
            return "postgresql://postgres:postgres@postgres-db:5432/maindb"
        return "postgresql://postgres:postgres@127.0.0.1:5432/maindb"

    @classmethod
    def get_csv_path(cls) -> str:
        if os.getenv("RUNNING_IN_CONTAINER"):
            return "/app/openfoodfacts.csv"
        return "openfoodfacts.csv"
