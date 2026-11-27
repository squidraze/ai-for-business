from pydantic import BaseModel


class BitrixConnectIn(BaseModel):
    webhook_url: str


class CommentIn(BaseModel):
    text: str
