"""Bitrix24 CRM over the portal's inbound webhook: deals, leads, contacts, companies, tasks, comments."""

from app.integrations.base import Integration
from app.integrations.bitrix24 import client
from app.integrations.bitrix24.router import router
from app.integrations.bitrix24.tools import TOOLS

integration = Integration(
    id=client.ID,
    title="Bitrix24",
    is_connected=client.is_connected,
    account_summary=client.account_summary,
    router=router,
    tools=TOOLS,
    prompt_scope="their Bitrix24 CRM (deals, leads, contacts, companies, tasks)",
    prompt_actions="create or update CRM records",
    prompt_hint="For the CRM, use bitrix_list_deals / bitrix_list_leads / bitrix_search_contacts; "
    "to move a deal, get the stage ids with bitrix_deal_stages first. "
    "Mention amounts with their currency and link records with their `url`.",
    prompt_approval="any change in Bitrix24",
)
