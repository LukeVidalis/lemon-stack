using Microsoft.Data.Sqlite;

namespace Dashboard.Features.Prefs;

public sealed class PrefsStore
{
    private static readonly string DbPath = Environment.GetEnvironmentVariable("DASHBOARD_DB_PATH") ?? "/data/dashboard.db";

    public void InitSchema()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(DbPath) ?? ".");
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS prefs (uid TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(uid, key));
            CREATE TABLE IF NOT EXISTS card_overrides (uid TEXT NOT NULL, slug TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, pinned INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(uid, slug));
            """;
        cmd.ExecuteNonQuery();
    }

    public void Ping()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT 1";
        _ = cmd.ExecuteScalar();
    }

    public async Task<PrefsDocument> GetPrefsAsync(string uid)
    {
        await using var conn = OpenConnection();

        var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT key, value FROM prefs WHERE uid = $uid";
            cmd.Parameters.AddWithValue("$uid", uid);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
                values[reader.GetString(0)] = reader.GetString(1);
        }

        var theme = values.TryGetValue("theme", out var storedTheme) ? storedTheme : "auto";
        var refreshIntervalSec = values.TryGetValue("refreshIntervalSec", out var storedRefresh)
            && int.TryParse(storedRefresh, out var parsedRefresh)
                ? parsedRefresh
                : 60;

        var cards = new List<CardOverride>();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT slug, hidden, sort_order, pinned FROM card_overrides WHERE uid = $uid ORDER BY sort_order, slug";
            cmd.Parameters.AddWithValue("$uid", uid);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                cards.Add(new CardOverride(
                    reader.GetString(0),
                    reader.GetInt32(1) != 0,
                    reader.GetInt32(2),
                    reader.GetInt32(3) != 0));
            }
        }

        return new PrefsDocument(theme, refreshIntervalSec, cards);
    }

    public async Task UpsertPrefsAsync(string uid, PrefsDocument prefs)
    {
        await using var conn = OpenConnection();
        await using var tx = await conn.BeginTransactionAsync();

        await UpsertPrefAsync(conn, tx, uid, "theme", prefs.Theme);
        await UpsertPrefAsync(conn, tx, uid, "refreshIntervalSec", prefs.RefreshIntervalSec.ToString(System.Globalization.CultureInfo.InvariantCulture));

        foreach (var card in prefs.Cards)
        {
            await using var cmd = conn.CreateCommand();
            cmd.Transaction = (SqliteTransaction)tx;
            cmd.CommandText = """
                INSERT INTO card_overrides (uid, slug, hidden, sort_order, pinned)
                VALUES ($uid, $slug, $hidden, $sortOrder, $pinned)
                ON CONFLICT(uid, slug) DO UPDATE SET
                    hidden = excluded.hidden,
                    sort_order = excluded.sort_order,
                    pinned = excluded.pinned
                """;
            cmd.Parameters.AddWithValue("$uid", uid);
            cmd.Parameters.AddWithValue("$slug", card.Slug);
            cmd.Parameters.AddWithValue("$hidden", card.Hidden ? 1 : 0);
            cmd.Parameters.AddWithValue("$sortOrder", card.SortOrder);
            cmd.Parameters.AddWithValue("$pinned", card.Pinned ? 1 : 0);
            await cmd.ExecuteNonQueryAsync();
        }

        await tx.CommitAsync();
    }

    private static async Task UpsertPrefAsync(SqliteConnection conn, System.Data.Common.DbTransaction tx, string uid, string key, string value)
    {
        await using var cmd = conn.CreateCommand();
        cmd.Transaction = (SqliteTransaction)tx;
        cmd.CommandText = """
            INSERT INTO prefs (uid, key, value) VALUES ($uid, $key, $value)
            ON CONFLICT(uid, key) DO UPDATE SET value = excluded.value
            """;
        cmd.Parameters.AddWithValue("$uid", uid);
        cmd.Parameters.AddWithValue("$key", key);
        cmd.Parameters.AddWithValue("$value", value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection($"Data Source={DbPath}");
        conn.Open();
        return conn;
    }
}

public record PrefsDocument(
    string Theme,
    int RefreshIntervalSec,
    List<CardOverride> Cards);

public record CardOverride(
    string Slug,
    bool Hidden,
    int SortOrder,
    bool Pinned);
