from datetime import datetime, timezone

import requests

from utils.types_custom import LogModelUsage


def logModel(response, processName, baseUrl): 
    if response.usage:
        docuObj: LogModelUsage = LogModelUsage(
            model_name=response.model,
            usage_stats=response.usage.to_dict(),
            process_name=processName,
            provider_url=baseUrl,
            timestamp=datetime.now(timezone.utc),
        )

        requests.post(
            "http://localhost:3030/log_model_usage",
            data=docuObj.model_dump_json(),
            headers={"Content-Type": "application/json"},
        )  # log usage to api
