from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlsplit

from app.tracker.capture_contract import Snapshot

ExclusionSource = Literal["default", "user"]

REDACTED_APP_NAME = "[Redacted]"
# A site rule shares the excluded-app list (and its account sync) under this id
# prefix, e.g. "site:kbstar.com", so no stored or synced schema changes.
SITE_RULE_PREFIX = "site:"
_SITE_LABEL = re.compile(r"^[a-z0-9\u00a1-\uffff](?:[a-z0-9\u00a1-\uffff-]*[a-z0-9\u00a1-\uffff])?$")


@dataclass(frozen=True)
class ExcludedAppRule:
    id: str
    name: str
    bundle_id: str | None
    source: ExclusionSource

    @property
    def site_domain(self) -> str | None:
        """The domain a site rule covers, with its subdomains; None for an app rule."""
        if not self.id.startswith(SITE_RULE_PREFIX):
            return None
        return normalize_excluded_site(self.id[len(SITE_RULE_PREFIX):])


def normalize_excluded_site(value: str | None) -> str | None:
    """A bare host for a site rule: lowercased, without scheme, path, port or a leading "www."."""
    text = (value or "").strip().lower()
    if not text:
        return None
    try:
        host = urlsplit(text if "://" in text else "//" + text).hostname or ""
    except ValueError:
        return None
    host = host.strip(".")
    if host.startswith("www."):
        host = host[4:]
    try:
        # One form for comparison: browsers and the settings field may give a
        # Unicode or a punycode host for the same site.
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        pass
    labels = host.split(".")
    if len(labels) < 2 or not all(_SITE_LABEL.match(label) for label in labels):
        return None
    return host


DEFAULT_EXCLUDED_APPS: tuple[ExcludedAppRule, ...] = (
    ExcludedAppRule(id="com.1password.1password", name="1Password", bundle_id="com.1password.1password", source="default"),
    ExcludedAppRule(id="com.authy.authy-mac", name="Authy", bundle_id="com.authy.authy-mac", source="default"),
    ExcludedAppRule(id="com.bitwarden.desktop", name="Bitwarden", bundle_id="com.bitwarden.desktop", source="default"),
    ExcludedAppRule(id="com.dashlane.dashlanephone6", name="Dashlane", bundle_id="com.dashlane.dashlanephone6", source="default"),
    ExcludedAppRule(id="in.sinew.Enpass-Desktop", name="Enpass", bundle_id="in.sinew.Enpass-Desktop", source="default"),
    ExcludedAppRule(id="com.keepersecurity.passwordmanager", name="Keeper", bundle_id="com.keepersecurity.passwordmanager", source="default"),
    ExcludedAppRule(id="org.keepassxc.keepassxc", name="KeePassXC", bundle_id="org.keepassxc.keepassxc", source="default"),
    ExcludedAppRule(id="com.apple.keychainaccess", name="Keychain Access", bundle_id="com.apple.keychainaccess", source="default"),
    ExcludedAppRule(id="com.lastpass.LastPass", name="LastPass", bundle_id="com.lastpass.LastPass", source="default"),
    ExcludedAppRule(id="com.ledger.live", name="Ledger Live", bundle_id="com.ledger.live", source="default"),
    ExcludedAppRule(id="com.nordpass.osx", name="NordPass", bundle_id="com.nordpass.osx", source="default"),
    ExcludedAppRule(id="com.apple.Passwords", name="Passwords", bundle_id="com.apple.Passwords", source="default"),
    ExcludedAppRule(id="ch.protonpass.mac", name="Proton Pass", bundle_id="ch.protonpass.mac", source="default"),
    ExcludedAppRule(id="com.outercorner.Secrets2", name="Secrets", bundle_id="com.outercorner.Secrets2", source="default"),
    ExcludedAppRule(id="io.trezor.suite", name="Trezor Suite", bundle_id="io.trezor.suite", source="default"),
    ExcludedAppRule(id="com.yubico.authenticator", name="Yubico Authenticator", bundle_id="com.yubico.authenticator", source="default"),
)


def match_app_exclusion(
    app_name: str | None,
    bundle_id: str | None,
    rules: list[ExcludedAppRule] | tuple[ExcludedAppRule, ...],
) -> ExcludedAppRule | None:
    norm_name = (app_name or "").strip().lower()
    norm_bundle = (bundle_id or "").strip().lower()
    for rule in rules:
        if rule.id.startswith(SITE_RULE_PREFIX):
            continue
        if rule.bundle_id and norm_bundle and rule.bundle_id.lower() == norm_bundle:
            return rule
        if rule.name and norm_name and rule.name.lower() == norm_name:
            return rule
    return None


def match_site_exclusion(
    site_domain: str | None,
    site_url: str | None,
    rules: list[ExcludedAppRule] | tuple[ExcludedAppRule, ...],
) -> ExcludedAppRule | None:
    host = normalize_excluded_site(site_domain) or normalize_excluded_site(site_url)
    if not host:
        return None
    for rule in rules:
        domain = rule.site_domain
        if domain and (host == domain or host.endswith("." + domain)):
            return rule
    return None


def match_exclusion(
    app_name: str | None,
    bundle_id: str | None,
    site_domain: str | None,
    site_url: str | None,
    rules: list[ExcludedAppRule] | tuple[ExcludedAppRule, ...],
) -> ExcludedAppRule | None:
    """The rule that keeps this capture out of history: its app, or the site it shows.

    An excluded site is recorded exactly like an excluded app, so its time stays
    counted while the app, window title, address and page clues are not kept.
    """
    return match_app_exclusion(app_name, bundle_id, rules) or match_site_exclusion(site_domain, site_url, rules)


def redact_snapshot(snapshot: Snapshot, exclusion_source: str) -> Snapshot:
    return Snapshot(
        observed_at=snapshot.observed_at,
        app_name=REDACTED_APP_NAME,
        bundle_id=None,
        window_title=None,
        source=snapshot.source,
        browser_name=None,
        site_domain=None,
        site_title=None,
        site_url=None,
        youtube_video_id=None,
        youtube_playlist_id=None,
        youtube_is_shorts=None,
        site_source=None,
        capture_confidence=snapshot.capture_confidence,
        engagement_evidence=snapshot.engagement_evidence,
        exclusion_source=exclusion_source,
    )

