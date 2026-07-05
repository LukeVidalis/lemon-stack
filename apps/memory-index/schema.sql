-- {{PLANE_PROJECT_PREFIX}}-50 — server-maintainer memory index
-- See ~/.claude/skills/memory/SKILL.md

PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS documents (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type  TEXT NOT NULL,           -- 'memory_note' | 'trajectory'
    source_path  TEXT NOT NULL,           -- absolute path on disk
    source_id    TEXT,                    -- short stable id (filename stem / run id)
    title        TEXT NOT NULL,
    raw_text     TEXT NOT NULL,
    summary      TEXT NOT NULL DEFAULT '',
    mtime        REAL NOT NULL,           -- source file mtime (epoch float)
    ingested_at  TEXT NOT NULL,           -- ISO-8601 UTC
    meta_json    TEXT NOT NULL DEFAULT '{}',
    UNIQUE(source_type, source_path)
);

CREATE INDEX IF NOT EXISTS idx_documents_type     ON documents(source_type);
CREATE INDEX IF NOT EXISTS idx_documents_mtime    ON documents(mtime);
CREATE INDEX IF NOT EXISTS idx_documents_ingested ON documents(ingested_at);

-- Contentless FTS5 mirror. We pass rowid = documents.id so search results
-- can be joined back to the source-of-truth row cheaply.
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
    title,
    summary,
    raw_text,
    content='documents',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

-- Keep FTS in sync with the base table.
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, title, summary, raw_text)
    VALUES (new.id, new.title, new.summary, new.raw_text);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, summary, raw_text)
    VALUES ('delete', old.id, old.title, old.summary, old.raw_text);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, title, summary, raw_text)
    VALUES ('delete', old.id, old.title, old.summary, old.raw_text);
    INSERT INTO documents_fts(rowid, title, summary, raw_text)
    VALUES (new.id, new.title, new.summary, new.raw_text);
END;
