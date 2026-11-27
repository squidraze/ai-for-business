"""Registry of all integrations. Adding one = a new package + one line here."""

from app.integrations.base import Integration
from app.integrations.bitrix24 import integration as bitrix24
from app.integrations.gmail import integration as gmail
from app.integrations.telegram import integration as telegram

INTEGRATIONS: list[Integration] = [
    telegram,
    gmail,
    bitrix24,
]
