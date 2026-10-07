"""Bounded author metadata from explicit HTML head; never current-document proof."""
import re
from html.parser import HTMLParser
from typing import Any, Dict, Optional

MAX_SOURCE_BYTES = 2_000_000
MAX_DESCRIPTION_UTF16 = 160
FIELDS = ("description", "og:description", "twitter:description")
# ECMAScript whitespace: match the existing QA/product normalization semantics.
SPACE = re.compile(r"[ \f\n\r\t\v\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+")
HEAD_TAGS = {"base", "basefont", "bgsound", "link", "meta", "title",
             "noscript", "noframes", "style", "script", "template"}
RAW_TAGS = {"title", "noscript", "noframes", "style", "script"}


def clip_description(value: str, limit: int = MAX_DESCRIPTION_UTF16) -> str:
    text = SPACE.sub(" ", value).strip(" ")
    result = []
    units = 0
    for point in text:
        size = 2 if ord(point) > 0xffff else 1
        if units + size > limit:
            break
        result.append(point)
        units += size
    return "".join(result).rstrip(" ")


class HeadMetadata(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.in_head = False
        self.seen_head = False
        self.finished = False
        self.unsupported = False
        self.raw_tag: Optional[str] = None
        self.template_depth = 0
        self.values: Dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: Any) -> None:
        if self.finished:
            return
        if self.raw_tag:
            return
        if tag == "head":
            if self.seen_head:
                self.unsupported = True
                self.finished = True
            else:
                self.seen_head = True
                self.in_head = True
            return
        if not self.in_head:
            if tag == "body":
                self.finished = True
            return
        if tag == "template":
            self.template_depth += 1
            return
        if self.template_depth:
            return
        if tag not in HEAD_TAGS:
            self.unsupported = True
            self.finished = True
            return
        if tag in RAW_TAGS:
            self.raw_tag = tag
            return
        if tag != "meta":
            return
        # Duplicate attributes: browsers retain the first, not the last.
        attributes: Dict[str, Optional[str]] = {}
        for key, value in attrs:
            if key not in attributes:
                attributes[key] = value
        # An explicitly empty name does not fall back to property (DOM nullish behavior).
        raw_field = attributes.get("name") if "name" in attributes else attributes.get("property")
        field = clip_description(raw_field or "", 100).lower()
        content = clip_description(attributes.get("content") or "")
        if field in FIELDS and content and field not in self.values:
            self.values[field] = content

    def handle_startendtag(self, tag: str, attrs: Any) -> None:
        self.handle_starttag(tag, attrs)
        if self.raw_tag == tag:
            self.unsupported = True
        if tag == "template":
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if self.finished:
            return
        if self.raw_tag:
            if tag == self.raw_tag:
                self.raw_tag = None
            return
        if tag == "template" and self.template_depth:
            self.template_depth -= 1
            return
        if self.template_depth:
            return
        if tag in {"head", "body", "html"}:
            self.in_head = False
            self.finished = True

    def handle_data(self, data: str) -> None:
        if self.in_head and not self.raw_tag and not self.template_depth and clip_description(data):
            self.unsupported = True
            self.finished = True


def description_from_loaded_html(html: Any) -> Dict[str, Any]:
    """Return at most one <=160 UTF16 D, with local-only provenance."""
    base: Dict[str, Any] = {
        "schema": "browser-description-research/v1",
        "source": "loaded_html",
        "freshness": "unknown",
    }
    if not isinstance(html, str):
        return dict(base, failure="invalid_source")
    try:
        source_bytes = len(html.encode("utf-8"))
    except UnicodeEncodeError:
        return dict(base, failure="invalid_encoding")
    if source_bytes > MAX_SOURCE_BYTES:
        return dict(base, failure="source_oversize")
    parser = HeadMetadata()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return dict(base, failure="parse_failure")
    if not parser.seen_head:
        return dict(base, failure="explicit_head_missing")
    if parser.unsupported or parser.raw_tag or parser.template_depth or parser.in_head:
        return dict(base, failure="unsupported_head_structure")
    for field in FIELDS:
        if field in parser.values:
            return dict(base, description=parser.values[field], descriptionField=field)
    return dict(base, failure="description_missing")
