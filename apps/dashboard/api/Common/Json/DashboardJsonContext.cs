using System.Text.Json.Serialization;
using Dashboard.Features.Aggregate;
using Dashboard.Features.BuildInfo;
using Dashboard.Features.Prefs;
using Dashboard.Features.Services;

namespace Dashboard.Common.Json;

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    UseStringEnumConverter = true)]
[JsonSerializable(typeof(AggregateResponse))]
[JsonSerializable(typeof(SourceResult))]
[JsonSerializable(typeof(SourceResult[]))]
[JsonSerializable(typeof(List<SourceResult>))]
[JsonSerializable(typeof(IReadOnlyList<SourceResult>))]
[JsonSerializable(typeof(Me))]
[JsonSerializable(typeof(ServiceEntry))]
[JsonSerializable(typeof(ServiceEntry[]))]
[JsonSerializable(typeof(List<ServiceEntry>))]
[JsonSerializable(typeof(IReadOnlyList<ServiceEntry>))]
[JsonSerializable(typeof(BuildInfo))]
[JsonSerializable(typeof(PrefsDocument))]
[JsonSerializable(typeof(CardOverride))]
[JsonSerializable(typeof(List<CardOverride>))]
internal partial class DashboardJsonContext : JsonSerializerContext { }
