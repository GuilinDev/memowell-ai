# Nursing Protocol Acquisition Roadmap

The following nursing-specific protocols and guidelines need to be acquired (as PDF documents) and ingested into the knowledge base for evidence-based care recommendations.

## Protocols To Acquire

### 1. ANA — American Nurses Association
- **Document:** *Nursing: Scope and Standards of Practice* (4th Edition)
- **Why:** Defines the foundational scope, standards, and competencies for all registered nurses
- **Status:** 📋 Pending acquisition

### 2. AACN — American Association of Critical-Care Nurses
- **Document:** *Practice Alerts* (collection)
- **Why:** Evidence-based guidelines for critical-care nursing practices and interventions
- **Status:** 📋 Pending acquisition

### 3. NCSBN — National Council of State Boards of Nursing
- **Document:** *Guidelines for Nursing Regulation* and delegation guidelines
- **Why:** Regulatory framework for nursing practice, delegation, and scope boundaries
- **Status:** 📋 Pending acquisition

### 4. Hartford Institute for Geriatric Nursing
- **Document:** *Evidence-Based Geriatric Nursing Protocols for Best Practice*
- **Why:** Directly relevant to Alzheimer's/dementia caregiving — covers assessment, intervention, and management of common geriatric conditions
- **Status:** 📋 Pending acquisition

## Next Steps

1. Obtain PDF copies of the above documents (check institutional access / licensing)
2. Place PDFs in `api/knowledge_base/pdfs/`
3. Run `python api/knowledge_base/ingest.py` to index into ChromaDB
4. Validate retrieval quality with sample nursing queries
