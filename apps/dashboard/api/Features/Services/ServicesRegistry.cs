using System.Text.Json;

namespace Dashboard.Features.Services;

public sealed class ServicesRegistry : IDisposable
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };
    private const string PortsPath = "/app/ports.json";

    private readonly ILogger<ServicesRegistry> _log;
    private readonly string _configPath;
    private readonly FileSystemWatcher _watcher;
    private readonly object _reloadLock = new();
    private Timer? _debounceTimer;
    private volatile IReadOnlyList<ServiceEntry> _services = [];

    public IReadOnlyList<ServiceEntry> Services => _services;

    public ServicesRegistry(ILogger<ServicesRegistry> log)
    {
        _log = log;
        _configPath = Path.Combine(AppContext.BaseDirectory, "services-config.json");

        Load(reload: false);

        var directory = Path.GetDirectoryName(_configPath) ?? AppContext.BaseDirectory;
        var fileName = Path.GetFileName(_configPath);
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
            var services = LoadServices(_log);
            _services = services;

            if (reload)
                _log.LogInformation("registry reloaded: {Count} services", services.Count);
            else
                _log.LogInformation("Services registry: {Count} entries", services.Count);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "Failed to load services registry");
        }
    }

    private IReadOnlyList<ServiceEntry> LoadServices(ILogger log)
    {
        var config = LoadConfig(_configPath, log);
        var pipeline = DiscoverFromPortsJson(PortsPath, config, log);
        return [.. pipeline, .. config.Static];
    }

    private static Config LoadConfig(string path, ILogger log)
    {
        if (!File.Exists(path))
        {
            log.LogWarning("services-config.json not found at {Path}", path);
            return new Config();
        }
        return JsonSerializer.Deserialize<Config>(File.ReadAllText(path), JsonOpts) ?? new Config();
    }

    private static List<ServiceEntry> DiscoverFromPortsJson(string path, Config config, ILogger log)
    {
        if (!File.Exists(path))
        {
            log.LogWarning("ports.json not found at {Path} — pipeline services will not be listed", path);
            return [];
        }

        Dictionary<string, JsonElement>? ports;
        try
        {
            ports = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(File.ReadAllText(path), JsonOpts);
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "Failed to parse ports.json");
            return [];
        }

        if (ports is null) return [];

        var result = new List<ServiceEntry>();
        foreach (var (slug, _) in ports)
        {
            config.Overrides.TryGetValue(slug, out var ov);
            if (ov?.Hidden == true) continue;

            var url = ov?.Url ?? config.PipelineUrlPattern.Replace("{slug}", slug);
            var name = ov?.Name ?? ToDisplayName(slug);

            result.Add(new ServiceEntry(slug, name, url, ov?.Icon, ov?.Category ?? config.DefaultCategory));
        }

        return [.. result.OrderBy(s => s.Name)];
    }

    private static string ToDisplayName(string slug)
        => string.Join(" ", slug.Split('-').Select(w => w.Length > 0 ? char.ToUpper(w[0]) + w[1..] : w));

    public void Dispose()
    {
        _watcher.Dispose();
        _debounceTimer?.Dispose();
    }

    private sealed class Config
    {
        public List<ServiceEntry> Static { get; set; } = [];
        public Dictionary<string, Override> Overrides { get; set; } = new();
        public string PipelineUrlPattern { get; set; } = "https://{slug}.{{DOMAIN}}";
        public string DefaultCategory { get; set; } = "apps";
    }

    private sealed class Override
    {
        public bool Hidden { get; set; }
        public string? Name { get; set; }
        public string? Url { get; set; }
        public string? Icon { get; set; }
        public string? Category { get; set; }
    }
}

public sealed record ServiceEntry(
    string Slug,
    string Name,
    string Url,
    string? Icon,
    string Category);
