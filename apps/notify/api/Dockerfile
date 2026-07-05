# Build context is the repo root (set in docker-compose.yml),
# so Directory.Build.props + Directory.Packages.props are reachable.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY Directory.Build.props Directory.Packages.props ./
COPY api/NotifyService.csproj ./api/
RUN dotnet restore api/NotifyService.csproj

COPY api/ ./api/
RUN dotnet publish api/NotifyService.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish ./

ENV ASPNETCORE_URLS=http://+:8080
ENV ASPNETCORE_ENVIRONMENT=Production
EXPOSE 8080

ENTRYPOINT ["dotnet", "NotifyService.dll"]
