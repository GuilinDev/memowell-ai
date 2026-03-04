"""
Caregiver Agent — simulates nursing staff responding to patient events.
Calls the REAL CareLoop API to report events and receive protocol recommendations.

Different skill levels produce different quality reports:
- expert: detailed clinical language, accurate observations
- intermediate: adequate reports, may miss subtle details
- novice: vague descriptions, may panic in emergencies
"""
import json
import random
import asyncio
import httpx
from typing import Optional, Dict, List


# Retry config
MAX_RETRIES = 3
RETRY_BACKOFF = [3.0, 6.0, 12.0]  # seconds between retries (generous for Groq rate limits)


# Report quality templates by skill level
REPORT_QUALITY = {
    "expert": {
        "detail_level": "high",
        "clinical_terms": True,
        "observation_accuracy": 0.95,
        "includes_vitals": True,
        "includes_context": True,
        "example_prefix": "",  # clean clinical language
    },
    "intermediate": {
        "detail_level": "medium",
        "clinical_terms": True,
        "observation_accuracy": 0.80,
        "includes_vitals": False,
        "includes_context": True,
        "example_prefix": "",
    },
    "novice": {
        "detail_level": "low",
        "clinical_terms": False,
        "observation_accuracy": 0.60,
        "includes_vitals": False,
        "includes_context": False,
        "example_prefix": "I think... ",  # uncertainty markers
    },
}

# How different skill levels describe the same event
DESCRIPTION_TEMPLATES = {
    "expert": {
        "sundowning": "Resident {name} exhibiting increased agitation consistent with sundowning syndrome at {time}. "
                      "Pacing near window, calling for family members. Agitation level approximately {severity}/10. "
                      "No signs of pain or acute medical issue. Previous interventions that have worked: {interventions}.",
        "fall_risk": "Resident {name} attempted unassisted transfer from wheelchair at {time}. "
                     "Found standing unsupported, gait unsteady with lateral sway. "
                     "No fall occurred. Last orthostatic BP: pending. Fall risk score: high.",
        "aggression": "Resident {name} became physically aggressive during personal care at {time}. "
                      "Struck staff member's arm during attempt to assist with toileting. "
                      "No injury to staff or resident. Possible trigger: invasion of personal space.",
        "default": "Resident {name} presenting with {behavior} at {time}. Severity: {severity}. {context}",
    },
    "intermediate": {
        "sundowning": "{name} is getting really agitated again, it's that time of day. "
                      "Walking around, asking for family. Started around {time}.",
        "fall_risk": "{name} tried to get up on their own at {time}. Caught them before they fell. Pretty unsteady.",
        "aggression": "{name} got aggressive during care at {time}. Hit my arm when I tried to help with bathroom.",
        "default": "{name} is having an episode of {behavior}. Started at {time}. {context}",
    },
    "novice": {
        "sundowning": "Um, {name} is really upset right now. Walking around a lot and seems confused. "
                      "Not sure what to do. It started around {time}.",
        "fall_risk": "{name} almost fell! I found them trying to stand up by themselves at {time}. "
                     "Should I call the nurse?",
        "aggression": "{name} hit me at {time}! I was just trying to help them to the bathroom. "
                      "I don't know what happened.",
        "default": "{name} seems to be having problems. {context}. This happened at {time}. Not sure what kind of issue this is.",
    },
}


