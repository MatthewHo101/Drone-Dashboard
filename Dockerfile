FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 FIELDBENCH_DB=/data/workspace.sqlite3
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*
RUN mkdir /data && chown 10001:10001 /data
COPY app.py team.py security.py commercial.py ./
COPY static/ static/
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["python", "app.py"]
CMD ["serve", "--host", "0.0.0.0"]
