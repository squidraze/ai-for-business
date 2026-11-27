from pydantic import BaseModel


class SendCodeIn(BaseModel):
    phone: str


class SignInIn(BaseModel):
    phone: str = ""
    code: str
    phone_code_hash: str | None = None


class PasswordIn(BaseModel):
    password: str


class SendMessageIn(BaseModel):
    text: str
    reply_to_id: int | None = None
