"""Sends auth emails through Gmail SMTP (STARTTLS). No other providers.

Blocking (smtplib): call it from a sync route, which FastAPI runs in its thread
pool, or wrap it in `run_in_threadpool` from async code.

Dev mode: with SMTP_USER or SMTP_PASSWORD empty nothing is sent and the code is
logged at WARNING level instead.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.auth.emails import render_code_email
from app.config import settings
from app.lib.errors import ApiError

log = logging.getLogger("app.auth.mail")

SMTP_TIMEOUT = 20


def send_code_email(to: str, purpose: str, code: str, lang: str = "en") -> None:
    if not settings.smtp_enabled:
        log.warning("[dev mail] to=%s purpose=%s code=%s", to, purpose, code)
        return

    subject, text, html_body = render_code_email(purpose, code, settings.EMAIL_CODE_TTL_MINUTES, lang)
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((settings.SMTP_FROM_NAME, settings.SMTP_USER))
    msg["To"] = to
    msg["Message-ID"] = make_msgid(domain=settings.SMTP_USER.split("@")[-1] or None)
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")

    try:
        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=SMTP_TIMEOUT) as smtp:
            smtp.ehlo()
            smtp.starttls(context=ssl.create_default_context())
            smtp.ehlo()
            # Google shows App Passwords in groups of four ("abcd efgh ..."); spaces are not part of it
            smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD.replace(" ", ""))
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        log.error("SMTP send to %s failed: %s", to, e)
        raise ApiError(502, "email_send_failed") from e
    log.info("sent %s code email to %s", purpose, to)
