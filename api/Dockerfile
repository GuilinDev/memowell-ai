FROM python:3.12-slim

WORKDIR /app

# Install system deps for PyMuPDF
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python deps
COPY api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    chromadb sentence-transformers pymupdf

# Copy API code
COPY api/ .

# Ingest PDFs into ChromaDB
RUN cd knowledge_base && python3 ingest.py

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
