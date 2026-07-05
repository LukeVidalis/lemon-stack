using System.Text.Json;

namespace Dashboard.Features.Aggregate;

public sealed class DataSourceRegistry : IDisposable
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    private readonly ILogger<DataSourceRegistry> _log;
    private readonly string _path;
    private readonly FileSystemWatcher _watcher;
    private readonly object _reloadLock = new();
    private Timer? _debounceTimer;
    private volatile IReadOnlyList<DataSource> _sources = [];

    public IReadOnlyList<DataSource> Sources => _sources;

    public DataSourceRegistry(ILogger<DataSourceRegistry> log, IHostEnvironment env)
    {
        _log = log;
        _path = Path.Combine(env.ContentRootPath, "data-sources.json");

        Load(reload: false);

        var directory = Path.GetDirectoryName(_path) ?? env.ContentRootPath;
        var fileName = Path.GetFileName(_path);
        _watcher = new FileSystemWatcher(directory, fileName)
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName | NotifyFilters.Size | NotifyFilters.CreationTime,
            EnableRaisingEvents = true,
        };
        _watcher.Changed += (_, _) => DebounceReload();
        _watcher.Created += (_, _) => DebounceReload();
    }

    private void DebounceReload()
    {
        lock (_reloadLock)
        {
            _debounceTimer?.Dispose();
            _debounceTimer = new Timer(_ => Load(reload: true), null, TimeSpan.FromMilliseconds(500), Timeout.InfiniteTimeSpan);
        }
    }

    private void Load(bool reload)
    {
        try
        {
            var loaded = LoadSources(_path, _log);
            _sources = loaded;

            if (reload)
                _log.LogInformation("registry reloaded: {Count} sources", loaded.Count);
            else
                _log.LogInformation("Loaded {Count} enabled data source(s): {Slugs}",
                    loaded.Count, string.Join(", ", loaded.Select(s => s.Slug)));
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to load data-sources.json from {Path}", _path);
        }
    }

    private static IReadOnlyList<DataSource> LoadSources(string path, ILogger log)
    {
        if (!File.Exists(path))
        {
            log.LogWarning("data-sources.json not found at {Path} — dashboard will be empty.", path);
            return [];
        }

        var json = File.ReadAllText(path);
        var doc = JsonSerializer.Deserialize<RegistryFile>(json, JsonOpts) ?? new RegistryFile();
        return doc.Sources.Where(s => s.Enabled).ToList();
    }

    public void Dispose()
    {
        _watcher.Dispose();
        _debounceTimer?.Dispose();
    }

    private sealed class RegistryFile
    {
        public List<DataSource> Sources { get; set; } = new();
    }
}

public sealed record DataSource
{
    public string Slug { get; init; } = "";
    public string Name { get; init; } = "";
    public string Host { get; init; } = "host.docker.internal";
    public int Port { get; init; }
    public string Path { get; init; } = "/api/_internal/user-summary";
    public string? Icon { get; init; }
    public string? DeepLink { get; init; }
    public int? TimeoutMs { get; init; }
    public bool Enabled { get; init; } = true;
}
