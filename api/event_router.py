"""
Event Router — Behavioral event reporting with Context → Intervention → Outcome loop.
"""

from datetime import datetime, timezone, date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session

from models import get_db, BehavioralEvent, Patient, CareStaff, EventType, Severity, utcnow
from schemas_v2 import (
    EventReportResponse, EventParsed, ProtocolStep,
    InterventionRequest, OutcomeRequest, EventOut,
)
import llm_service
import rag_service

router = APIRouter(prefix="/api/events", tags=["Events"])


def _determine_shift() -> str:
    """Determine current shift based on UTC hour (rough heuristic)."""
    hour = datetime.now(timezone.utc).hour
    if 11 <= hour < 19:  # ~7am-3pm ET
        return "Day"
    elif 19 <= hour or hour < 3:  # ~3pm-11pm ET
        return "Evening"
    else:
        return "Night"


@router.post("/report", response_model=EventReportResponse)
async def report_event(
    patient_id: int = Form(...),
    reporter_id: int = Form(...),
    text: Optional[str] = Form(None),
    audio: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """Report a behavioral event via text or audio. Returns parsed event + matched protocols."""
    # Validate patient and reporter exist
    patient = db.query(Patient).get(patient_id)
    if not patient:
        raise HTTPException(404, "Patient not found")
    reporter = db.query(CareStaff).get(reporter_id)
    if not reporter:
        raise HTTPException(404, "Reporter not found")

    # Get text from audio or form
    transcription = None
    if audio:
        audio_bytes = await audio.read()
        transcription = await llm_service.transcribe_audio(audio_bytes, audio.filename or "audio.wav")
        description = transcription
    elif text:
        description = text
    else:
        raise HTTPException(400, "Either text or audio file is required")

    # Parse event with LLM
    parsed = await llm_service.parse_event(description)

    # Map to enums (with fallback)
    try:
        event_type = EventType(parsed.get("event_type", "Other"))
    except ValueError:
        event_type = EventType.OTHER
    try:
        severity = Severity(parsed.get("severity", "Medium"))
    except ValueError:
        severity = Severity.MEDIUM

    # Skip RAG for positive/no-issue reports
    # Only skip RAG if the parsed summary indicates explicitly positive/no-issue
    combined_text = (parsed.get("summary", "") + " " + description).lower()
    is_positive = any(kw in combined_text
                      for kw in ["good day", "doing well", "doing good", "doing great", "doing fine",
                                 "no issue", "no issues", "no concern", "no concerns", "no problem",
                                 "stable", "no incident", "uneventful", "all good", "everything is fine",
                                 "no notable", "routine", "normal day", "no behavioral"])
    if event_type == EventType.OTHER and severity == Severity.LOW and is_positive:
        protocols_formatted = []
        summarized = [{"source": "N/A", "page": 0, "steps": ["No specific protocols needed. Continue monitoring."]}]
    else:
        # Search protocols via RAG
        raw_protocols = rag_service.search_by_event_type(event_type.value)
        protocols_formatted = rag_service.format_protocol_for_display(raw_protocols)

        # LLM post-processing: summarize into actionable steps
        try:
            summarized = await llm_service.summarize_protocols(description, protocols_formatted)
        except Exception:
            summarized = []

        # Merge steps back into formatted protocols
        for i, p in enumerate(protocols_formatted):
            if i < len(summarized):
                p["steps"] = summarized[i].get("steps", [])

    # Create DB record
    event = BehavioralEvent(
        patient_id=patient_id,
        reporter_id=reporter_id,
        shift=_determine_shift(),
        event_type=event_type,
        severity=severity,
        description=description,
        location=parsed.get("location", "Unknown"),
        trigger=parsed.get("trigger", "Unknown"),
        protocol_matched=[
            {"source": s.get("source", ""), "page": s.get("page", 0), "steps": s.get("steps", [])}
            for s in summarized
        ],
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    # Build response protocols
    if protocols_formatted:
        response_protocols = [ProtocolStep(**p) for p in protocols_formatted]
    else:
        response_protocols = [
            ProtocolStep(source=s.get("source", "N/A"), page=s.get("page", 0), steps=s.get("steps", []))
            for s in summarized
        ]

    return EventReportResponse(
        event_id=event.id,
        parsed=EventParsed(**parsed),
        protocols=response_protocols,
        transcription=transcription,
    )


@router.post("/{event_id}/intervention")
async def record_intervention(
    event_id: int,
    audio: Optional[UploadFile] = File(None),
    text: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Record an intervention for an event."""
    event = db.query(BehavioralEvent).get(event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    if audio:
        audio_bytes = await audio.read()
        description = await llm_service.transcribe_audio(audio_bytes)
    elif text:
        description = text
    else:
        raise HTTPException(400, "Either text or audio is required")

    event.intervention_description = description
    event.intervention_at = utcnow()
    db.commit()
    return {"event_id": event_id, "intervention": description, "status": "recorded"}


@router.post("/{event_id}/outcome")
async def record_outcome(
    event_id: int,
    text: Optional[str] = Form(None),
    resolved: bool = Form(False),
    audio: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
):
    """Record the outcome, completing the C→I→O loop."""
    event = db.query(BehavioralEvent).get(event_id)
    if not event:
        raise HTTPException(404, "Event not found")

    if audio:
        audio_bytes = await audio.read()
        description = await llm_service.transcribe_audio(audio_bytes)
    elif text:
        description = text
    else:
        raise HTTPException(400, "Either text or audio is required")

    event.outcome_description = description
    event.outcome_at = utcnow()
    event.resolved = resolved
    db.commit()
    return {"event_id": event_id, "outcome": description, "resolved": resolved, "status": "recorded"}


@router.get("", response_model=list[EventOut])
def list_events(
    patient_id: Optional[int] = None,
    shift: Optional[str] = None,
    event_date: Optional[date] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    """List events with optional filters."""
    q = db.query(BehavioralEvent)
    if patient_id:
        q = q.filter(BehavioralEvent.patient_id == patient_id)
    if shift:
        q = q.filter(BehavioralEvent.shift == shift)
    if event_date:
        q = q.filter(
            BehavioralEvent.event_at >= datetime.combine(event_date, datetime.min.time()).replace(tzinfo=timezone.utc),
            BehavioralEvent.event_at < datetime.combine(event_date, datetime.max.time()).replace(tzinfo=timezone.utc),
        )
    return q.order_by(BehavioralEvent.event_at.desc()).limit(limit).all()


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: int, db: Session = Depends(get_db)):
    """Get event details."""
    event = db.query(BehavioralEvent).get(event_id)
    if not event:
        raise HTTPException(404, "Event not found")
    return event
