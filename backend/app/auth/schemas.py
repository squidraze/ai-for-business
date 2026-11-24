from typing import Annotated, Literal

from pydantic import BaseModel, BeforeValidator, model_validator

from app.auth import validation as v

Email = Annotated[str, BeforeValidator(v.normalize_email)]
NewPassword = Annotated[str, BeforeValidator(v.check_password)]
AnyPassword = Annotated[str, BeforeValidator(v.nonempty)]
Name = Annotated[str, BeforeValidator(v.normalize_name)]
Code = Annotated[str, BeforeValidator(v.check_code)]
Token = Annotated[str, BeforeValidator(v.nonempty)]
NamePart = Annotated[str | None, BeforeValidator(v.optional_name_part)]


class RegisterIn(BaseModel):
    email: Email
    password: NewPassword
    name: Name

    @model_validator(mode="after")
    def _password_not_email(self):
        v.check_password_not_email(self.password, self.email)
        return self


class VerifyEmailIn(BaseModel):
    email: Email
    code: Code


class ResendCodeIn(BaseModel):
    email: Email
    purpose: Literal["verify", "reset"]


class LoginIn(BaseModel):
    email: Email
    password: AnyPassword


class ForgotPasswordIn(BaseModel):
    email: Email


class ResetPasswordIn(BaseModel):
    email: Email
    code: Code
    password: NewPassword

    @model_validator(mode="after")
    def _password_not_email(self):
        v.check_password_not_email(self.password, self.email)
        return self


class GoogleIn(BaseModel):
    id_token: Token


class AppleIn(BaseModel):
    identity_token: Token
    given_name: NamePart = None
    family_name: NamePart = None
