#!/usr/bin/env bash
# Rename TemplateApi → your project name.
# Run once after cloning: ./setup.sh MyProject
set -euo pipefail

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
    echo "Usage: ./setup.sh <ProjectName>"
    echo "  e.g. ./setup.sh GroceryTracker"
    exit 1
fi

LOWER=$(echo "$NAME" | tr '[:upper:]' '[:lower:]')

# Rename files
mv api/TemplateApi.csproj "api/${NAME}.csproj"

# Replace all occurrences in source files
find . -type f \( -name "*.cs" -o -name "*.csproj" -o -name "*.json" -o -name "Dockerfile" \) \
    -not -path "./.git/*" \
    -exec sed -i "s/TemplateApi/${NAME}/g; s/template/${LOWER}/g" {} +

# Update docker-compose volume name
sed -i "s/template_db/${LOWER}_db/g" docker-compose.yml

echo "Done. Project renamed to ${NAME}."
echo ""
echo "Next steps:"
echo "  1. Create ~/docker/<repo-name>/.env on lemon-server (see .env.example)"
echo "  2. Add your entities to api/Data/AppDbContext.cs"
echo "  3. dotnet ef migrations add InitialCreate (from api/)"
echo "  4. Push to {{GITHUB_ORG}} — auto-deploys to ${LOWER}.{{DOMAIN}}"
