use std::sync::OnceLock;

/// The native shell accepts the same explicit display-language tags as the UI.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum NativeLanguage {
    #[default]
    English,
    Korean,
    Spanish,
    Japanese,
    BrazilianPortuguese,
    SimplifiedChinese,
    French,
    German,
}

impl NativeLanguage {
    pub(crate) fn parse(value: &str) -> Result<Self, String> {
        match value {
            "en" => Ok(Self::English), "ko" => Ok(Self::Korean), "es" => Ok(Self::Spanish),
            "ja" => Ok(Self::Japanese), "pt-BR" => Ok(Self::BrazilianPortuguese),
            "zh-Hans" => Ok(Self::SimplifiedChinese), "fr" => Ok(Self::French), "de" => Ok(Self::German),
            _ => Err(format!("Unsupported display language: {value}")),
        }
    }
    pub(crate) fn from_tag(tag: Option<&str>) -> Self {
        tag.and_then(|tag| Self::parse(tag).ok()).unwrap_or_default()
    }
    pub(crate) fn tag(self) -> &'static str {
        match self {
            Self::English => "en", Self::Korean => "ko", Self::Spanish => "es", Self::Japanese => "ja",
            Self::BrazilianPortuguese => "pt-BR", Self::SimplifiedChinese => "zh-Hans", Self::French => "fr", Self::German => "de",
        }
    }
    pub(crate) fn is_korean(self) -> bool { self == Self::Korean }
    pub(crate) fn is_additional(self) -> bool { !matches!(self, Self::English | Self::Korean | Self::Spanish) }
    pub(crate) fn text<'a>(self, english: &'a str) -> &'a str {
        static COPY: OnceLock<serde_json::Value> = OnceLock::new();
        let copy = COPY.get_or_init(|| serde_json::from_str(include_str!("../../apps/desktop/src/features/localization/supplementalTranslations.json"))
            .expect("checked-in supplemental translations must be valid JSON"));
        copy.get(self.tag()).and_then(|table| table.get(english)).and_then(|value| value.as_str()).unwrap_or(english)
    }
    pub(crate) fn pick(self, english: &'static str, korean: &'static str, spanish: &'static str) -> &'static str {
        match self { Self::English => english, Self::Korean => korean, Self::Spanish => spanish, _ => self.text(english) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_supported_native_language_parses_and_has_menu_copy() {
        for tag in ["en", "ko", "es", "ja", "pt-BR", "zh-Hans", "fr", "de"] {
            let language = NativeLanguage::parse(tag).unwrap();
            assert_eq!(language.tag(), tag);
            if language.is_additional() {
                assert_ne!(language.pick("Quit Drifty", "Drifty 종료", "Salir de Drifty"), "Quit Drifty");
            }
        }
        assert!(NativeLanguage::parse("zh-Hant").is_err());
        assert_eq!(NativeLanguage::from_tag(Some("unknown")), NativeLanguage::English);
    }

    #[test]
    fn runtime_status_keys_use_the_same_catalog_without_changing_unknown_details() {
        let status = String::from("Drift alerts: AI unavailable");
        let detail = String::from("Unknown provider detail");
        for tag in ["ja", "pt-BR", "zh-Hans", "fr", "de"] {
            let language = NativeLanguage::parse(tag).unwrap();
            assert_ne!(language.text(&status), status);
            assert_eq!(language.text(&detail), detail);
        }
    }
}
