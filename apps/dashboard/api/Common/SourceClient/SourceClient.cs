using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using Dashboard.Features.Aggregate;
using Microsoft.Extensions.Caching.Memory;

namespace Dashboard.Common.SourceClient;

public enum SourceFetchError
{
    None,
    Timeout,
    ConnectionRefused,
    HttpError,
    Malformed,
    CircuitOpen
}

public sealed class SourceClient
{
    private const string SecretEnvVar = "INTERNAL_SUMMARY_SECRET";
    private const int DefaultTimeoutMs = 1500;
    private static readonly TimeSpan FreshFor = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan BreakDuration = TimeSpan.FromSeconds(30);

    private readonly IHttpClientFactory _clients;
    private readonly ILogger<SourceClient> _log;
    private readonly ConcurrentDictionary<string, CircuitState> _circuits = new();

    public SourceClient(IHttpClientFactory clients, ILogger<SourceClient> log)
    {
        _clients = clients;
        _log = log;
    }

    public async Task<SourceResult> FetchAsync(DataSource src, string uid, CancellationToken ct)
    {
        if (IsOpen(src.Slug))
        {
            return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "error", null,
                "circuit open", 0, SourceFetchError.CircuitOpen);
        }

        var sw = Stopwatch.StartNew();
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(src.TimeoutMs ?? DefaultTimeoutMs);

