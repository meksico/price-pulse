FROM mcr.microsoft.com/playwright/python:v1.50.0-noble

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir .

ENV PORT=8080
EXPOSE 8080

CMD ["sh", "-c", "uvicorn pricepulse.api.app:app --host 0.0.0.0 --port ${PORT}"]

