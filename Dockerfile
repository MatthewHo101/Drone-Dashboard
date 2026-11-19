FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 FIELDBENCH_DB=/data/workspace.sqlite3
WORKDIR /app
RUN pip install --no-cache-dir 'cryptography>=44,<50'
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils antiword && rm -rf /var/lib/apt/lists/*
RUN mkdir /data && chown 10001:10001 /data
COPY google_calendar.py app.py team.py security.py commercial.py ./
COPY static/ static/
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["python", "app.py"]
CMD ["serve", "--host", "0.0.0.0"]
