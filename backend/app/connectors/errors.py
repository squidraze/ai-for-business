from fastapi import HTTPException


class ConnectorError(HTTPException):
    """A clean 4xx `{detail}` error. Subclasses HTTPException so FastAPI renders it as-is,
    while `str(err)` is just the human-readable detail (handy for the AI tools)."""

    def __init__(self, status_code: int, detail: str):
        super().__init__(status_code=status_code, detail=detail)

    def __str__(self) -> str:
        return str(self.detail)


class NotConnected(ConnectorError):
    def __init__(self, detail: str = "Connector is not connected"):
        super().__init__(409, detail)