class CaregiverAgent:
    """
    An AI-driven caregiver agent that observes patient behaviors,
    reports to CareLoop, and executes interventions.
    """

    def __init__(self, profile: dict, api_base_url: str = "http://localhost:8000"):
        self.profile = profile
        self.id = profile["id"]
        self.name = profile["name"]
        self.role = profile["role"]
        self.shift = profile["shift"]
        self.skill_level = profile.get("skill_level", "intermediate")
        self.assigned_patients = profile.get("assigned_patients", [])
        self.communication_style = profile.get("communication_style", "standard")

        self.api_base_url = api_base_url
        self.client = httpx.AsyncClient(base_url=api_base_url, timeout=30.0)

        # Track what this caregiver has done this shift
        self.events_reported: List[dict] = []
        self.interventions_performed: List[dict] = []

    def generate_report(self, event: dict) -> str:
        """
        Generate a natural language report based on skill level.
        Expert caregivers write detailed clinical reports.
        Novice caregivers write vague, uncertain reports.
        """
        behavior = event.get("behavior", "unknown")
        templates = DESCRIPTION_TEMPLATES.get(self.skill_level, DESCRIPTION_TEMPLATES["intermediate"])

        template = templates.get(behavior, templates["default"])

        report = template.format(
            name=event.get("patient_name", "Resident"),
            time=event.get("time", "unknown time"),
            behavior=behavior.replace("_", " "),
            severity=event.get("severity", "moderate"),
            context=event.get("context", ""),
            interventions=", ".join(event.get("effective_interventions", ["standard protocols"])),
        )

        # Add quality modifiers
        quality = REPORT_QUALITY[self.skill_level]
        if quality["example_prefix"]:
            report = quality["example_prefix"] + report

        return report

    async def _request_with_retry(self, method: str, url: str, **kwargs) -> Optional[httpx.Response]:
        """
        Make an HTTP request with exponential backoff retry.
        Retries on 5xx, 429, timeouts, and connection errors.
        Does NOT retry on 4xx (except 429) — those are client bugs to fix.
        """
        last_error = None
        for attempt in range(MAX_RETRIES):
            try:
                response = await self.client.request(method, url, **kwargs)

                # Success
                if response.status_code < 400:
                    return response

                # 4xx (not 429) = client error, don't retry
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    print(f"[{self.name}] Client error {response.status_code} on {url}: {response.text[:200]}")
                    return response  # return as-is, caller handles

                # 429 or 5xx = retry
                wait = RETRY_BACKOFF[attempt] if attempt < len(RETRY_BACKOFF) else RETRY_BACKOFF[-1]
                print(f"[{self.name}] ⚠️ {response.status_code} on {url}, retry {attempt+1}/{MAX_RETRIES} in {wait}s...")
                await asyncio.sleep(wait)

            except (httpx.TimeoutException, httpx.ConnectError, httpx.ReadError) as e:
                last_error = e
                wait = RETRY_BACKOFF[attempt] if attempt < len(RETRY_BACKOFF) else RETRY_BACKOFF[-1]
                print(f"[{self.name}] ⚠️ {type(e).__name__} on {url}, retry {attempt+1}/{MAX_RETRIES} in {wait}s...")
                await asyncio.sleep(wait)

            except Exception as e:
                print(f"[{self.name}] ❌ Unexpected error on {url}: {e}")
                return None

        print(f"[{self.name}] ❌ All {MAX_RETRIES} retries exhausted for {url}")
        return None

    async def report_event(self, event: dict, patient_api_id: int = 1, reporter_api_id: int = 1) -> Optional[dict]:
        """
        Report a behavioral event to CareLoop API.
        Returns the API response with protocol recommendations.
        Note: API uses Form data (multipart) because it also supports audio upload.
        """
        report_text = self.generate_report(event)

        response = await self._request_with_retry(
            "POST", "/api/events/report",
            data={
                "patient_id": patient_api_id,
                "reporter_id": reporter_api_id,
                "text": report_text,
            }
        )

        if response is None or response.status_code >= 400:
            status = response.status_code if response else "no response"
            print(f"[{self.name}] Error reporting event: {status}")
            return None

        result = response.json()
        self.events_reported.append({
            "event": event,
            "report_text": report_text,
            "api_response": result,
            "caregiver": self.name,
        })
        return result

    async def report_intervention(self, event_id: int, intervention: str) -> Optional[dict]:
        """Report an intervention performed."""
        response = await self._request_with_retry(
            "POST", f"/api/events/{event_id}/intervention",
            data={"text": intervention}
        )

        if response is None or response.status_code >= 400:
            status = response.status_code if response else "no response"
            print(f"[{self.name}] Error reporting intervention: {status}")
            return None

        result = response.json()
        self.interventions_performed.append({
            "event_id": event_id,
            "intervention": intervention,
            "result": result,
        })
        return result

    async def report_outcome(self, event_id: int, outcome: str, resolved: bool = True) -> Optional[dict]:
        """Report the outcome of an intervention."""
        response = await self._request_with_retry(
            "POST", f"/api/events/{event_id}/outcome",
            data={
                "text": outcome,
                "resolved": str(resolved).lower(),  # Form data needs string
            }
        )

        if response is None or response.status_code >= 400:
            status = response.status_code if response else "no response"
            print(f"[{self.name}] Error reporting outcome: {status}")
            return None

        return response.json()

    def choose_intervention(self, event: dict, protocol_steps: List[str]) -> str:
        """
        Choose which intervention to perform based on skill level.
        Expert: follows protocol precisely + adds clinical judgment
        Intermediate: follows protocol
        Novice: may miss steps or improvise
        """
        if not protocol_steps:
            return self._improvise_intervention(event)

        if self.skill_level == "expert":
            # Expert follows protocol and adds context
            step = protocol_steps[0]
            return f"Following protocol: {step}. Also monitoring vitals and documenting baseline."

        elif self.skill_level == "intermediate":
            # Intermediate follows protocol
            step = protocol_steps[0]
            return f"Following recommended step: {step}"

        else:  # novice
            # Novice may not follow protocol perfectly
            if random.random() < 0.3:
                return self._improvise_intervention(event)
            step = protocol_steps[0]
            return f"Trying: {step}"

    def _improvise_intervention(self, event: dict) -> str:
        """When protocol isn't followed, novice may improvise."""
        generic = [
            "Tried talking to the resident calmly",
            "Asked the resident to sit down",
            "Offered water and a snack",
            "Called for help from another staff member",
            "Stayed with the resident and waited",
        ]
        return random.choice(generic)

    def determine_outcome(self, event: dict, intervention: str) -> tuple:
        """
        Determine the outcome of an intervention.
        Returns (outcome_description, resolved_bool, outcome_category)
        """
        behavior = event.get("behavior", "")
        effective = event.get("effective_interventions", [])

        # Check if intervention aligns with known effective interventions
        intervention_effective = any(
            eff.replace("_", " ").lower() in intervention.lower()
            for eff in effective
        )

        # Base success probability
        if intervention_effective:
            success_prob = 0.8
        else:
            success_prob = 0.4

        # Modify by skill level
        skill_mod = {"expert": 1.2, "intermediate": 1.0, "novice": 0.7}
        success_prob *= skill_mod.get(self.skill_level, 1.0)
        success_prob = min(success_prob, 0.95)

        # Determine outcome
        roll = random.random()
        if roll < success_prob * 0.6:
            return (
                f"Intervention successful. {event['patient_name']} has calmed down and returned to baseline.",
                True,
                "resolved"
            )
        elif roll < success_prob:
            return (
                f"Partial improvement. {event['patient_name']} is less agitated but still showing some {behavior.replace('_', ' ')}.",
                False,
                "partially_resolved"
            )
        elif roll < 0.9:
            return (
                f"Intervention had limited effect. {event['patient_name']} continues to exhibit {behavior.replace('_', ' ')}. "
                f"Will try alternative approach.",
                False,
                "ineffective"
            )
        else:
            return (
                f"Situation escalated despite intervention. {event['patient_name']}'s {behavior.replace('_', ' ')} "
                f"has worsened. Notifying charge nurse.",
                False,
                "escalated"
            )

    async def generate_handoff(self, facility_id: int = 1) -> Optional[dict]:
        """Generate shift handoff report via CareLoop API."""
        shift_map = {"day": "Day", "evening": "Evening", "night": "Night"}
        to_shift_map = {"day": "Evening", "evening": "Night", "night": "Day"}

        response = await self._request_with_retry(
            "POST", "/api/handoffs/generate",
            json={
                "facility_id": facility_id,
                "from_shift": shift_map.get(self.shift, "Day"),
                "to_shift": to_shift_map.get(self.shift, "Evening"),
            }
        )

        if response is None or response.status_code >= 400:
            status = response.status_code if response else "no response"
            print(f"[{self.name}] Error generating handoff: {status}")
            return None

        return response.json()

    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

    def get_shift_summary(self) -> dict:
        """Get a summary of this caregiver's shift."""
        return {
            "caregiver": self.name,
            "role": self.role,
            "skill_level": self.skill_level,
            "events_reported": len(self.events_reported),
            "interventions_performed": len(self.interventions_performed),
            "events": self.events_reported,
        }
