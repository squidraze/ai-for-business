from pydantic import BaseModel


class SendEmailIn(BaseModel):
    to: str | list[str]
    subject: str = ""
    body: str = ""
    cc: str | list[str] | None = None


class ReplyIn(BaseModel):
    body: str
