from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.tracker.capture_contract import Snapshot

ExclusionSource = Literal["default", "user"]

REDACTED_APP_NAME = "[Redacted]"


@dataclass(frozen=True)
class ExcludedAppRule:
    id: str
    name: str
    bundle_id: str | None
    source: ExclusionSource


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
        if rule.bundle_id and norm_bundle and rule.bundle_id.lower() == norm_bundle:
            return rule
        if rule.name and norm_name and rule.name.lower() == norm_name:
            return rule
    return None


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