        var http = _clients.CreateClient("source");
        var secret = Environment.GetEnvironmentVariable(SecretEnvVar) ?? "";
        var url = $"http://{src.Host}:{src.Port}{src.Path}?uid={WebUtility.UrlEncode(uid)}";

        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, url);
            if (!string.IsNullOrEmpty(secret))
                req.Headers.Add("X-Internal-Secret", secret);

            using var res = await http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            sw.Stop();

            if (res.StatusCode == HttpStatusCode.NoContent)
            {
                RecordSuccess(src.Slug);
                return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "empty", null, null,
                    (int)sw.ElapsedMilliseconds);
            }

            if (!res.IsSuccessStatusCode)
            {
                var opened = RecordFailure(src.Slug);
                _log.LogWarning("{Slug} returned {Status}{Circuit}", src.Slug, res.StatusCode,
                    opened ? " and opened circuit" : "");
                return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "error", null,
                    $"HTTP {(int)res.StatusCode}", (int)sw.ElapsedMilliseconds, SourceFetchError.HttpError);
            }

            var stream = await res.Content.ReadAsStreamAsync(cts.Token);
            var data = await JsonSerializer.DeserializeAsync<JsonElement>(stream, cancellationToken: cts.Token);
            RecordSuccess(src.Slug);
            return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "ok", data, null,
                (int)sw.ElapsedMilliseconds);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested && !ct.IsCancellationRequested)
        {
            sw.Stop();
            _log.LogWarning("{Slug} timed out after {Ms}ms", src.Slug, sw.ElapsedMilliseconds);
            return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "timeout", null, "timeout",
                (int)sw.ElapsedMilliseconds, SourceFetchError.Timeout);
        }
        catch (HttpRequestException ex) when (IsConnectionRefused(ex))
        {
            sw.Stop();
            var opened = RecordFailure(src.Slug);
            _log.LogWarning(ex, "{Slug} connection refused{Circuit}", src.Slug, opened ? "; opened circuit" : "");
            return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "error", null,
                ex.GetType().Name, (int)sw.ElapsedMilliseconds, SourceFetchError.ConnectionRefused);
        }
        catch (Exception ex) when (IsCircuitOpenException(ex))
        {
            sw.Stop();
            _log.LogWarning(ex, "{Slug} resilience circuit is open", src.Slug);
            return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "error", null,
                ex.GetType().Name, (int)sw.ElapsedMilliseconds, SourceFetchError.CircuitOpen);
        }
        catch (JsonException ex)
        {
            sw.Stop();
            var opened = RecordFailure(src.Slug);
            _log.LogWarning(ex, "{Slug} returned malformed JSON{Circuit}", src.Slug, opened ? "; opened circuit" : "");
            return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "error", null,
                "malformed", (int)sw.ElapsedMilliseconds, SourceFetchError.Malformed);
        }
        catch (Exception ex)
        {
            sw.Stop();
            var opened = RecordFailure(src.Slug);
            _log.LogWarning(ex, "{Slug} failed: {Message}{Circuit}", src.Slug, ex.Message,
                opened ? "; opened circuit" : "");
            return new SourceResult(src.Slug, src.Name, src.Icon, src.DeepLink, "error", null,
                ex.GetType().Name, (int)sw.ElapsedMilliseconds, SourceFetchError.HttpError);
        }
    }

    public async Task<SourceResult> FetchWithCacheAsync(DataSource src, string uid, IMemoryCache cache, CancellationToken ct)
    {
        if (cache.TryGetValue(CacheKey(src.Slug, uid), out CacheEntry? entry) && entry is not null)
        {
            var age = DateTimeOffset.UtcNow - entry.CachedAt;
            if (age < FreshFor)
                return entry.Result;

            if (age < CacheTtl)
            {
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var refreshed = await FetchAsync(src, uid, CancellationToken.None);
                        UpdateCache(cache, src.Slug, uid, refreshed);
                    }
                    catch (Exception ex)
                    {
                        _log.LogWarning(ex, "background refresh failed for {Slug}", src.Slug);
                    }
                }, CancellationToken.None);

                return entry.Result;
            }
        }

        var result = await FetchAsync(src, uid, ct);
        UpdateCache(cache, src.Slug, uid, result);
        return result;
    }

    public static string CacheKey(string slug, string uid) => $"src:{slug}:{uid}";

    public void UpdateCache(IMemoryCache cache, string slug, string uid, SourceResult result)
    {
        cache.Set(CacheKey(slug, uid), new CacheEntry(result, DateTimeOffset.UtcNow), CacheTtl);
    }

    private void RecordSuccess(string slug)
    {
        var state = _circuits.GetOrAdd(slug, _ => new CircuitState());
        Interlocked.Exchange(ref state.ConsecutiveFailures, 0);
        Volatile.Write(ref state.OpenUntilTicks, 0);
    }

    private bool RecordFailure(string slug)
    {
        var state = _circuits.GetOrAdd(slug, _ => new CircuitState());
        var failures = Interlocked.Increment(ref state.ConsecutiveFailures);
        if (failures < 5)
            return false;

        var openedUntil = DateTimeOffset.UtcNow.Add(BreakDuration).UtcTicks;
        Volatile.Write(ref state.OpenUntilTicks, openedUntil);
        Interlocked.Exchange(ref state.ConsecutiveFailures, 0);
        return true;
    }

    private bool IsOpen(string slug)
    {
        if (!_circuits.TryGetValue(slug, out var state))
            return false;

        var openUntil = Volatile.Read(ref state.OpenUntilTicks);
        if (openUntil == 0)
            return false;

        if (DateTimeOffset.UtcNow.UtcTicks < openUntil)
            return true;

        Volatile.Write(ref state.OpenUntilTicks, 0);
        return false;
    }

    private static bool IsConnectionRefused(HttpRequestException ex) =>
        ex.InnerException is SocketException { SocketErrorCode: SocketError.ConnectionRefused };

    private static bool IsCircuitOpenException(Exception ex) =>
        ex.GetType().Name is "BrokenCircuitException" or "IsolatedCircuitException"
        || ex.GetType().FullName?.Contains("BrokenCircuit", StringComparison.Ordinal) == true;

    private sealed class CircuitState
    {
        public volatile int ConsecutiveFailures;
        public long OpenUntilTicks;
    }

    private sealed record CacheEntry(SourceResult Result, DateTimeOffset CachedAt);
}
