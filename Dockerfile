FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 FIELDBENCH_DB=/data/workspace.sqlite3
WORKDIR /app
RUN mkdir /data && chown 10001:10001 /data
COPY app.py team.py ./
COPY static/ static/
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["python", "app.py"]
CMD ["serve", "--host", "0.0.0.0"]
