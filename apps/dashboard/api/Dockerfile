FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src

COPY Dashboard.csproj ./
RUN dotnet restore Dashboard.csproj

COPY . ./
RUN dotnet publish Dashboard.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:9.0 AS runtime
WORKDIR /app
# curl for compose healthcheck; aspnet image is debian-based
# TODO: switch to aspnet:9.0-alpine once culture/ICU requirements are verified
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish ./

ARG BUILD_SHA=dev
ARG BUILD_TIME=unknown
ARG BUILD_VERSION=dev
ENV BUILD_SHA=$BUILD_SHA \
    BUILD_TIME=$BUILD_TIME \
    BUILD_VERSION=$BUILD_VERSION \
    ASPNETCORE_URLS=http://+:8080 \
    ASPNETCORE_ENVIRONMENT=Production

EXPOSE 8080
ENTRYPOINT ["dotnet", "Dashboard.dll"]
