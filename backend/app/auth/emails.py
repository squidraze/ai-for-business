"""Localized email templates for auth codes (en / ru / uz latin)."""

import html

LANGS = ("en", "ru", "uz")

_T = {
    "en": {
        "verify_subject": "{code} is your forBusiness verification code",
        "verify_intro": "Use this code to confirm your email address:",
        "reset_subject": "{code} is your forBusiness password reset code",
        "reset_intro": "Use this code to reset your password:",
        "expires": "The code is valid for {minutes} minutes.",
        "ignore": "If you did not request this, just ignore this email.",
    },
    "ru": {
        "verify_subject": "{code} — код подтверждения forBusiness",
        "verify_intro": "Введите этот код, чтобы подтвердить адрес почты:",
        "reset_subject": "{code} — код для сброса пароля forBusiness",
        "reset_intro": "Введите этот код, чтобы сбросить пароль:",
        "expires": "Код действует {minutes} минут.",
        "ignore": "Если вы не запрашивали код, просто проигнорируйте это письмо.",
    },
    "uz": {
        "verify_subject": "{code} — forBusiness tasdiqlash kodi",
        "verify_intro": "Elektron pochta manzilingizni tasdiqlash uchun ushbu koddan foydalaning:",
        "reset_subject": "{code} — forBusiness parolni tiklash kodi",
        "reset_intro": "Parolni tiklash uchun ushbu koddan foydalaning:",
        "expires": "Kod {minutes} daqiqa amal qiladi.",
        "ignore": "Agar siz bu kodni so'ramagan bo'lsangiz, ushbu xatni e'tiborsiz qoldiring.",
    },
}


def pick_lang(accept_language: str | None) -> str:
    """First supported language from an Accept-Language header; English by default."""
    for part in (accept_language or "").split(","):
        tag = part.split(";")[0].strip().lower()[:2]
        if tag in LANGS:
            return tag
    return "en"


def render_code_email(purpose: str, code: str, minutes: int, lang: str = "en") -> tuple[str, str, str]:
    """Returns (subject, plain text, html)."""
    t = _T.get(lang, _T["en"])
    subject = t[f"{purpose}_subject"].format(code=code)
    intro = t[f"{purpose}_intro"]
    expires = t["expires"].format(minutes=minutes)
    ignore = t["ignore"]

    text = f"{intro}\n\n    {code}\n\n{expires}\n{ignore}\n\nforBusiness\n"
    e = html.escape
    body = f"""<!doctype html>
<html><body style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#1d1d1f">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-size:16px">{e(intro)}</p>
    <p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:6px">{e(code)}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#555">{e(expires)}</p>
    <p style="margin:0;font-size:14px;color:#555">{e(ignore)}</p>
  </div>
  <p style="text-align:center;font-size:12px;color:#999;margin-top:16px">forBusiness</p>
</body></html>"""
    return subject, text, body
