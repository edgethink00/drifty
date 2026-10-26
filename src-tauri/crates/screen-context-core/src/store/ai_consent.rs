use super::*;
use crate::ai_consent::AiConsentPreferences;
use rusqlite::OptionalExtension;

const MAX_CONSENT_BYTES: usize = 8192;
const TABLE_SQL: &str = "CREATE TABLE screen_ai_consent (id INTEGER PRIMARY KEY CHECK(id=1), value BLOB, pending INTEGER NOT NULL CHECK(pending IN (0,1)))";
struct StoredConsent {
    value: Option<Vec<u8>>,
    pending: bool,
}

impl EvidenceStore {
    fn ai_consent_table_exists(&self) -> Result<bool, Error> {
        let rows=self.db.prepare("SELECT type,sql FROM sqlite_master WHERE name='screen_ai_consent' OR tbl_name='screen_ai_consent'")?.query_map([],|row|Ok((row.get::<_,String>(0)?,row.get::<_,Option<String>>(1)?)))?.collect::<Result<Vec<_>,_>>()?;
        match rows.as_slice() {
            [] => Ok(false),
            [(kind, Some(sql))] if kind == "table" && sql.trim() == TABLE_SQL => Ok(true),
            _ => Err(Error::Authentication),
        }
    }
    /// A first read creates no optional table and never inherits capture or
    /// browser/AI settings. A foreign/future table/value refuses unchanged.
    pub fn read_ai_consent_preferences(&mut self, now: i64) -> Result<AiConsentPreferences, Error> {
        self.maintenance(now)?;
        if !self.ai_consent_table_exists()? {
            return Ok(AiConsentPreferences::default());
        }
        let Some(StoredConsent { value, pending }) = self.ai_consent_row()? else {
            return Ok(AiConsentPreferences::default());
        };
        if pending {
            return Err(Error::Authentication);
        }
        let sealed = value.ok_or(Error::Authentication)?;
        self.decode_ai_consent(&sealed)
    }
    fn ai_consent_row(&self) -> Result<Option<StoredConsent>, Error> {
        Ok(self
            .db
            .query_row(
                "SELECT value,pending FROM screen_ai_consent WHERE id=1",
                [],
                |row| {
                    Ok(StoredConsent {
                        value: row.get(0)?,
                        pending: row.get(1)?,
                    })
                },
            )
            .optional()?)
    }
    fn decode_ai_consent(&self, sealed: &[u8]) -> Result<AiConsentPreferences, Error> {
        if sealed.len() > MAX_CONSENT_BYTES + 64 {
            return Err(Error::Authentication);
        }
        let clear = self.crypto.open(
            format!("screen-ai-consent:{}", self.scope.path_component()).as_bytes(),
            sealed,
        )?;
        serde_json::from_slice(&clear).map_err(|_| Error::Authentication)
    }
    pub(crate) fn save_ai_consent_preferences(
        &mut self,
        value: &AiConsentPreferences,
        now: i64,
        current: &dyn Fn() -> bool,
    ) -> Result<(), Error> {
        self.maintenance(now)?;
        if !current() {
            return Err(Error::Invalidated);
        }
        // Check before any DDL/overwrite, including an explicit empty choice.
        let exists = self.ai_consent_table_exists()?;
        if exists {
            match self.ai_consent_row()? {
                Some(StoredConsent {
                    value: Some(sealed),
                    ..
                }) => {
                    // Explicit edits may recover our own interrupted write,
                    // but never a foreign/future encrypted value.
                    self.decode_ai_consent(&sealed)?;
                }
                Some(StoredConsent {
                    value: None,
                    pending: false,
                }) => return Err(Error::Authentication),
                _ => {}
            }
        }
        let clear =
            Zeroizing::new(serde_json::to_vec(value).map_err(|_| Error::Invalid("AI consent"))?);
        if clear.len() > MAX_CONSENT_BYTES {
            return Err(Error::Invalid("AI consent size"));
        }
        let sealed = self.crypto.seal(
            format!("screen-ai-consent:{}", self.scope.path_component()).as_bytes(),
            &clear,
        )?;
        // A separate durable barrier precedes changing the encrypted grants.
        // After this commit, crash/uncertain commit/late cancellation makes
        // reopen refuse until another explicit native settings save succeeds.
        let barrier = self.db.transaction()?;
        if !exists {
            barrier.execute_batch(TABLE_SQL)?;
        }
        barrier.execute("INSERT INTO screen_ai_consent(id,value,pending) VALUES(1,NULL,1) ON CONFLICT(id) DO UPDATE SET pending=1",[])?;
        if !current() {
            return Err(Error::Invalidated);
        }
        if barrier.commit().is_err() {
            self.poisoned = true;
            return Err(Error::Storage);
        }
        if !current() {
            return Err(Error::Invalidated);
        }
        let tx = self.db.transaction()?;
        if tx.execute(
            "UPDATE screen_ai_consent SET value=?1 WHERE id=1 AND pending=1",
            [sealed],
        )? != 1
        {
            return Err(Error::Authentication);
        }
        if !current() {
            return Err(Error::Invalidated);
        }
        if tx.commit().is_err() {
            self.poisoned = true;
            return Err(Error::Storage);
        }
        if !current() {
            return Err(Error::Invalidated);
        }
        if !self
            .db
            .execute(
                "UPDATE screen_ai_consent SET pending=0 WHERE id=1 AND pending=1",
                [],
            )
            .is_ok_and(|changed| changed == 1)
        {
            self.poisoned = true;
            return Err(Error::Storage);
        }
        if !current() {
            if self
                .db
                .execute("UPDATE screen_ai_consent SET pending=1 WHERE id=1", [])
                .is_err()
            {
                self.poisoned = true;
                return Err(Error::Storage);
            }
            return Err(Error::Invalidated);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
