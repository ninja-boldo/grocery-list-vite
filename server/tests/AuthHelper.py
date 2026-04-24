import requests
from ..utils import types_custom as typ


class Auth:
    def __init__(self, tokenEndpoint: str, user: str, passwd: str) -> None:
        self.bearer: str = ""
        self.username: str = user
        self.passwd: str = passwd
        self.tokenEndpoint: str = tokenEndpoint

    def getBearer(self):
        try:
            res: requests.Response = requests.post(
                self.tokenEndpoint,
                data={"username": self.username, "password": self.passwd},
            )
            print(res.json())
            parsedRes: typ.Token = typ.Token.model_validate(res.json())
            return parsedRes.access_token
        except Exception as e:
            raise Exception(f"""failed obtaining the bearer 
                            with this username: {self.username},
                            this endpoint: {self.tokenEndpoint}
                            and this error: {e}""")

    def getAuthHeader(self):
        if self.bearer == "":
            self.bearer = self.getBearer()
        return {"Authorization": self.bearer}
